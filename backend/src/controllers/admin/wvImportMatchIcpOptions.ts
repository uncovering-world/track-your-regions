/**
 * The four alignments the ICP tries.
 *
 * A — translation only, the scale kept as it is; B — translation with a
 * gentle scale correction; C — the same weighted by internal borders, where
 * two clusters meet, as well as the silhouette's outer edge; D — a grid
 * search that asks instead which scale and offset land the divisions'
 * centroids on the largest clusters. Each returns a transform;
 * `wvImportMatchIcp.ts` scores them by overflow and mean error and keeps the
 * best.
 *
 * Split out of `wvImportMatchIcp.ts`, which had reached the length the lint
 * draws the line at (#933).
 */

// =============================================================================
// ICP iteration helpers
// =============================================================================

export interface Transform { sx: number; sy: number; tx: number; ty: number }

export type NearestFn = (px: number, py: number) => { pt: [number, number]; dist: number } | null;

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
export function runOptionA(
  gadmBoundary: Array<[number, number]>,
  nearestCvBorder: NearestFn,
  init: Transform,
): Transform {
  return runTranslationIcp(gadmBoundary, nearestCvBorder, init, 20);
}

/** Option B: Translation + gentle scale correction ICP (3 phase-2 passes). */
export function runOptionB(
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
export function runOptionC(
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
export function runOptionD(
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
