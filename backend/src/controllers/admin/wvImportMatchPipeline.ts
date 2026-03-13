/**
 * WorldView Import Match — CV Pipeline Orchestrator
 *
 * Contains the monolithic colorMatchDivisionsSSE function (moved from controller).
 * Future tasks will extract individual phases into separate modules.
 */

import { Response } from 'express';
import sharp from 'sharp';
import { pool } from '../../db/index.js';
import type { AuthenticatedRequest } from '../../middleware/auth.js';
import { matchDivisionsFromClusters, type ReclusterSignal } from './wvImportMatchShared.js';
import {
  removeColoredLines,
} from './wvImportMatchHelpers.js';
import {
  pendingParkReviews,
  storeParkCrops,
  type ParkReviewDecision,
} from './wvImportMatchReview.js';
import { detectText } from './wvImportMatchText.js';
import { detectWater } from './wvImportMatchWater.js';
import { detectBackground } from './wvImportMatchBackground.js';

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

  // Collect ALL divisions known to be part of this parent region's territory.
  // Includes divisions assigned to the parent itself and to all child regions,
  // both via region_members (confirmed) and region_match_suggestions (proposed).
  // This ensures multi-part territories (e.g. Egypt: Africa + Sinai) are fully covered.
  const [knownMemberResult, knownSugResult] = await Promise.all([
    pool.query(`
      SELECT DISTINCT division_id AS id FROM region_members
      WHERE region_id = $1 OR region_id IN (
        SELECT id FROM regions WHERE parent_region_id = $1 AND world_view_id = $2
      )
    `, [regionId, worldViewId]),
    pool.query(`
      SELECT DISTINCT rms.division_id AS id FROM region_match_suggestions rms
      WHERE (rms.region_id = $1 OR rms.region_id IN (
        SELECT id FROM regions WHERE parent_region_id = $1 AND world_view_id = $2
      ))
      AND rms.rejected = FALSE
    `, [regionId, worldViewId]),
  ]);

  const knownDivisionIds = new Set<number>();
  for (const r of knownMemberResult.rows) knownDivisionIds.add(r.id as number);
  for (const r of knownSugResult.rows) knownDivisionIds.add(r.id as number);

  if (knownDivisionIds.size === 0) {
    sendEvent({ type: 'error', message: 'No divisions found in this region or its children — need at least one assigned or suggested division' });
    res.end();
    return;
  }

  const sampleDivId = [...knownDivisionIds][0];

  // Find country ancestor + determine GADM depth of sample division
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

  const countryId = countryResult.rows[0]?.id as number | undefined;
  const countryDepth = countryResult.rows[0]?.depth as number | undefined;
  if (!countryId || countryDepth === undefined) {
    sendEvent({ type: 'error', message: 'Could not find country ancestor' });
    res.end();
    return;
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

  const gadmCount = allDivsResult.rows.length;
  const extraFromRegion = allDivisionIds.length - gadmCount;
  if (extraFromRegion > 0) {
    await logStep(`Found ${gadmCount} GADM divisions + ${extraFromRegion} extra from region members (total: ${allDivisionIds.length})`);
  }

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

      // Clean color buffer for K-means: start from origDownBuf (zero spatial filtering →
      // zero cross-boundary contamination). Text is removed via BFS color propagation
      // (nearest non-text neighbor color) instead of Telea inpainting (which bleeds ocean)
      // or spatial filters (median/bilateral/mean-shift all blur across boundaries).
      // This is the "Photoshop Select by Color → Content-Aware Fill" approach.
      const colorBuf = Buffer.from(origDownBuf);
      removeColoredLines(colorBuf, TW, TH, RES_SCALE);

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
        expectedRegionCount: 0, mapBuffer,
        TW, TH, tp, origW, origH, RES_SCALE,
        origDownBuf, rawBuf, colorBuf,
        hsvSharp: Buffer.alloc(0), labBufEarly: Buffer.alloc(0),
        hsvBuf: Buffer.alloc(0), inpaintedBuf: null,
        textExcluded: new Uint8Array(0), waterGrown: new Uint8Array(0),
        countryMask: new Uint8Array(0), countrySize: 0,
        coastalBand: new Uint8Array(0),
        pixelLabels: new Uint8Array(0),
        colorCentroids: [], clusterCounts: [],
        ckOverride: null, chromaBoost: 0, randomSeed: false,
        sendEvent: sendEvent as PipelineContext['sendEvent'],
        logStep, pushDebugImage, debugImages, startTime,
        oddK, pxS,
      };
      await detectText(ctx);
      const textExcluded = ctx.textExcluded;
      const labBufEarly = ctx.labBufEarly;

      // --- Step B: Water detection (multi-signal voting + CC + interactive review) ---
      await detectWater(ctx);
      const waterGrown = ctx.waterGrown;

      // --- Step C: Background/foreground detection ---
      await detectBackground(ctx);
      const countryMask = ctx.countryMask;
      let countrySize = ctx.countrySize;

      // ── Park overlay detection & removal ──────────────────────────────────
      // Wikivoyage maps overlay national parks/reserves as dark saturated green
      // blobs on top of region colors. These steal K-means clusters from actual
      // regions. Detect them by: dark + saturated + greenish pixels within the
      // country mask, forming mid-sized blobs that are distinctly darker than
      // their surroundings. Inpaint confirmed parks with per-pixel nearest
      // boundary color (not uniform average) so parks spanning two regions get
      // correct colors on each side.
      await logStep('Detecting park overlays...');
      {
        // Step 1: Find "dark saturated green" candidates in the country mask
        const parkCandidate = new Uint8Array(tp);
        // Compute median brightness of country pixels to set relative threshold
        const brightnesses: number[] = [];
        for (let i = 0; i < tp; i++) {
          if (!countryMask[i]) continue;
          brightnesses.push(Math.max(colorBuf[i * 3], colorBuf[i * 3 + 1], colorBuf[i * 3 + 2]));
        }
        brightnesses.sort((a, b) => a - b);
        const medianV = brightnesses[Math.floor(brightnesses.length / 2)] || 128;
        // Park criterion: dark relative to median, saturated, greenish
        const vThresh = Math.round(medianV * 0.78); // darker than 78% of median (was 72%)
        for (let i = 0; i < tp; i++) {
          if (!countryMask[i]) continue;
          const r = colorBuf[i * 3], g = colorBuf[i * 3 + 1], b2 = colorBuf[i * 3 + 2];
          const maxC = Math.max(r, g, b2);
          const minC = Math.min(r, g, b2);
          const sat = maxC > 0 ? (maxC - minC) / maxC : 0;
          // Dark + saturated + green-dominant (or at least green is high)
          if (maxC <= vThresh && sat >= 0.20 && g >= r && g >= b2 * 0.8) {
            parkCandidate[i] = 1;
          }
        }

        // Step 2: Morphological close to fill small gaps in park blobs
        // Dilation then erosion (kernel scales with resolution to bridge text gaps)
        const PARK_MORPH_R = pxS(2);
        const dilated = new Uint8Array(tp);
        for (let i = 0; i < tp; i++) {
          if (parkCandidate[i]) { dilated[i] = 1; continue; }
          if (!countryMask[i]) continue;
          const x = i % TW, y = Math.floor(i / TW);
          outer: for (let dy = -PARK_MORPH_R; dy <= PARK_MORPH_R; dy++) {
            for (let dx = -PARK_MORPH_R; dx <= PARK_MORPH_R; dx++) {
              const nx = x + dx, ny = y + dy;
              if (nx >= 0 && nx < TW && ny >= 0 && ny < TH && parkCandidate[ny * TW + nx]) { dilated[i] = 1; break outer; }
            }
          }
        }
        const closed = new Uint8Array(tp);
        for (let i = 0; i < tp; i++) {
          if (!dilated[i]) continue;
          const x = i % TW, y = Math.floor(i / TW);
          let allSet = true;
          for (let dy = -PARK_MORPH_R; dy <= PARK_MORPH_R && allSet; dy++) {
            for (let dx = -PARK_MORPH_R; dx <= PARK_MORPH_R && allSet; dx++) {
              const nx = x + dx, ny = y + dy;
              if (nx >= 0 && nx < TW && ny >= 0 && ny < TH) {
                if (!dilated[ny * TW + nx]) allSet = false;
              }
            }
          }
          if (allSet) closed[i] = 1;
        }
        // Use closed mask for CC, but only within country
        const parkMask = new Uint8Array(tp);
        for (let i = 0; i < tp; i++) {
          if (countryMask[i] && closed[i]) parkMask[i] = 1;
        }

        // Step 3: Connected components + size filter
        const parkVisited = new Uint8Array(tp);
        interface ParkBlob { id: number; pixels: number[]; avgR: number; avgG: number; avgB: number; boundaryAvgColor: [number, number, number] }
        const parkBlobs: ParkBlob[] = [];
        const minParkPx = Math.max(pxS(200), Math.round(countrySize * 0.003)); // >0.3%
        const maxParkPx = Math.round(countrySize * 0.15); // <15% (raised from 4%)
        let blobId = 0;
        for (let i = 0; i < tp; i++) {
          if (!parkMask[i] || parkVisited[i]) continue;
          const pixels: number[] = [];
          const q = [i]; parkVisited[i] = 1; let h = 0;
          while (h < q.length) {
            const p = q[h++]; pixels.push(p);
            for (const n of [p - TW, p + TW, p - 1, p + 1]) {
              if (n >= 0 && n < tp && !parkVisited[n] && parkMask[n]) { parkVisited[n] = 1; q.push(n); }
            }
          }
          const pxPct = (pixels.length / countrySize * 100).toFixed(1);
          if (pixels.length < minParkPx) {
            console.log(`    [Park skip] CC ${pixels.length}px (${pxPct}%) — too small (min=${minParkPx})`);
            continue;
          }
          if (pixels.length > maxParkPx) {
            console.log(`    [Park skip] CC ${pixels.length}px (${pxPct}%) — too large (max=${maxParkPx})`);
            continue;
          }
          // Compute blob average color
          let rr = 0, gg = 0, bb = 0;
          for (const p of pixels) { rr += colorBuf[p * 3]; gg += colorBuf[p * 3 + 1]; bb += colorBuf[p * 3 + 2]; }
          const avgR = Math.round(rr / pixels.length), avgG = Math.round(gg / pixels.length), avgB = Math.round(bb / pixels.length);

          // Step 4: Compute average boundary color for contrast check
          const blobSet = new Set(pixels);
          let bndCount = 0, brSum = 0, bgSum = 0, bbSum = 0;
          for (const p of pixels) {
            for (const n of [p - TW, p + TW, p - 1, p + 1]) {
              if (n >= 0 && n < tp && countryMask[n] && !blobSet.has(n) && !parkMask[n]) {
                brSum += colorBuf[n * 3]; bgSum += colorBuf[n * 3 + 1]; bbSum += colorBuf[n * 3 + 2];
                bndCount++;
              }
            }
          }
          if (bndCount < 10) {
            console.log(`    [Park skip] CC ${pixels.length}px (${pxPct}%) RGB(${avgR},${avgG},${avgB}) — no clear boundary (${bndCount} px)`);
            continue;
          }
          const bndR = Math.round(brSum / bndCount);
          const bndG = Math.round(bgSum / bndCount);
          const bndB = Math.round(bbSum / bndCount);

          // Step 5: Verify contrast — blob must be significantly darker than boundary
          const blobLum = 0.299 * avgR + 0.587 * avgG + 0.114 * avgB;
          const bndLum = 0.299 * bndR + 0.587 * bndG + 0.114 * bndB;
          if (bndLum < blobLum * 1.12) {
            console.log(`    [Park skip] CC ${pixels.length}px (${pxPct}%) RGB(${avgR},${avgG},${avgB}) — low contrast (blobLum=${blobLum.toFixed(0)} bndLum=${bndLum.toFixed(0)} ratio=${(bndLum/blobLum).toFixed(2)})`);
            continue;
          }

          parkBlobs.push({ id: blobId++, pixels, avgR, avgG, avgB, boundaryAvgColor: [bndR, bndG, bndB] });
        }

        const totalParkPx = parkBlobs.reduce((s, b) => s + b.pixels.length, 0);
        console.log(`  [Park] Detected ${parkBlobs.length} park blob(s), ${totalParkPx}px (${(totalParkPx / countrySize * 100).toFixed(1)}% of country), medianV=${medianV}, vThresh=${vThresh}`);
        for (const pb of parkBlobs) {
          console.log(`    blob ${pb.id}: ${pb.pixels.length}px RGB(${pb.avgR},${pb.avgG},${pb.avgB}) → avg boundary RGB(${pb.boundaryAvgColor})`);
        }

        // Debug: show park detection mask (use origDownBuf for unprocessed original colors)
        const parkVizBuf = Buffer.alloc(tp * 3);
        for (let i = 0; i < tp; i++) {
          if (!countryMask[i]) {
            parkVizBuf[i * 3] = 200; parkVizBuf[i * 3 + 1] = 200; parkVizBuf[i * 3 + 2] = 200;
          } else {
            // Show original colors dimmed, parks highlighted
            parkVizBuf[i * 3] = Math.round(origDownBuf[i * 3] * 0.5 + 100);
            parkVizBuf[i * 3 + 1] = Math.round(origDownBuf[i * 3 + 1] * 0.5 + 100);
            parkVizBuf[i * 3 + 2] = Math.round(origDownBuf[i * 3 + 2] * 0.5 + 100);
          }
        }
        // Highlight confirmed park blobs in red, their boundary color as a ring
        for (const pb of parkBlobs) {
          for (const p of pb.pixels) {
            parkVizBuf[p * 3] = 220; parkVizBuf[p * 3 + 1] = 50; parkVizBuf[p * 3 + 2] = 50;
          }
        }
        const parkVizPng = await sharp(parkVizBuf, {
          raw: { width: TW, height: TH, channels: 3 },
        }).resize(origW, origH, { kernel: 'lanczos3' }).png().toBuffer();
        await pushDebugImage(
          `Park detection: ${parkBlobs.length} blobs (${(totalParkPx / countrySize * 100).toFixed(1)}% of country, red = detected parks)`,
          `data:image/png;base64,${parkVizPng.toString('base64')}`,
        );

        // Interactive review if parks were found
        if (parkBlobs.length > 0) {
          const reviewId = `pr-${regionId}-${Date.now()}`;
          // Generate crop images for each park blob
          const cropComponents: Array<{ id: number; pct: number; cropDataUrl: string }> = [];
          for (const pb of parkBlobs) {
            // Find bounding box of blob
            let minX = TW, maxX = 0, minY = TH, maxY = 0;
            for (const p of pb.pixels) {
              const x = p % TW, y = Math.floor(p / TW);
              if (x < minX) minX = x; if (x > maxX) maxX = x;
              if (y < minY) minY = y; if (y > maxY) maxY = y;
            }
            const pad = 15;
            const cx1 = Math.max(0, minX - pad), cy1 = Math.max(0, minY - pad);
            const cx2 = Math.min(TW - 1, maxX + pad), cy2 = Math.min(TH - 1, maxY + pad);
            const cw = cx2 - cx1 + 1, ch = cy2 - cy1 + 1;
            // Render crop: unprocessed original image with 2px red border around park blob
            const cropBuf = Buffer.alloc(cw * ch * 3);
            const blobSet = new Set(pb.pixels);
            // First pass: copy original image
            for (let y = cy1; y <= cy2; y++) {
              for (let x = cx1; x <= cx2; x++) {
                const si = y * TW + x;
                const di = (y - cy1) * cw + (x - cx1);
                cropBuf[di * 3] = origDownBuf[si * 3];
                cropBuf[di * 3 + 1] = origDownBuf[si * 3 + 1];
                cropBuf[di * 3 + 2] = origDownBuf[si * 3 + 2];
              }
            }
            // Second pass: draw 2px red border on edge pixels of the blob
            for (let y = cy1; y <= cy2; y++) {
              for (let x = cx1; x <= cx2; x++) {
                const si = y * TW + x;
                if (!blobSet.has(si)) continue;
                let isEdge = false;
                for (let dy = -1; dy <= 1 && !isEdge; dy++) {
                  for (let dx = -1; dx <= 1 && !isEdge; dx++) {
                    if (dx === 0 && dy === 0) continue;
                    const ni = (y + dy) * TW + (x + dx);
                    if (y + dy < 0 || y + dy >= TH || x + dx < 0 || x + dx >= TW || !blobSet.has(ni)) isEdge = true;
                  }
                }
                if (isEdge) {
                  for (let dy = -1; dy <= 1; dy++) {
                    for (let dx = -1; dx <= 1; dx++) {
                      const py = (y - cy1) + dy, px = (x - cx1) + dx;
                      if (py >= 0 && py < ch && px >= 0 && px < cw) {
                        const di = py * cw + px;
                        cropBuf[di * 3] = 220; cropBuf[di * 3 + 1] = 40; cropBuf[di * 3 + 2] = 40;
                      }
                    }
                  }
                }
              }
            }
            const cropPng = await sharp(cropBuf, { raw: { width: cw, height: ch, channels: 3 } }).png().toBuffer();
            const cropDataUrl = `data:image/png;base64,${cropPng.toString('base64')}`;
            cropComponents.push({ id: pb.id, pct: Math.round(pb.pixels.length / countrySize * 1000) / 10, cropDataUrl });
          }

          storeParkCrops(reviewId, cropComponents);
          console.log(`  [Park] Stored ${cropComponents.length} crop(s) for review ${reviewId}`);

          // Send park_review SSE event (like water_review)
          sendEvent({
            type: 'park_review',
            reviewId,
            data: {
              parkCount: parkBlobs.length,
              totalParkPct: Math.round(totalParkPx / countrySize * 1000) / 10,
              components: cropComponents.map(c => ({ id: c.id, pct: c.pct })),
            },
          });
          await new Promise(resolve => setImmediate(resolve));

          // Wait for user to confirm which blobs are parks (5 min timeout → auto-confirm all)
          const decision = await new Promise<ParkReviewDecision>((resolve) => {
            pendingParkReviews.set(reviewId, resolve);
            setTimeout(() => {
              if (pendingParkReviews.has(reviewId)) {
                console.log(`  [Park] Review ${reviewId} timed out — auto-confirming all ${parkBlobs.length} blobs`);
                pendingParkReviews.delete(reviewId);
                resolve({ confirmedIds: parkBlobs.map(b => b.id) });
              }
            }, 300000);
          });

          const confirmedSet = new Set(decision.confirmedIds);
          const confirmedBlobs = parkBlobs.filter(b => confirmedSet.has(b.id));
          console.log(`  [Park] Decision: ${confirmedBlobs.length}/${parkBlobs.length} confirmed as parks`);

          // Inpaint confirmed parks — 3-pass approach:
          //   Pass 1: BFS fill detected blobs + 6px dilation from colorBuf boundary.
          //   Pass 2: Cleanup remaining dark-green remnants via BFS.
          //   Pass 3: Harmonize — each filled pixel adopts the median color of
          //           nearby non-filled country pixels so it clusters correctly.
          if (confirmedBlobs.length > 0) {
            await logStep(`Removing ${confirmedBlobs.length} park overlay(s)...`);

            // ── Pass 1: BFS fill detected blobs + 6px dilation ──
            const confirmedParkMask = new Uint8Array(tp);
            for (const pb of confirmedBlobs) {
              for (const p of pb.pixels) confirmedParkMask[p] = 1;
            }
            const PARK_DILATE = 6;
            const fillZone = new Uint8Array(tp);
            for (let i = 0; i < tp; i++) {
              if (confirmedParkMask[i]) { fillZone[i] = 1; continue; }
              if (!countryMask[i]) continue;
              const ix = i % TW, iy = Math.floor(i / TW);
              for (let dy = -PARK_DILATE; dy <= PARK_DILATE && !fillZone[i]; dy++) {
                for (let dx = -PARK_DILATE; dx <= PARK_DILATE; dx++) {
                  const nx = ix + dx, ny = iy + dy;
                  if (nx >= 0 && nx < TW && ny >= 0 && ny < TH && confirmedParkMask[ny * TW + nx]) {
                    fillZone[i] = 1; break;
                  }
                }
              }
            }
            // BFS from boundary — seed from colorBuf (same color space as K-means input)
            const parkFillColor = new Int32Array(tp * 3).fill(-1);
            const bfsQueue: number[] = [];
            const fillSet = new Set<number>();
            for (let i = 0; i < tp; i++) { if (fillZone[i]) fillSet.add(i); }
            for (const p of fillSet) {
              for (const n of [p - TW, p + TW, p - 1, p + 1]) {
                if (n >= 0 && n < tp && countryMask[n] && !fillSet.has(n) && parkFillColor[n * 3] === -1) {
                  parkFillColor[n * 3] = colorBuf[n * 3];
                  parkFillColor[n * 3 + 1] = colorBuf[n * 3 + 1];
                  parkFillColor[n * 3 + 2] = colorBuf[n * 3 + 2];
                  bfsQueue.push(n);
                }
              }
            }
            let bfsHead = 0;
            while (bfsHead < bfsQueue.length) {
              const p = bfsQueue[bfsHead++];
              for (const n of [p - TW, p + TW, p - 1, p + 1]) {
                if (n >= 0 && n < tp && fillSet.has(n) && parkFillColor[n * 3] === -1) {
                  parkFillColor[n * 3] = parkFillColor[p * 3];
                  parkFillColor[n * 3 + 1] = parkFillColor[p * 3 + 1];
                  parkFillColor[n * 3 + 2] = parkFillColor[p * 3 + 2];
                  bfsQueue.push(n);
                }
              }
            }
            for (const p of fillSet) {
              if (parkFillColor[p * 3] >= 0) {
                colorBuf[p * 3] = parkFillColor[p * 3];
                colorBuf[p * 3 + 1] = parkFillColor[p * 3 + 1];
                colorBuf[p * 3 + 2] = parkFillColor[p * 3 + 2];
              }
            }

            // ── Pass 2: cleanup remaining dark-green remnants ──
            const allFilled = new Uint8Array(tp); // track everything we've filled
            for (const p of fillSet) allFilled[p] = 1;
            const remnant = new Uint8Array(tp);
            let remnantCount = 0;
            for (let i = 0; i < tp; i++) {
              if (!countryMask[i] || allFilled[i]) continue;
              const r = colorBuf[i * 3], g = colorBuf[i * 3 + 1], b2 = colorBuf[i * 3 + 2];
              const maxC = Math.max(r, g, b2);
              const minC = Math.min(r, g, b2);
              const sat = maxC > 0 ? (maxC - minC) / maxC : 0;
              if (maxC <= vThresh && sat >= 0.20 && g >= r && g >= b2 * 0.8) {
                remnant[i] = 1;
                allFilled[i] = 1;
                remnantCount++;
              }
            }
            if (remnantCount > 0) {
              console.log(`  [Park] Pass 2: cleaning ${remnantCount} remnant dark-green px`);
              const remFill = new Int32Array(tp * 3).fill(-1);
              const remQueue: number[] = [];
              for (let i = 0; i < tp; i++) {
                if (!remnant[i]) continue;
                for (const n of [i - TW, i + TW, i - 1, i + 1]) {
                  if (n >= 0 && n < tp && countryMask[n] && !allFilled[n] && remFill[n * 3] === -1) {
                    remFill[n * 3] = colorBuf[n * 3];
                    remFill[n * 3 + 1] = colorBuf[n * 3 + 1];
                    remFill[n * 3 + 2] = colorBuf[n * 3 + 2];
                    remQueue.push(n);
                  }
                }
              }
              let remHead = 0;
              while (remHead < remQueue.length) {
                const p = remQueue[remHead++];
                for (const n of [p - TW, p + TW, p - 1, p + 1]) {
                  if (n >= 0 && n < tp && remnant[n] && remFill[n * 3] === -1) {
                    remFill[n * 3] = remFill[p * 3];
                    remFill[n * 3 + 1] = remFill[p * 3 + 1];
                    remFill[n * 3 + 2] = remFill[p * 3 + 2];
                    remQueue.push(n);
                  }
                }
              }
              for (let i = 0; i < tp; i++) {
                if (remnant[i] && remFill[i * 3] >= 0) {
                  colorBuf[i * 3] = remFill[i * 3];
                  colorBuf[i * 3 + 1] = remFill[i * 3 + 1];
                  colorBuf[i * 3 + 2] = remFill[i * 3 + 2];
                }
              }
            }

            // ── Pass 3: harmonize filled pixels with surrounding region color ──
            // Each filled pixel samples non-filled country pixels within a 10px
            // radius and adopts their median color. This snaps the fill to the
            // actual region interior color so K-means won't separate it.
            const HARMONIZE_R = pxS(10);
            let harmonized = 0;
            for (let i = 0; i < tp; i++) {
              if (!allFilled[i]) continue;
              const ix = i % TW, iy = Math.floor(i / TW);
              const samples: Array<[number, number, number]> = [];
              for (let dy = -HARMONIZE_R; dy <= HARMONIZE_R; dy++) {
                for (let dx = -HARMONIZE_R; dx <= HARMONIZE_R; dx++) {
                  if (dx * dx + dy * dy > HARMONIZE_R * HARMONIZE_R) continue;
                  const nx = ix + dx, ny = iy + dy;
                  if (nx < 0 || nx >= TW || ny < 0 || ny >= TH) continue;
                  const ni = ny * TW + nx;
                  if (countryMask[ni] && !allFilled[ni]) {
                    samples.push([colorBuf[ni * 3], colorBuf[ni * 3 + 1], colorBuf[ni * 3 + 2]]);
                  }
                }
              }
              if (samples.length >= 3) {
                samples.sort((a, b) => (a[0] + a[1] + a[2]) - (b[0] + b[1] + b[2]));
                const mid = samples[Math.floor(samples.length / 2)];
                colorBuf[i * 3] = mid[0]; colorBuf[i * 3 + 1] = mid[1]; colorBuf[i * 3 + 2] = mid[2];
                harmonized++;
              }
            }
            console.log(`  [Park] Pass 3: harmonized ${harmonized}/${fillSet.size + remnantCount} filled px`);

            // Debug: show result after park removal
            const afterParkBuf = Buffer.alloc(tp * 3, 200);
            for (let i = 0; i < tp; i++) {
              if (waterGrown[i]) {
                afterParkBuf[i * 3] = 60; afterParkBuf[i * 3 + 1] = 120; afterParkBuf[i * 3 + 2] = 200;
              } else if (countryMask[i]) {
                afterParkBuf[i * 3] = colorBuf[i * 3]; afterParkBuf[i * 3 + 1] = colorBuf[i * 3 + 1]; afterParkBuf[i * 3 + 2] = colorBuf[i * 3 + 2];
              }
            }
            const afterParkPng = await sharp(afterParkBuf, {
              raw: { width: TW, height: TH, channels: 3 },
            }).resize(origW, origH, { kernel: 'lanczos3' }).png().toBuffer();
            await pushDebugImage(
              `After park removal (${confirmedBlobs.length} parks inpainted with boundary colors)`,
              `data:image/png;base64,${afterParkPng.toString('base64')}`,
            );
          }
        }
      }

      // Recluster loop: re-run K-means with modified params when user requests
      let reclusterAttempt = 0;
      const MAX_RECLUSTER = 3;
      let ckOverride: number | null = null;
      let chromaBoost = 1.0;
      let randomSeed = false;

      let reclusterResult: ReclusterSignal | void;
      do {
      await logStep('K-means color clustering...');

      // Convert clean color buffer to CIELAB for perceptually-accurate K-means
      const cvBufForLab = new cv.Mat(TH, TW, cv.CV_8UC3);
      cvBufForLab.data.set(colorBuf);
      const cvLabMat = new cv.Mat();
      cv.cvtColor(cvBufForLab, cvLabMat, cv.COLOR_RGB2Lab);
      const labBuf = Buffer.from(cvLabMat.data);
      cvBufForLab.delete(); cvLabMat.delete();

      // Per-channel stats for z-score normalization (amplifies chromatic differences)
      let sumL = 0, sumA = 0, sumB = 0, sumL2 = 0, sumA2 = 0, sumB2 = 0;
      let statCount = 0;
      for (let i = 0; i < tp; i++) {
        if (!countryMask[i] || textExcluded[i]) continue;
        const L = labBuf[i * 3], a = labBuf[i * 3 + 1], b = labBuf[i * 3 + 2];
        sumL += L; sumA += a; sumB += b;
        sumL2 += L * L; sumA2 += a * a; sumB2 += b * b;
        statCount++;
      }
      if (statCount === 0) throw new Error('No country pixels remaining after text exclusion — cannot cluster');
      const meanL = sumL / statCount, meanA = sumA / statCount, meanB = sumB / statCount;
      const rawStdL = Math.sqrt(Math.max(0, sumL2 / statCount - meanL * meanL));
      const rawStdA = Math.sqrt(Math.max(0, sumA2 / statCount - meanA * meanA));
      const rawStdB = Math.sqrt(Math.max(0, sumB2 / statCount - meanB * meanB));
      const stdL = rawStdL < 0.01 ? 1.0 : rawStdL;
      const stdA = rawStdA < 0.01 ? 1.0 : rawStdA;
      const stdB = rawStdB < 0.01 ? 1.0 : rawStdB;
      const wL = 0.5 / stdL, wA = chromaBoost / stdA, wB = chromaBoost / stdB;
      console.log(`  [Lab] mean=(${meanL.toFixed(1)},${meanA.toFixed(1)},${meanB.toFixed(1)}) std=(${stdL.toFixed(1)},${stdA.toFixed(1)},${stdB.toFixed(1)})`);

      // K-means: use ~3x expected region count for enough color resolution
      // to separate similar-but-distinct regions. The merge step consolidates
      // truly redundant clusters afterward. Cap at 32, floor at 8.
      const CK = ckOverride ?? Math.max(8, Math.min(expectedRegionCount * 3, 32));
      console.log(`  [K-means] CK=${CK} (expectedRegions=${expectedRegionCount})`);
      // Exclude text pixels from K-means centroids — their BFS-filled colors are
      // from nearest neighbors and may be wrong at region boundaries.
      // Park pixels are already filled with correct boundary colors in colorBuf.
      const countryPixels: Array<[number, number, number]> = [];
      const countryIndices: number[] = [];
      let textExcludedCount = 0;
      for (let i = 0; i < tp; i++) {
        if (countryMask[i]) {
          if (textExcluded[i]) { textExcludedCount++; continue; }
          countryPixels.push([
            (labBuf[i * 3] - meanL) * wL,
            (labBuf[i * 3 + 1] - meanA) * wA,
            (labBuf[i * 3 + 2] - meanB) * wB,
          ]);
          countryIndices.push(i);
        }
      }
      if (textExcludedCount > 0) {
        console.log(`  [K-means] Excluded ${textExcludedCount} text pixels from centroid computation (${(textExcludedCount / countrySize * 100).toFixed(1)}% of country)`);
      }

      // K-means++ initialization: probabilistic distance-weighted sampling
      const firstIdx = randomSeed
          ? Math.floor(Math.random() * countryPixels.length)
          : Math.floor(countryPixels.length / 2);
      const colorCentroids: Array<[number, number, number]> = [countryPixels[firstIdx]];
      for (let c = 1; c < CK; c++) {
        const d2 = new Float64Array(countryPixels.length);
        let totalD2 = 0;
        for (let i = 0; i < countryPixels.length; i++) {
          let minDist = Infinity;
          for (const ct of colorCentroids) {
            const d = (countryPixels[i][0] - ct[0]) ** 2 + (countryPixels[i][1] - ct[1]) ** 2 + (countryPixels[i][2] - ct[2]) ** 2;
            if (d < minDist) minDist = d;
          }
          d2[i] = minDist;
          totalD2 += minDist;
        }
        let target = Math.random() * totalD2;
        let chosen = 0;
        for (let i = 0; i < countryPixels.length; i++) {
          target -= d2[i];
          if (target <= 0) { chosen = i; break; }
        }
        let retries = 0;
        while (retries < 5) {
          const p = countryPixels[chosen];
          let tooClose = false;
          for (const ct of colorCentroids) {
            if ((p[0] - ct[0]) ** 2 + (p[1] - ct[1]) ** 2 + (p[2] - ct[2]) ** 2 < 4) { tooClose = true; break; }
          }
          if (!tooClose) break;
          chosen = Math.floor(Math.random() * countryPixels.length);
          retries++;
        }
        colorCentroids.push([...countryPixels[chosen]]);
      }
      const MAX_ITER = 40;
      for (let iter = 0; iter < MAX_ITER; iter++) {
        const sums = colorCentroids.map(() => [0, 0, 0, 0]);
        for (const px of countryPixels) {
          let bestDist = Infinity, bestK = 0;
          for (let k = 0; k < CK; k++) {
            const d = (px[0] - colorCentroids[k][0]) ** 2 + (px[1] - colorCentroids[k][1]) ** 2 + (px[2] - colorCentroids[k][2]) ** 2;
            if (d < bestDist) { bestDist = d; bestK = k; }
          }
          sums[bestK][0] += px[0]; sums[bestK][1] += px[1]; sums[bestK][2] += px[2]; sums[bestK][3]++;
        }
        let totalMovement = 0;
        for (let k = 0; k < CK; k++) {
          if (sums[k][3] > 0) {
            const newC: [number, number, number] = [
              sums[k][0] / sums[k][3],
              sums[k][1] / sums[k][3],
              sums[k][2] / sums[k][3],
            ];
            totalMovement += Math.abs(newC[0] - colorCentroids[k][0]) + Math.abs(newC[1] - colorCentroids[k][1]) + Math.abs(newC[2] - colorCentroids[k][2]);
            colorCentroids[k] = newC;
          }
        }
        if (totalMovement < 1.0) {
          console.log(`  [K-means] Converged at iteration ${iter + 1}`);
          break;
        }
      }

      // Convert centroids: normalized Lab → original Lab → RGB (for debug viz + shared pipeline)
      const rgbCentroids: Array<[number, number, number]> = colorCentroids.map(c => {
        const oL = Math.round(Math.min(255, Math.max(0, c[0] / wL + meanL)));
        const oA = Math.round(Math.min(255, Math.max(0, c[1] / wA + meanA)));
        const oB = Math.round(Math.min(255, Math.max(0, c[2] / wB + meanB)));
        const labPx = new cv.Mat(1, 1, cv.CV_8UC3);
        labPx.data[0] = oL; labPx.data[1] = oA; labPx.data[2] = oB;
        const rgbPx = new cv.Mat();
        cv.cvtColor(labPx, rgbPx, cv.COLOR_Lab2RGB);
        const rgb: [number, number, number] = [rgbPx.data[0], rgbPx.data[1], rgbPx.data[2]];
        labPx.delete(); rgbPx.delete();
        return rgb;
      });

      // Two-phase label assignment using colorBuf (lightly filtered, accurate colors):
      // Phase 1: Assign labels to clean (non-excluded) country pixels by nearest centroid.
      // Phase 2: BFS-propagate labels from clean pixels into excluded (text+park) gaps.
      // Clean pixels have accurate per-region colors from colorBuf (median(3) + mean shift).
      // Excluded pixels get labels from spatial neighbors, preserving connectivity.
      const pixelLabels = new Uint8Array(tp).fill(255);
      const clusterCounts = new Array(CK).fill(0);
      // Phase 1: color-based assignment for clean pixels only (normalized Lab)
      for (let i = 0; i < tp; i++) {
        if (!countryMask[i] || textExcluded[i]) continue;
        const nL = (labBuf[i * 3] - meanL) * wL;
        const nA = (labBuf[i * 3 + 1] - meanA) * wA;
        const nB = (labBuf[i * 3 + 2] - meanB) * wB;
        let bestDist = Infinity, bestK = 0;
        for (let k = 0; k < CK; k++) {
          const d = (nL - colorCentroids[k][0]) ** 2 + (nA - colorCentroids[k][1]) ** 2 + (nB - colorCentroids[k][2]) ** 2;
          if (d < bestDist) { bestDist = d; bestK = k; }
        }
        pixelLabels[i] = bestK;
        clusterCounts[bestK]++;
      }
      // Phase 2: BFS from clean pixels into text regions
      if (textExcludedCount > 0) {
        const bfsQ: number[] = [];
        for (let i = 0; i < tp; i++) {
          if (pixelLabels[i] < 255) bfsQ.push(i);
        }
        let bfsH = 0, bfsFilled = 0;
        while (bfsH < bfsQ.length) {
          const p = bfsQ[bfsH++];
          const lbl = pixelLabels[p];
          for (const n of [p - TW, p + TW, p - 1, p + 1]) {
            if (n >= 0 && n < tp && countryMask[n] && pixelLabels[n] === 255) {
              pixelLabels[n] = lbl;
              clusterCounts[lbl]++;
              bfsQ.push(n);
              bfsFilled++;
            }
          }
        }
        console.log(`  [K-means] BFS propagated labels to ${bfsFilled} text pixels`);
      }

      // Spatial mode filter: clean up salt-and-pepper noise from BFS seams and line residue.
      // For each pixel, if the majority of its neighborhood has a different label AND the
      // pixel's color is reasonably close to the majority's centroid, relabel it.
      const MODE_R = pxS(5); // radius in pixels (8 at TW=800)
      let modeRelabeled = 0;
      const newLabels = new Uint8Array(pixelLabels); // copy — don't modify during iteration
      for (let i = 0; i < tp; i++) {
        if (!countryMask[i] || pixelLabels[i] === 255) continue;
        const ix = i % TW, iy = Math.floor(i / TW);
        const votes = new Map<number, number>();
        for (let dy = -MODE_R; dy <= MODE_R; dy++) {
          const ny = iy + dy;
          if (ny < 0 || ny >= TH) continue;
          for (let dx = -MODE_R; dx <= MODE_R; dx++) {
            const nx = ix + dx;
            if (nx < 0 || nx >= TW) continue;
            const ni = ny * TW + nx;
            if (pixelLabels[ni] !== 255) votes.set(pixelLabels[ni], (votes.get(pixelLabels[ni]) || 0) + 1);
          }
        }
        const myLabel = pixelLabels[i];
        let bestLabel = myLabel, bestCount = 0;
        for (const [lbl, cnt] of votes) {
          if (cnt > bestCount) { bestCount = cnt; bestLabel = lbl; }
        }
        if (bestLabel === myLabel) continue;
        // Guard: only relabel if pixel's color is close enough to majority centroid
        const nL = (labBuf[i * 3] - meanL) * wL;
        const nA = (labBuf[i * 3 + 1] - meanA) * wA;
        const nB = (labBuf[i * 3 + 2] - meanB) * wB;
        const distOwn = (nL - colorCentroids[myLabel][0]) ** 2 + (nA - colorCentroids[myLabel][1]) ** 2 + (nB - colorCentroids[myLabel][2]) ** 2;
        const distMaj = (nL - colorCentroids[bestLabel][0]) ** 2 + (nA - colorCentroids[bestLabel][1]) ** 2 + (nB - colorCentroids[bestLabel][2]) ** 2;
        if (distMaj < distOwn * 2.0) {
          newLabels[i] = bestLabel;
          modeRelabeled++;
        }
      }
      // Apply relabeling
      if (modeRelabeled > 0) {
        for (let i = 0; i < tp; i++) pixelLabels[i] = newLabels[i];
        // Recount
        clusterCounts.fill(0);
        for (let i = 0; i < tp; i++) {
          if (countryMask[i] && pixelLabels[i] < 255) clusterCounts[pixelLabels[i]]++;
        }
        console.log(`  [Mode filter] Relabeled ${modeRelabeled} noisy pixels to neighborhood majority`);
      }

      // Log K-means results before processing
      console.log(`  [K-means] ${CK} clusters, countrySize=${countrySize}:`);
      for (let k = 0; k < CK; k++) {
        if (clusterCounts[k] === 0) continue;
        const pct = (clusterCounts[k] / countrySize * 100).toFixed(1);
        const c = rgbCentroids[k];
        console.log(`    cluster ${k}: RGB(${c[0]},${c[1]},${c[2]}) ${clusterCounts[k]}px (${pct}%)`);
      }


      // ── Spatial split through complete event: delegated to shared function ──
      reclusterResult = await matchDivisionsFromClusters({
        worldViewId, regionId,
        knownDivisionIds,
        buf: colorBuf, mapBuffer, countryMask, waterGrown, pixelLabels, colorCentroids: rgbCentroids,
        TW, TH, origW, origH,
        skipClusterReview: false,
        sendEvent: sendEvent as (event: Record<string, unknown>) => void,
        logStep, pushDebugImage, debugImages,
        startTime,
      });

        if (reclusterResult?.recluster) {
          reclusterAttempt++;
          if (reclusterAttempt >= MAX_RECLUSTER) {
            console.log(`  [Recluster] Max attempts (${MAX_RECLUSTER}) reached, proceeding with current clusters`);
            await matchDivisionsFromClusters({
              worldViewId, regionId, knownDivisionIds,
              buf: colorBuf, mapBuffer, countryMask, waterGrown, pixelLabels, colorCentroids: rgbCentroids,
              TW, TH, origW, origH,
              skipClusterReview: true,
              sendEvent: sendEvent as (event: Record<string, unknown>) => void,
              logStep, pushDebugImage, debugImages, startTime,
            });
            break;
          }
          const preset = reclusterResult.preset;
          if (preset === 'more_clusters') {
            const baseCK = ckOverride ?? Math.max(8, Math.min(expectedRegionCount * 3, 32));
            ckOverride = Math.min(baseCK + 4, 32);
            console.log(`  [Recluster] More clusters: CK → ${ckOverride}`);
          } else if (preset === 'different_seed') {
            randomSeed = true;
            console.log(`  [Recluster] Different seed: randomizing K-means++ init`);
          } else if (preset === 'boost_chroma') {
            chromaBoost = 1.5;
            console.log(`  [Recluster] Boost chroma: a*/b* weight → ${chromaBoost}`);
          }
          await logStep(`Re-clustering (attempt ${reclusterAttempt + 1})...`);
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
