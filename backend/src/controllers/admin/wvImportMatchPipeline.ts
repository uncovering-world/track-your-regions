/**
 * WorldView Import Match — CV Pipeline Orchestrator
 *
 * SSE-streaming CV pipeline: data prep → text detection → water detection →
 * background extraction → park removal → K-means clustering → division matching.
 * Each phase lives in its own module; this file orchestrates the sequence.
 */

import { Response } from 'express';
import sharp from 'sharp';
import { pool } from '../../db/index.js';
import type { AuthenticatedRequest } from '../../middleware/auth.js';
import { matchDivisionsFromClusters, type ReclusterSignal } from './wvImportMatchShared.js';
import {
  removeColoredLines,
} from './wvImportMatchHelpers.js';
import { detectText } from './wvImportMatchText.js';
import { detectWater } from './wvImportMatchWater.js';
import { detectBackground } from './wvImportMatchBackground.js';
import { detectParks } from './wvImportMatchParks.js';
import { runKMeansClustering } from './wvImportMatchCluster.js';
import { meanshiftPreprocess } from './wvImportMatchMeanshift.js';

// OpenCV WASM — eagerly initialized at module load to avoid tsx/esbuild overhead during requests.
// tsx transforms every dynamic import() through esbuild, which takes 30s+ for the 10MB opencv.js.
// By importing at module level, the cost is paid once at server startup.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// Cache OpenCV on globalThis so it survives tsx hot-reloads
// (each hot-reload re-evaluates this module, but globalThis persists)
const G = globalThis as unknown as { __cv?: any; __cvReady?: Promise<void> };
if (!G.__cvReady) {
  G.__cvReady = (async () => {
    try {
      const mod = await import('@techstark/opencv-js') as Record<string, unknown>;
      const cv = (mod.default ?? mod) as Record<string, unknown>;
      for (let i = 0; i < 600 && !cv.Mat; i++) {
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      if (cv.Mat) {
        G.__cv = cv;
        console.log('OpenCV WASM initialized');
      } else {
        console.error('OpenCV WASM failed to initialize');
      }
    } catch (err) {
      console.error('OpenCV WASM load error:', err);
    }
  })();
}

// =============================================================================
// PipelineContext — shared state passed to all phase functions (future use)
// =============================================================================

export interface PipelineContext {
  // Inputs (set by orchestrator before first phase)
  cv: any;
  regionId: number;
  worldViewId: number;
  regionName: string;
  knownDivisionIds: Set<number>;
  expectedRegionCount: number;
  mapBuffer: Buffer;

  // Image dimensions
  TW: number;
  TH: number;
  tp: number;
  origW: number;
  origH: number;
  RES_SCALE: number;

  // Pixel buffers (set during noise removal in orchestrator)
  origDownBuf: Buffer;
  rawBuf: Buffer;
  colorBuf: Buffer;
  // NOTE: no separate `buf` alias — all phases use `colorBuf` directly

  // Derived buffers (set during various phases)
  hsvSharp: Buffer;
  labBufEarly: Buffer;
  hsvBuf: Buffer;
  inpaintedBuf: Buffer | null;

  // Masks (built up across phases)
  textExcluded: Uint8Array;
  waterGrown: Uint8Array;
  countryMask: Uint8Array;
  countrySize: number;
  coastalBand: Uint8Array;

  // K-means state (set by cluster phase)
  pixelLabels: Uint8Array;
  colorCentroids: Array<[number, number, number]>;
  clusterCounts: number[];

  // Recluster params (mutated by orchestrator loop)
  ckOverride: number | null;
  chromaBoost: number;
  randomSeed: boolean;

  // SSE/debug helpers (set by orchestrator)
  sendEvent: (event: Record<string, unknown>) => void;
  logStep: (step: string) => Promise<void>;
  pushDebugImage: (label: string, dataUrl: string) => Promise<void>;
  debugImages: Array<{ label: string; dataUrl: string }>;
  startTime: number;

  // Utility functions (depend on TW/RES_SCALE)
  oddK: (base: number) => number;
  pxS: (base: number) => number;
}

// =============================================================================
// colorMatchDivisionsSSE — monolithic CV pipeline (will be split in Tasks 4-8)
// =============================================================================

export async function colorMatchDivisionsSSE(req: AuthenticatedRequest, res: Response): Promise<void> {
  const worldViewId = parseInt(String(req.params.worldViewId));
  const regionId = parseInt(String(req.query.regionId));
  const method = String(req.query.method || 'classical');
  const usePolyRaster = req.query.polyRaster === 'true';

  // SSE setup — disable TCP buffering for immediate flush
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.flushHeaders();
  res.socket?.setNoDelay(true);

  const startTime = Date.now();
  const sendEvent = (event: { type: string; step?: string; elapsed?: number; debugImage?: { label: string; dataUrl: string }; data?: unknown; message?: string; reviewId?: string; waterMaskImage?: string; waterPxPercent?: number; waterComponents?: Array<{ id: number; pct: number; cropDataUrl: string; subClusters: Array<{ idx: number; pct: number; cropDataUrl: string }> }> }) => {
    if (res.destroyed) return;
    try { res.write(`data: ${JSON.stringify(event)}\n\n`); } catch { /* client disconnected */ }
  };
  const logStep = async (step: string) => {
    const elapsed = (Date.now() - startTime) / 1000;
    console.log(`[CV Match SSE] ${step} (${elapsed.toFixed(1)}s)`);
    sendEvent({ type: 'progress', step, elapsed });
    // Yield to event loop so SSE data actually flushes to client
    await new Promise(resolve => setImmediate(resolve));
  };

  // Get parent region info (name, map image)
  const regionResult = await pool.query(`
    SELECT r.name, ris.region_map_url
    FROM regions r
    LEFT JOIN region_import_state ris ON ris.region_id = r.id
    WHERE r.id = $1 AND r.world_view_id = $2
  `, [regionId, worldViewId]);

  if (regionResult.rows.length === 0) {
    sendEvent({ type: 'error', message: 'Region not found' });
    res.end();
    return;
  }

  const regionName = regionResult.rows[0].name as string;
  const regionMapUrl = regionResult.rows[0].region_map_url as string | null;

  if (!regionMapUrl) {
    sendEvent({ type: 'error', message: 'No map image selected for this region' });
    res.end();
    return;
  }

  await logStep(`Loading divisions for ${regionName}...`);

  // Collect divisions confirmed as part of this parent region's territory.
  // ALL members (parent + children) — used for GADM depth detection and centroid scope.
  // Only region_members (accepted assignments) count — suggestions from other tools
  // (name matching, etc.) must not influence the CV pipeline's division scope.
  const knownMemberResult = await pool.query(`
    SELECT DISTINCT division_id AS id, region_id FROM region_members
    WHERE region_id = $1 OR region_id IN (
      SELECT id FROM regions WHERE parent_region_id = $1 AND world_view_id = $2
    )
  `, [regionId, worldViewId]);

  const knownDivisionIds = new Set<number>();
  // Gap exclusion: only divisions assigned to CHILD regions, not the parent itself.
  // Divisions assigned to the parent are exactly what we're splitting — they must be processable.
  const childRegionMemberIds = new Set<number>();
  for (const r of knownMemberResult.rows) {
    knownDivisionIds.add(r.id as number);
    if ((r.region_id as number) !== regionId) {
      childRegionMemberIds.add(r.id as number);
    }
  }

  if (knownDivisionIds.size === 0) {
    sendEvent({ type: 'error', message: 'No divisions found in this region or its children — need at least one accepted division (region_members)' });
    res.end();
    return;
  }

  // Determine countryId: the GADM division whose children we want to match.
  // If the region's own division (not a child region's) has GADM children,
  // use it directly — we're splitting that territory into its sub-divisions.
  // Otherwise, walk up to the country ancestor and use siblings at the same depth.
  const parentDivIds = new Set<number>();
  for (const id of knownDivisionIds) {
    if (!childRegionMemberIds.has(id)) parentDivIds.add(id);
  }

  let countryId: number;
  let countryDepth: number;

  if (parentDivIds.size === 1) {
    const parentDivId = [...parentDivIds][0];
    // Check if this division has GADM children (i.e., can be split)
    const childrenCheck = await pool.query(
      'SELECT COUNT(*)::int AS cnt FROM administrative_divisions WHERE parent_id = $1',
      [parentDivId],
    );
    if ((childrenCheck.rows[0]?.cnt as number) > 0) {
      // Use the region's own division as the "country" — split into its children
      countryId = parentDivId;
      countryDepth = 0;
      console.log(`  [CV] Using region division ${parentDivId} as countryId (has ${childrenCheck.rows[0].cnt} children)`);
    } else {
      // Leaf division — fall through to ancestor walk
      countryId = 0;
      countryDepth = 0;
    }
  } else {
    countryId = 0;
    countryDepth = 0;
  }

  // If we couldn't use the region's own division, walk up to find the country ancestor
  if (countryId === 0) {
    const sampleDivId = [...knownDivisionIds][0];
    const sampleDivResult = await pool.query(
      'SELECT id, name, parent_id FROM administrative_divisions WHERE id = $1',
      [sampleDivId],
    );

    if (sampleDivResult.rows.length === 0) {
      sendEvent({ type: 'error', message: 'Sample division not found in GADM' });
      res.end();
      return;
    }

    if (sampleDivResult.rows[0].parent_id == null) {
      countryId = sampleDivResult.rows[0].id as number;
      countryDepth = 0;
    } else {
      const countryResult = await pool.query(`
        WITH RECURSIVE ancestors AS (
          SELECT id, name, parent_id, 0 AS depth FROM administrative_divisions WHERE id = $1
          UNION ALL
          SELECT ad.id, ad.name, ad.parent_id, a.depth + 1 FROM administrative_divisions ad
          JOIN ancestors a ON a.parent_id = ad.id
        )
        SELECT a.id, a.name, a.depth FROM ancestors a
        JOIN administrative_divisions p ON a.parent_id = p.id
        WHERE p.parent_id IS NULL
        LIMIT 1
      `, [sampleDivId]);

      const cId = countryResult.rows[0]?.id as number | undefined;
      const cDepth = countryResult.rows[0]?.depth as number | undefined;
      if (!cId || cDepth === undefined) {
        sendEvent({ type: 'error', message: 'Could not find country ancestor' });
        res.end();
        return;
      }
      countryId = cId;
      countryDepth = cDepth;
    }
  }

  // Get ALL GADM divisions at the same depth as the sample (all siblings across the country).
  // depth=1 means direct children of country, depth=2 means grandchildren, etc.
  // If depth=0, the sample IS the country itself — go one level deeper to get subdivisions.
  let targetDepth = countryDepth === 0 ? 1 : countryDepth;
  let allDivsResult = await pool.query(`
    WITH RECURSIVE descendants AS (
      SELECT id, 0 AS depth FROM administrative_divisions WHERE id = $1
      UNION ALL
      SELECT ad.id, d.depth + 1 FROM administrative_divisions ad
      JOIN descendants d ON ad.parent_id = d.id
      WHERE d.depth < $2
    )
    SELECT id FROM descendants WHERE depth = $2
  `, [countryId, targetDepth]);

  // If only 1 division found (e.g. sample at country level), try one level deeper
  if (allDivsResult.rows.length <= 1 && targetDepth === countryDepth) {
    targetDepth = countryDepth + 1;
    allDivsResult = await pool.query(`
      WITH RECURSIVE descendants AS (
        SELECT id, 0 AS depth FROM administrative_divisions WHERE id = $1
        UNION ALL
        SELECT ad.id, d.depth + 1 FROM administrative_divisions ad
        JOIN descendants d ON ad.parent_id = d.id
        WHERE d.depth < $2
      )
      SELECT id FROM descendants WHERE depth = $2
    `, [countryId, targetDepth]);
  }

  // Union GADM descendants with ALL known divisions from region members + suggestions.
  // The GADM walk captures unassigned siblings, while known divisions ensure
  // multi-part territories (e.g. Egypt with African + Asian divisions) are fully covered.
  const allDivisionIdSet = new Set<number>();
  for (const r of allDivsResult.rows) allDivisionIdSet.add(r.id as number);
  for (const id of knownDivisionIds) allDivisionIdSet.add(id);

  const allDivisionIds = [...allDivisionIdSet];
  if (allDivisionIds.length === 0) {
    sendEvent({ type: 'error', message: 'No divisions found at this level' });
    res.end();
    return;
  }

  const gapCount = allDivisionIds.length - childRegionMemberIds.size;
  await logStep(`Found ${allDivisionIds.length} divisions (${childRegionMemberIds.size} assigned to child regions, ${gapCount} to process)`);

  // Get which divisions are already assigned to which child region
  const assignedResult = await pool.query(`
    SELECT rm.division_id, rm.region_id, r.name AS region_name
    FROM region_members rm
    JOIN regions r ON r.id = rm.region_id
    WHERE rm.region_id IN (
      SELECT id FROM regions WHERE parent_region_id = $1 AND world_view_id = $2
    )
  `, [regionId, worldViewId]);

  const assignedMap = new Map<number, { regionId: number; regionName: string }>();
  for (const r of assignedResult.rows) {
    assignedMap.set(r.division_id as number, {
      regionId: r.region_id as number,
      regionName: r.region_name as string,
    });
  }

  // Count child regions to cap K-means cluster count
  const childCountResult = await pool.query(
    `SELECT COUNT(*) FROM regions WHERE parent_region_id = $1 AND world_view_id = $2`,
    [regionId, worldViewId],
  );
  const expectedRegionCount = parseInt(childCountResult.rows[0].count as string);

  // Fetch centroids + names for all divisions
  const centroidResult = await pool.query(`
    SELECT id, name,
      ST_X(ST_Centroid(geom_simplified_medium)) AS cx,
      ST_Y(ST_Centroid(geom_simplified_medium)) AS cy
    FROM administrative_divisions
    WHERE id = ANY($1) AND geom_simplified_medium IS NOT NULL
  `, [allDivisionIds]);

  // Map division ID → display name (built up as we recurse deeper)
  const divNameMap = new Map<number, string>();

  const centroids = centroidResult.rows.map(r => {
    const name = r.name as string;
    divNameMap.set(r.id as number, name);
    return {
      id: r.id as number,
      cx: parseFloat(r.cx as string),
      cy: parseFloat(r.cy as string),
      assigned: assignedMap.get(r.id as number) ?? null,
    };
  });

  await logStep(`Computing borders for ${centroids.length} divisions...`);

  // Fetch individual division SVG paths + classified borders + country outline
  const [divPathsResult, borderResult] = await Promise.all([
    // Individual division outlines as SVG (for CV rasterization)
    pool.query(`
      SELECT id, ST_AsSVG(geom_simplified_medium, 0, 4) AS svg_path
      FROM administrative_divisions
      WHERE id = ANY($1) AND geom_simplified_medium IS NOT NULL
    `, [allDivisionIds]),
    // Union border classification + region outline + bbox
    // Use subset (union of all relevant divisions) for bbox — NOT the GADM country,
    // so multi-part regions (e.g. Egypt: Africa + Sinai) get full coverage.
    pool.query(`
      WITH subset AS (
        SELECT ST_Union(geom_simplified_medium) AS geom
        FROM administrative_divisions
        WHERE id = ANY($1) AND geom_simplified_medium IS NOT NULL
      ),
      all_borders AS (
        SELECT ST_Union(ST_Boundary(geom_simplified_medium)) AS geom
        FROM administrative_divisions
        WHERE id = ANY($1) AND geom_simplified_medium IS NOT NULL
      )
      SELECT
        ST_AsSVG(subset.geom, 0, 4) AS country_path,
        ST_AsSVG(
          ST_Intersection(
            all_borders.geom,
            ST_Buffer(ST_Boundary(subset.geom), 0.001)
          ), 0, 4
        ) AS external_border,
        ST_AsSVG(
          ST_Difference(
            all_borders.geom,
            ST_Buffer(ST_Boundary(subset.geom), 0.001)
          ), 0, 4
        ) AS internal_border,
        ST_XMin(subset.geom) AS country_min_x,
        ST_YMin(subset.geom) AS country_min_y,
        ST_XMax(subset.geom) AS country_max_x,
        ST_YMax(subset.geom) AS country_max_y
      FROM subset, all_borders
    `, [allDivisionIds]),
  ]);

  if (borderResult.rows.length === 0) {
    sendEvent({ type: 'error', message: 'Could not compute borders' });
    res.end();
    return;
  }

  // Individual division paths (SVG for CV rasterization)
  const divPaths = divPathsResult.rows.map(r => ({
    id: r.id as number,
    svgPath: r.svg_path as string,
  }));

  const row = borderResult.rows[0];
  const countryPath = row.country_path as string;
  const externalBorder = row.external_border as string | null;
  const internalBorder = row.internal_border as string | null;
  const cMinX = parseFloat(row.country_min_x as string);
  const cMinY = parseFloat(row.country_min_y as string);
  const cMaxX = parseFloat(row.country_max_x as string);
  const cMaxY = parseFloat(row.country_max_y as string);

  // Build debug SVG with country context
  const pad = 0.5;
  const vbX = cMinX - pad;
  const vbY = -(cMaxY + pad);
  const vbW = (cMaxX - cMinX) + 2 * pad;
  const vbH = (cMaxY - cMinY) + 2 * pad;
  const ss = Math.max(vbW, vbH) / 800; // stroke scale (thin lines for accuracy)

  // Individual division outlines (all same style — assigned/unassigned shown by centroid dots)
  const divisionShapes = divPaths.map(d =>
    `<path d="${d.svgPath}" fill="#ddeeff" stroke="#90a4ae" stroke-width="${ss}" fill-opacity="0.7"/>`
  ).join('\n');

  // Centroid dots (green = assigned, orange = unassigned)
  const dots = centroids.map(c => {
    const color = c.assigned ? '#2e7d32' : '#e65100';
    return `<circle cx="${c.cx}" cy="${-c.cy}" r="${ss * 4}" fill="${color}" stroke="white" stroke-width="${ss * 0.5}"/>`;
  }).join('\n');

  const borderSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vbX} ${vbY} ${vbW} ${vbH}" width="1600">
    <rect x="${vbX}" y="${vbY}" width="${vbW}" height="${vbH}" fill="#f0f2f5"/>
    <path d="${countryPath}" fill="#e8e8e8" stroke="#bbb" stroke-width="${ss * 0.5}"/>
    ${divisionShapes}
    ${externalBorder ? `<path d="${externalBorder}" fill="none" stroke="#d32f2f" stroke-width="${ss * 3}" stroke-linecap="round"/>` : ''}
    ${internalBorder ? `<path d="${internalBorder}" fill="none" stroke="#1565c0" stroke-width="${ss * 2}" stroke-dasharray="${ss * 4},${ss * 3}" stroke-linecap="round"/>` : ''}
    ${dots}
  </svg>`;

  const borderPng = await sharp(Buffer.from(borderSvg))
    .flatten({ background: '#f0f2f5' })
    .png()
    .toBuffer();

  const debugImages: Array<{ label: string; dataUrl: string }> = [];
  let debugIdx = 0;
  const debugSlug = regionName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const pushDebugImage = async (label: string, dataUrl: string) => {
    const img = { label, dataUrl };
    debugImages.push(img);
    sendEvent({ type: 'debug_image', debugImage: img });
    // Save debug images to /tmp for inspection (named by region to avoid overwrites)
    try {
      const b64 = dataUrl.replace(/^data:image\/\w+;base64,/, '');
      const fs = await import('fs');
      fs.writeFileSync(`/tmp/cv-debug-${debugSlug}-${debugIdx++}.png`, Buffer.from(b64, 'base64'));
    } catch { /* ignore */ }
    await new Promise(resolve => setImmediate(resolve));
  };

  await pushDebugImage(
    'Step 1: GADM divisions with classified borders (red=external, blue dashed=internal, green dot=assigned, orange dot=unassigned)',
    `data:image/png;base64,${borderPng.toString('base64')}`,
  );

  // Step 2: CV border detection on the source map image
  // Pipeline: downscale → noise removal (rivers/roads/text) → multi-bg detection via edge K-means →
  // foreground mask → morphological close → connected components → country silhouette →
  // K-means color clustering → spatial split → merge → ICP → division assignment → OCR → geo preview

  try {
    await logStep('Fetching source map image...');
    const mapResponse = await fetch(regionMapUrl, {
      headers: { 'User-Agent': 'TrackYourRegions/1.0 (CV border detection)' },
      redirect: 'follow',
    });
    if (mapResponse.ok) {
      const mapBuffer = Buffer.from(await mapResponse.arrayBuffer());
      const origMeta = await sharp(mapBuffer).metadata();
      const origW = origMeta.width!;
      const origH = origMeta.height!;

      // Downscale to 800px + targeted noise removal (rivers, roads, text)
      const TW = 800;
      const scale = TW / origW;
      const TH = Math.round(origH * scale);
      const tp = TW * TH;
      // Scale factor for pixel-based constants (calibrated at 500px base resolution)
      const RES_SCALE = TW / 500;
      /** Scale pixel constant and ensure odd (required for OpenCV kernels) */
      const oddK = (base: number) => { const v = Math.round(base * RES_SCALE); return v | 1; };
      /** Scale pixel constant (round to nearest integer) */
      const pxS = (base: number) => Math.round(base * RES_SCALE);

      await logStep('Noise removal (downscale + median + line removal)...');
      if (!G.__cv) throw new Error('OpenCV WASM not available');
      const cv = G.__cv;
      // Keep clean downscale for water review crops (before any processing)
      const origDownBuf = await sharp(mapBuffer)
        .removeAlpha()
        .resize(TW, TH, { kernel: 'lanczos3' })
        .raw()
        .toBuffer();
      // Light median + color-targeted line removal (kernel scales with resolution)
      const rawBuf = await sharp(mapBuffer)
        .removeAlpha()
        .resize(TW, TH, { kernel: 'lanczos3' })
        .median(oddK(5))
        .raw()
        .toBuffer();
      removeColoredLines(rawBuf, TW, TH, RES_SCALE);

      // Clean color buffer for K-means: start from origDownBuf with NO processing.
      // Text + colored lines are detected as masks and Telea-inpainted in detectText
      // with a tight radius — no 8px median blur that destroys thin coastal regions.
      const colorBuf = Buffer.from(origDownBuf);

      // Debug: show image after noise removal (before CV processing)
      const noiseRemovedPng = await sharp(Buffer.from(rawBuf), {
        raw: { width: TW, height: TH, channels: 3 },
      }).resize(origW, origH, { kernel: 'lanczos3' }).png().toBuffer();
      await pushDebugImage(
        'After noise removal (downscale + median + line removal)',
        `data:image/png;base64,${noiseRemovedPng.toString('base64')}`,
      );

      // --- Step A: Detect text/symbols for exclusion (no colorBuf modification) ---
      const ctx: PipelineContext = {
        cv, regionId, worldViewId, regionName,
        knownDivisionIds,
        expectedRegionCount, mapBuffer,
        TW, TH, tp, origW, origH, RES_SCALE,
        origDownBuf, rawBuf, colorBuf,
        hsvSharp: Buffer.alloc(0), labBufEarly: Buffer.alloc(0),
        hsvBuf: Buffer.alloc(0), inpaintedBuf: null,
        textExcluded: new Uint8Array(0), waterGrown: new Uint8Array(0),
        countryMask: new Uint8Array(0), countrySize: 0,
        coastalBand: new Uint8Array(0),
        pixelLabels: new Uint8Array(0),
        colorCentroids: [], clusterCounts: [],
        ckOverride: null, chromaBoost: 1.0, randomSeed: false,
        sendEvent: sendEvent as PipelineContext['sendEvent'],
        logStep, pushDebugImage, debugImages, startTime,
        oddK, pxS,
      };
      // Branch based on method: mean-shift replaces the classical 4-phase pipeline
      if (method === 'meanshift') {
        await meanshiftPreprocess(ctx);
      } else {
        // Classical pipeline: text → water → background → parks
        await detectText(ctx);
        await detectWater(ctx);
        await detectBackground(ctx);
        await detectParks(ctx);
      }

      // Recluster loop: re-run K-means with modified params when user requests
      let reclusterResult: ReclusterSignal | void;
      let skipKmeans = false; // remove_roads skips K-means — just cleans existing clusters
      do {
        if (!skipKmeans) await runKMeansClustering(ctx);
        skipKmeans = false;

        // ── Spatial split through complete event: delegated to shared function ──
        reclusterResult = await matchDivisionsFromClusters({
          worldViewId, regionId, knownDivisionIds: childRegionMemberIds, countryId, countryDepth,
          buf: ctx.colorBuf, mapBuffer, countryMask: ctx.countryMask,
          waterGrown: ctx.waterGrown, pixelLabels: ctx.pixelLabels,
          colorCentroids: ctx.colorCentroids,
          TW, TH, origW, origH,
          skipClusterReview: false,
          usePolyRaster,
          sendEvent: sendEvent as (event: Record<string, unknown>) => void,
          logStep, pushDebugImage, debugImages, startTime,
        });

        if (reclusterResult?.recluster) {
          const preset = reclusterResult.preset;
          if (preset === 'more_clusters') {
            const baseCK = ctx.ckOverride ?? Math.max(8, Math.min(expectedRegionCount * 3, 32));
            ctx.ckOverride = Math.min(baseCK + 4, 32);
            console.log(`  [Recluster] More clusters: CK → ${ctx.ckOverride}`);
          } else if (preset === 'different_seed') {
            ctx.randomSeed = true;
            console.log(`  [Recluster] Different seed: randomizing K-means++ init`);
          } else if (preset === 'boost_chroma') {
            ctx.chromaBoost = 1.5;
            console.log(`  [Recluster] Boost chroma: a*/b* weight → ${ctx.chromaBoost}`);
          } else if (preset === 'remove_roads') {
            // Morphological opening removes thin features (roads, border lines)
            // while preserving solid region fills. k=5 ellipse removes ~1-3px lines.
            // Does NOT re-run K-means — just removes pixels from existing clusters.
            const cmMat = cv.matFromArray(TH, TW, cv.CV_8UC1,
              Uint8Array.from(ctx.countryMask, (v: number) => v ? 255 : 0));
            const roadK = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(5, 5));
            const opened = new cv.Mat();
            cv.morphologyEx(cmMat, opened, cv.MORPH_OPEN, roadK);
            let removed = 0;
            for (let i = 0; i < tp; i++) {
              if (ctx.countryMask[i] && !opened.data[i]) {
                ctx.countryMask[i] = 0;
                ctx.countrySize--;
                // Also exclude from cluster labels so review sees clean clusters
                if (ctx.pixelLabels[i] !== 255) {
                  ctx.clusterCounts[ctx.pixelLabels[i]]--;
                  ctx.pixelLabels[i] = 255;
                }
                removed++;
              }
            }
            cmMat.delete(); roadK.delete(); opened.delete();
            skipKmeans = true; // re-show cluster review with cleaned existing clusters
            console.log(`  [Remove roads] Removed ${removed} thin pixels (${(removed / tp * 100).toFixed(1)}%)`);
          } else if (preset === 'fill_holes') {
            // Fill interior holes in the country mask (text/sign gaps).
            // Flood-fill from image borders on the INVERSE mask to find exterior.
            // Everything not reachable from borders = interior holes → fill them.
            const inverseMask = new Uint8Array(tp);
            for (let i = 0; i < tp; i++) {
              if (!ctx.countryMask[i]) inverseMask[i] = 1;
            }
            // Flood-fill from all border pixels to mark exterior
            const exterior = new Uint8Array(tp);
            const queue: number[] = [];
            for (let x = 0; x < TW; x++) {
              if (inverseMask[x]) { exterior[x] = 1; queue.push(x); }
              const bot = (TH - 1) * TW + x;
              if (inverseMask[bot]) { exterior[bot] = 1; queue.push(bot); }
            }
            for (let y = 0; y < TH; y++) {
              const left = y * TW;
              if (inverseMask[left]) { exterior[left] = 1; queue.push(left); }
              const right = y * TW + TW - 1;
              if (inverseMask[right]) { exterior[right] = 1; queue.push(right); }
            }
            let head = 0;
            while (head < queue.length) {
              const p = queue[head++];
              const px = p % TW, py = Math.floor(p / TW);
              for (const n of [p - 1, p + 1, p - TW, p + TW]) {
                if (n >= 0 && n < tp && inverseMask[n] && !exterior[n]) {
                  const nx = n % TW, ny = Math.floor(n / TW);
                  if (nx >= 0 && nx < TW && ny >= 0 && ny < TH) {
                    exterior[n] = 1;
                    queue.push(n);
                  }
                }
              }
            }
            // Interior holes = inverse pixels NOT reachable from borders
            // Collect hole pixels, then BFS-assign each to the nearest surrounding cluster
            const holePixels: number[] = [];
            for (let i = 0; i < tp; i++) {
              if (inverseMask[i] && !exterior[i]) {
                ctx.countryMask[i] = 1;
                ctx.countrySize++;
                holePixels.push(i);
              }
            }
            // BFS from all existing cluster boundary pixels into holes
            // Each hole pixel gets the label of the nearest clustered neighbor
            if (holePixels.length > 0) {
              const holeSet = new Set(holePixels);
              const fillQueue: number[] = [];
              // Seed: cluster pixels adjacent to hole pixels
              for (const hp of holePixels) {
                for (const n of [hp - 1, hp + 1, hp - TW, hp + TW]) {
                  if (n >= 0 && n < tp && ctx.pixelLabels[n] !== 255 && !holeSet.has(n)) {
                    // This neighbor has a cluster — seed BFS from it
                    // But we want to BFS INTO holes, so check if hp itself needs a label
                    if (ctx.pixelLabels[hp] === 255) {
                      ctx.pixelLabels[hp] = ctx.pixelLabels[n];
                      ctx.clusterCounts[ctx.pixelLabels[n]]++;
                      fillQueue.push(hp);
                    }
                  }
                }
              }
              // BFS outward through remaining hole pixels
              let fHead = 0;
              while (fHead < fillQueue.length) {
                const p = fillQueue[fHead++];
                const label = ctx.pixelLabels[p];
                for (const n of [p - 1, p + 1, p - TW, p + TW]) {
                  if (n >= 0 && n < tp && holeSet.has(n) && ctx.pixelLabels[n] === 255) {
                    ctx.pixelLabels[n] = label;
                    ctx.clusterCounts[label]++;
                    fillQueue.push(n);
                  }
                }
              }
            }
            skipKmeans = true; // holes assigned via BFS, no K-means needed
            console.log(`  [Fill holes] Filled ${holePixels.length} interior hole pixels (${(holePixels.length / tp * 100).toFixed(1)}%)`);
          } else if (preset === 'clean_light' || preset === 'clean_heavy') {
            // Remove small isolated pixel clusters (text remnants, icon fragments).
            // Light: remove CCs < 0.1% of country area. Heavy: < 0.5%.
            const threshold = preset === 'clean_light' ? 0.001 : 0.005;
            const minSize = Math.max(5, Math.round(ctx.countrySize * threshold));
            // BFS connected components on the country mask
            const ccLabels = new Int32Array(tp);
            let nextLabel = 1;
            const ccSizes = new Map<number, number>();
            for (let i = 0; i < tp; i++) {
              if (!ctx.countryMask[i] || ccLabels[i] > 0) continue;
              const label = nextLabel++;
              let size = 0;
              const bfs = [i];
              while (bfs.length > 0) {
                const p = bfs.pop()!;
                if (p < 0 || p >= tp || ccLabels[p] > 0 || !ctx.countryMask[p]) continue;
                ccLabels[p] = label;
                size++;
                const x = p % TW, y = Math.floor(p / TW);
                if (x > 0) bfs.push(p - 1);
                if (x < TW - 1) bfs.push(p + 1);
                if (y > 0) bfs.push(p - TW);
                if (y < TH - 1) bfs.push(p + TW);
              }
              ccSizes.set(label, size);
            }
            let removed = 0;
            const removedCCs = [...ccSizes.entries()].filter(([, s]) => s < minSize).length;
            for (let i = 0; i < tp; i++) {
              if (ccLabels[i] > 0 && (ccSizes.get(ccLabels[i]) ?? 0) < minSize) {
                ctx.countryMask[i] = 0;
                ctx.countrySize--;
                if (ctx.pixelLabels[i] !== 255) {
                  ctx.clusterCounts[ctx.pixelLabels[i]]--;
                  ctx.pixelLabels[i] = 255;
                }
                removed++;
              }
            }
            skipKmeans = true;
            console.log(`  [Clean ${preset === 'clean_light' ? 'light' : 'heavy'}] Removed ${removed} pixels in ${removedCCs} small CCs (threshold: <${minSize}px = ${(threshold * 100).toFixed(1)}% of country)`);
          }
          await logStep(skipKmeans ? 'Cleaning...' : 'Re-clustering...');
        }
      } while (reclusterResult?.recluster);

    } else {
      console.log(`  Source map fetch failed: ${mapResponse.status}`);
    }
  } catch (mapErr) {
    const errMsg = mapErr instanceof Error ? mapErr.message : String(mapErr);
    console.error('  Source map border detection failed:', mapErr);
    await logStep(`CV processing error: ${errMsg}`);
  }

  if (!res.destroyed) res.end();
}
