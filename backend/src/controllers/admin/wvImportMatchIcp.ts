/**
 * ICP alignment phase for division matching.
 *
 * Tries 3 alignment approaches (Centroid ICP, BBox ICP, BBox-only) to align
 * GADM country boundaries to the CV silhouette extracted from the source map.
 * Picks the best alignment by overflow + mean error and returns the
 * gadmToPixel transform function.
 */

import sharp from 'sharp';
import { parseSvgPathPoints, parseSvgSubPaths, resamplePath } from './wvImportMatchSvgHelpers.js';

// =============================================================================
// Types
// =============================================================================

export interface AlignmentParams {
  /** Division SVG paths from PostGIS */
  divPaths: Array<{ id: number; svgPath: string }>;
  /** Country outline SVG path */
  countryPath: string;
  /** GADM bounding box */
  cMinX: number; cMinY: number; cMaxX: number; cMaxY: number;
  /** ICP mask (active cluster pixels, noise-cleaned) */
  icpMask: Uint8Array;
  /** Pixel labels from clustering */
  pixelLabels: Uint8Array;
  /** Image dimensions */
  TW: number; TH: number;
  /** Original image dimensions (for upscaling debug images) */
  origW: number; origH: number;
  /** Quantized color buffer */
  quantBuf: Buffer;
  /** Centroids data for overlay */
  centroids: Array<{ id: number; cx: number; cy: number; assigned: { regionId: number; regionName: string } | null }>;
  /** Calibrated pixel scale function */
  pxS: (base: number) => number;
  /** Logging callbacks */
  pushDebugImage: (label: string, dataUrl: string) => Promise<void>;
  /** Override GADM bbox (for adjusted alignment after excluding islands) */
  gBboxOverride?: { minX: number; maxX: number; minY: number; maxY: number };
  /** Scale constraint range — 0.10 means ±10% (default), 0.25 means ±25% */
  scaleRange?: number;
}

export interface AlignmentResult {
  /** Transform GADM coordinates to pixel space */
  gadmToPixel: (gx: number, gy: number) => [number, number];
  /** Which ICP option was selected (A, B, or C) */
  bestLabel: string;
  /** Mean alignment error */
  bestError: number;
  /** Max bbox overflow */
  bestOverflow: number;
  /** GADM bbox used for alignment (original or overridden) */
  gBbox: { minX: number; maxX: number; minY: number; maxY: number };
  /** CV bbox computed from border pixels */
  cBbox: { minX: number; maxX: number; minY: number; maxY: number };
}

// =============================================================================
// Geometry helpers for ICP adjustment
// =============================================================================

export interface DivisionBbox {
  id: number;
  minX: number; maxX: number;
  minY: number; maxY: number;
  area: number;
}

/** Compute polygon area using the shoelace formula. Returns absolute area. */
export function computeShoelaceArea(points: Array<[number, number]>): number {
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const j = (i + 1) % points.length;
    area += points[i][0] * points[j][1];
    area -= points[j][0] * points[i][1];
  }
  return Math.abs(area) / 2;
}

/**
 * Compute polygon area from an SVG path, handling multipolygons correctly.
 * Unlike computeShoelaceArea on concatenated points, this sums per-ring areas
 * so archipelago divisions (Azores, Madeira, etc.) get correct land area
 * instead of inflated phantom-polygon area crossing oceans between islands.
 */
export function computeSvgPathArea(svgPath: string): number {
  const subPaths = parseSvgSubPaths(svgPath);
  let totalArea = 0;
  for (const pts of subPaths) {
    totalArea += computeShoelaceArea(pts);
  }
  return totalArea;
}

/** Compute the tight bounding box enclosing all divisions. */
export function computeBboxFromDivisions(
  divs: DivisionBbox[],
): { minX: number; maxX: number; minY: number; maxY: number } {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const d of divs) {
    if (d.minX < minX) minX = d.minX;
    if (d.maxX > maxX) maxX = d.maxX;
    if (d.minY < minY) minY = d.minY;
    if (d.maxY > maxY) maxY = d.maxY;
  }
  return { minX, maxX, minY, maxY };
}

/**
 * Detect if ICP alignment likely failed due to bbox inflation (distant islands)
 * or other shape mismatch between GADM and CV bounding boxes.
 *
 * Six detection paths (any one triggers):
 * 1. Aspect ratio mismatch > 1.2 AND overflow > 10%
 * 2. Overflow alone > 15%
 * 3. Scale asymmetry > 1.25 AND overflow > 8%
 * 4. Scale asymmetry > 1.2 AND mean error > 2% of image — catches distorted fits
 * 5. Mean error alone > 3% of image — very poor alignment regardless of cause
 * 6. Scale asymmetry alone > 1.35 — GADM bbox aspect ratio doesn't match CV
 */
export function detectBboxInflation(
  gBbox: { minX: number; maxX: number; minY: number; maxY: number },
  cBbox: { minX: number; maxX: number; minY: number; maxY: number },
  bestOverflow: number,
  bestError: number,
  TW: number, TH: number,
): boolean {
  const gadmW = gBbox.maxX - gBbox.minX;
  const gadmH = gBbox.maxY - gBbox.minY;
  const cvW = cBbox.maxX - cBbox.minX;
  const cvH = cBbox.maxY - cBbox.minY;
  if (gadmW <= 0 || gadmH <= 0 || cvW <= 0 || cvH <= 0) return false;

  const gadmRatio = gadmW / gadmH;
  const cvRatio = cvW / cvH;
  const ratioMismatch = Math.max(gadmRatio, cvRatio) / Math.min(gadmRatio, cvRatio);
  const overflowPct = bestOverflow / Math.max(TW, TH);
  const meanErrorPct = bestError / Math.max(TW, TH);

  // Scale asymmetry: if initSx/initSy differs significantly from 1.0,
  // the GADM bbox shape doesn't match the CV bbox shape
  const scaleRatioX = cvW / gadmW;
  const scaleRatioY = cvH / gadmH;
  const scaleAsymmetry = Math.max(scaleRatioX, scaleRatioY) / Math.min(scaleRatioX, scaleRatioY);

  console.log(`  [ICP Detection] ratioMismatch=${ratioMismatch.toFixed(3)}, overflowPct=${(overflowPct * 100).toFixed(1)}%, scaleAsymmetry=${scaleAsymmetry.toFixed(3)}, meanErrorPct=${(meanErrorPct * 100).toFixed(1)}%`);

  return (ratioMismatch > 1.2 && overflowPct > 0.10)
      || (overflowPct > 0.15)
      || (scaleAsymmetry > 1.25 && overflowPct > 0.08)
      || (scaleAsymmetry > 1.2 && meanErrorPct > 0.02)
      || (meanErrorPct > 0.03)
      // Path 6: High scale asymmetry alone — GADM bbox aspect ratio doesn't match
      // CV bbox, indicating distant features (islands) stretching one axis.
      // Even if overflow/error look moderate, the alignment is distorted.
      || (scaleAsymmetry > 1.35);
}

/** Find connected components of bboxes using union-find with spatial overlap margin. */
function findSpatialComponents(
  divBboxes: DivisionBbox[],
): Map<number, number[]> {
  const spans = divBboxes.map(d => Math.max(d.maxX - d.minX, d.maxY - d.minY));
  spans.sort((a, b) => a - b);
  const margin = spans[Math.floor(spans.length / 2)] * 0.2;

  const n = divBboxes.length;
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (x: number): number => {
    if (parent[x] !== x) parent[x] = find(parent[x]);
    return parent[x];
  };

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const a = divBboxes[i], b = divBboxes[j];
      if (a.maxX + margin >= b.minX && b.maxX + margin >= a.minX &&
          a.maxY + margin >= b.minY && b.maxY + margin >= a.minY) {
        parent[find(i)] = find(j);
      }
    }
  }

  const components = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const root = find(i);
    if (!components.has(root)) components.set(root, []);
    components.get(root)!.push(i);
  }
  return components;
}

/**
 * Strategy B: Find spatially disconnected island groups that inflate the GADM bbox.
 *
 * Uses connected-component analysis: divisions whose bboxes overlap (with margin)
 * form a spatial cluster. The largest cluster is the "mainland". All smaller
 * clusters whose total area < 10% of the overall area are excluded as outliers.
 * This correctly handles multi-division island groups (e.g., Madeira + Selvagens)
 * that the old per-division iterative approach couldn't remove.
 */
export function findBboxOutliers(
  divBboxes: DivisionBbox[],
  cBbox: { minX: number; maxX: number; minY: number; maxY: number },
): number[] {
  const cvW = cBbox.maxX - cBbox.minX;
  const cvH = cBbox.maxY - cBbox.minY;
  if (cvW <= 0 || cvH <= 0 || divBboxes.length < 2) return [];

  const cvRatio = cvW / cvH;
  const fullRatio = bboxRatio(computeBboxFromDivisions(divBboxes));
  if (fullRatio <= 0) return [];
  const ratioMatch = Math.max(fullRatio, cvRatio) / Math.min(fullRatio, cvRatio);
  if (ratioMatch <= 1.3) return [];

  const components = findSpatialComponents(divBboxes);
  if (components.size <= 1) return [];

  const excluded = collectOutlierIds(divBboxes, components);
  if (excluded.length === 0) return [];

  // Verify that excluding outliers actually improves the ratio match
  const newRatio = bboxRatio(computeBboxFromDivisions(divBboxes.filter(d => !excluded.includes(d.id))));
  if (newRatio <= 0) return [];
  const newMatch = Math.max(newRatio, cvRatio) / Math.min(newRatio, cvRatio);

  const mainlandSize = Math.max(...[...components.values()].map(v => v.length));
  console.log(`  [ICP Adjust B] ${components.size} spatial clusters found, mainland=${mainlandSize} divs, ${excluded.length} outlier divs in ${components.size - 1} island group(s)`);
  console.log(`  [ICP Adjust B] ratio: ${fullRatio.toFixed(3)} → ${newRatio.toFixed(3)} (cvRatio=${cvRatio.toFixed(3)}, match: ${ratioMatch.toFixed(2)} → ${newMatch.toFixed(2)})`);

  if (newMatch >= ratioMatch) {
    console.log(`  [ICP Adjust B] Excluding outliers didn't improve ratio — skipping`);
    return [];
  }

  return excluded;
}

/** Width/height ratio of a bbox, or 0 for degenerate bboxes. */
function bboxRatio(bbox: { minX: number; maxX: number; minY: number; maxY: number }): number {
  const w = bbox.maxX - bbox.minX, h = bbox.maxY - bbox.minY;
  return w > 0 && h > 0 ? w / h : 0;
}

/** Collect division IDs from non-mainland spatial components with small area. */
function collectOutlierIds(
  divBboxes: DivisionBbox[],
  components: Map<number, number[]>,
): number[] {
  const totalArea = divBboxes.reduce((sum, d) => sum + d.area, 0);

  // Largest component by count is the mainland
  let mainlandRoot = -1;
  let mainlandSize = 0;
  for (const [root, indices] of components) {
    if (indices.length > mainlandSize) {
      mainlandSize = indices.length;
      mainlandRoot = root;
    }
  }

  const excluded: number[] = [];
  for (const [root, indices] of components) {
    if (root === mainlandRoot) continue;
    const groupArea = indices.reduce((sum, i) => sum + divBboxes[i].area, 0);
    if (groupArea <= totalArea * 0.1) {
      for (const i of indices) excluded.push(divBboxes[i].id);
    }
  }
  return excluded;
}

/**
 * Strategy C: Find divisions whose centroid doesn't land on the CV mask
 * when projected using the (possibly bad) initial gadmToPixel transform.
 * Accepts pre-parsed points to keep SVG parsing in the caller.
 */
export function findOverlapOutliers(
  divPaths: Array<{ id: number; points: Array<[number, number]> }>,
  gadmToPixel: (gx: number, gy: number) => [number, number],
  icpMask: Uint8Array,
  TW: number, TH: number,
): number[] {
  const excluded: number[] = [];
  for (const d of divPaths) {
    if (d.points.length === 0) continue;
    let cx = 0, cy = 0;
    for (const [x, y] of d.points) { cx += x; cy += y; }
    cx /= d.points.length;
    cy /= d.points.length;
    const [px, py] = gadmToPixel(cx, cy);
    const ix = Math.round(px), iy = Math.round(py);
    if (ix < 0 || ix >= TW || iy < 0 || iy >= TH || !icpMask[iy * TW + ix]) {
      excluded.push(d.id);
    }
  }
  return excluded;
}

// =============================================================================
// Internal helpers
// =============================================================================

/** Find nearest CV border pixel using spatial grid */
function buildNearestCvBorderFn(
  cvBorderPixels: Array<[number, number]>,
  TW: number, TH: number,
  CELL: number,
): (px: number, py: number) => { pt: [number, number]; dist: number } | null {
  const gridW = Math.ceil(TW / CELL), gridH = Math.ceil(TH / CELL);
  const cvGrid: Array<Array<[number, number]>> = Array.from({ length: gridW * gridH }, () => []);
  for (const [x, y] of cvBorderPixels) {
    cvGrid[Math.floor(y / CELL) * gridW + Math.floor(x / CELL)].push([x, y]);
  }

  return function nearestCvBorder(px: number, py: number) {
    const gx = Math.floor(px / CELL), gy = Math.floor(py / CELL);
    let bestDist = Infinity;
    let bestPt: [number, number] | null = null;
    for (let dy = -6; dy <= 6; dy++) {
      for (let dx = -6; dx <= 6; dx++) {
        const nx = gx + dx, ny = gy + dy;
        if (nx < 0 || nx >= gridW || ny < 0 || ny >= gridH) continue;
        for (const [cx, cy] of cvGrid[ny * gridW + nx]) {
          const d = (px - cx) ** 2 + (py - cy) ** 2;
          if (d < bestDist) { bestDist = d; bestPt = [cx, cy]; }
        }
      }
    }
    return bestPt ? { pt: bestPt, dist: Math.sqrt(bestDist) } : null;
  };
}

/** Compute the min/max extents of a set of points. */
function computeExtents(
  points: Iterable<[number, number]>,
  initTop: number,
  initLeft: number,
): { top: number; bot: number; left: number; right: number } {
  let top = initTop, bot = 0, left = initLeft, right = 0;
  for (const [x, y] of points) {
    if (y < top) top = y;
    if (y > bot) bot = y;
    if (x < left) left = x;
    if (x > right) right = x;
  }
  return { top, bot, left, right };
}

function computeMaxOverflow(
  gadmBoundary: Array<[number, number]>,
  cvBorderPixels: Array<[number, number]>,
  TW: number, TH: number,
  sx: number, sy: number, tx: number, ty: number,
): number {
  const transformed = gadmBoundary.map(([gx, gy]): [number, number] =>
    [gx * sx + tx, gy * sy + ty],
  );
  const g = computeExtents(transformed, TH, TW);
  const c = computeExtents(cvBorderPixels, TH, TW);
  return Math.max(
    Math.abs(c.top - g.top),
    Math.abs(g.bot - c.bot),
    Math.abs(c.left - g.left),
    Math.abs(g.right - c.right),
  );
}

function computeMeanError(
  gadmBoundary: Array<[number, number]>,
  nearestCvBorder: (px: number, py: number) => { pt: [number, number]; dist: number } | null,
  sx: number, sy: number, tx: number, ty: number,
): number {
  let total = 0, cnt = 0;
  for (const [gx, gy] of gadmBoundary) {
    const n = nearestCvBorder(gx * sx + tx, gy * sy + ty);
    if (n) { total += n.dist; cnt++; }
  }
  return cnt > 0 ? total / cnt : Infinity;
}

// =============================================================================
// Border extraction helpers
// =============================================================================

/** True if pixel at (x,y,p) is on the external border (image-edge or has an off-mask neighbor). */
function isExternalBorderPixel(
  icpMask: Uint8Array,
  x: number, y: number, p: number,
  TW: number, TH: number,
): boolean {
  if (x === 0 || x === TW - 1 || y === 0 || y === TH - 1) return true;
  for (const n of [p - TW, p + TW, p - 1, p + 1]) {
    if (!icpMask[n]) return true;
  }
  return false;
}

/** Extract external border pixels of the ICP mask (image-edge pixels always included). */
function extractExternalBorder(
  icpMask: Uint8Array,
  TW: number, TH: number,
): Array<[number, number]> {
  const result: Array<[number, number]> = [];
  for (let y = 0; y < TH; y++) {
    for (let x = 0; x < TW; x++) {
      const p = y * TW + x;
      if (!icpMask[p]) continue;
      if (isExternalBorderPixel(icpMask, x, y, p, TW, TH)) {
        result.push([x, y]);
      }
    }
  }
  return result;
}

/** Extract internal border pixels where differently-labeled clusters meet. */
function extractInternalBorder(
  pixelLabels: Uint8Array,
  TW: number, TH: number,
): Array<[number, number]> {
  const result: Array<[number, number]> = [];
  for (let y = 1; y < TH - 1; y++) {
    for (let x = 1; x < TW - 1; x++) {
      const p = y * TW + x;
      if (pixelLabels[p] === 255) continue;
      for (const n of [p - TW, p + TW, p - 1, p + 1]) {
        if (pixelLabels[n] !== 255 && pixelLabels[n] !== pixelLabels[p]) {
          result.push([x, y]);
          break;
        }
      }
    }
  }
  return result;
}

// =============================================================================
// bbox / initial-transform helpers
// =============================================================================

interface Bbox { minX: number; maxX: number; minY: number; maxY: number }

/** Compute GADM bbox in corrected space — prefers centroid-based bbox if enough centroids. */
function computeGadmBbox(
  centroids: Array<{ cx: number; cy: number }>,
  polyBbox: Bbox,
  applyCorrX: (x: number) => number,
): Bbox {
  if (centroids.length < 5) return polyBbox;
  let cxMin = Infinity, cxMax = -Infinity, cyMin = Infinity, cyMax = -Infinity;
  for (const c of centroids) {
    const corrX = applyCorrX(c.cx);
    const corrY = -c.cy; // SVG Y-negation
    if (corrX < cxMin) cxMin = corrX;
    if (corrX > cxMax) cxMax = corrX;
    if (corrY < cyMin) cyMin = corrY;
    if (corrY > cyMax) cyMax = corrY;
  }
  const marginX = (cxMax - cxMin) * 0.05;
  const marginY = (cyMax - cyMin) * 0.05;
  console.log(`  [ICP] Using centroid-based bbox (${centroids.length} centroids, 5% per-side margin)`);
  return {
    minX: cxMin - marginX, maxX: cxMax + marginX,
    minY: cyMin - marginY, maxY: cyMax + marginY,
  };
}

/** Tight bbox of CV border pixels. */
function computeCvBbox(
  cvBorderPixels: Array<[number, number]>,
  TW: number, TH: number,
): Bbox {
  let minX = TW, maxX = 0, minY = TH, maxY = 0;
  for (const [x, y] of cvBorderPixels) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return { minX, maxX, minY, maxY };
}

// =============================================================================
// ICP iteration helpers
// =============================================================================

interface Transform { sx: number; sy: number; tx: number; ty: number }

type NearestFn = (px: number, py: number) => { pt: [number, number]; dist: number } | null;

/**
 * Single pass of translation-only ICP refinement.
 * Mutates tx/ty via centroid shift of matched point pairs (dist<15).
 * Returns the updated translation; bails out (returns nulls) if too few matches.
 */
function translationIcpStep(
  gadmBoundary: Array<[number, number]>,
  nearestCvBorder: NearestFn,
  sx: number, sy: number, tx: number, ty: number,
): { tx: number; ty: number } | null {
  let sumDx = 0, sumDy = 0, count = 0;
  for (const [gx, gy] of gadmBoundary) {
    const px = gx * sx + tx, py = gy * sy + ty;
    const n = nearestCvBorder(px, py);
    if (n && n.dist < 15) { sumDx += n.pt[0] - px; sumDy += n.pt[1] - py; count++; }
  }
  if (count < 10) return null;
  return { tx: tx + sumDx / count, ty: ty + sumDy / count };
}

/** Run N iterations of translation-only ICP, stopping early on low match count. */
function runTranslationIcp(
  gadmBoundary: Array<[number, number]>,
  nearestCvBorder: NearestFn,
  init: Transform,
  iterations: number,
): Transform {
  const { sx, sy } = init;
  let { tx, ty } = init;
  for (let iter = 0; iter < iterations; iter++) {
    const step = translationIcpStep(gadmBoundary, nearestCvBorder, sx, sy, tx, ty);
    if (!step) break;
    tx = step.tx;
    ty = step.ty;
  }
  return { sx, sy, tx, ty };
}

/** Option A: Translation-only ICP (20 iterations, fixed scale). */
function runOptionA(
  gadmBoundary: Array<[number, number]>,
  nearestCvBorder: NearestFn,
  init: Transform,
): Transform {
  return runTranslationIcp(gadmBoundary, nearestCvBorder, init, 20);
}

/** Option B: Translation + gentle scale correction ICP (3 phase-2 passes). */
function runOptionB(
  gadmBoundary: Array<[number, number]>,
  nearestCvBorder: NearestFn,
  init: Transform,
  effectiveSx: number,
  initSy: number,
  range: number,
): Transform {
  let t = runTranslationIcp(gadmBoundary, nearestCvBorder, init, 20);
  for (let phase2 = 0; phase2 < 3; phase2++) {
    const corrs = collectBoundaryCorrespondences(gadmBoundary, nearestCvBorder, t.sx, t.sy, t.tx, t.ty);
    if (corrs.length < 20) break;
    corrs.sort((a, b) => a.dist - b.dist);
    const trimmed = corrs.slice(0, Math.floor(corrs.length * 0.75));
    const fit = unweightedScaleTranslateFit(trimmed, effectiveSx, initSy, range);
    if (!fit) break;
    t = runTranslationIcp(gadmBoundary, nearestCvBorder, fit, 5);
  }
  return t;
}

interface BoundaryCorr { gx: number; gy: number; cx: number; cy: number; dist: number }

/** Collect GADM-boundary → CV-border correspondences within 15 pixels. */
function collectBoundaryCorrespondences(
  gadmBoundary: Array<[number, number]>,
  nearestCvBorder: NearestFn,
  sx: number, sy: number, tx: number, ty: number,
): BoundaryCorr[] {
  const result: BoundaryCorr[] = [];
  for (const [gx, gy] of gadmBoundary) {
    const px = gx * sx + tx, py = gy * sy + ty;
    const n = nearestCvBorder(px, py);
    if (n && n.dist < 15) result.push({ gx, gy, cx: n.pt[0], cy: n.pt[1], dist: n.dist });
  }
  return result;
}

/** Closed-form scale+translate fit via least-squares on unweighted correspondences. */
function unweightedScaleTranslateFit(
  trimmed: BoundaryCorr[],
  effectiveSx: number,
  initSy: number,
  range: number,
): Transform | null {
  const np = trimmed.length;
  let sGx = 0, sGx2 = 0, sCx = 0, sGxCx = 0;
  let sGy = 0, sGy2 = 0, sCy = 0, sGyCy = 0;
  for (const { gx, gy, cx, cy } of trimmed) {
    sGx += gx; sGx2 += gx * gx; sCx += cx; sGxCx += gx * cx;
    sGy += gy; sGy2 += gy * gy; sCy += cy; sGyCy += gy * cy;
  }
  const detX = np * sGx2 - sGx * sGx, detY = np * sGy2 - sGy * sGy;
  if (Math.abs(detX) < 1e-10 || Math.abs(detY) < 1e-10) return null;
  const sx = Math.max(effectiveSx * (1 - range), Math.min(effectiveSx * (1 + range), (np * sGxCx - sGx * sCx) / detX));
  const sy = Math.max(initSy * (1 - range), Math.min(initSy * (1 + range), (np * sGyCy - sGy * sCy) / detY));
  return {
    sx, sy,
    tx: (sCx - sx * sGx) / np,
    ty: (sCy - sy * sGy) / np,
  };
}

interface WeightedCorr extends BoundaryCorr { type: string }

type DivGrid = Array<Array<[number, number, number, number]>>;

/** Build a spatial grid of projected division points for fast neighbor lookup. */
function buildDivGrid(
  allDivPoints: Array<[number, number]>,
  t: Transform,
  gridW: number, gridH: number,
  CELL: number,
): DivGrid {
  const grid: DivGrid = Array.from({ length: gridW * gridH }, () => []);
  for (const [gx, gy] of allDivPoints) {
    const px = gx * t.sx + t.tx, py = gy * t.sy + t.ty;
    const gi = Math.floor(py / CELL) * gridW + Math.floor(px / CELL);
    if (gi >= 0 && gi < grid.length) grid[gi].push([gx, gy, px, py]);
  }
  return grid;
}

/** Find the nearest projected division point to (ix,iy) within a 9x9 grid-cell neighborhood. */
function findNearestDivPoint(
  grid: DivGrid,
  ix: number, iy: number,
  gridW: number, gridH: number,
  CELL: number,
): { gadm: [number, number]; dist: number } | null {
  const giX = Math.floor(ix / CELL), giY = Math.floor(iy / CELL);
  let bestDist = Infinity;
  let bestGadm: [number, number] | null = null;
  for (let dy = -4; dy <= 4; dy++) {
    for (let dx = -4; dx <= 4; dx++) {
      const nx = giX + dx, ny = giY + dy;
      if (nx < 0 || nx >= gridW || ny < 0 || ny >= gridH) continue;
      for (const [gx, gy, px, py] of grid[ny * gridW + nx]) {
        const d = (ix - px) ** 2 + (iy - py) ** 2;
        if (d < bestDist) { bestDist = d; bestGadm = [gx, gy]; }
      }
    }
  }
  return bestGadm ? { gadm: bestGadm, dist: Math.sqrt(bestDist) } : null;
}

/** Collect internal-border correspondences by searching a grid of projected division points. */
function collectInternalCorrespondences(
  allDivPoints: Array<[number, number]>,
  intBorderPixels: Array<[number, number]>,
  t: Transform,
  gridW: number, gridH: number,
  CELL: number,
): WeightedCorr[] {
  const grid = buildDivGrid(allDivPoints, t, gridW, gridH, CELL);
  const result: WeightedCorr[] = [];
  for (const [ix, iy] of intBorderPixels) {
    const found = findNearestDivPoint(grid, ix, iy, gridW, gridH, CELL);
    if (found && found.dist < 8) {
      result.push({ gx: found.gadm[0], gy: found.gadm[1], cx: ix, cy: iy, dist: found.dist, type: 'int' });
    }
  }
  return result;
}

/** Closed-form weighted scale+translate fit (external weight=3, internal weight=1). */
function weightedScaleTranslateFit(
  trimmed: WeightedCorr[],
  effectiveSx: number,
  initSy: number,
  range: number,
): Transform | null {
  let wSum = 0, wsGx = 0, wsGx2 = 0, wsCx = 0, wsGxCx = 0;
  let wsGy = 0, wsGy2 = 0, wsCy = 0, wsGyCy = 0;
  for (const { gx, gy, cx, cy, type } of trimmed) {
    const w = type === 'ext' ? 3 : 1;
    wSum += w; wsGx += w * gx; wsGx2 += w * gx * gx; wsCx += w * cx; wsGxCx += w * gx * cx;
    wsGy += w * gy; wsGy2 += w * gy * gy; wsCy += w * cy; wsGyCy += w * gy * cy;
  }
  const detXC = wSum * wsGx2 - wsGx * wsGx, detYC = wSum * wsGy2 - wsGy * wsGy;
  if (Math.abs(detXC) < 1e-10 || Math.abs(detYC) < 1e-10) return null;
  const sx = Math.max(effectiveSx * (1 - range), Math.min(effectiveSx * (1 + range), (wSum * wsGxCx - wsGx * wsCx) / detXC));
  const sy = Math.max(initSy * (1 - range), Math.min(initSy * (1 + range), (wSum * wsGyCy - wsGy * wsCy) / detYC));
  return {
    sx, sy,
    tx: (wsCx - sx * wsGx) / wSum,
    ty: (wsCy - sy * wsGy) / wSum,
  };
}

/** Option C: External + internal border ICP (weighted, 5 phase-2 passes). */
function runOptionC(
  gadmBoundary: Array<[number, number]>,
  allDivPoints: Array<[number, number]>,
  intBorderPixels: Array<[number, number]>,
  nearestCvBorder: NearestFn,
  init: Transform,
  effectiveSx: number, initSy: number, range: number,
  gridW: number, gridH: number, CELL: number,
): Transform {
  let t = runTranslationIcp(gadmBoundary, nearestCvBorder, init, 20);
  for (let phase2 = 0; phase2 < 5; phase2++) {
    const extCorrs = collectBoundaryCorrespondences(gadmBoundary, nearestCvBorder, t.sx, t.sy, t.tx, t.ty);
    const corrsC: WeightedCorr[] = extCorrs.map(c => ({ ...c, type: 'ext' }));
    const intCorrs = collectInternalCorrespondences(allDivPoints, intBorderPixels, t, gridW, gridH, CELL);
    corrsC.push(...intCorrs);
    if (corrsC.length < 20) break;
    corrsC.sort((a, b) => a.dist - b.dist);
    const trimmedC = corrsC.slice(0, Math.floor(corrsC.length * 0.75));
    const fit = weightedScaleTranslateFit(trimmedC, effectiveSx, initSy, range);
    if (!fit) break;
    t = runTranslationIcp(gadmBoundary, nearestCvBorder, fit, 5);
  }
  return t;
}

// =============================================================================
// Option D: Centroid-based grid search
// =============================================================================

type CentroidScoreFn = (sx: number, sy: number, tx: number, ty: number) => number;

/** Build a score function that measures how well centroids land on large clusters. */
function buildCentroidScorer(
  centroids: Array<{ cx: number; cy: number }>,
  pixelLabels: Uint8Array,
  TW: number, TH: number,
  applyCorrX: (x: number) => number,
): CentroidScoreFn {
  const tp = TW * TH;
  const clusterPxCounts = new Map<number, number>();
  for (let i = 0; i < tp; i++) {
    if (pixelLabels[i] < 255) clusterPxCounts.set(pixelLabels[i], (clusterPxCounts.get(pixelLabels[i]) ?? 0) + 1);
  }
  const totalPx = [...clusterPxCounts.values()].reduce((a, b) => a + b, 0);
  const largeClusters = new Set<number>();
  for (const [lbl, cnt] of clusterPxCounts) {
    if (cnt > totalPx * 0.05) largeClusters.add(lbl);
  }

  return (sx: number, sy: number, tx: number, ty: number): number => {
    const perCluster = new Map<number, number>();
    let inMask = 0, outOfBounds = 0;
    for (const c of centroids) {
      const px = Math.round(applyCorrX(c.cx) * sx + tx);
      const py = Math.round(-c.cy * sy + ty);
      if (px >= 0 && px < TW && py >= 0 && py < TH) {
        const lbl = pixelLabels[py * TW + px];
        if (lbl < 255) { perCluster.set(lbl, (perCluster.get(lbl) ?? 0) + 1); inMask++; }
        else outOfBounds++;
      } else {
        outOfBounds++;
      }
    }
    let largeHit = 0;
    for (const lc of largeClusters) if (perCluster.has(lc)) largeHit++;
    // Score: cluster coverage (primary) + in-mask (secondary) - out-of-bounds penalty
    return largeHit * 100000 + inMask * 100 - outOfBounds * 200;
  };
}

interface CentroidSearchBest extends Transform { score: number }

/** Coarse grid search over sx/sy/tx/ty to find centroid alignment. */
function coarseCentroidSearch(
  score: CentroidScoreFn,
  effectiveSx: number, initSy: number,
  gCx: number, gCy: number, pCx: number, pCy: number,
  TW: number,
  initial: CentroidSearchBest,
): CentroidSearchBest {
  const sxRange = 0.20, syRange = 0.15;
  const sStep = 0.04;
  const tRange = Math.max(15, TW * 0.04);
  const tStep = Math.max(2, Math.round(tRange / 8));
  let best = initial;

  for (let sxMul = 1 - sxRange; sxMul <= 1 + sxRange; sxMul += sStep) {
    for (let syMul = 1 - syRange; syMul <= 1 + syRange; syMul += sStep) {
      const trySx = effectiveSx * sxMul;
      const trySy = initSy * syMul;
      const baseTx = pCx - gCx * trySx;
      const baseTy = pCy - gCy * trySy;
      for (let dx = -tRange; dx <= tRange; dx += tStep) {
        for (let dy = -tRange; dy <= tRange; dy += tStep) {
          const s = score(trySx, trySy, baseTx + dx, baseTy + dy);
          if (s > best.score) best = { score: s, sx: trySx, sy: trySy, tx: baseTx + dx, ty: baseTy + dy };
        }
      }
    }
  }
  return best;
}

/** Fine refinement around the coarse-search best. */
function refineCentroidSearch(
  score: CentroidScoreFn,
  gCx: number, gCy: number, pCx: number, pCy: number,
  coarse: CentroidSearchBest,
): CentroidSearchBest {
  const fSx = coarse.sx, fSy = coarse.sy, fTx = coarse.tx, fTy = coarse.ty;
  let best = coarse;
  for (let sxD2 = -0.01; sxD2 <= 0.01; sxD2 += 0.005) {
    for (let syD2 = -0.01; syD2 <= 0.01; syD2 += 0.005) {
      const trySx = fSx * (1 + sxD2), trySy = fSy * (1 + syD2);
      const baseTx = fTx + (pCx - gCx * trySx) - (pCx - gCx * fSx);
      const baseTy = fTy + (pCy - gCy * trySy) - (pCy - gCy * fSy);
      for (let dx = -2; dx <= 2; dx++) {
        for (let dy = -2; dy <= 2; dy++) {
          const s = score(trySx, trySy, baseTx + dx, baseTy + dy);
          if (s > best.score) best = { score: s, sx: trySx, sy: trySy, tx: baseTx + dx, ty: baseTy + dy };
        }
      }
    }
  }
  return best;
}

/** Option D: Centroid-based scale+translate grid search, then local refinement. */
function runOptionD(
  centroids: Array<{ cx: number; cy: number }>,
  pixelLabels: Uint8Array,
  TW: number, TH: number,
  applyCorrX: (x: number) => number,
  effectiveSx: number, initSy: number,
  gCx: number, gCy: number, pCx: number, pCy: number,
  init: Transform,
): Transform {
  const score = buildCentroidScorer(centroids, pixelLabels, TW, TH, applyCorrX);

  const initialBest: CentroidSearchBest = {
    sx: init.sx, sy: init.sy, tx: init.tx, ty: init.ty,
    score: score(init.sx, init.sy, init.tx, init.ty),
  };

  const coarse = coarseCentroidSearch(score, effectiveSx, initSy, gCx, gCy, pCx, pCy, TW, initialBest);
  const fine = refineCentroidSearch(score, gCx, gCy, pCx, pCy, coarse);

  const largeHit = Math.floor(fine.score / 100000);
  const inMask = Math.floor((fine.score % 100000) / 100);
  // Re-derive cluster count for log message without rebuilding the scorer
  const clusterPxCountsLog = new Map<number, number>();
  const tp = TW * TH;
  for (let i = 0; i < tp; i++) {
    if (pixelLabels[i] < 255) clusterPxCountsLog.set(pixelLabels[i], (clusterPxCountsLog.get(pixelLabels[i]) ?? 0) + 1);
  }
  const totalPx = [...clusterPxCountsLog.values()].reduce((a, b) => a + b, 0);
  let largeClusterCount = 0;
  for (const cnt of clusterPxCountsLog.values()) {
    if (cnt > totalPx * 0.05) largeClusterCount++;
  }
  console.log(`  [ICP] Option D (centroid): sx=${fine.sx.toFixed(2)} sy=${fine.sy.toFixed(2)} clusters=${largeHit}/${largeClusterCount} inMask=${inMask}/${centroids.length}`);

  return { sx: fine.sx, sy: fine.sy, tx: fine.tx, ty: fine.ty };
}

// =============================================================================
// GADM boundary preparation
// =============================================================================

/**
 * Parse and resample the GADM country boundary, applying cosine X correction and
 * optionally filtering to a bbox override (with 5% margin on each side).
 */
function prepareGadmBoundary(
  countryPath: string,
  pxS: (base: number) => number,
  applyCorrX: (x: number) => number,
  bboxOverride: Bbox | undefined,
): Array<[number, number]> {
  let boundary = resamplePath(
    parseSvgPathPoints(countryPath),
    pxS(500),
  ).map(([x, y]): [number, number] => [applyCorrX(x), y]);

  if (bboxOverride) {
    const ob = {
      minX: applyCorrX(bboxOverride.minX),
      maxX: applyCorrX(bboxOverride.maxX),
      minY: bboxOverride.minY,
      maxY: bboxOverride.maxY,
    };
    const marginX = (ob.maxX - ob.minX) * 0.05;
    const marginY = (ob.maxY - ob.minY) * 0.05;
    const beforeCount = boundary.length;
    boundary = boundary.filter(([gx, gy]) =>
      gx >= ob.minX - marginX && gx <= ob.maxX + marginX &&
      gy >= ob.minY - marginY && gy <= ob.maxY + marginY,
    );
    console.log(`  [ICP] Filtered gadmBoundary: ${beforeCount} → ${boundary.length} points (excluded ${beforeCount - boundary.length} outside bbox override)`);
  }
  return boundary;
}

/** Resample each division's SVG path and concatenate all points in corrected space. */
function buildAllDivPoints(
  divPaths: Array<{ id: number; svgPath: string }>,
  pxS: (base: number) => number,
  applyCorrX: (x: number) => number,
): Array<[number, number]> {
  const result: Array<[number, number]> = [];
  for (const d of divPaths) {
    const pts = parseSvgPathPoints(d.svgPath);
    if (pts.length >= 3) {
      const resampled = resamplePath(pts, pxS(50));
      for (const p of resampled) result.push([applyCorrX(p[0]), p[1]]);
    }
  }
  return result;
}

// =============================================================================
// Option selection
// =============================================================================

interface IcpOption extends Transform {
  label: string;
  overflow: number;
  error: number;
}

/**
 * Pick the best ICP option: prefer acceptable overflow (<15% of image),
 * then lowest mean error.
 */
function selectBestOption(
  options: IcpOption[],
  maxDim: number,
): IcpOption {
  const sorted = [...options].sort((a, b) => {
    const aOverflowOk = a.overflow < maxDim * 0.15;
    const bOverflowOk = b.overflow < maxDim * 0.15;
    if (aOverflowOk !== bOverflowOk) return aOverflowOk ? -1 : 1;
    return a.error - b.error;
  });
  return sorted[0];
}

/** Build the IcpOption array by evaluating overflow + error for each candidate transform. */
function buildIcpOptions(
  transforms: Array<{ label: string; t: Transform }>,
  gadmBoundary: Array<[number, number]>,
  cvBorderPixels: Array<[number, number]>,
  nearestCvBorder: NearestFn,
  TW: number, TH: number,
): IcpOption[] {
  return transforms.map(({ label, t }) => ({
    label, sx: t.sx, sy: t.sy, tx: t.tx, ty: t.ty,
    overflow: computeMaxOverflow(gadmBoundary, cvBorderPixels, TW, TH, t.sx, t.sy, t.tx, t.ty),
    error: computeMeanError(gadmBoundary, nearestCvBorder, t.sx, t.sy, t.tx, t.ty),
  }));
}

// =============================================================================
// Debug rendering
// =============================================================================

type DrawLineFn = (a: number, b0: number, b1: number, r: number, g: number, b: number) => void;

/** Create horizontal line drawer into a buffer. */
function makeDrawHLine(buf: Buffer, TW: number, TH: number): DrawLineFn {
  return (y: number, x0: number, x1: number, r: number, g: number, b: number) => {
    if (y < 0 || y >= TH) return;
    for (let x = Math.max(0, Math.floor(x0)); x <= Math.min(TW - 1, Math.ceil(x1)); x++) {
      const idx = (y * TW + x) * 3;
      buf[idx] = r; buf[idx + 1] = g; buf[idx + 2] = b;
    }
  };
}

/** Create vertical line drawer into a buffer. */
function makeDrawVLine(buf: Buffer, TW: number, TH: number): DrawLineFn {
  return (x: number, y0: number, y1: number, r: number, g: number, b: number) => {
    if (x < 0 || x >= TW) return;
    for (let y = Math.max(0, Math.floor(y0)); y <= Math.min(TH - 1, Math.ceil(y1)); y++) {
      const idx = (y * TW + x) * 3;
      buf[idx] = r; buf[idx + 1] = g; buf[idx + 2] = b;
    }
  };
}

/** Render and push the ICP bbox diagnostic debug image. */
async function renderBboxDiagnostic(
  icpMask: Uint8Array,
  cvBorderPixels: Array<[number, number]>,
  gadmBoundary: Array<[number, number]>,
  gBbox: Bbox, cBbox: Bbox,
  rawToPixel: (gx: number, gy: number) => [number, number],
  TW: number, TH: number, origW: number, origH: number,
  best: IcpOption,
  pushDebugImage: (label: string, dataUrl: string) => Promise<void>,
): Promise<void> {
  const tp = TW * TH;
  const bboxBuf = Buffer.alloc(tp * 3, 40);
  for (let i = 0; i < tp; i++) {
    if (icpMask[i]) { bboxBuf[i * 3] = 30; bboxBuf[i * 3 + 1] = 80; bboxBuf[i * 3 + 2] = 30; }
  }
  for (const [x, y] of cvBorderPixels) {
    const idx = (y * TW + x) * 3;
    bboxBuf[idx] = 0; bboxBuf[idx + 1] = 255; bboxBuf[idx + 2] = 255;
  }
  const drawHLine = makeDrawHLine(bboxBuf, TW, TH);
  const drawVLine = makeDrawVLine(bboxBuf, TW, TH);
  drawHLine(cBbox.minY, cBbox.minX, cBbox.maxX, 0, 200, 200);
  drawHLine(cBbox.maxY, cBbox.minX, cBbox.maxX, 0, 200, 200);
  drawVLine(cBbox.minX, cBbox.minY, cBbox.maxY, 0, 200, 200);
  drawVLine(cBbox.maxX, cBbox.minY, cBbox.maxY, 0, 200, 200);
  const gCorners = [
    rawToPixel(gBbox.minX, gBbox.minY), rawToPixel(gBbox.maxX, gBbox.minY),
    rawToPixel(gBbox.maxX, gBbox.maxY), rawToPixel(gBbox.minX, gBbox.maxY),
  ];
  drawHLine(Math.round(gCorners[0][1]), gCorners[0][0], gCorners[1][0], 255, 60, 60);
  drawHLine(Math.round(gCorners[2][1]), gCorners[3][0], gCorners[2][0], 255, 60, 60);
  drawVLine(Math.round(gCorners[0][0]), gCorners[0][1], gCorners[3][1], 255, 60, 60);
  drawVLine(Math.round(gCorners[1][0]), gCorners[1][1], gCorners[2][1], 255, 60, 60);
  for (const [gx, gy] of gadmBoundary) {
    const [px, py] = rawToPixel(gx, gy);
    const ix = Math.round(px), iy = Math.round(py);
    if (ix >= 0 && ix < TW && iy >= 0 && iy < TH) {
      const idx = (iy * TW + ix) * 3;
      bboxBuf[idx] = 255; bboxBuf[idx + 1] = 80; bboxBuf[idx + 2] = 80;
    }
  }
  const bboxPng = await sharp(bboxBuf, { raw: { width: TW, height: TH, channels: 3 } })
    .resize(origW, origH, { kernel: 'nearest' })
    .png()
    .toBuffer();
  await pushDebugImage(
    `ICP bbox diagnostic: cyan=CV border+bbox, red=GADM border+bbox (ICP ${best.label}, err=${best.error.toFixed(1)}, overflow=${best.overflow.toFixed(0)})`,
    `data:image/png;base64,${bboxPng.toString('base64')}`,
  );
}

/** Draw all division boundaries into vizBuf (white lines). */
function drawDivisionsIntoBuffer(
  vizBuf: Buffer,
  divPaths: Array<{ id: number; svgPath: string }>,
  gadmToPixel: (gx: number, gy: number) => [number, number],
  TW: number, TH: number,
): void {
  for (const d of divPaths) {
    const pts = parseSvgPathPoints(d.svgPath);
    for (let i = 1; i < pts.length; i++) {
      const [x0, y0] = gadmToPixel(pts[i - 1][0], pts[i - 1][1]);
      const [x1, y1] = gadmToPixel(pts[i][0], pts[i][1]);
      const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) * 2;
      for (let s = 0; s <= steps; s++) {
        const t = steps > 0 ? s / steps : 0;
        const x = Math.round(x0 + t * (x1 - x0));
        const y = Math.round(y0 + t * (y1 - y0));
        if (x >= 0 && x < TW && y >= 0 && y < TH) {
          const idx = (y * TW + x) * 3;
          vizBuf[idx] = 255; vizBuf[idx + 1] = 255; vizBuf[idx + 2] = 255;
        }
      }
    }
  }
}

/** Pick marker-pixel RGB: black edge, green fill for assigned, orange fill for unassigned. */
function centroidMarkerColor(
  distSq: number,
  assigned: { regionId: number; regionName: string } | null,
): [number, number, number] {
  if (distSq >= 6) return [0, 0, 0];
  if (assigned) return [76, 175, 80];
  return [255, 152, 0];
}

/** Draw a single centroid marker at (ix, iy) into the buffer. */
function drawCentroidMarker(
  vizBuf: Buffer,
  ix: number, iy: number,
  assigned: { regionId: number; regionName: string } | null,
  TW: number, TH: number,
): void {
  for (let dy = -3; dy <= 3; dy++) {
    for (let dx = -3; dx <= 3; dx++) {
      const distSq = dx * dx + dy * dy;
      if (distSq > 9) continue;
      const x = ix + dx, y = iy + dy;
      if (x < 0 || x >= TW || y < 0 || y >= TH) continue;
      const idx = (y * TW + x) * 3;
      const [r, g, b] = centroidMarkerColor(distSq, assigned);
      vizBuf[idx] = r;
      vizBuf[idx + 1] = g;
      vizBuf[idx + 2] = b;
    }
  }
}

/** Draw all centroid markers into vizBuf (green if assigned, orange if unassigned). */
function drawCentroidsIntoBuffer(
  vizBuf: Buffer,
  centroids: Array<{ cx: number; cy: number; assigned: { regionId: number; regionName: string } | null }>,
  gadmToPixel: (gx: number, gy: number) => [number, number],
  TW: number, TH: number,
): void {
  for (const c of centroids) {
    const [px, py] = gadmToPixel(c.cx, -c.cy);
    drawCentroidMarker(vizBuf, Math.round(px), Math.round(py), c.assigned, TW, TH);
  }
}

/** Render and push the GADM-over-CV overlay debug image. */
async function renderGadmOverlay(
  quantBuf: Buffer,
  divPaths: Array<{ id: number; svgPath: string }>,
  centroids: Array<{ cx: number; cy: number; assigned: { regionId: number; regionName: string } | null }>,
  gadmToPixel: (gx: number, gy: number) => [number, number],
  TW: number, TH: number, origW: number, origH: number,
  best: IcpOption,
  pushDebugImage: (label: string, dataUrl: string) => Promise<void>,
): Promise<void> {
  const vizBuf = Buffer.from(quantBuf);
  drawDivisionsIntoBuffer(vizBuf, divPaths, gadmToPixel, TW, TH);
  drawCentroidsIntoBuffer(vizBuf, centroids, gadmToPixel, TW, TH);
  const compositePng = await sharp(vizBuf, { raw: { width: TW, height: TH, channels: 3 } })
    .resize(origW, origH, { kernel: 'lanczos3' })
    .png()
    .toBuffer();
  await pushDebugImage(
    `Step 3: GADM divisions overlaid on CV color regions (ICP ${best.label}, err=${best.error.toFixed(1)}, overflow=${best.overflow.toFixed(0)}px)`,
    `data:image/png;base64,${compositePng.toString('base64')}`,
  );
}

// =============================================================================
// Main alignment function
// =============================================================================

export async function alignDivisionsToImage(params: AlignmentParams): Promise<AlignmentResult> {
  const {
    divPaths, countryPath,
    cMinX, cMinY, cMaxX, cMaxY,
    icpMask, pixelLabels,
    TW, TH, origW, origH,
    quantBuf, centroids,
    pxS, pushDebugImage,
  } = params;

  // Phase 1: border extraction
  const cvBorderPixels = extractExternalBorder(icpMask, TW, TH);
  const intBorderPixels = extractInternalBorder(pixelLabels, TW, TH);

  // Phase 2: cosine-latitude correction setup
  // GADM SVG paths are in EPSG:4326 (degrees). Source maps use projected CRS
  // where 1° longitude ≈ cos(lat) × 1° latitude in ground distance.
  // Apply cos(midLat) to all X coordinates so the ICP operates in a
  // pseudo-equirectangular space matching the map projection.
  // The correction is embedded in gadmToPixel so callers use raw GADM coords.
  const rawGBbox = params.gBboxOverride ?? { minX: cMinX, maxX: cMaxX, minY: -cMaxY, maxY: -cMinY };
  const midLat = Math.abs((rawGBbox.minY + rawGBbox.maxY) / 2);
  const cosLat = Math.cos(midLat * Math.PI / 180);
  const applyCosFix = Math.abs(1 - cosLat) > 0.03;
  const cosX = applyCosFix ? cosLat : 1.0;
  if (applyCosFix) {
    console.log(`  [ICP] Applying cosine latitude correction: midLat=${midLat.toFixed(1)}°, cos=${cosLat.toFixed(4)}, X-coords scaled by ${cosX.toFixed(4)}`);
  }
  const cx = (x: number) => x * cosX;

  // Phase 3: build GADM boundaries + division points
  const allDivPoints = buildAllDivPoints(divPaths, pxS, cx);
  const gadmBoundary = prepareGadmBoundary(countryPath, pxS, cx, params.gBboxOverride);

  // Phase 4: spatial grid + bbox computation
  const CELL = pxS(5);
  const gridW = Math.ceil(TW / CELL), gridH = Math.ceil(TH / CELL);
  const nearestCvBorder = buildNearestCvBorderFn(cvBorderPixels, TW, TH, CELL);

  const polyBbox = { minX: cx(rawGBbox.minX), maxX: cx(rawGBbox.maxX), minY: rawGBbox.minY, maxY: rawGBbox.maxY };
  const gBbox = computeGadmBbox(centroids, polyBbox, cx);
  const cBbox = computeCvBbox(cvBorderPixels, TW, TH);

  const initSx = (cBbox.maxX - cBbox.minX) / (gBbox.maxX - gBbox.minX);
  const initSy = (cBbox.maxY - cBbox.minY) / (gBbox.maxY - gBbox.minY);
  const scaleAsymmetry = Math.max(initSx, initSy) / Math.min(initSx, initSy);
  const autoRange = scaleAsymmetry > 1.15 ? Math.min(scaleAsymmetry - 1 + 0.05, 0.50) : 0.10;
  const range = params.scaleRange ?? autoRange;
  const effectiveSx = initSx;

  console.log(`  [ICP] GADM bbox (corrected): x=[${gBbox.minX.toFixed(4)},${gBbox.maxX.toFixed(4)}] y=[${gBbox.minY.toFixed(4)},${gBbox.maxY.toFixed(4)}]`);
  console.log(`  [ICP] CV bbox (full):        x=[${cBbox.minX},${cBbox.maxX}] y=[${cBbox.minY},${cBbox.maxY}] (${cvBorderPixels.length} pts)`);
  console.log(`  [ICP] initScale: sx=${initSx.toFixed(4)} sy=${initSy.toFixed(4)}, asymmetry=${scaleAsymmetry.toFixed(3)}, range=±${(range * 100).toFixed(0)}%`);

  const gCx = (gBbox.minX + gBbox.maxX) / 2;
  const gCy = (gBbox.minY + gBbox.maxY) / 2;
  const pCx = (cBbox.minX + cBbox.maxX) / 2;
  const pCy = (cBbox.minY + cBbox.maxY) / 2;
  console.log(`  [ICP] GADM bbox center: (${gCx.toFixed(4)}, ${gCy.toFixed(4)}) → CV bbox center: (${pCx.toFixed(1)}, ${pCy.toFixed(1)})`);

  // Phase 5: run each ICP option from the common starting transform
  const initTransform: Transform = {
    sx: effectiveSx, sy: initSy,
    tx: pCx - gCx * effectiveSx, ty: pCy - gCy * initSy,
  };
  const tA = runOptionA(gadmBoundary, nearestCvBorder, initTransform);
  const tB = runOptionB(gadmBoundary, nearestCvBorder, initTransform, effectiveSx, initSy, range);
  const tC = runOptionC(
    gadmBoundary, allDivPoints, intBorderPixels, nearestCvBorder,
    initTransform, effectiveSx, initSy, range,
    gridW, gridH, CELL,
  );
  const tD = runOptionD(
    centroids, pixelLabels, TW, TH, cx,
    effectiveSx, initSy, gCx, gCy, pCx, pCy,
    initTransform,
  );

  // Phase 6: select best option
  const icpOptions = buildIcpOptions(
    [{ label: 'A', t: tA }, { label: 'B', t: tB }, { label: 'C', t: tC }, { label: 'D', t: tD }],
    gadmBoundary, cvBorderPixels, nearestCvBorder, TW, TH,
  );
  for (const o of icpOptions) {
    console.log(`  [ICP] Option ${o.label}: sx=${o.sx.toFixed(2)} sy=${o.sy.toFixed(2)} err=${o.error.toFixed(1)} overflow=${o.overflow.toFixed(1)}`);
  }
  // Selection: prefer options that have low overflow AND low error.
  // Option D (centroid) may have higher overflow but better division placement —
  // give it a bonus by treating moderate overflow (<15% of image) as acceptable.
  const best = selectBestOption(icpOptions, Math.max(TW, TH));

  // Phase 7: build final transforms
  const rawToPixel = (gx: number, gy: number): [number, number] =>
    [gx * best.sx + best.tx, gy * best.sy + best.ty];
  const gadmToPixel = (gx: number, gy: number): [number, number] =>
    rawToPixel(cx(gx), gy);

  // Phase 8: debug images
  await renderBboxDiagnostic(
    icpMask, cvBorderPixels, gadmBoundary, gBbox, cBbox, rawToPixel,
    TW, TH, origW, origH, best, pushDebugImage,
  );
  await renderGadmOverlay(
    quantBuf, divPaths, centroids, gadmToPixel,
    TW, TH, origW, origH, best, pushDebugImage,
  );
  // __source_map__ is pushed early in wvImportMatchPipeline.ts, right after
  // mapBuffer is loaded, so it works for both JS and Python CV paths.

  return {
    gadmToPixel,
    bestLabel: best.label,
    bestError: best.error,
    bestOverflow: best.overflow,
    gBbox,
    cBbox,
  };
}
