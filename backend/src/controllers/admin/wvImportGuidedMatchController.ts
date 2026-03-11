/**
 * Guided CV Match Controller
 *
 * Two-step handshake:
 *   POST /wv-import/matches/:worldViewId/guided-match-prepare  — validates seeds, stores session
 *   GET  /wv-import/matches/:worldViewId/guided-match-stream   — SSE stream that runs the pipeline
 *
 * The user clicks water, park, and region seed points on the Wikivoyage map image.
 * The backend samples colors at those points, builds masks, assigns pixels to nearest
 * seed color via K-means, then delegates to the shared division-matching pipeline.
 */

import { Response } from 'express';
import sharp from 'sharp';
import crypto from 'crypto';
import type { AuthenticatedRequest } from '../../middleware/auth.js';
import { matchDivisionsFromClusters } from './wvImportMatchShared.js';
import { pool } from '../../db/index.js';

// =============================================================================
// In-memory session storage (sessionId → seeds), auto-cleanup after 5 min
// =============================================================================

interface GuidedSeeds {
  regionId: number;
  seeds: {
    waterPoints: Array<{ x: number; y: number }>;
    parkPoints: Array<{ x: number; y: number }>;
    regionSeeds: Array<{ x: number; y: number; regionId: number }>;
  };
  createdAt: number;
}

const pendingSessions = new Map<string, GuidedSeeds>();

setInterval(() => {
  const now = Date.now();
  for (const [id, s] of pendingSessions) {
    if (now - s.createdAt > 5 * 60_000) pendingSessions.delete(id);
  }
}, 60_000);

// =============================================================================
// POST handler — validate seeds, store session, return sessionId
// =============================================================================

export async function prepareGuidedMatch(req: AuthenticatedRequest, res: Response): Promise<void> {
  const worldViewId = parseInt(String(req.params.worldViewId));
  const { regionId, seeds } = req.body as {
    regionId: number;
    seeds: GuidedSeeds['seeds'];
  };

  // Fetch the region's map URL to validate it exists
  const regionResult = await pool.query(
    'SELECT region_map_url FROM regions WHERE id = $1 AND world_view_id = $2',
    [regionId, worldViewId],
  );
  if (!regionResult.rows[0]?.region_map_url) {
    res.status(404).json({ error: 'Region not found or has no map URL' });
    return;
  }

  const sessionId = crypto.randomUUID();
  pendingSessions.set(sessionId, { regionId, seeds, createdAt: Date.now() });
  res.json({ sessionId });
}

// =============================================================================
// GET SSE handler — retrieve session, process image, run pipeline
// =============================================================================

export async function guidedMatchDivisionsSSE(req: AuthenticatedRequest, res: Response): Promise<void> {
  const worldViewId = parseInt(String(req.params.worldViewId));
  const sessionId = String(req.query.sessionId);

  const session = pendingSessions.get(sessionId);
  if (!session) {
    res.status(404).json({ error: 'Session not found or expired' });
    return;
  }
  pendingSessions.delete(sessionId);
  const { regionId, seeds } = session;

  // SSE setup — match the pattern from colorMatchDivisionsSSE
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.flushHeaders();
  res.socket?.setNoDelay(true);

  const startTime = Date.now();
  const sendEvent = (event: Record<string, unknown>) => {
    if (res.destroyed) return;
    try { res.write(`data: ${JSON.stringify(event)}\n\n`); } catch { /* disconnected */ }
  };
  const debugImages: Array<{ label: string; dataUrl: string }> = [];
  const logStep = async (msg: string) => {
    sendEvent({ type: 'progress', step: msg, elapsed: (Date.now() - startTime) / 1000 });
  };
  const pushDebugImage = async (label: string, dataUrl: string) => {
    debugImages.push({ label, dataUrl });
    sendEvent({ type: 'debug_image', debugImage: { label, dataUrl } });
  };

  try {
    // 1. Fetch region map URL
    const regionResult = await pool.query(
      'SELECT r.region_map_url, r.name FROM regions r WHERE r.id = $1 AND r.world_view_id = $2',
      [regionId, worldViewId],
    );
    const regionMapUrl: string | undefined = regionResult.rows[0]?.region_map_url;
    if (!regionMapUrl) {
      sendEvent({ type: 'error', message: 'Region has no map URL' });
      res.end();
      return;
    }

    // 2. Query known division IDs (divisions already assigned to sibling regions)
    const knownDivisionsResult = await pool.query<{ division_id: number }>(
      `SELECT DISTINCT rm.division_id
       FROM region_members rm
       JOIN regions r ON r.id = rm.region_id
       WHERE r.parent_region_id = (
         SELECT parent_region_id FROM regions WHERE id = $1 AND world_view_id = $2
       ) AND r.world_view_id = $2`,
      [regionId, worldViewId],
    );
    const knownDivisionIds = new Set<number>(knownDivisionsResult.rows.map(row => row.division_id));

    await logStep('Downloading map image...');
    const mapResponse = await fetch(regionMapUrl, { redirect: 'follow' });
    if (!mapResponse.ok) {
      sendEvent({ type: 'error', message: `Failed to download map: ${mapResponse.status}` });
      res.end();
      return;
    }
    const mapBuffer = Buffer.from(await mapResponse.arrayBuffer());
    const origMeta = await sharp(mapBuffer).metadata();
    const origW = origMeta.width!;
    const origH = origMeta.height!;

    // Working resolution (same as auto pipeline)
    const TW = 800;
    const scale = TW / origW;
    const TH = Math.round(origH * scale);
    const tp = TW * TH;

    await logStep('Downscaling + sampling seed colors...');
    const imgBuf = await sharp(mapBuffer)
      .removeAlpha()
      .resize(TW, TH, { kernel: 'lanczos3' })
      .raw()
      .toBuffer();

    // Scale seed coordinates from original image space to working resolution
    const scaleX = (x: number) => Math.min(Math.round(x * scale), TW - 1);
    const scaleY = (y: number) => Math.min(Math.round(y * scale), TH - 1);

    // Sample colors at seed points
    const sampleColor = (x: number, y: number): [number, number, number] => {
      const i = (scaleY(y) * TW + scaleX(x)) * 3;
      return [imgBuf[i], imgBuf[i + 1], imgBuf[i + 2]];
    };

    const waterColors = seeds.waterPoints.map(p => sampleColor(p.x, p.y));
    const parkColors = seeds.parkPoints.map(p => sampleColor(p.x, p.y));
    const regionColors = seeds.regionSeeds.map(p => ({
      color: sampleColor(p.x, p.y),
      regionId: p.regionId,
    }));

    console.log(`  [Guided] Water seeds: ${waterColors.length}, Park seeds: ${parkColors.length}, Region seeds: ${regionColors.length}`);
    for (const rc of regionColors) {
      console.log(`    Region ${rc.regionId}: RGB(${rc.color[0]},${rc.color[1]},${rc.color[2]})`);
    }

    // 3. Build water mask from water seed colors
    await logStep('Building water mask from seed colors...');
    const WATER_DIST_SQ = 40 * 40; // RGB distance threshold (squared)
    const waterMask = new Uint8Array(tp);
    if (waterColors.length > 0) {
      for (let i = 0; i < tp; i++) {
        const r = imgBuf[i * 3], g = imgBuf[i * 3 + 1], b = imgBuf[i * 3 + 2];
        for (const wc of waterColors) {
          const d = (r - wc[0]) ** 2 + (g - wc[1]) ** 2 + (b - wc[2]) ** 2;
          if (d < WATER_DIST_SQ) { waterMask[i] = 1; break; }
        }
      }
    }
    let waterCount = 0;
    for (let i = 0; i < tp; i++) if (waterMask[i]) waterCount++;
    console.log(`  [Guided] Water mask: ${waterCount} pixels (${(waterCount / tp * 100).toFixed(1)}%)`);

    // 4. Build background mask from edge pixels
    await logStep('Detecting background...');
    const edgePixels: Array<[number, number, number]> = [];
    for (let x = 0; x < TW; x++) {
      edgePixels.push([imgBuf[x * 3], imgBuf[x * 3 + 1], imgBuf[x * 3 + 2]]);
      const bi = ((TH - 1) * TW + x) * 3;
      edgePixels.push([imgBuf[bi], imgBuf[bi + 1], imgBuf[bi + 2]]);
    }
    for (let y = 0; y < TH; y++) {
      const li = (y * TW) * 3;
      edgePixels.push([imgBuf[li], imgBuf[li + 1], imgBuf[li + 2]]);
      const ri = (y * TW + TW - 1) * 3;
      edgePixels.push([imgBuf[ri], imgBuf[ri + 1], imgBuf[ri + 2]]);
    }
    // Take median of edge pixels as single background color
    edgePixels.sort((a, b) => (a[0] + a[1] + a[2]) - (b[0] + b[1] + b[2]));
    const bgColor = edgePixels[Math.floor(edgePixels.length / 2)];
    const BG_DIST_SQ = 35 * 35;

    // 5. Build country mask (not water, not background)
    const countryMask = new Uint8Array(tp);
    let countrySize = 0;
    for (let i = 0; i < tp; i++) {
      if (waterMask[i]) continue;
      const r = imgBuf[i * 3], g = imgBuf[i * 3 + 1], b = imgBuf[i * 3 + 2];
      const dr = r - bgColor[0], dg = g - bgColor[1], db = b - bgColor[2];
      if (dr * dr + dg * dg + db * db > BG_DIST_SQ) {
        countryMask[i] = 1;
        countrySize++;
      }
    }
    console.log(`  [Guided] Country mask: ${countrySize} pixels (${(countrySize / tp * 100).toFixed(1)}%)`);

    // 6. Assign every country pixel to nearest region seed color
    await logStep('Assigning pixels to region seeds...');
    const CK = regionColors.length;
    const colorCentroids: Array<[number, number, number]> = regionColors.map(rc => [...rc.color] as [number, number, number]);
    const pixelLabels = new Uint8Array(tp).fill(255);
    const clusterCounts = new Array<number>(CK).fill(0);

    for (let i = 0; i < tp; i++) {
      if (!countryMask[i]) continue;
      const r = imgBuf[i * 3], g = imgBuf[i * 3 + 1], b = imgBuf[i * 3 + 2];
      let bestDist = Infinity, bestK = 0;
      for (let k = 0; k < CK; k++) {
        const d = (r - colorCentroids[k][0]) ** 2 + (g - colorCentroids[k][1]) ** 2 + (b - colorCentroids[k][2]) ** 2;
        if (d < bestDist) { bestDist = d; bestK = k; }
      }
      pixelLabels[i] = bestK;
      clusterCounts[bestK]++;
    }

    // 7. Refine centroids with K-means iterations
    for (let iter = 0; iter < 10; iter++) {
      const sums = colorCentroids.map(() => [0, 0, 0, 0]);
      for (let i = 0; i < tp; i++) {
        if (pixelLabels[i] === 255) continue;
        const k = pixelLabels[i];
        sums[k][0] += imgBuf[i * 3];
        sums[k][1] += imgBuf[i * 3 + 1];
        sums[k][2] += imgBuf[i * 3 + 2];
        sums[k][3]++;
      }
      for (let k = 0; k < CK; k++) {
        if (sums[k][3] > 0) {
          colorCentroids[k] = [
            Math.round(sums[k][0] / sums[k][3]),
            Math.round(sums[k][1] / sums[k][3]),
            Math.round(sums[k][2] / sums[k][3]),
          ];
        }
      }
      // Re-assign pixels to updated centroids
      clusterCounts.fill(0);
      for (let i = 0; i < tp; i++) {
        if (!countryMask[i]) continue;
        const r = imgBuf[i * 3], g = imgBuf[i * 3 + 1], b = imgBuf[i * 3 + 2];
        let bestDist = Infinity, bestK = 0;
        for (let k = 0; k < CK; k++) {
          const d = (r - colorCentroids[k][0]) ** 2 + (g - colorCentroids[k][1]) ** 2 + (b - colorCentroids[k][2]) ** 2;
          if (d < bestDist) { bestDist = d; bestK = k; }
        }
        pixelLabels[i] = bestK;
        clusterCounts[bestK]++;
      }
    }

    for (let k = 0; k < CK; k++) {
      console.log(`    cluster ${k} (region ${regionColors[k].regionId}): RGB(${colorCentroids[k][0]},${colorCentroids[k][1]},${colorCentroids[k][2]}) ${clusterCounts[k]}px`);
    }

    // Debug: source map
    const srcPng = await sharp(mapBuffer).resize(origW, origH).png().toBuffer();
    await pushDebugImage('Source map', `data:image/png;base64,${srcPng.toString('base64')}`);

    // Debug: seed overlay
    const seedVizBuf = Buffer.from(imgBuf);
    const drawDot = (cx: number, cy: number, cr: number, cg: number, cb: number, radius: number) => {
      const sx = scaleX(cx), sy = scaleY(cy);
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          if (dx * dx + dy * dy > radius * radius) continue;
          const nx = sx + dx, ny = sy + dy;
          if (nx >= 0 && nx < TW && ny >= 0 && ny < TH) {
            const ni = (ny * TW + nx) * 3;
            seedVizBuf[ni] = cr;
            seedVizBuf[ni + 1] = cg;
            seedVizBuf[ni + 2] = cb;
          }
        }
      }
    };
    for (const wp of seeds.waterPoints) drawDot(wp.x, wp.y, 0, 100, 255, 4);
    for (const pp of seeds.parkPoints) drawDot(pp.x, pp.y, 0, 200, 0, 4);
    for (const rs of seeds.regionSeeds) {
      // Yellow dots for region seeds regardless of their sampled color
      drawDot(rs.x, rs.y, 255, 255, 0, 5);
    }
    const seedPng = await sharp(seedVizBuf, { raw: { width: TW, height: TH, channels: 3 } })
      .resize(origW, origH, { kernel: 'lanczos3' })
      .png()
      .toBuffer();
    await pushDebugImage('Seed points (blue=water, green=park, yellow=region)', `data:image/png;base64,${seedPng.toString('base64')}`);

    // Debug: cluster assignment
    const clusterVizBuf = Buffer.alloc(tp * 3, 200);
    for (let i = 0; i < tp; i++) {
      if (waterMask[i]) {
        clusterVizBuf[i * 3] = 60;
        clusterVizBuf[i * 3 + 1] = 120;
        clusterVizBuf[i * 3 + 2] = 200;
      } else if (pixelLabels[i] < 255) {
        const c = colorCentroids[pixelLabels[i]];
        clusterVizBuf[i * 3] = c[0];
        clusterVizBuf[i * 3 + 1] = c[1];
        clusterVizBuf[i * 3 + 2] = c[2];
      }
    }
    const clusterPng = await sharp(clusterVizBuf, { raw: { width: TW, height: TH, channels: 3 } })
      .resize(origW, origH, { kernel: 'lanczos3' })
      .png()
      .toBuffer();
    await pushDebugImage('Guided clustering (user seed colors)', `data:image/png;base64,${clusterPng.toString('base64')}`);

    // 8. Call shared division-matching pipeline
    await matchDivisionsFromClusters({
      worldViewId,
      regionId,
      knownDivisionIds,
      buf: imgBuf,
      mapBuffer,
      countryMask,
      waterGrown: waterMask,
      pixelLabels,
      colorCentroids,
      TW,
      TH,
      origW,
      origH,
      skipClusterReview: true,
      sendEvent,
      logStep,
      pushDebugImage,
      debugImages,
      startTime,
    });

  } catch (err) {
    console.error('Guided CV match error:', err);
    sendEvent({ type: 'error', message: String(err) });
  } finally {
    res.end();
  }
}
