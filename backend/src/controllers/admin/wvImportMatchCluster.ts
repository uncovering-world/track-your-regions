import type { PipelineContext } from './wvImportMatchPipeline.js';

/**
 * K-means color clustering phase.
 *
 * Converts colorBuf to CIELAB, runs K-means++ with chromatic normalization,
 * assigns labels via two-phase approach (color + BFS), then applies spatial mode filter.
 *
 * Sets on ctx: pixelLabels, colorCentroids (RGB), clusterCounts
 */
export async function runKMeansClustering(ctx: PipelineContext): Promise<void> {
  const {
    cv, TW, TH, tp,
    pxS,
    colorBuf, countryMask, countrySize, textExcluded,
    expectedRegionCount,
    logStep,
  } = ctx;
  const { ckOverride, chromaBoost, randomSeed } = ctx;

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
  let textExcludedCount = 0;
  for (let i = 0; i < tp; i++) {
    if (countryMask[i]) {
      if (textExcluded[i]) { textExcludedCount++; continue; }
      countryPixels.push([
        (labBuf[i * 3] - meanL) * wL,
        (labBuf[i * 3 + 1] - meanA) * wA,
        (labBuf[i * 3 + 2] - meanB) * wB,
      ]);
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

  // Write results to ctx
  ctx.pixelLabels = pixelLabels;
  ctx.colorCentroids = rgbCentroids;
  ctx.clusterCounts = clusterCounts;
}
