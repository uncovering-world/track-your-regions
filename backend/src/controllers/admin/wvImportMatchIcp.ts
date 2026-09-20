/**
 * ICP alignment phase for division matching.
 *
 * Fits a region's GADM division boundaries onto the silhouette the CV run
 * extracted from the source map, and returns the gadmToPixel transform the
 * assignment then works in. The file owns the preparation and the verdict:
 * the bounding boxes both sides are measured in, the border pixels the fit is
 * scored against, the four candidate transforms' overflow and mean error, and
 * the two debug images a reviewer reads. The candidates themselves — options
 * A to D — are `wvImportMatchIcpOptions.ts`, and which divisions are allowed
 * into the box at all is `wvImportMatchIcpOutliers.ts`.
 */
import sharp from 'sharp';
import { parseSvgPathPoints, resamplePath } from './wvImportMatchSvgHelpers.js';
import {
  runOptionA, runOptionB, runOptionC, runOptionD,
  type Transform, type NearestFn,
} from './wvImportMatchIcpOptions.js';

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
  /** Which ICP option was selected (A, B, C or D) */
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
