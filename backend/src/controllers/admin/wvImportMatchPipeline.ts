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
import { runKMeansClustering } from './wvImportMatchCluster.js';
import { meanshiftPreprocess } from './wvImportMatchMeanshift.js';

// OpenCV WASM — eagerly initialized at module load to avoid tsx/esbuild overhead during requests.
// tsx transforms every dynamic import() through esbuild, which takes 30s+ for the 10MB opencv.js.
// By importing at module level, the cost is paid once at server startup.
// Cache OpenCV on globalThis so it survives tsx hot-reloads
// (each hot-reload re-evaluates this module, but globalThis persists)
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- OpenCV.js has no TypeScript types
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

// PipelineContext moved to wvImportMatchContext.ts to break the circular import
// with phase modules that need the type (cluster/helpers/meanshift).
export type { PipelineContext } from './wvImportMatchContext.js';
import type { PipelineContext } from './wvImportMatchContext.js';

// =============================================================================
// colorMatchDivisionsSSE helpers — phase functions
// =============================================================================

type SendEvent = (event: {
  type: string;
  step?: string;
  elapsed?: number;
  debugImage?: { label: string; dataUrl: string };
  data?: unknown;
  message?: string;
  reviewId?: string;
  waterMaskImage?: string;
  waterPxPercent?: number;
  waterComponents?: Array<{ id: number; pct: number; cropDataUrl: string; subClusters: Array<{ idx: number; pct: number; cropDataUrl: string }> }>;
}) => void;

type LogStep = (step: string) => Promise<void>;
type PushDebugImage = (label: string, dataUrl: string) => Promise<void>;

/** Configure SSE response headers and return the raw sendEvent + logStep helpers. */
function createSseHelpers(res: Response, startTime: number): { sendEvent: SendEvent; logStep: LogStep } {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  // CORS is handled globally by the cors() middleware (origin: FRONTEND_ORIGIN,
  // credentials: true). Setting Access-Control-Allow-Origin: * here would both
  // widen the policy AND break credentialed SSE (browsers reject '*' with
  // credentials). The same-origin admin frontend uses ?token=… so we don't
  // need a custom CORS header here.
  res.flushHeaders();
  res.socket?.setNoDelay(true);

  const sendEvent: SendEvent = (event) => {
    if (res.destroyed) return;
    try { res.write(`data: ${JSON.stringify(event)}\n\n`); } catch { /* client disconnected */ }
  };
  const logStep: LogStep = async (step) => {
    const elapsed = (Date.now() - startTime) / 1000;
    console.log(`[CV Match SSE] ${step} (${elapsed.toFixed(1)}s)`);
    sendEvent({ type: 'progress', step, elapsed });
    await new Promise(resolve => setImmediate(resolve));
  };
  return { sendEvent, logStep };
}

/** Create a `pushDebugImage` callback that appends to a shared array, streams via SSE, and persists to disk. */
function createPushDebugImage(
  sendEvent: SendEvent,
  regionName: string,
  debugImages: Array<{ label: string; dataUrl: string }>,
): PushDebugImage {
  let debugIdx = 0;
  const debugSlug = regionName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return async (label, dataUrl) => {
    const img = { label, dataUrl };
    debugImages.push(img);
    sendEvent({ type: 'debug_image', debugImage: img });
    try {
      const b64 = dataUrl.replace(/^data:image\/\w+;base64,/, '');
      const fs = await import('fs');
      const dir = `${process.cwd()}/data/cv-debug`;
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(`${dir}/${debugSlug}-${String(debugIdx++).padStart(2, '0')}.png`, Buffer.from(b64, 'base64'));
    } catch { /* ignore */ }
    await new Promise(resolve => setImmediate(resolve));
  };
}

/** Load region name + map URL. Writes an error event and ends the response on failure. */
async function loadRegionAndMap(
  regionId: number, worldViewId: number, sendEvent: SendEvent, res: Response,
): Promise<{ regionName: string; regionMapUrl: string } | null> {
  const regionResult = await pool.query(`
    SELECT r.name, ris.region_map_url
    FROM regions r
    LEFT JOIN region_import_state ris ON ris.region_id = r.id
    WHERE r.id = $1 AND r.world_view_id = $2
  `, [regionId, worldViewId]);

  if (regionResult.rows.length === 0) {
    sendEvent({ type: 'error', message: 'Region not found' });
    res.end();
    return null;
  }
  const regionName = regionResult.rows[0].name as string;
  const regionMapUrl = regionResult.rows[0].region_map_url as string | null;
  if (!regionMapUrl) {
    sendEvent({ type: 'error', message: 'No map image selected for this region' });
    res.end();
    return null;
  }
  return { regionName, regionMapUrl };
}

/**
 * Load the set of known-member divisions for a region and partition them into
 * parent-level vs. child-region divisions.
 */
async function loadKnownDivisionIds(
  regionId: number, worldViewId: number,
): Promise<{ knownDivisionIds: Set<number>; childRegionMemberIds: Set<number> }> {
  const knownMemberResult = await pool.query(`
    SELECT DISTINCT division_id AS id, region_id FROM region_members
    WHERE region_id = $1 OR region_id IN (
      SELECT id FROM regions WHERE parent_region_id = $1 AND world_view_id = $2
    )
  `, [regionId, worldViewId]);

  const knownDivisionIds = new Set<number>();
  const childRegionMemberIds = new Set<number>();
  for (const r of knownMemberResult.rows) {
    knownDivisionIds.add(r.id as number);
    if ((r.region_id as number) !== regionId) {
      childRegionMemberIds.add(r.id as number);
    }
  }
  return { knownDivisionIds, childRegionMemberIds };
}

/**
 * Determine the GADM scope roots ("countryIds") for the region:
 *  - if its own divisions have GADM children, use them,
 *  - else walk up to the common GADM ancestor of child-region divisions.
 */
async function resolveCountryIds(
  knownDivisionIds: Set<number>, childRegionMemberIds: Set<number>,
): Promise<number[]> {
  const parentDivIds = new Set<number>();
  for (const id of knownDivisionIds) {
    if (!childRegionMemberIds.has(id)) parentDivIds.add(id);
  }

  let countryIds: number[] = [];
  if (parentDivIds.size >= 1) {
    const childrenCheck = await pool.query(
      'SELECT parent_id, COUNT(*)::int AS cnt FROM administrative_divisions WHERE parent_id = ANY($1) GROUP BY parent_id',
      [[...parentDivIds]],
    );
    const withChildren = new Set(childrenCheck.rows.map(r => r.parent_id as number));
    if (withChildren.size > 0) {
      countryIds = [...withChildren];
      const childSummary = childrenCheck.rows.map(r => `${r.parent_id}→${r.cnt} children`).join(', ');
      console.log(`  [CV] Using region division(s) [${countryIds.join(', ')}] as scope roots (${childSummary})`);
    }
  }

  if (countryIds.length === 0 && childRegionMemberIds.size > 0) {
    const sampleDivId = [...childRegionMemberIds][0];
    const parentResult = await pool.query(
      'SELECT parent_id FROM administrative_divisions WHERE id = $1',
      [sampleDivId],
    );
    const gadmParentId = parentResult.rows[0]?.parent_id as number | null;
    if (gadmParentId != null) {
      countryIds = [gadmParentId];
      console.log(`  [CV] Region has no own division — scoping to GADM parent ${gadmParentId} of child divisions`);
    }
  }
  return countryIds;
}

/** Count child regions (used for K-means cap and adaptive depth selection). */
async function countChildRegions(regionId: number, worldViewId: number): Promise<number> {
  const childCountResult = await pool.query(
    `SELECT COUNT(*) FROM regions WHERE parent_region_id = $1 AND world_view_id = $2`,
    [regionId, worldViewId],
  );
  return parseInt(childCountResult.rows[0].count as string);
}

/** Pick an appropriate GADM descent depth from the scope roots. */
function pickTargetDepth(
  countryIds: number[], expectedRegionCount: number, countryDepth: number,
): number {
  if (countryIds.length > 1 && countryIds.length >= expectedRegionCount) {
    console.log(`  [CV] Using scope roots directly as divisions (${countryIds.length} roots ≥ ${expectedRegionCount} expected regions)`);
    return 0;
  }
  return countryDepth === 0 ? 1 : countryDepth;
}

async function queryDescendantsAtDepth(countryIds: number[], depth: number): Promise<number[]> {
  const res = await pool.query(`
    WITH RECURSIVE descendants AS (
      SELECT id, 0 AS depth FROM administrative_divisions WHERE id = ANY($1)
      UNION ALL
      SELECT ad.id, d.depth + 1 FROM administrative_divisions ad
      JOIN descendants d ON ad.parent_id = d.id
      WHERE d.depth < $2
    )
    SELECT id FROM descendants WHERE depth = $2
  `, [countryIds, depth]);
  return res.rows.map(r => r.id as number);
}

/** Resolve the list of division IDs to consider, unioning GADM walk with known members. */
async function loadAllDivisionIds(
  countryIds: number[], knownDivisionIds: Set<number>,
  expectedRegionCount: number, countryDepth: number,
): Promise<number[]> {
  let targetDepth = pickTargetDepth(countryIds, expectedRegionCount, countryDepth);
  let walkedIds = await queryDescendantsAtDepth(countryIds, targetDepth);
  if (walkedIds.length <= 1 && targetDepth === countryDepth) {
    targetDepth = countryDepth + 1;
    walkedIds = await queryDescendantsAtDepth(countryIds, targetDepth);
  }
  const allDivisionIdSet = new Set<number>();
  for (const id of walkedIds) allDivisionIdSet.add(id);
  for (const id of knownDivisionIds) allDivisionIdSet.add(id);
  return [...allDivisionIdSet];
}

interface DivPath { id: number; svgPath: string }
interface Centroid { id: number; name: string; cx: number; cy: number; assigned: { regionId: number; regionName: string } | null }

/** Load per-child assignments so the debug preview can color assigned centroids green. */
async function loadAssignedMap(
  regionId: number, worldViewId: number,
): Promise<Map<number, { regionId: number; regionName: string }>> {
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
  return assignedMap;
}

/** Fetch per-division centroids and annotate with `assigned` region info. */
async function loadCentroids(
  allDivisionIds: number[],
  assignedMap: Map<number, { regionId: number; regionName: string }>,
): Promise<Centroid[]> {
  const centroidResult = await pool.query(`
    SELECT id, name,
      ST_X(ST_Centroid(geom_simplified_medium)) AS cx,
      ST_Y(ST_Centroid(geom_simplified_medium)) AS cy
    FROM administrative_divisions
    WHERE id = ANY($1) AND geom_simplified_medium IS NOT NULL
  `, [allDivisionIds]);
  return centroidResult.rows.map(r => ({
    id: r.id as number,
    name: r.name as string,
    cx: parseFloat(r.cx as string),
    cy: parseFloat(r.cy as string),
    assigned: assignedMap.get(r.id as number) ?? null,
  }));
}

interface BorderData {
  divPaths: DivPath[];
  countryPath: string;
  externalBorder: string | null;
  internalBorder: string | null;
  cMinX: number; cMinY: number; cMaxX: number; cMaxY: number;
}

/** Fetch per-division SVG paths + union border classification in parallel. */
async function loadDivPathsAndBorders(allDivisionIds: number[]): Promise<BorderData | null> {
  const [divPathsResult, borderResult] = await Promise.all([
    pool.query(`
      SELECT id, ST_AsSVG(geom_simplified_medium, 0, 4) AS svg_path
      FROM administrative_divisions
      WHERE id = ANY($1) AND geom_simplified_medium IS NOT NULL
    `, [allDivisionIds]),
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
          ST_Intersection(all_borders.geom, ST_Buffer(ST_Boundary(subset.geom), 0.001)), 0, 4
        ) AS external_border,
        ST_AsSVG(
          ST_Difference(all_borders.geom, ST_Buffer(ST_Boundary(subset.geom), 0.001)), 0, 4
        ) AS internal_border,
        ST_XMin(subset.geom) AS country_min_x,
        ST_YMin(subset.geom) AS country_min_y,
        ST_XMax(subset.geom) AS country_max_x,
        ST_YMax(subset.geom) AS country_max_y
      FROM subset, all_borders
    `, [allDivisionIds]),
  ]);
  if (borderResult.rows.length === 0) return null;

  const divPaths = divPathsResult.rows.map(r => ({
    id: r.id as number,
    svgPath: r.svg_path as string,
  }));
  const row = borderResult.rows[0];
  return {
    divPaths,
    countryPath: row.country_path as string,
    externalBorder: row.external_border as string | null,
    internalBorder: row.internal_border as string | null,
    cMinX: parseFloat(row.country_min_x as string),
    cMinY: parseFloat(row.country_min_y as string),
    cMaxX: parseFloat(row.country_max_x as string),
    cMaxY: parseFloat(row.country_max_y as string),
  };
}

/** Render the "Step 1" debug image (GADM divisions + classified borders) to PNG. */
async function renderBorderDebugPng(data: BorderData, centroids: Centroid[]): Promise<Buffer> {
  const { divPaths, countryPath, externalBorder, internalBorder, cMinX, cMinY, cMaxX, cMaxY } = data;
  const pad = 0.5;
  const vbX = cMinX - pad;
  const vbY = -(cMaxY + pad);
  const vbW = (cMaxX - cMinX) + 2 * pad;
  const vbH = (cMaxY - cMinY) + 2 * pad;
  const ss = Math.max(vbW, vbH) / 800;

  const divisionShapes = divPaths.map(d =>
    `<path d="${d.svgPath}" fill="#ddeeff" stroke="#90a4ae" stroke-width="${ss}" fill-opacity="0.7"/>`
  ).join('\n');
  const dots = centroids.map(c => {
    const color = c.assigned ? '#2e7d32' : '#e65100';
    return `<circle cx="${c.cx}" cy="${-c.cy}" r="${ss * 4}" fill="${color}" stroke="white" stroke-width="${ss * 0.5}"/>`;
  }).join('\n');
  const externalPath = externalBorder
    ? `<path d="${externalBorder}" fill="none" stroke="#d32f2f" stroke-width="${ss * 3}" stroke-linecap="round"/>`
    : '';
  const internalPath = internalBorder
    ? `<path d="${internalBorder}" fill="none" stroke="#1565c0" stroke-width="${ss * 2}" stroke-dasharray="${ss * 4},${ss * 3}" stroke-linecap="round"/>`
    : '';

  const borderSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vbX} ${vbY} ${vbW} ${vbH}" width="1600">
    <rect x="${vbX}" y="${vbY}" width="${vbW}" height="${vbH}" fill="#f0f2f5"/>
    <path d="${countryPath}" fill="#e8e8e8" stroke="#bbb" stroke-width="${ss * 0.5}"/>
    ${divisionShapes}
    ${externalPath}
    ${internalPath}
    ${dots}
  </svg>`;
  return sharp(Buffer.from(borderSvg))
    .flatten({ background: '#f0f2f5' })
    .png()
    .toBuffer();
}

interface ImageDims {
  TW: number; TH: number; tp: number;
  origW: number; origH: number;
  RES_SCALE: number;
  oddK: (base: number) => number;
  pxS: (base: number) => number;
}

/** Compute working image dimensions + pixel-constant scalers from the original size. */
function deriveImageDims(origW: number, origH: number): ImageDims {
  const TW = 800;
  const scale = TW / origW;
  const TH = Math.round(origH * scale);
  const tp = TW * TH;
  const RES_SCALE = TW / 500;
  const oddK = (base: number) => { const v = Math.round(base * RES_SCALE); return v | 1; };
  const pxS = (base: number) => Math.round(base * RES_SCALE);
  return { TW, TH, tp, origW, origH, RES_SCALE, oddK, pxS };
}

interface PythonPipelineParams {
  mapBuffer: Buffer;
  dims: ImageDims;
  expectedRegionCount: number;
  regionId: number; worldViewId: number;
  childRegionMemberIds: Set<number>;
  countryIds: number[]; countryDepth: number;
  sendEvent: SendEvent; logStep: LogStep; pushDebugImage: PushDebugImage;
  debugImages: Array<{ label: string; dataUrl: string }>;
  startTime: number;
}

interface PythonPhase1Buffers {
  filteredBuf: Buffer;
  maskBuf: Buffer;
  noiseMaskBuf: Buffer | undefined;
  origDownBuf: Buffer;
  filteredRawBuf: Buffer;
}

/** Run Python Phase 1 and decode its outputs into reusable buffers. */
async function runPythonPhase1AndPrepareBuffers(
  cvPhase1: typeof import('../../services/cv/pythonCvClient.js').cvPhase1,
  mapBuffer: Buffer, dims: ImageDims,
  pyProgress: (step: string) => Promise<void>,
  logStep: LogStep, pushDebugImage: PushDebugImage,
  sendEvent: SendEvent,
): Promise<PythonPhase1Buffers> {
  const { TW, TH, origW, origH } = dims;
  // Handle interactive review requests emitted by Python (currently just water
  // review). Emit the equivalent SSE event to the frontend, wait for the
  // operator's response via POST /wv-import/water-review/:id, then forward
  // the decision to Python /pipeline/respond/:id so the worker unblocks.
  const { registerPythonReview } = await import('../../services/cv/pythonReviewBridge.js');
  const { cvRespondToReview } = await import('../../services/cv/pythonCvClient.js');
  const onReview = async (req: { kind: string; reviewId: string; data: unknown }) => {
    if (req.kind === 'water') {
      const data = (req.data ?? {}) as {
        components?: Array<{ id: number; pct: number; cropDataUrl: string; subClusters: Array<{ idx: number; pct: number; cropDataUrl: string }> }>;
        waterPxPercent?: number;
        waterMaskImage?: string;
      };
      sendEvent({
        type: 'water_review',
        reviewId: req.reviewId,
        waterPxPercent: data.waterPxPercent ?? 0,
        waterMaskImage: data.waterMaskImage ?? '',
        waterComponents: (data.components ?? []).map(c => ({
          id: c.id,
          pct: c.pct,
          cropDataUrl: c.cropDataUrl,
          subClusters: c.subClusters ?? [],
        })),
      });
      const decision = await new Promise<unknown>((resolve) => {
        registerPythonReview(req.reviewId, resolve);
      });
      await cvRespondToReview(req.reviewId, decision);
    } else {
      console.warn(`[Python Review] Unknown review kind "${req.kind}" — continuing without response`);
      await cvRespondToReview(req.reviewId, {});
    }
  };

  const phase1 = await cvPhase1(mapBuffer, { tw: TW, th: TH, origW, origH }, pyProgress, onReview);
  for (const di of phase1.debugImages) await pushDebugImage(di.label, di.dataUrl);
  if (phase1.waterComponents.length > 0) {
    await logStep(`Python CV: water detection found ${phase1.waterComponents.length} component(s)`);
  }

  const filteredBuf = Buffer.from(phase1.filteredImage.replace(/^data:image\/png;base64,/, ''), 'base64');
  const maskBuf = Buffer.from(phase1.countryMask.replace(/^data:image\/png;base64,/, ''), 'base64');
  const noiseMaskBuf = phase1.knownNoiseMask
    ? Buffer.from(phase1.knownNoiseMask.replace(/^data:image\/png;base64,/, ''), 'base64')
    : undefined;
  const origDownBuf = await sharp(mapBuffer)
    .removeAlpha().resize(TW, TH, { kernel: 'lanczos3' }).raw().toBuffer();
  // Raw RGB version of the Python-filtered image (mean-shifted, text+road-inpainted).
  // Must NOT be origDownBuf — passing the dirty original re-introduces road/text pixel
  // colors into cluster centroids.
  const filteredRawBuf = await sharp(filteredBuf).removeAlpha().raw().toBuffer();
  return { filteredBuf, maskBuf, noiseMaskBuf, origDownBuf, filteredRawBuf };
}

interface PythonPhase2Outcome {
  pixelLabels: Uint8Array;
  colorCentroids: Array<[number, number, number] | null>;
  countryMask: Uint8Array;
}

/** Run Python Phase 2 for a single iteration and materialize its outputs into typed arrays. */
async function runPythonPhase2Iteration(
  cvPhase2: typeof import('../../services/cv/pythonCvClient.js').cvPhase2,
  buffers: PythonPhase1Buffers, dims: ImageDims,
  numClusters: number, randomSeed: number,
  pyProgress: (step: string) => Promise<void>,
  pushDebugImage: PushDebugImage,
): Promise<PythonPhase2Outcome> {
  const { TW, TH } = dims;
  const phase2 = await cvPhase2(
    buffers.filteredBuf, buffers.maskBuf,
    { tw: TW, th: TH, numClusters, randomSeed },
    pyProgress, buffers.noiseMaskBuf,
  );
  for (const di of phase2.debugImages) await pushDebugImage(di.label, di.dataUrl);

  const pixelLabels = new Uint8Array(Buffer.from(phase2.pixelLabels, 'base64'));
  const colorCentroids: Array<[number, number, number] | null> = new Array(32).fill(null);
  for (let i = 0; i < phase2.colorCentroids.length; i++) {
    colorCentroids[i] = phase2.colorCentroids[i];
  }
  if (phase2.quantizedImage) {
    await pushDebugImage('__quantized_map__', phase2.quantizedImage);
  }
  const countryMask = new Uint8Array(TW * TH);
  for (let i = 0; i < pixelLabels.length; i++) {
    countryMask[i] = pixelLabels[i] !== 255 ? 1 : 0;
  }
  return { pixelLabels, colorCentroids, countryMask };
}

/**
 * Execute the Python CV branch. Returns `true` when Python handled the request (caller should exit);
 * `false` when the Python service is unavailable and the caller should fall back to JavaScript.
 */
async function runPythonPipeline(p: PythonPipelineParams, res: Response): Promise<boolean> {
  const { cvHealthCheck, cvPhase1, cvPhase2 } = await import('../../services/cv/pythonCvClient.js');
  const isAvailable = await cvHealthCheck();
  if (!isAvailable) {
    console.warn('[CV] Python service unavailable, falling back to JavaScript');
    return false;
  }
  console.log('[CV] Using Python CV pipeline');

  const { mapBuffer, dims, expectedRegionCount } = p;
  const { TW, TH, origW, origH } = dims;
  const pyProgress = (step: string) => p.logStep(`Python CV: ${step}`);

  const buffers = await runPythonPhase1AndPrepareBuffers(
    cvPhase1, mapBuffer, dims, pyProgress, p.logStep, p.pushDebugImage, p.sendEvent,
  );

  let pyNumClusters = Math.max(8, Math.min(expectedRegionCount * 3, 32));
  let pyRandomSeed = 0; // 0 = deterministic PP_CENTERS, >0 = RANDOM_CENTERS with this seed
  let pyRecluster: ReclusterSignal | void;
  do {
    const seedSuffix = pyRandomSeed ? `, seed #${pyRandomSeed}` : '';
    await p.logStep(`Python CV: clustering (k=${pyNumClusters}${seedSuffix}) + superpixels...`);
    const { pixelLabels, colorCentroids, countryMask } = await runPythonPhase2Iteration(
      cvPhase2, buffers, dims, pyNumClusters, pyRandomSeed, pyProgress, p.pushDebugImage,
    );

    pyRecluster = await matchDivisionsFromClusters({
      worldViewId: p.worldViewId, regionId: p.regionId,
      knownDivisionIds: p.childRegionMemberIds,
      countryIds: p.countryIds, countryDepth: p.countryDepth,
      buf: buffers.filteredRawBuf, origBuf: buffers.origDownBuf, mapBuffer,
      countryMask, pixelLabels, colorCentroids,
      TW, TH, origW, origH,
      skipClusterReview: false,
      sendEvent: p.sendEvent as (event: Record<string, unknown>) => void,
      logStep: p.logStep, pushDebugImage: p.pushDebugImage,
      debugImages: p.debugImages, startTime: p.startTime,
    });

    if (pyRecluster?.recluster) {
      const { next, seed } = applyPythonReclusterPreset(pyRecluster.preset, pyNumClusters, pyRandomSeed);
      pyNumClusters = next;
      pyRandomSeed = seed;
    }
  } while (pyRecluster?.recluster);

  p.sendEvent({ type: 'complete', data: { message: 'Python CV pipeline completed' } });
  res.end();
  return true;
}

/** Pure computation of updated (k, seed) from a Python recluster preset. */
function applyPythonReclusterPreset(
  preset: NonNullable<ReclusterSignal['preset']>,
  k: number, seed: number,
): { next: number; seed: number } {
  if (preset === 'more_clusters') {
    const nextK = Math.min(k + 4, 32);
    const nextSeed = seed + 1;
    console.log(`  [Python Recluster] More clusters: k → ${nextK}, seed #${nextSeed}`);
    return { next: nextK, seed: nextSeed };
  }
  if (preset === 'different_seed') {
    const nextSeed = seed + 1;
    console.log(`  [Python Recluster] Different seed #${nextSeed}`);
    return { next: k, seed: nextSeed };
  }
  if (preset === 'boost_chroma') {
    const nextSeed = seed + 1;
    console.log(`  [Python Recluster] Boost chroma, seed #${nextSeed}`);
    return { next: k, seed: nextSeed };
  }
  // remove_roads, fill_holes, clean_light, clean_heavy — Python re-runs full Phase 2
  console.log(`  [Python Recluster] ${preset}: re-running full Phase 2 (cleanup presets not yet optimized for Python)`);
  return { next: k, seed };
}

/** Downscale + median filter + color-line removal; keep a pristine origDownBuf for water crops. */
async function buildDownscaledBuffers(
  mapBuffer: Buffer, dims: ImageDims,
): Promise<{ origDownBuf: Buffer; rawBuf: Buffer; colorBuf: Buffer }> {
  const { TW, TH, RES_SCALE, oddK } = dims;
  const origDownBuf = await sharp(mapBuffer)
    .removeAlpha()
    .resize(TW, TH, { kernel: 'lanczos3' })
    .raw()
    .toBuffer();
  const rawBuf = await sharp(mapBuffer)
    .removeAlpha()
    .resize(TW, TH, { kernel: 'lanczos3' })
    .median(oddK(5))
    .raw()
    .toBuffer();
  removeColoredLines(rawBuf, TW, TH, RES_SCALE);
  const colorBuf = Buffer.from(origDownBuf);
  return { origDownBuf, rawBuf, colorBuf };
}

interface JsPipelineContextInput {
  cv: PipelineContext['cv'];
  regionId: number; worldViewId: number; regionName: string;
  knownDivisionIds: Set<number>;
  expectedRegionCount: number; mapBuffer: Buffer;
  dims: ImageDims;
  origDownBuf: Buffer; rawBuf: Buffer; colorBuf: Buffer;
  sendEvent: SendEvent;
  logStep: LogStep; pushDebugImage: PushDebugImage;
  debugImages: Array<{ label: string; dataUrl: string }>;
  startTime: number;
}

function buildJsPipelineContext(input: JsPipelineContextInput): PipelineContext {
  const { dims, cv, sendEvent, logStep, pushDebugImage, debugImages, startTime, regionName } = input;
  return {
    cv,
    regionId: input.regionId, worldViewId: input.worldViewId, regionName,
    knownDivisionIds: input.knownDivisionIds,
    expectedRegionCount: input.expectedRegionCount, mapBuffer: input.mapBuffer,
    TW: dims.TW, TH: dims.TH, tp: dims.tp, origW: dims.origW, origH: dims.origH, RES_SCALE: dims.RES_SCALE,
    origDownBuf: input.origDownBuf, rawBuf: input.rawBuf, colorBuf: input.colorBuf,
    hsvSharp: Buffer.alloc(0), labBufEarly: Buffer.alloc(0),
    hsvBuf: Buffer.alloc(0), inpaintedBuf: null,
    waterGrown: new Uint8Array(0),
    countryMask: new Uint8Array(0), countrySize: 0,
    coastalBand: new Uint8Array(0),
    pixelLabels: new Uint8Array(0),
    colorCentroids: [], clusterCounts: [],
    ckOverride: null, chromaBoost: 1.0, randomSeed: false,
    sendEvent: sendEvent as PipelineContext['sendEvent'],
    logStep, pushDebugImage, debugImages, startTime,
    oddK: dims.oddK, pxS: dims.pxS,
  };
}

/**
 * Morphological opening on the country mask — removes thin features (roads, border lines)
 * while preserving solid region fills. Mutates ctx.countryMask / countrySize / pixelLabels / clusterCounts.
 */
function applyRemoveRoadsPreset(ctx: PipelineContext): void {
  const { cv, TW, TH, tp } = ctx;
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
      if (ctx.pixelLabels[i] !== 255) {
        ctx.clusterCounts[ctx.pixelLabels[i]]--;
        ctx.pixelLabels[i] = 255;
      }
      removed++;
    }
  }
  cmMat.delete(); roadK.delete(); opened.delete();
  console.log(`  [Remove roads] Removed ${removed} thin pixels (${(removed / tp * 100).toFixed(1)}%)`);
}

/** Seed the BFS queue with all border inverse-mask pixels. */
function seedExteriorBorderQueue(
  inverseMask: Uint8Array, exterior: Uint8Array,
  TW: number, TH: number, queue: number[],
): void {
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
}

/** Push `n` onto the BFS queue if it's a valid, unmarked inverse-mask neighbor. */
function tryPushExteriorNeighbor(
  n: number, inverseMask: Uint8Array, exterior: Uint8Array,
  TW: number, TH: number, tp: number, queue: number[],
): void {
  if (n < 0 || n >= tp || !inverseMask[n] || exterior[n]) return;
  const nx = n % TW, ny = Math.floor(n / TW);
  if (nx < 0 || nx >= TW || ny < 0 || ny >= TH) return;
  exterior[n] = 1;
  queue.push(n);
}

/** Flood-fill `exterior` from all four image borders using the inverse country mask. */
function floodFillExteriorMask(
  inverseMask: Uint8Array, TW: number, TH: number, tp: number,
): Uint8Array {
  const exterior = new Uint8Array(tp);
  const queue: number[] = [];
  seedExteriorBorderQueue(inverseMask, exterior, TW, TH, queue);

  let head = 0;
  while (head < queue.length) {
    const p = queue[head++];
    tryPushExteriorNeighbor(p - 1, inverseMask, exterior, TW, TH, tp, queue);
    tryPushExteriorNeighbor(p + 1, inverseMask, exterior, TW, TH, tp, queue);
    tryPushExteriorNeighbor(p - TW, inverseMask, exterior, TW, TH, tp, queue);
    tryPushExteriorNeighbor(p + TW, inverseMask, exterior, TW, TH, tp, queue);
  }
  return exterior;
}

/** Collect interior hole pixels (not reachable from borders) and add them to the country mask. */
function collectAndFillInteriorHoles(
  ctx: PipelineContext, inverseMask: Uint8Array, exterior: Uint8Array, tp: number,
): number[] {
  const holePixels: number[] = [];
  for (let i = 0; i < tp; i++) {
    if (inverseMask[i] && !exterior[i]) {
      ctx.countryMask[i] = 1;
      ctx.countrySize++;
      holePixels.push(i);
    }
  }
  return holePixels;
}

/** Seed BFS queue: inherit a cluster label for each hole pixel from its first clustered neighbor. */
function seedHoleLabelsFromBoundary(
  ctx: PipelineContext, holePixels: number[], holeSet: Set<number>,
  tp: number, TW: number, fillQueue: number[],
): void {
  for (const hp of holePixels) {
    for (const n of [hp - 1, hp + 1, hp - TW, hp + TW]) {
      if (n < 0 || n >= tp || holeSet.has(n) || ctx.pixelLabels[n] === 255) continue;
      if (ctx.pixelLabels[hp] !== 255) break;
      ctx.pixelLabels[hp] = ctx.pixelLabels[n];
      ctx.clusterCounts[ctx.pixelLabels[n]]++;
      fillQueue.push(hp);
    }
  }
}

/** Propagate labels from the BFS queue into still-unlabeled hole pixels. */
function propagateHoleLabels(
  ctx: PipelineContext, holeSet: Set<number>,
  tp: number, TW: number, fillQueue: number[],
): void {
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

/** BFS outward from hole-boundary cluster pixels, labelling adjacent hole pixels with neighbor's label. */
function bfsFillHoleLabels(
  ctx: PipelineContext, holePixels: number[], tp: number, TW: number,
): void {
  if (holePixels.length === 0) return;
  const holeSet = new Set(holePixels);
  const fillQueue: number[] = [];
  seedHoleLabelsFromBoundary(ctx, holePixels, holeSet, tp, TW, fillQueue);
  propagateHoleLabels(ctx, holeSet, tp, TW, fillQueue);
}

/** Fill interior holes (text/sign gaps) in the country mask. */
function applyFillHolesPreset(ctx: PipelineContext): void {
  const { TW, TH, tp } = ctx;
  const inverseMask = new Uint8Array(tp);
  for (let i = 0; i < tp; i++) {
    if (!ctx.countryMask[i]) inverseMask[i] = 1;
  }
  const exterior = floodFillExteriorMask(inverseMask, TW, TH, tp);
  const holePixels = collectAndFillInteriorHoles(ctx, inverseMask, exterior, tp);
  bfsFillHoleLabels(ctx, holePixels, tp, TW);
  console.log(`  [Fill holes] Filled ${holePixels.length} interior hole pixels (${(holePixels.length / tp * 100).toFixed(1)}%)`);
}

/** Grow one connected component starting at `seed`. Returns its size. */
function growConnectedComponent(
  seed: number, label: number,
  countryMask: Uint8Array, ccLabels: Int32Array,
  tp: number, TW: number, TH: number,
): number {
  const bfs = [seed];
  let size = 0;
  while (bfs.length > 0) {
    const p = bfs.pop()!;
    if (p < 0 || p >= tp || ccLabels[p] > 0 || !countryMask[p]) continue;
    ccLabels[p] = label;
    size++;
    const x = p % TW, y = Math.floor(p / TW);
    if (x > 0) bfs.push(p - 1);
    if (x < TW - 1) bfs.push(p + 1);
    if (y > 0) bfs.push(p - TW);
    if (y < TH - 1) bfs.push(p + TW);
  }
  return size;
}

/** Label connected components in the country mask using a BFS stack. */
function labelConnectedComponents(
  ctx: PipelineContext, tp: number, TW: number, TH: number,
): { ccLabels: Int32Array; ccSizes: Map<number, number> } {
  const ccLabels = new Int32Array(tp);
  let nextLabel = 1;
  const ccSizes = new Map<number, number>();
  for (let i = 0; i < tp; i++) {
    if (!ctx.countryMask[i] || ccLabels[i] > 0) continue;
    const label = nextLabel++;
    const size = growConnectedComponent(i, label, ctx.countryMask, ccLabels, tp, TW, TH);
    ccSizes.set(label, size);
  }
  return { ccLabels, ccSizes };
}

/** Remove small isolated pixel clusters (text remnants, icon fragments). */
function applyCleanSmallCCsPreset(
  ctx: PipelineContext, preset: 'clean_light' | 'clean_heavy',
): void {
  const { TW, TH, tp } = ctx;
  const threshold = preset === 'clean_light' ? 0.001 : 0.005;
  const minSize = Math.max(5, Math.round(ctx.countrySize * threshold));
  const { ccLabels, ccSizes } = labelConnectedComponents(ctx, tp, TW, TH);

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
  const variantLabel = preset === 'clean_light' ? 'light' : 'heavy';
  console.log(`  [Clean ${variantLabel}] Removed ${removed} pixels in ${removedCCs} small CCs (threshold: <${minSize}px = ${(threshold * 100).toFixed(1)}% of country)`);
}

/**
 * Apply a JS recluster preset to `ctx`. Returns `true` if the preset only cleans
 * existing clusters (skip K-means next iteration); `false` if K-means must re-run.
 */
function applyJsReclusterPreset(
  ctx: PipelineContext,
  preset: NonNullable<ReclusterSignal['preset']>,
  expectedRegionCount: number,
): boolean {
  if (preset === 'more_clusters') {
    const baseCK = ctx.ckOverride ?? Math.max(8, Math.min(expectedRegionCount * 3, 32));
    ctx.ckOverride = Math.min(baseCK + 4, 32);
    console.log(`  [Recluster] More clusters: CK → ${ctx.ckOverride}`);
    return false;
  }
  if (preset === 'different_seed') {
    ctx.randomSeed = true;
    console.log(`  [Recluster] Different seed: randomizing K-means++ init`);
    return false;
  }
  if (preset === 'boost_chroma') {
    ctx.chromaBoost = 1.5;
    console.log(`  [Recluster] Boost chroma: a*/b* weight → ${ctx.chromaBoost}`);
    return false;
  }
  if (preset === 'remove_roads') {
    applyRemoveRoadsPreset(ctx);
    return true;
  }
  if (preset === 'fill_holes') {
    applyFillHolesPreset(ctx);
    return true;
  }
  if (preset === 'clean_light' || preset === 'clean_heavy') {
    applyCleanSmallCCsPreset(ctx, preset);
    return true;
  }
  return false;
}

interface JsPipelineParams {
  mapBuffer: Buffer;
  dims: ImageDims;
  regionId: number; worldViewId: number; regionName: string;
  knownDivisionIds: Set<number>;
  childRegionMemberIds: Set<number>;
  countryIds: number[]; countryDepth: number;
  expectedRegionCount: number;
  sendEvent: SendEvent; logStep: LogStep; pushDebugImage: PushDebugImage;
  debugImages: Array<{ label: string; dataUrl: string }>;
  startTime: number;
}

/** Run the JavaScript CV branch: noise removal → mean-shift → K-means → match → recluster loop. */
async function runJavaScriptPipeline(p: JsPipelineParams): Promise<void> {
  const { mapBuffer, dims, expectedRegionCount } = p;
  const { TW, TH, origW, origH } = dims;
  await p.logStep('Noise removal (downscale + median + line removal)...');
  if (!G.__cv) throw new Error('OpenCV WASM not available');
  const cv = G.__cv;

  const { origDownBuf, rawBuf, colorBuf } = await buildDownscaledBuffers(mapBuffer, dims);

  // Debug: show image after noise removal (before CV processing)
  const noiseRemovedPng = await sharp(Buffer.from(rawBuf), {
    raw: { width: TW, height: TH, channels: 3 },
  }).resize(origW, origH, { kernel: 'lanczos3' }).png().toBuffer();
  await p.pushDebugImage(
    'After noise removal (downscale + median + line removal)',
    `data:image/png;base64,${noiseRemovedPng.toString('base64')}`,
  );

  const ctx = buildJsPipelineContext({
    cv,
    regionId: p.regionId, worldViewId: p.worldViewId, regionName: p.regionName,
    knownDivisionIds: p.knownDivisionIds,
    expectedRegionCount, mapBuffer,
    dims, origDownBuf, rawBuf, colorBuf,
    sendEvent: p.sendEvent, logStep: p.logStep, pushDebugImage: p.pushDebugImage,
    debugImages: p.debugImages, startTime: p.startTime,
  });

  await meanshiftPreprocess(ctx);

  let reclusterResult: ReclusterSignal | void;
  let skipKmeans = false; // remove_roads / fill_holes / clean_* skip K-means
  do {
    if (!skipKmeans) await runKMeansClustering(ctx);
    skipKmeans = false;

    reclusterResult = await matchDivisionsFromClusters({
      worldViewId: p.worldViewId, regionId: p.regionId,
      knownDivisionIds: p.childRegionMemberIds,
      countryIds: p.countryIds, countryDepth: p.countryDepth,
      buf: ctx.colorBuf, origBuf: ctx.origDownBuf, mapBuffer,
      countryMask: ctx.countryMask,
      pixelLabels: ctx.pixelLabels, colorCentroids: ctx.colorCentroids,
      TW, TH, origW, origH,
      skipClusterReview: false,
      sendEvent: p.sendEvent as (event: Record<string, unknown>) => void,
      logStep: p.logStep, pushDebugImage: p.pushDebugImage,
      debugImages: p.debugImages, startTime: p.startTime,
    });

    if (reclusterResult?.recluster) {
      skipKmeans = applyJsReclusterPreset(ctx, reclusterResult.preset, expectedRegionCount);
      await p.logStep(skipKmeans ? 'Cleaning...' : 'Re-clustering...');
    }
  } while (reclusterResult?.recluster);
}

interface SourceMapPipelineParams {
  regionMapUrl: string;
  regionName: string;
  regionId: number; worldViewId: number;
  knownDivisionIds: Set<number>;
  childRegionMemberIds: Set<number>;
  countryIds: number[]; countryDepth: number;
  expectedRegionCount: number;
  sendEvent: SendEvent; logStep: LogStep; pushDebugImage: PushDebugImage;
  debugImages: Array<{ label: string; dataUrl: string }>;
  startTime: number;
}

/**
 * Fetch the source map image, normalize to PNG, derive working dimensions, then dispatch to
 * the Python or JavaScript CV branch based on the `cv_pipeline_implementation` setting.
 */
async function runSourceMapPipeline(p: SourceMapPipelineParams, res: Response): Promise<void> {
  await p.logStep('Fetching source map image...');
  const mapResponse = await fetch(p.regionMapUrl, {
    headers: { 'User-Agent': 'TrackYourRegions/1.0 (CV border detection)' },
    redirect: 'follow',
  });
  if (!mapResponse.ok) {
    console.log(`  Source map fetch failed: ${mapResponse.status}`);
    return;
  }

  const rawMapBuffer = Buffer.from(await mapResponse.arrayBuffer());
  const origMeta = await sharp(rawMapBuffer).metadata();
  const origW = origMeta.width!;
  const origH = origMeta.height!;
  // Normalize to PNG for compatibility with Python CV (cv2.imdecode raster only)
  const mapBuffer = await sharp(rawMapBuffer).removeAlpha().png().toBuffer();

  try {
    await p.pushDebugImage(
      '__source_map__',
      `data:image/png;base64,${mapBuffer.toString('base64')}`,
    );
  } catch (err) {
    console.warn('[CV] Failed to push source map debug image:', err);
  }

  const dims = deriveImageDims(origW, origH);

  // Decide Python vs JS implementation
  const { getSetting } = await import('../../services/ai/aiSettingsService.js');
  const cvImpl = await getSetting('cv_pipeline_implementation') ?? 'javascript';
  if (cvImpl === 'python') {
    const handled = await runPythonPipeline({
      mapBuffer, dims, expectedRegionCount: p.expectedRegionCount,
      regionId: p.regionId, worldViewId: p.worldViewId,
      childRegionMemberIds: p.childRegionMemberIds,
      countryIds: p.countryIds, countryDepth: p.countryDepth,
      sendEvent: p.sendEvent, logStep: p.logStep, pushDebugImage: p.pushDebugImage,
      debugImages: p.debugImages, startTime: p.startTime,
    }, res);
    if (handled) return;
  }

  await runJavaScriptPipeline({
    mapBuffer, dims,
    regionId: p.regionId, worldViewId: p.worldViewId, regionName: p.regionName,
    knownDivisionIds: p.knownDivisionIds,
    childRegionMemberIds: p.childRegionMemberIds,
    countryIds: p.countryIds, countryDepth: p.countryDepth,
    expectedRegionCount: p.expectedRegionCount,
    sendEvent: p.sendEvent, logStep: p.logStep, pushDebugImage: p.pushDebugImage,
    debugImages: p.debugImages, startTime: p.startTime,
  });
}

// =============================================================================
// colorMatchDivisionsSSE — SSE-streaming CV pipeline orchestrator
// =============================================================================

export async function colorMatchDivisionsSSE(req: AuthenticatedRequest, res: Response): Promise<void> {
  const worldViewId = parseInt(String(req.params.worldViewId));
  const regionId = parseInt(String(req.query.regionId));

  const startTime = Date.now();
  const { sendEvent, logStep } = createSseHelpers(res, startTime);

  // 1. Load region name + map URL
  const regionInfo = await loadRegionAndMap(regionId, worldViewId, sendEvent, res);
  if (!regionInfo) return;
  const { regionName, regionMapUrl } = regionInfo;

  await logStep(`Loading divisions for ${regionName}...`);

  // 2. Resolve division scope
  const { knownDivisionIds, childRegionMemberIds } = await loadKnownDivisionIds(regionId, worldViewId);
  if (knownDivisionIds.size === 0) {
    sendEvent({ type: 'error', message: 'No divisions found in this region or its children — need at least one accepted division (region_members)' });
    res.end();
    return;
  }

  const countryIds = await resolveCountryIds(knownDivisionIds, childRegionMemberIds);
  if (countryIds.length === 0) {
    sendEvent({ type: 'error', message: 'Cannot determine GADM scope: region has no own division and no children with divisions assigned' });
    res.end();
    return;
  }
  const countryDepth = 0;

  const expectedRegionCount = await countChildRegions(regionId, worldViewId);

  // 3. Walk down the GADM tree to the target depth
  const allDivisionIds = await loadAllDivisionIds(
    countryIds, knownDivisionIds, expectedRegionCount, countryDepth,
  );
  if (allDivisionIds.length === 0) {
    sendEvent({ type: 'error', message: 'No divisions found at this level' });
    res.end();
    return;
  }

  const gapCount = allDivisionIds.length - childRegionMemberIds.size;
  await logStep(`Found ${allDivisionIds.length} divisions (${childRegionMemberIds.size} assigned to child regions, ${gapCount} to process)`);

  // 4. Load assignments + centroids
  const assignedMap = await loadAssignedMap(regionId, worldViewId);
  const centroids = await loadCentroids(allDivisionIds, assignedMap);

  await logStep(`Computing borders for ${centroids.length} divisions...`);

  // 5. Fetch SVG paths + classified borders, render "Step 1" debug image
  const borderData = await loadDivPathsAndBorders(allDivisionIds);
  if (!borderData) {
    sendEvent({ type: 'error', message: 'Could not compute borders' });
    res.end();
    return;
  }

  const borderPng = await renderBorderDebugPng(borderData, centroids);

  const debugImages: Array<{ label: string; dataUrl: string }> = [];
  const pushDebugImage = createPushDebugImage(sendEvent, regionName, debugImages);

  await pushDebugImage(
    'Step 1: GADM divisions with classified borders (red=external, blue dashed=internal, green dot=assigned, orange dot=unassigned)',
    `data:image/png;base64,${borderPng.toString('base64')}`,
  );

  // 6. Source map → CV pipeline (Python or JavaScript)
  try {
    await runSourceMapPipeline({
      regionMapUrl, regionName,
      regionId, worldViewId,
      knownDivisionIds, childRegionMemberIds,
      countryIds, countryDepth,
      expectedRegionCount,
      sendEvent, logStep, pushDebugImage,
      debugImages, startTime,
    }, res);
  } catch (mapErr) {
    const errMsg = mapErr instanceof Error ? mapErr.message : String(mapErr);
    console.error('  Source map border detection failed:', mapErr);
    await logStep(`CV processing error: ${errMsg}`);
  }

  if (!res.destroyed) res.end();
}
