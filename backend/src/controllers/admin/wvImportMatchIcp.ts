/**
 * ICP alignment phase for division matching.
 *
 * Tries 3 alignment approaches (Centroid ICP, BBox ICP, BBox-only) to align
 * GADM country boundaries to the CV silhouette extracted from the source map.
 * Picks the best alignment by overflow + mean error and returns the
 * gadmToPixel transform function.
 */

import sharp from 'sharp';
import { parseSvgPathPoints, resamplePath } from './wvImportMatchSvgHelpers.js';

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
  /** Map buffer for source image debug */
  mapBuffer: Buffer;
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
 * Five detection paths (any one triggers):
 * 1. Aspect ratio mismatch > 1.2 AND overflow > 10%
 * 2. Overflow alone > 15%
 * 3. Scale asymmetry > 1.25 AND overflow > 8%
 * 4. Scale asymmetry > 1.2 AND mean error > 2% of image — catches distorted fits
 * 5. Mean error alone > 3% of image — very poor alignment regardless of cause
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
      || (meanErrorPct > 0.03);
}

/**
 * Strategy B: Find divisions that inflate the GADM bbox disproportionately.
 * Iteratively removes the division whose removal shrinks the bbox the most,
 * until the aspect ratio matches the CV bbox or no significant improvement remains.
 */
export function findBboxOutliers(
  divBboxes: DivisionBbox[],
  cBbox: { minX: number; maxX: number; minY: number; maxY: number },
): number[] {
  const totalArea = divBboxes.reduce((sum, d) => sum + d.area, 0);
  const cvW = cBbox.maxX - cBbox.minX;
  const cvH = cBbox.maxY - cBbox.minY;
  if (cvW <= 0 || cvH <= 0) return [];
  const cvRatio = cvW / cvH;

  const excluded: number[] = [];
  let remaining = [...divBboxes];

  for (let iter = 0; iter < divBboxes.length && remaining.length > 1; iter++) {
    const curBbox = computeBboxFromDivisions(remaining);
    const curW = curBbox.maxX - curBbox.minX;
    const curH = curBbox.maxY - curBbox.minY;
    if (curW <= 0 || curH <= 0) break;

    const curRatio = curW / curH;
    const ratioMatch = Math.max(curRatio, cvRatio) / Math.min(curRatio, cvRatio);
    if (ratioMatch <= 1.3) break;

    const curArea = curW * curH;
    let bestReduction = 0;
    let bestIdx = -1;

    for (let i = 0; i < remaining.length; i++) {
      if (remaining[i].area > totalArea * 0.1) continue;
      const without = remaining.filter((_, j) => j !== i);
      if (without.length === 0) continue;
      const newBbox = computeBboxFromDivisions(without);
      const newArea = (newBbox.maxX - newBbox.minX) * (newBbox.maxY - newBbox.minY);
      const reduction = (curArea - newArea) / curArea;
      if (reduction > bestReduction) {
        bestReduction = reduction;
        bestIdx = i;
      }
    }

    if (bestIdx < 0 || bestReduction < 0.05) break;

    excluded.push(remaining[bestIdx].id);
    remaining = remaining.filter((_, i) => i !== bestIdx);
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

function computeMaxOverflow(
  gadmBoundary: Array<[number, number]>,
  cvBorderPixels: Array<[number, number]>,
  TW: number, TH: number,
  sx: number, sy: number, tx: number, ty: number,
): number {
  let gTop = TH, gBot = 0, gLeft = TW, gRight = 0;
  for (const [gx, gy] of gadmBoundary) {
    const px = gx * sx + tx, py = gy * sy + ty;
    if (py < gTop) gTop = py; if (py > gBot) gBot = py;
    if (px < gLeft) gLeft = px; if (px > gRight) gRight = px;
  }
  let cTop = TH, cBot = 0, cLeft = TW, cRight = 0;
  for (const [x, y] of cvBorderPixels) {
    if (y < cTop) cTop = y; if (y > cBot) cBot = y;
    if (x < cLeft) cLeft = x; if (x > cRight) cRight = x;
  }
  return Math.max(Math.abs(cTop - gTop), Math.abs(gBot - cBot), Math.abs(cLeft - gLeft), Math.abs(gRight - cRight));
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
// Main alignment function
// =============================================================================

export async function alignDivisionsToImage(params: AlignmentParams): Promise<AlignmentResult> {
  const {
    divPaths, countryPath,
    cMinX, cMinY, cMaxX, cMaxY,
    icpMask, pixelLabels,
    TW, TH, origW, origH,
    quantBuf, centroids, mapBuffer,
    pxS, pushDebugImage,
  } = params;

  const tp = TW * TH;

  // Extract CV external border pixels (including image-edge pixels)
  const cvBorderPixels: Array<[number, number]> = [];
  for (let y = 0; y < TH; y++) {
    for (let x = 0; x < TW; x++) {
      const p = y * TW + x;
      if (!icpMask[p]) continue;
      // Image-edge mask pixels are always border pixels
      if (x === 0 || x === TW - 1 || y === 0 || y === TH - 1) {
        cvBorderPixels.push([x, y]);
        continue;
      }
      for (const n of [p - TW, p + TW, p - 1, p + 1]) {
        if (!icpMask[n]) { cvBorderPixels.push([x, y]); break; }
      }
    }
  }

  // Extract CV internal border pixels
  const intBorderPixels: Array<[number, number]> = [];
  for (let y = 1; y < TH - 1; y++) {
    for (let x = 1; x < TW - 1; x++) {
      const p = y * TW + x;
      if (pixelLabels[p] === 255) continue;
      for (const n of [p - TW, p + TW, p - 1, p + 1]) {
        if (pixelLabels[n] !== 255 && pixelLabels[n] !== pixelLabels[p]) {
          intBorderPixels.push([x, y]);
          break;
        }
      }
    }
  }

  // Resample GADM division boundaries for internal border matching
  const allDivPoints: Array<[number, number]> = [];
  for (const d of divPaths) {
    const pts = parseSvgPathPoints(d.svgPath);
    if (pts.length >= 3) {
      const resampled = resamplePath(pts, pxS(50));
      for (const p of resampled) allDivPoints.push(p);
    }
  }

  // Parse + resample GADM country boundary
  let gadmBoundary = resamplePath(
    parseSvgPathPoints(countryPath),
    pxS(500),
  );

  // When using bbox override (excluding islands), filter boundary points to
  // the overridden bbox. Without this, island boundary points inflate overflow
  // and error metrics even though the islands were excluded from the bbox.
  if (params.gBboxOverride) {
    const ob = params.gBboxOverride;
    const marginX = (ob.maxX - ob.minX) * 0.05;
    const marginY = (ob.maxY - ob.minY) * 0.05;
    const beforeCount = gadmBoundary.length;
    gadmBoundary = gadmBoundary.filter(([gx, gy]) =>
      gx >= ob.minX - marginX && gx <= ob.maxX + marginX &&
      gy >= ob.minY - marginY && gy <= ob.maxY + marginY,
    );
    console.log(`  [ICP] Filtered gadmBoundary: ${beforeCount} → ${gadmBoundary.length} points (excluded ${beforeCount - gadmBoundary.length} outside bbox override)`);
  }

  // Spatial grid for fast nearest-neighbor on CV border
  const CELL = pxS(5);
  const gridW = Math.ceil(TW / CELL), gridH = Math.ceil(TH / CELL);
  const nearestCvBorder = buildNearestCvBorderFn(cvBorderPixels, TW, TH, CELL);

  // Two-phase ICP with auto-selection
  const gBbox = params.gBboxOverride ?? { minX: cMinX, maxX: cMaxX, minY: -cMaxY, maxY: -cMinY };
  let cvMinX = TW, cvMaxX = 0, cvMinY = TH, cvMaxY = 0;
  for (const [x, y] of cvBorderPixels) {
    if (x < cvMinX) cvMinX = x; if (x > cvMaxX) cvMaxX = x;
    if (y < cvMinY) cvMinY = y; if (y > cvMaxY) cvMaxY = y;
  }
  const cBbox = { minX: cvMinX, maxX: cvMaxX, minY: cvMinY, maxY: cvMaxY };
  const initSx = (cBbox.maxX - cBbox.minX) / (gBbox.maxX - gBbox.minX);
  const initSy = (cBbox.maxY - cBbox.minY) / (gBbox.maxY - gBbox.minY);
  const range = params.scaleRange ?? 0.10;

  console.log(`  [ICP] GADM bbox (PostGIS): x=[${gBbox.minX.toFixed(4)},${gBbox.maxX.toFixed(4)}] y=[${gBbox.minY.toFixed(4)},${gBbox.maxY.toFixed(4)}]`);
  console.log(`  [ICP] CV bbox (full):      x=[${cBbox.minX},${cBbox.maxX}] y=[${cBbox.minY},${cBbox.maxY}] (${cvBorderPixels.length} pts)`);
  console.log(`  [ICP] initScale: sx=${initSx.toFixed(4)} sy=${initSy.toFixed(4)}`);

  const gCx = (gBbox.minX + gBbox.maxX) / 2;
  const gCy = (gBbox.minY + gBbox.maxY) / 2;
  const pCx = (cBbox.minX + cBbox.maxX) / 2;
  const pCy = (cBbox.minY + cBbox.maxY) / 2;
  console.log(`  [ICP] GADM bbox center: (${gCx.toFixed(4)}, ${gCy.toFixed(4)}) → CV bbox center: (${pCx.toFixed(1)}, ${pCy.toFixed(1)})`);

  // --- Option A: Translation-only ICP ---
  const sxA = initSx, syA = initSy;
  let txA = pCx - gCx * sxA, tyA = pCy - gCy * syA;
  for (let iter = 0; iter < 20; iter++) {
    let sumDx = 0, sumDy = 0, count = 0;
    for (const [gx, gy] of gadmBoundary) {
      const px = gx * sxA + txA, py = gy * syA + tyA;
      const n = nearestCvBorder(px, py);
      if (n && n.dist < 15) { sumDx += n.pt[0] - px; sumDy += n.pt[1] - py; count++; }
    }
    if (count < 10) break;
    txA += sumDx / count; tyA += sumDy / count;
  }
  const overflowA = computeMaxOverflow(gadmBoundary, cvBorderPixels, TW, TH, sxA, syA, txA, tyA);
  const errorA = computeMeanError(gadmBoundary, nearestCvBorder, sxA, syA, txA, tyA);

  // --- Option B: Translation + gentle scale correction ---
  let sxB = initSx, syB = initSy;
  let txB = pCx - gCx * sxB, tyB = pCy - gCy * syB;
  for (let iter = 0; iter < 20; iter++) {
    let sumDx = 0, sumDy = 0, count = 0;
    for (const [gx, gy] of gadmBoundary) {
      const px = gx * sxB + txB, py = gy * syB + tyB;
      const n = nearestCvBorder(px, py);
      if (n && n.dist < 15) { sumDx += n.pt[0] - px; sumDy += n.pt[1] - py; count++; }
    }
    if (count < 10) break;
    txB += sumDx / count; tyB += sumDy / count;
  }
  for (let phase2 = 0; phase2 < 3; phase2++) {
    const corrs: Array<{ gx: number; gy: number; cx: number; cy: number; dist: number }> = [];
    for (const [gx, gy] of gadmBoundary) {
      const px = gx * sxB + txB, py = gy * syB + tyB;
      const n = nearestCvBorder(px, py);
      if (n && n.dist < 15) corrs.push({ gx, gy, cx: n.pt[0], cy: n.pt[1], dist: n.dist });
    }
    if (corrs.length < 20) break;
    corrs.sort((a, b) => a.dist - b.dist);
    const trimmed = corrs.slice(0, Math.floor(corrs.length * 0.75));
    const np = trimmed.length;
    let sGx = 0, sGx2 = 0, sCx = 0, sGxCx = 0;
    let sGy = 0, sGy2 = 0, sCy = 0, sGyCy = 0;
    for (const { gx, gy, cx, cy } of trimmed) {
      sGx += gx; sGx2 += gx * gx; sCx += cx; sGxCx += gx * cx;
      sGy += gy; sGy2 += gy * gy; sCy += cy; sGyCy += gy * cy;
    }
    const detX = np * sGx2 - sGx * sGx, detY = np * sGy2 - sGy * sGy;
    if (Math.abs(detX) < 1e-10 || Math.abs(detY) < 1e-10) break;
    sxB = Math.max(initSx * (1 - range), Math.min(initSx * (1 + range), (np * sGxCx - sGx * sCx) / detX));
    syB = Math.max(initSy * (1 - range), Math.min(initSy * (1 + range), (np * sGyCy - sGy * sCy) / detY));
    txB = (sCx - sxB * sGx) / np;
    tyB = (sCy - syB * sGy) / np;
    for (let iter = 0; iter < 5; iter++) {
      let sumDx = 0, sumDy = 0, count = 0;
      for (const [gx, gy] of gadmBoundary) {
        const px = gx * sxB + txB, py = gy * syB + tyB;
        const n = nearestCvBorder(px, py);
        if (n && n.dist < 15) { sumDx += n.pt[0] - px; sumDy += n.pt[1] - py; count++; }
      }
      if (count < 10) break;
      txB += sumDx / count; tyB += sumDy / count;
    }
  }
  const overflowB = computeMaxOverflow(gadmBoundary, cvBorderPixels, TW, TH, sxB, syB, txB, tyB);
  const errorB = computeMeanError(gadmBoundary, nearestCvBorder, sxB, syB, txB, tyB);

  // --- Option C: External + Internal borders, scale+translate ICP ---
  let sxC = initSx, syC = initSy;
  let txC = pCx - gCx * sxC, tyC = pCy - gCy * syC;
  for (let iter = 0; iter < 20; iter++) {
    let sumDx = 0, sumDy = 0, count = 0;
    for (const [gx, gy] of gadmBoundary) {
      const px = gx * sxC + txC, py = gy * syC + tyC;
      const n = nearestCvBorder(px, py);
      if (n && n.dist < 15) { sumDx += n.pt[0] - px; sumDy += n.pt[1] - py; count++; }
    }
    if (count < 10) break;
    txC += sumDx / count; tyC += sumDy / count;
  }
  for (let phase2 = 0; phase2 < 5; phase2++) {
    const corrsC: Array<{ gx: number; gy: number; cx: number; cy: number; dist: number; type: string }> = [];
    for (const [gx, gy] of gadmBoundary) {
      const px = gx * sxC + txC, py = gy * syC + tyC;
      const n = nearestCvBorder(px, py);
      if (n && n.dist < 15) corrsC.push({ gx, gy, cx: n.pt[0], cy: n.pt[1], dist: n.dist, type: 'ext' });
    }
    const gadmDivGrid: Array<Array<[number, number, number, number]>> = Array.from(
      { length: gridW * gridH }, () => [],
    );
    for (const [gx, gy] of allDivPoints) {
      const px = gx * sxC + txC, py = gy * syC + tyC;
      const gi = Math.floor(py / CELL) * gridW + Math.floor(px / CELL);
      if (gi >= 0 && gi < gadmDivGrid.length) gadmDivGrid[gi].push([gx, gy, px, py]);
    }
    for (const [ix, iy] of intBorderPixels) {
      const giX = Math.floor(ix / CELL), giY = Math.floor(iy / CELL);
      let bestDist = Infinity;
      let bestGadm: [number, number] | null = null;
      for (let dy = -4; dy <= 4; dy++) {
        for (let dx = -4; dx <= 4; dx++) {
          const nx = giX + dx, ny = giY + dy;
          if (nx < 0 || nx >= gridW || ny < 0 || ny >= gridH) continue;
          for (const [gx, gy, px, py] of gadmDivGrid[ny * gridW + nx]) {
            const d = (ix - px) ** 2 + (iy - py) ** 2;
            if (d < bestDist) { bestDist = d; bestGadm = [gx, gy]; }
          }
        }
      }
      if (bestGadm && Math.sqrt(bestDist) < 8) {
        corrsC.push({ gx: bestGadm[0], gy: bestGadm[1], cx: ix, cy: iy, dist: Math.sqrt(bestDist), type: 'int' });
      }
    }
    if (corrsC.length < 20) break;
    corrsC.sort((a, b) => a.dist - b.dist);
    const trimmedC = corrsC.slice(0, Math.floor(corrsC.length * 0.75));
    let wSum = 0, wsGx = 0, wsGx2 = 0, wsCx = 0, wsGxCx = 0;
    let wsGy = 0, wsGy2 = 0, wsCy = 0, wsGyCy = 0;
    for (const { gx, gy, cx, cy, type } of trimmedC) {
      const w = type === 'ext' ? 3 : 1;
      wSum += w; wsGx += w * gx; wsGx2 += w * gx * gx; wsCx += w * cx; wsGxCx += w * gx * cx;
      wsGy += w * gy; wsGy2 += w * gy * gy; wsCy += w * cy; wsGyCy += w * gy * cy;
    }
    const detXC = wSum * wsGx2 - wsGx * wsGx, detYC = wSum * wsGy2 - wsGy * wsGy;
    if (Math.abs(detXC) < 1e-10 || Math.abs(detYC) < 1e-10) break;
    sxC = Math.max(initSx * (1 - range), Math.min(initSx * (1 + range), (wSum * wsGxCx - wsGx * wsCx) / detXC));
    syC = Math.max(initSy * (1 - range), Math.min(initSy * (1 + range), (wSum * wsGyCy - wsGy * wsCy) / detYC));
    txC = (wsCx - sxC * wsGx) / wSum;
    tyC = (wsCy - syC * wsGy) / wSum;
    for (let iter = 0; iter < 5; iter++) {
      let sumDx = 0, sumDy = 0, count = 0;
      for (const [gx, gy] of gadmBoundary) {
        const px = gx * sxC + txC, py = gy * syC + tyC;
        const n = nearestCvBorder(px, py);
        if (n && n.dist < 15) { sumDx += n.pt[0] - px; sumDy += n.pt[1] - py; count++; }
      }
      if (count < 10) break;
      txC += sumDx / count; tyC += sumDy / count;
    }
  }
  const overflowC = computeMaxOverflow(gadmBoundary, cvBorderPixels, TW, TH, sxC, syC, txC, tyC);
  const errorC = computeMeanError(gadmBoundary, nearestCvBorder, sxC, syC, txC, tyC);

  // Pick best option
  const icpOptions = [
    { label: 'A', sx: sxA, sy: syA, tx: txA, ty: tyA, overflow: overflowA, error: errorA },
    { label: 'B', sx: sxB, sy: syB, tx: txB, ty: tyB, overflow: overflowB, error: errorB },
    { label: 'C', sx: sxC, sy: syC, tx: txC, ty: tyC, overflow: overflowC, error: errorC },
  ];
  icpOptions.sort((a, b) => {
    if (Math.abs(a.overflow - b.overflow) < 3) return a.error - b.error;
    return a.overflow - b.overflow;
  });
  const best = icpOptions[0];
  const icpSx = best.sx, icpSy = best.sy, icpTx = best.tx, icpTy = best.ty;
  const gadmToPixel = (gx: number, gy: number): [number, number] =>
    [gx * icpSx + icpTx, gy * icpSy + icpTy];

  // Debug image: ICP alignment bbox diagnostic
  {
    const bboxBuf = Buffer.alloc(tp * 3, 40);
    for (let i = 0; i < tp; i++) {
      if (icpMask[i]) { bboxBuf[i * 3] = 30; bboxBuf[i * 3 + 1] = 80; bboxBuf[i * 3 + 2] = 30; }
    }
    for (const [x, y] of cvBorderPixels) {
      const idx = (y * TW + x) * 3;
      bboxBuf[idx] = 0; bboxBuf[idx + 1] = 255; bboxBuf[idx + 2] = 255;
    }
    const drawHLine = (y: number, x0: number, x1: number, r: number, g: number, b: number) => {
      if (y < 0 || y >= TH) return;
      for (let x = Math.max(0, Math.floor(x0)); x <= Math.min(TW - 1, Math.ceil(x1)); x++) {
        const idx = (y * TW + x) * 3;
        bboxBuf[idx] = r; bboxBuf[idx + 1] = g; bboxBuf[idx + 2] = b;
      }
    };
    const drawVLine = (x: number, y0: number, y1: number, r: number, g: number, b: number) => {
      if (x < 0 || x >= TW) return;
      for (let y = Math.max(0, Math.floor(y0)); y <= Math.min(TH - 1, Math.ceil(y1)); y++) {
        const idx = (y * TW + x) * 3;
        bboxBuf[idx] = r; bboxBuf[idx + 1] = g; bboxBuf[idx + 2] = b;
      }
    };
    drawHLine(cBbox.minY, cBbox.minX, cBbox.maxX, 0, 200, 200);
    drawHLine(cBbox.maxY, cBbox.minX, cBbox.maxX, 0, 200, 200);
    drawVLine(cBbox.minX, cBbox.minY, cBbox.maxY, 0, 200, 200);
    drawVLine(cBbox.maxX, cBbox.minY, cBbox.maxY, 0, 200, 200);
    const gCorners = [
      gadmToPixel(gBbox.minX, gBbox.minY), gadmToPixel(gBbox.maxX, gBbox.minY),
      gadmToPixel(gBbox.maxX, gBbox.maxY), gadmToPixel(gBbox.minX, gBbox.maxY),
    ];
    drawHLine(Math.round(gCorners[0][1]), gCorners[0][0], gCorners[1][0], 255, 60, 60);
    drawHLine(Math.round(gCorners[2][1]), gCorners[3][0], gCorners[2][0], 255, 60, 60);
    drawVLine(Math.round(gCorners[0][0]), gCorners[0][1], gCorners[3][1], 255, 60, 60);
    drawVLine(Math.round(gCorners[1][0]), gCorners[1][1], gCorners[2][1], 255, 60, 60);
    for (const [gx, gy] of gadmBoundary) {
      const [px, py] = gadmToPixel(gx, gy);
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

  // Debug image: GADM divisions overlaid on quantized map
  const vizBuf = Buffer.from(quantBuf);
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
  for (const c of centroids) {
    const [px, py] = gadmToPixel(c.cx, -c.cy);
    const ix = Math.round(px), iy = Math.round(py);
    for (let dy = -3; dy <= 3; dy++) {
      for (let dx = -3; dx <= 3; dx++) {
        if (dx * dx + dy * dy > 9) continue;
        const x = ix + dx, y = iy + dy;
        if (x >= 0 && x < TW && y >= 0 && y < TH) {
          const idx = (y * TW + x) * 3;
          const isEdge = dx * dx + dy * dy >= 6;
          if (isEdge) { vizBuf[idx] = 0; vizBuf[idx + 1] = 0; vizBuf[idx + 2] = 0; }
          else if (c.assigned) { vizBuf[idx] = 76; vizBuf[idx + 1] = 175; vizBuf[idx + 2] = 80; }
          else { vizBuf[idx] = 255; vizBuf[idx + 1] = 152; vizBuf[idx + 2] = 0; }
        }
      }
    }
  }
  const compositePng = await sharp(vizBuf, { raw: { width: TW, height: TH, channels: 3 } })
    .resize(origW, origH, { kernel: 'lanczos3' })
    .png()
    .toBuffer();
  await pushDebugImage(
    `Step 3: GADM divisions overlaid on CV color regions (ICP ${best.label}, err=${best.error.toFixed(1)}, overflow=${best.overflow.toFixed(0)}px)`,
    `data:image/png;base64,${compositePng.toString('base64')}`,
  );
  const srcPng = await sharp(mapBuffer).png().toBuffer();
  await pushDebugImage(
    '__source_map__',
    `data:image/png;base64,${srcPng.toString('base64')}`,
  );

  return {
    gadmToPixel,
    bestLabel: best.label,
    bestError: best.error,
    bestOverflow: best.overflow,
    gBbox,
    cBbox,
  };
}
