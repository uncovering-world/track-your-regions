/**
 * Shared division-matching orchestrator for CV color match.
 *
 * Coordinates the full pipeline: cluster cleaning → interactive review →
 * ICP alignment → division assignment → result assembly.
 * Each phase lives in its own module; this file manages the sequence,
 * SSE events, and interactive cluster review loop.
 */

import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import sharp from 'sharp';
import { pool } from '../../db/index.js';
import {
  registerIcpAdjustment,
  hasIcpAdjustment,
  cancelIcpAdjustment,
  type IcpAdjustmentDecision,
} from './wvImportMatchReview.js';
import { cleanClusters } from './wvImportMatchClusterClean.js';
import {
  alignDivisionsToImage,
  detectBboxInflation,
  findBboxOutliers,
  findOverlapOutliers,
  computeSvgPathArea,
  computeBboxFromDivisions,
  type AlignmentResult,
  type DivisionBbox,
} from './wvImportMatchIcp.js';
import { parseSvgPathPoints } from './wvImportMatchSvgHelpers.js';
import {
  assignDivisionsToClusters,
  type DivAssignment,
  type FinalDivAssignment,
} from './wvImportMatchAssignment.js';
import {
  runClusterReviewLoop,
  type GridDims,
  type ReclusterSignal,
} from './wvImportMatchClusterReview.js';
import {
  buildPhase5Results,
  runSpatialAnomalyDetection,
  buildCompletePayload,
  type CentroidInfo,
  type MatchingResult,
} from './wvImportMatchPhase5.js';

// Re-export SVG helpers for backward compatibility (used by other modules)
export { parseSvgPathPoints, parseSvgSubPaths, resamplePath } from './wvImportMatchSvgHelpers.js';

// Re-export ReclusterSignal for the pipeline caller
export type { ReclusterSignal } from './wvImportMatchClusterReview.js';

// =============================================================================
// Exported types
// =============================================================================

export interface MatchDivisionsParams {
  worldViewId: number;
  regionId: number;
  knownDivisionIds: Set<number>;
  countryIds: number[];
  countryDepth: number;
  buf: Buffer;
  /** Original (pre-mean-shift) image buffer — for divisive split */
  origBuf?: Buffer;
  mapBuffer: Buffer;
  countryMask: Uint8Array;
  pixelLabels: Uint8Array;
  colorCentroids: Array<[number, number, number] | null>;
  TW: number;
  TH: number;
  origW: number;
  origH: number;
  skipClusterReview: boolean;
  sendEvent: (event: Record<string, unknown>) => void;
  logStep: (msg: string) => Promise<void>;
  pushDebugImage: (label: string, dataUrl: string) => Promise<void>;
  debugImages: Array<{ label: string; dataUrl: string }>;
  startTime: number;
}

// =============================================================================
// Division data loading
// =============================================================================

/** Query division IDs at the given depth below `countryIds` */
async function queryDivisionsAtDepth(countryIds: number[], depth: number): Promise<number[]> {
  const result = await pool.query<{ id: number }>(`
    WITH RECURSIVE descendants AS (
      SELECT id, 0 AS depth FROM administrative_divisions WHERE id = ANY($1)
      UNION ALL
      SELECT ad.id, d.depth + 1 FROM administrative_divisions ad
      JOIN descendants d ON ad.parent_id = d.id
      WHERE d.depth < $2
    )
    SELECT id FROM descendants WHERE depth = $2
  `, [countryIds, depth]);
  return result.rows.map(r => r.id);
}

/**
 * Resolve the division ID set: query target depth, fall back one level deeper
 * if the initial query returned <= 1 division at the given depth.
 */
async function resolveAllDivisionIds(
  countryIds: number[],
  countryDepth: number,
  knownDivisionIds: Set<number>,
): Promise<number[]> {
  let targetDepth = countryDepth === 0 ? 1 : countryDepth;
  let rows = await queryDivisionsAtDepth(countryIds, targetDepth);
  if (rows.length <= 1 && targetDepth === countryDepth) {
    targetDepth = countryDepth + 1;
    rows = await queryDivisionsAtDepth(countryIds, targetDepth);
  }
  const allDivisionIdSet = new Set<number>(rows);
  for (const id of knownDivisionIds) allDivisionIdSet.add(id);
  return [...allDivisionIdSet];
}

/** Load the map of divisions already assigned to CHILD regions of `regionId` */
async function loadAssignedChildRegions(
  regionId: number,
  worldViewId: number,
): Promise<Map<number, { regionId: number; regionName: string }>> {
  const result = await pool.query<{ division_id: number; region_id: number; region_name: string }>(`
    SELECT rm.division_id, rm.region_id, r.name AS region_name
    FROM region_members rm
    JOIN regions r ON r.id = rm.region_id
    WHERE rm.region_id IN (
      SELECT id FROM regions WHERE parent_region_id = $1 AND world_view_id = $2
    )
  `, [regionId, worldViewId]);
  const assignedMap = new Map<number, { regionId: number; regionName: string }>();
  for (const r of result.rows) {
    assignedMap.set(r.division_id, { regionId: r.region_id, regionName: r.region_name });
  }
  return assignedMap;
}

/** Load centroids + names for all divisions, populating `divNameMap` */
async function loadCentroids(
  allDivisionIds: number[],
  assignedMap: Map<number, { regionId: number; regionName: string }>,
  divNameMap: Map<number, string>,
): Promise<CentroidInfo[]> {
  const result = await pool.query<{ id: number; name: string; cx: string; cy: string }>(`
    SELECT id, name,
      ST_X(ST_Centroid(geom_simplified_medium)) AS cx,
      ST_Y(ST_Centroid(geom_simplified_medium)) AS cy
    FROM administrative_divisions
    WHERE id = ANY($1) AND geom_simplified_medium IS NOT NULL
  `, [allDivisionIds]);
  return result.rows.map(r => {
    divNameMap.set(r.id, r.name);
    return {
      id: r.id,
      cx: parseFloat(r.cx),
      cy: parseFloat(r.cy),
      assigned: assignedMap.get(r.id) ?? null,
    };
  });
}

interface BorderInfo {
  divPaths: Array<{ id: number; svgPath: string }>;
  countryPath: string;
  cMinX: number;
  cMinY: number;
  cMaxX: number;
  cMaxY: number;
  externalBorder: string | null;
  internalBorder: string | null;
}

/** Fetch division SVG paths and union borders in parallel */
async function loadDivPathsAndBorders(allDivisionIds: number[]): Promise<BorderInfo | null> {
  const [divPathsResult, borderResult] = await Promise.all([
    pool.query<{ id: number; svg_path: string }>(`
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

  if (borderResult.rows.length === 0) return null;

  const divPaths = divPathsResult.rows.map(r => ({ id: r.id, svgPath: r.svg_path }));
  const row = borderResult.rows[0];
  return {
    divPaths,
    countryPath: row.country_path as string,
    cMinX: parseFloat(row.country_min_x as string),
    cMinY: parseFloat(row.country_min_y as string),
    cMaxX: parseFloat(row.country_max_x as string),
    cMaxY: parseFloat(row.country_max_y as string),
    externalBorder: (row.external_border as string | null) ?? null,
    internalBorder: (row.internal_border as string | null) ?? null,
  };
}

/** Fetch region name + aggregated country name for logging */
async function loadRegionAndCountryNames(
  regionId: number,
  worldViewId: number,
  countryIds: number[],
): Promise<{ regionName: string; countryName: string }> {
  const regionNameResult = await pool.query<{ name: string }>(
    `SELECT name FROM regions WHERE id = $1 AND world_view_id = $2`,
    [regionId, worldViewId],
  );
  const countryNameResult = await pool.query<{ name: string }>(
    `SELECT string_agg(name, ' + ' ORDER BY id) AS name FROM administrative_divisions WHERE id = ANY($1)`,
    [countryIds],
  );
  return {
    regionName: regionNameResult.rows[0]?.name ?? `Region#${regionId}`,
    countryName: countryNameResult.rows[0]?.name ?? `Country#${countryIds.join('+')}`,
  };
}

// =============================================================================
// Matching-state dump
// =============================================================================

interface MatchingDumpParams {
  regionName: string;
  worldViewId: number;
  regionId: number;
  countryName: string;
  countryIds: number[];
  allDivisionIds: number[];
  dims: GridDims;
  origW: number;
  origH: number;
  countrySize: number;
  colorCentroids: Array<[number, number, number] | null>;
  centroids: CentroidInfo[];
  divPaths: Array<{ id: number; svgPath: string }>;
  countryPath: string;
  cMinX: number;
  cMinY: number;
  cMaxX: number;
  cMaxY: number;
  divNameMap: Map<number, string>;
  assignedMap: Map<number, { regionId: number; regionName: string }>;
  externalBorder: string | null;
  internalBorder: string | null;
  pixelLabels: Uint8Array;
  countryMask: Uint8Array;
  icpMask: Uint8Array;
  mapBuffer: Buffer;
}

/** Write post-review matching state to `data/matching-dumps/<regionSlug>/` for offline replay.
 * Paths are built from a sanitized region slug under a fixed base — not user-controlled input. */
/* eslint-disable security/detect-non-literal-fs-filename -- paths are internally constructed from sanitized region slug under fixed base dir, not user-controlled */
function dumpMatchingState(p: MatchingDumpParams): void {
  const safeName = p.regionName.replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase();
  const dumpDir = `data/matching-dumps/${safeName}`;
  if (!existsSync(dumpDir)) mkdirSync(dumpDir, { recursive: true });
  const dump = {
    regionId: p.regionId,
    worldViewId: p.worldViewId,
    regionName: p.regionName,
    countryName: p.countryName,
    countryIds: p.countryIds,
    allDivisionIds: p.allDivisionIds,
    TW: p.dims.TW,
    TH: p.dims.TH,
    origW: p.origW,
    origH: p.origH,
    countrySize: p.countrySize,
    colorCentroids: p.colorCentroids.map(c => c ?? null),
    centroids: p.centroids,
    divPaths: p.divPaths,
    countryPath: p.countryPath,
    countryBbox: { cMinX: p.cMinX, cMinY: p.cMinY, cMaxX: p.cMaxX, cMaxY: p.cMaxY },
    divNameMap: Object.fromEntries(p.divNameMap),
    assignedMap: Object.fromEntries([...p.assignedMap].map(([k, v]) => [String(k), v])),
    externalBorder: p.externalBorder,
    internalBorder: p.internalBorder,
  };
  writeFileSync(`${dumpDir}/gadm-data.json`, JSON.stringify(dump, null, 2));
  writeFileSync(`${dumpDir}/pixel-labels.b64`, Buffer.from(p.pixelLabels).toString('base64'));
  writeFileSync(`${dumpDir}/country-mask.b64`, Buffer.from(p.countryMask).toString('base64'));
  writeFileSync(`${dumpDir}/icp-mask.b64`, Buffer.from(p.icpMask).toString('base64'));
  writeFileSync(`${dumpDir}/source.png`, p.mapBuffer);
  console.log(`[DUMP] Post-review matching state saved to ${dumpDir}/`);
}
/* eslint-enable security/detect-non-literal-fs-filename */

// =============================================================================
// Python matching path
// =============================================================================

interface PythonMatchParams {
  divPaths: Array<{ id: number; svgPath: string }>;
  centroids: CentroidInfo[];
  colorCentroids: Array<[number, number, number] | null>;
  divNameMap: Map<number, string>;
  countryPath: string;
  cMinX: number;
  cMinY: number;
  cMaxX: number;
  cMaxY: number;
  pixelLabels: Uint8Array;
  icpMask: Uint8Array;
  dims: GridDims;
  origW: number;
  origH: number;
  logStep: (msg: string) => Promise<void>;
  pushDebugImage: (label: string, dataUrl: string) => Promise<void>;
}

/** Convert one Python divAssignment to {divAssignment, finalAssignment|unsplittable} */
function classifyPythonAssignment(
  a: { divisionId: number; clusterId: number; confidence: number; isSplit: boolean; splitClusters?: Array<{ clusterId: number; share: number }> },
): { asDiv: DivAssignment; unsplittable?: MatchingResult['unsplittableDivs'][number]; final?: FinalDivAssignment } {
  const asDiv: DivAssignment = {
    divisionId: a.divisionId,
    clusterId: a.clusterId,
    confidence: a.confidence,
    isSplit: a.isSplit,
    splitClusters: a.splitClusters,
  };
  if (a.isSplit) {
    return {
      asDiv,
      unsplittable: {
        divisionId: a.divisionId,
        clusterId: a.clusterId,
        confidence: a.confidence,
        depth: 0,
        splitClusters: a.splitClusters ?? [],
      },
    };
  }
  return {
    asDiv,
    final: {
      divisionId: a.divisionId,
      clusterId: a.clusterId,
      confidence: a.confidence,
      depth: 0,
    },
  };
}

/** Attempt Python RANSAC matching. Returns null if Python service is unavailable. */
async function runPythonMatching(p: PythonMatchParams): Promise<MatchingResult | null> {
  const { cvMatch, cvHealthCheck } = await import('../../services/cv/pythonCvClient.js');
  const pyAvailable = await cvHealthCheck();
  if (!pyAvailable) return null;

  await p.logStep('Python RANSAC matching (alignment + assignment)...');

  // Encode pixelLabels and icpMask as PNGs for HTTP transfer
  const labelsPng = await sharp(Buffer.from(p.pixelLabels), {
    raw: { width: p.dims.TW, height: p.dims.TH, channels: 1 },
  }).png().toBuffer();
  const icpPng = await sharp(Buffer.from(p.icpMask), {
    raw: { width: p.dims.TW, height: p.dims.TH, channels: 1 },
  }).png().toBuffer();

  const pyProgress = (step: string) => p.logStep(`Python: ${step}`);
  const matchResult = await cvMatch(labelsPng, icpPng, {
    tw: p.dims.TW, th: p.dims.TH, origW: p.origW, origH: p.origH,
    divisionPaths: p.divPaths,
    centroids: p.centroids.map(c => ({ id: c.id, cx: c.cx, cy: c.cy })),
    colorCentroids: p.colorCentroids,
    countryPath: p.countryPath,
    countryBbox: { minX: p.cMinX, minY: p.cMinY, maxX: p.cMaxX, maxY: p.cMaxY },
  }, pyProgress);

  for (const di of matchResult.debugImages) await p.pushDebugImage(di.label, di.dataUrl);

  // Build gadmToPixel from returned affine transform matrix
  const m = matchResult.transform.matrix;
  const cosLat = matchResult.transform.cosLat;
  const gadmToPixel = (gx: number, gy: number): [number, number] => {
    const cx = gx * cosLat;
    return [
      cx * m[0][0] + gy * m[0][1] + m[0][2],
      cx * m[1][0] + gy * m[1][1] + m[1][2],
    ];
  };

  // Convert Python assignments to JS types expected by Phase 5
  const divAssignments: DivAssignment[] = new Array(p.centroids.length);
  const finalAssignments: FinalDivAssignment[] = [];
  const unsplittableDivs: MatchingResult['unsplittableDivs'] = [];

  for (const a of matchResult.divAssignments) {
    const { asDiv, unsplittable, final } = classifyPythonAssignment(a);
    const ci = p.centroids.findIndex(c => c.id === a.divisionId);
    if (ci >= 0) divAssignments[ci] = asDiv;
    if (unsplittable) unsplittableDivs.push(unsplittable);
    if (final) finalAssignments.push(final);
  }

  const cvOutOfBounds = matchResult.outOfBounds.map(id => ({
    id,
    name: p.divNameMap.get(id) ?? `Division ${id}`,
  }));

  const alignmentSummary = `Python-${matchResult.alignmentMethod} (err=${matchResult.alignmentError.toFixed(2)}, inliers=${matchResult.inlierRatio})`;
  console.log(`  [Python Match] ${matchResult.alignmentMethod}: error=${matchResult.alignmentError}px, inliers=${matchResult.inlierRatio}`);
  console.log(`  [Python Match] ${finalAssignments.length} resolved, ${unsplittableDivs.length} unsplittable, ${cvOutOfBounds.length} OOB`);

  return {
    gadmToPixel,
    divAssignments,
    finalAssignments,
    unsplittableDivs,
    cvOutOfBounds,
    splitDepth: 0,
    alignmentSummary,
  };
}

// =============================================================================
// JS ICP adjustment (fallback strategies B and C)
// =============================================================================

/** Parse division paths + compute per-division bboxes using per-ring area */
function buildDivisionBboxes(divPaths: Array<{ id: number; svgPath: string }>): {
  divParsed: Array<{ id: number; points: Array<[number, number]> }>;
  divBboxes: DivisionBbox[];
} {
  const divParsed = divPaths.map(d => ({
    id: d.id,
    points: parseSvgPathPoints(d.svgPath),
  }));
  const divBboxes: DivisionBbox[] = divPaths.map(d => {
    const points = divParsed.find(p => p.id === d.id)!.points;
    let dMinX = Infinity, dMaxX = -Infinity, dMinY = Infinity, dMaxY = -Infinity;
    for (const [x, y] of points) {
      if (x < dMinX) dMinX = x;
      if (x > dMaxX) dMaxX = x;
      if (y < dMinY) dMinY = y;
      if (y > dMaxY) dMaxY = y;
    }
    return { id: d.id, minX: dMinX, maxX: dMaxX, minY: dMinY, maxY: dMaxY, area: computeSvgPathArea(d.svgPath) };
  });
  return { divParsed, divBboxes };
}

type IcpAlignParams = Parameters<typeof alignDivisionsToImage>[0];

interface AlignmentCandidate {
  label: string;
  overflow: number;
  error: number;
  result: AlignmentResult | null;
}

/** Rank candidates by (overflow within cap first, then composite err*3 + overflow) */
function rankAlignmentCandidates(candidates: AlignmentCandidate[], overflowCap: number): void {
  for (const c of candidates) {
    console.log(`  [ICP Adjust] Candidate ${c.label}: overflow=${c.overflow.toFixed(1)}, err=${c.error.toFixed(1)}`);
  }
  candidates.sort((a, b) => {
    const aOk = a.overflow <= overflowCap;
    const bOk = b.overflow <= overflowCap;
    if (aOk !== bOk) return aOk ? -1 : 1;
    return (a.error * 3 + a.overflow) - (b.error * 3 + b.overflow);
  });
}

type SimpleBbox = { minX: number; maxX: number; minY: number; maxY: number };

/** Build Strategy B candidate: exclude bbox outliers, re-align on remaining */
async function tryStrategyB(
  divBboxes: DivisionBbox[],
  icpParams: IcpAlignParams,
  cBbox: SimpleBbox,
): Promise<AlignmentCandidate | null> {
  const excludedB = findBboxOutliers(divBboxes, cBbox);
  const remainingB = divBboxes.filter(d => !excludedB.includes(d.id));
  if (excludedB.length === 0 || remainingB.length === 0) return null;
  const bboxB = computeBboxFromDivisions(remainingB);
  console.log(`  [ICP Adjust B] Excluded ${excludedB.length} divisions: [${excludedB}]`);
  const resultB = await alignDivisionsToImage({ ...icpParams, gBboxOverride: bboxB, scaleRange: 0.25 });
  return { label: 'strategyB', overflow: resultB.bestOverflow, error: resultB.bestError, result: resultB };
}

/** Build Strategy C candidate: exclude overlap outliers, re-align on remaining */
async function tryStrategyC(
  divBboxes: DivisionBbox[],
  divParsed: Array<{ id: number; points: Array<[number, number]> }>,
  icpParams: IcpAlignParams,
  gadmToPixel: (gx: number, gy: number) => [number, number],
  icpMask: Uint8Array,
  dims: GridDims,
): Promise<AlignmentCandidate | null> {
  const excludedC = findOverlapOutliers(divParsed, gadmToPixel, icpMask, dims.TW, dims.TH);
  const remainingC = divBboxes.filter(d => !excludedC.includes(d.id));
  if (excludedC.length === 0 || remainingC.length === 0) return null;
  // Safeguard: if the distorted initial transform causes most centroids to
  // project outside the CV mask, Strategy C over-excludes mainland divisions.
  // Discard when >60% are excluded — the transform is too bad for overlap testing.
  if (excludedC.length > divBboxes.length * 0.6) {
    console.log(`  [ICP Adjust C] Skipped — excluded ${excludedC.length}/${divBboxes.length} divisions (>60%), transform too distorted for overlap test`);
    return null;
  }
  const bboxC = computeBboxFromDivisions(remainingC);
  console.log(`  [ICP Adjust C] Excluded ${excludedC.length} divisions: [${excludedC}]`);
  const resultC = await alignDivisionsToImage({ ...icpParams, gBboxOverride: bboxC, scaleRange: 0.25 });
  return { label: 'strategyC', overflow: resultC.bestOverflow, error: resultC.bestError, result: resultC };
}

interface IcpAdjustmentAttemptParams {
  divPaths: Array<{ id: number; svgPath: string }>;
  icpParams: IcpAlignParams;
  cBbox: SimpleBbox;
  bestOverflow: number;
  bestError: number;
  gadmToPixel: (gx: number, gy: number) => [number, number];
  icpMask: Uint8Array;
  dims: GridDims;
}

/** Run both ICP adjustment strategies (B and C) and return the winning transform, if any. */
async function runIcpAdjustment(p: IcpAdjustmentAttemptParams): Promise<((gx: number, gy: number) => [number, number]) | null> {
  const { divParsed, divBboxes } = buildDivisionBboxes(p.divPaths);
  const candidates: AlignmentCandidate[] = [
    { label: 'original', overflow: p.bestOverflow, error: p.bestError, result: null },
  ];

  const b = await tryStrategyB(divBboxes, p.icpParams, p.cBbox);
  if (b) candidates.push(b);

  const c = await tryStrategyC(divBboxes, divParsed, p.icpParams, p.gadmToPixel, p.icpMask, p.dims);
  if (c) candidates.push(c);

  const overflowCap = Math.max(p.dims.TW, p.dims.TH) * 0.10;
  rankAlignmentCandidates(candidates, overflowCap);

  const winner = candidates[0];
  if (winner.result) {
    console.log(`  [ICP Adjust] Winner: ${winner.label} (ICP ${winner.result.bestLabel}, err=${winner.result.bestError.toFixed(1)}, overflow=${winner.result.bestOverflow.toFixed(0)}px)`);
    return winner.result.gadmToPixel;
  }
  console.log(`  [ICP Adjust] Original alignment was best — keeping it`);
  return null;
}

interface RunJsMatchingParams {
  divPaths: Array<{ id: number; svgPath: string }>;
  countryPath: string;
  cMinX: number;
  cMinY: number;
  cMaxX: number;
  cMaxY: number;
  icpMask: Uint8Array;
  pixelLabels: Uint8Array;
  dims: GridDims;
  origW: number;
  origH: number;
  quantBuf: Buffer;
  centroids: CentroidInfo[];
  mapBuffer: Buffer;
  pxS: (base: number) => number;
  pushDebugImage: (label: string, dataUrl: string) => Promise<void>;
  logStep: (msg: string) => Promise<void>;
  sendEvent: (event: Record<string, unknown>) => void;
  divNameMap: Map<number, string>;
  buf: Buffer;
  colorCentroids: Array<[number, number, number] | null>;
  countrySize: number;
}

/** Wait for an ICP-adjustment decision from the UI, with a 5-minute auto-continue timeout */
async function awaitIcpAdjustmentDecision(
  reviewId: string,
  sendEvent: (event: Record<string, unknown>) => void,
  bestOverflow: number,
  bestError: number,
  bestLabel: string,
): Promise<IcpAdjustmentDecision> {
  sendEvent({
    type: 'icp_adjustment_available',
    reviewId,
    message: 'Alignment quality is lower than expected, possibly due to small islands or features not shown on the map.',
    metrics: { overflow: Math.round(bestOverflow), error: Math.round(bestError * 10) / 10, icpOption: bestLabel },
  });
  await new Promise(resolve => setImmediate(resolve));

  return new Promise<IcpAdjustmentDecision>((resolve) => {
    registerIcpAdjustment(reviewId, resolve);
    setTimeout(() => {
      if (hasIcpAdjustment(reviewId)) {
        console.log(`  [ICP Adjustment] Review ${reviewId} timed out — continuing with original`);
        cancelIcpAdjustment(reviewId);
        resolve({ action: 'continue' });
      }
    }, 300000);
  });
}

interface RunMatchingParams {
  divPaths: Array<{ id: number; svgPath: string }>;
  centroids: CentroidInfo[];
  colorCentroids: Array<[number, number, number] | null>;
  divNameMap: Map<number, string>;
  countryPath: string;
  cMinX: number;
  cMinY: number;
  cMaxX: number;
  cMaxY: number;
  pixelLabels: Uint8Array;
  icpMask: Uint8Array;
  dims: GridDims;
  origW: number;
  origH: number;
  quantBuf: Buffer;
  mapBuffer: Buffer;
  buf: Buffer;
  countrySize: number;
  pxS: (base: number) => number;
  logStep: (msg: string) => Promise<void>;
  pushDebugImage: (label: string, dataUrl: string) => Promise<void>;
  sendEvent: (event: Record<string, unknown>) => void;
}

/**
 * Run the chosen matching pipeline (Python if available/configured, otherwise JS).
 * Reads the `cv_pipeline_implementation` setting to pick the preferred path.
 */
async function runMatching(p: RunMatchingParams): Promise<MatchingResult> {
  const { getSetting } = await import('../../services/ai/aiSettingsService.js');
  const matchImpl = await getSetting('cv_pipeline_implementation') ?? 'javascript';

  if (matchImpl === 'python') {
    const pythonResult = await runPythonMatching({
      divPaths: p.divPaths, centroids: p.centroids, colorCentroids: p.colorCentroids, divNameMap: p.divNameMap,
      countryPath: p.countryPath, cMinX: p.cMinX, cMinY: p.cMinY, cMaxX: p.cMaxX, cMaxY: p.cMaxY,
      pixelLabels: p.pixelLabels, icpMask: p.icpMask, dims: p.dims, origW: p.origW, origH: p.origH,
      logStep: p.logStep, pushDebugImage: p.pushDebugImage,
    });
    if (pythonResult) return pythonResult;
  }

  return runJsMatching({
    divPaths: p.divPaths, countryPath: p.countryPath,
    cMinX: p.cMinX, cMinY: p.cMinY, cMaxX: p.cMaxX, cMaxY: p.cMaxY,
    icpMask: p.icpMask, pixelLabels: p.pixelLabels, dims: p.dims, origW: p.origW, origH: p.origH,
    quantBuf: p.quantBuf, centroids: p.centroids, mapBuffer: p.mapBuffer,
    pxS: p.pxS, pushDebugImage: p.pushDebugImage, logStep: p.logStep, sendEvent: p.sendEvent,
    divNameMap: p.divNameMap, buf: p.buf, colorCentroids: p.colorCentroids, countrySize: p.countrySize,
  });
}

/** JS path: ICP alignment → optional adjustment → division assignment */
async function runJsMatching(p: RunJsMatchingParams): Promise<MatchingResult> {
  await p.logStep('ICP alignment (matching GADM boundary to CV silhouette)...');

  const icpParams = {
    divPaths: p.divPaths, countryPath: p.countryPath,
    cMinX: p.cMinX, cMinY: p.cMinY, cMaxX: p.cMaxX, cMaxY: p.cMaxY,
    icpMask: p.icpMask, pixelLabels: p.pixelLabels,
    TW: p.dims.TW, TH: p.dims.TH, origW: p.origW, origH: p.origH,
    quantBuf: p.quantBuf, centroids: p.centroids, mapBuffer: p.mapBuffer,
    pxS: p.pxS, pushDebugImage: p.pushDebugImage,
  };
  const icpResult = await alignDivisionsToImage(icpParams);

  let gadmToPixel = icpResult.gadmToPixel;
  const { bestLabel, bestError, bestOverflow, gBbox, cBbox } = icpResult;
  const alignmentSummary = `${bestLabel} (err=${bestError.toFixed(2)}, overflow=${bestOverflow.toFixed(1)})`;

  // Check for bbox inflation (islands problem)
  const inflationDetected = detectBboxInflation(gBbox, cBbox, bestOverflow, bestError, p.dims.TW, p.dims.TH);
  if (inflationDetected) {
    console.log(`  [ICP] Bbox inflation detected — aspect ratio mismatch + high overflow (err=${bestError.toFixed(1)}, overflow=${bestOverflow.toFixed(0)}px)`);
    const reviewId = `icp-adj-${Date.now()}`;
    const decision = await awaitIcpAdjustmentDecision(reviewId, p.sendEvent, bestOverflow, bestError, bestLabel);

    if (decision.action === 'adjust') {
      await p.logStep('Adjusting ICP alignment (excluding outlier divisions)...');
      const adjusted = await runIcpAdjustment({
        divPaths: p.divPaths,
        icpParams,
        cBbox,
        bestOverflow,
        bestError,
        gadmToPixel,
        icpMask: p.icpMask,
        dims: p.dims,
      });
      if (adjusted) gadmToPixel = adjusted;
    } else {
      console.log(`  [ICP Adjustment] User chose to continue with original alignment`);
    }
  }

  await p.logStep('Assigning GADM divisions to color regions...');
  const assignmentResult = await assignDivisionsToClusters({
    divPaths: p.divPaths,
    centroids: p.centroids,
    divNameMap: p.divNameMap,
    gadmToPixel,
    pixelLabels: p.pixelLabels,
    buf: p.buf,
    colorCentroids: p.colorCentroids,
    countrySize: p.countrySize,
    TW: p.dims.TW, TH: p.dims.TH, origW: p.origW, origH: p.origH,
    pxS: p.pxS, logStep: p.logStep, pushDebugImage: p.pushDebugImage,
  });

  return {
    gadmToPixel,
    divAssignments: assignmentResult.divAssignments,
    finalAssignments: assignmentResult.finalAssignments,
    unsplittableDivs: assignmentResult.unsplittableDivs,
    cvOutOfBounds: assignmentResult.outOfBounds,
    splitDepth: assignmentResult.splitDepth,
    alignmentSummary,
  };
}

// =============================================================================
// Main pipeline
// =============================================================================

/**
 * Run the spatial-split → merge → cluster-review → ICP → rasterization →
 * division-voting → recursive-split → OCR → geo-preview pipeline.
 *
 * Sends `complete` event via `sendEvent` at the end.
 * Returns a ReclusterSignal if the user requests re-clustering during review.
 */
export async function matchDivisionsFromClusters(params: MatchDivisionsParams): Promise<ReclusterSignal | void> {
  const {
    worldViewId, regionId, knownDivisionIds, countryIds, countryDepth,
    buf, origBuf, mapBuffer, countryMask,
    pixelLabels, colorCentroids,
    TW, TH, origW, origH,
    skipClusterReview,
    sendEvent, logStep, pushDebugImage, debugImages,
    startTime,
  } = params;

  const tp = TW * TH;
  const dims: GridDims = { TW, TH, tp };

  /** Scale pixel constant (calibrated at 500px base resolution) */
  const pxS = (base: number) => Math.round(base * TW / 500);

  // Compute countrySize from mask
  let countrySize = 0;
  for (let i = 0; i < tp; i++) {
    if (countryMask[i]) countrySize++;
  }

  // ── Load division data from DB ──
  const allDivisionIds = await resolveAllDivisionIds(countryIds, countryDepth, knownDivisionIds);
  if (allDivisionIds.length === 0) {
    sendEvent({ type: 'error', message: 'No divisions found at this level' });
    return;
  }

  const assignedMap = await loadAssignedChildRegions(regionId, worldViewId);
  const divNameMap = new Map<number, string>();
  const centroids = await loadCentroids(allDivisionIds, assignedMap, divNameMap);

  const borderInfo = await loadDivPathsAndBorders(allDivisionIds);
  if (!borderInfo) {
    sendEvent({ type: 'error', message: 'Could not compute borders' });
    return;
  }
  const { divPaths, countryPath, cMinX, cMinY, cMaxX, cMaxY, externalBorder, internalBorder } = borderInfo;

  const { regionName, countryName } = await loadRegionAndCountryNames(regionId, worldViewId, countryIds);

  // ── Phase 1: Cluster cleaning (spatial split, merge, patch cleanup, noise exclusion) ──
  const { finalLabels, quantBuf, icpMask, borderPaths } = await cleanClusters({
    pixelLabels, colorCentroids, buf, origBuf, countryMask, countrySize,
    TW, TH, origW, origH, pxS, pushDebugImage,
  });

  // ── Phase 2: Interactive cluster review (loops on split requests) ──
  if (!skipClusterReview) {
    const reclusterSignal = await runClusterReviewLoop({
      regionId, finalLabels, pixelLabels, colorCentroids, countrySize, borderPaths,
      dims, origW, origH, pxS,
      sendEvent, logStep,
    });
    if (reclusterSignal) return reclusterSignal;
  }

  // Recount clusters after review modifications
  const postReviewClusters = new Map<number, number>();
  for (let i = 0; i < tp; i++) {
    if (pixelLabels[i] < 255) postReviewClusters.set(pixelLabels[i], (postReviewClusters.get(pixelLabels[i]) || 0) + 1);
  }

  // Rebuild ICP mask after review exclusions — excluded clusters must not affect
  // border detection or bbox computation (e.g. title text marked for removal)
  for (let i = 0; i < tp; i++) {
    if (icpMask[i] && pixelLabels[i] === 255) icpMask[i] = 0;
  }

  // ── Auto-dump matching state for offline replay ──
  dumpMatchingState({
    regionName, worldViewId, regionId, countryName,
    countryIds, allDivisionIds,
    dims, origW, origH, countrySize,
    colorCentroids, centroids, divPaths, countryPath,
    cMinX, cMinY, cMaxX, cMaxY,
    divNameMap, assignedMap,
    externalBorder, internalBorder,
    pixelLabels, countryMask, icpMask, mapBuffer,
  });

  // ── Phase 3+4: Alignment + Assignment (Python or JS path) ──
  const matchResult = await runMatching({
    divPaths, centroids, colorCentroids, divNameMap,
    countryPath, cMinX, cMinY, cMaxX, cMaxY,
    pixelLabels, icpMask, dims, origW, origH, quantBuf, mapBuffer, buf,
    countrySize, pxS, logStep, pushDebugImage, sendEvent,
  });

  // ── Phase 5: Match clusters to child regions + build results ──
  const { cvClusterResult, cvChildRegions, geoPreview } = await buildPhase5Results({
    regionId, worldViewId, knownDivisionIds, assignedMap, divNameMap,
    centroids, colorCentroids, postReviewClusters, matchResult, pixelLabels, dims,
  });

  console.log(`  Source map: ${origW}x${origH} → ${TW}x${TH}, regions: ${postReviewClusters.size}, alignment: ${matchResult.alignmentSummary}`);

  const assignedCount = centroids.filter(c => c.assigned).length;
  const gapCount = centroids.length - assignedCount;
  console.log(`CV color match: ${regionName} (${countryName}), ${centroids.length} divisions (${assignedCount} already assigned, ${gapCount} gaps)`);

  // ── Spatial anomaly detection on suggested assignments (non-fatal) ──
  const { spatialAnomalies, adjacencyEdges } = await runSpatialAnomalyDetection({
    regionId, worldViewId, cvChildRegions, cvClusterResult,
  });

  sendEvent(buildCompletePayload({
    cvClusterResult, cvChildRegions,
    cvOutOfBounds: matchResult.cvOutOfBounds,
    debugImages, geoPreview, spatialAnomalies, adjacencyEdges,
    centroids, assignedCount, countryName, startTime,
  }));
}
