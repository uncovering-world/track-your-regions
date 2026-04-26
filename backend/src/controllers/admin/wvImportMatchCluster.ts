import type { PipelineContext } from './wvImportMatchContext.js';

// OpenCV.js has no TypeScript types — mirror the no-type pattern used in wvImportMatchPipeline.
type Cv = PipelineContext['cv'];

type Lab = [number, number, number];

interface LabStats {
  meanL: number; meanA: number; meanB: number;
  wL: number; wA: number; wB: number;
}

/** Convert an 8-bit RGB buffer to a raw CIELAB buffer via OpenCV. */
function convertRgbToLabBuffer(cv: Cv, colorBuf: Buffer, TW: number, TH: number): Buffer {
  const cvBufForLab = new cv.Mat(TH, TW, cv.CV_8UC3);
  cvBufForLab.data.set(colorBuf);
  const cvLabMat = new cv.Mat();
  cv.cvtColor(cvBufForLab, cvLabMat, cv.COLOR_RGB2Lab);
  const labBuf = Buffer.from(cvLabMat.data);
  cvBufForLab.delete(); cvLabMat.delete();
  return labBuf;
}

/** Per-channel mean/std of country pixels + chromatic boost weights. Throws if country is empty. */
function computeLabStats(
  labBuf: Buffer,
  countryMask: Uint8Array,
  tp: number,
  chromaBoost: number,
): LabStats {
  let sumL = 0, sumA = 0, sumB = 0, sumL2 = 0, sumA2 = 0, sumB2 = 0;
  let statCount = 0;
  for (let i = 0; i < tp; i++) {
    if (!countryMask[i]) continue;
    const L = labBuf[i * 3], a = labBuf[i * 3 + 1], b = labBuf[i * 3 + 2];
    sumL += L; sumA += a; sumB += b;
    sumL2 += L * L; sumA2 += a * a; sumB2 += b * b;
    statCount++;
  }
  if (statCount === 0) throw new Error('No country pixels remaining — cannot cluster');
  const meanL = sumL / statCount, meanA = sumA / statCount, meanB = sumB / statCount;
  const rawStdL = Math.sqrt(Math.max(0, sumL2 / statCount - meanL * meanL));
  const rawStdA = Math.sqrt(Math.max(0, sumA2 / statCount - meanA * meanA));
  const rawStdB = Math.sqrt(Math.max(0, sumB2 / statCount - meanB * meanB));
  const stdL = rawStdL < 0.01 ? 1.0 : rawStdL;
  const stdA = rawStdA < 0.01 ? 1.0 : rawStdA;
  const stdB = rawStdB < 0.01 ? 1.0 : rawStdB;
  const wL = 0.5 / stdL, wA = chromaBoost / stdA, wB = chromaBoost / stdB;
  console.log(`  [Lab] mean=(${meanL.toFixed(1)},${meanA.toFixed(1)},${meanB.toFixed(1)}) std=(${stdL.toFixed(1)},${stdA.toFixed(1)},${stdB.toFixed(1)})`);
  return { meanL, meanA, meanB, wL, wA, wB };
}

/** Read a single normalized Lab triple at linear pixel index `i`. */
function readNormalizedLab(labBuf: Buffer, i: number, s: LabStats): Lab {
  return [
    (labBuf[i * 3] - s.meanL) * s.wL,
    (labBuf[i * 3 + 1] - s.meanA) * s.wA,
    (labBuf[i * 3 + 2] - s.meanB) * s.wB,
  ];
}

/** Collect normalized-Lab triples of all country pixels (for K-means sampling). */
function collectCountryLabPixels(
  labBuf: Buffer, countryMask: Uint8Array, tp: number, s: LabStats,
): Lab[] {
  const out: Lab[] = [];
  for (let i = 0; i < tp; i++) {
    if (countryMask[i]) out.push(readNormalizedLab(labBuf, i, s));
  }
  return out;
}

/** Nearest-centroid index for a single normalized-Lab pixel. */
function nearestCentroidIdx(px: Lab, centroids: Lab[]): number {
  let bestDist = Infinity, bestK = 0;
  for (let k = 0; k < centroids.length; k++) {
    const d = (px[0] - centroids[k][0]) ** 2 + (px[1] - centroids[k][1]) ** 2 + (px[2] - centroids[k][2]) ** 2;
    if (d < bestDist) { bestDist = d; bestK = k; }
  }
  return bestK;
}

/** Compute squared-distance to the nearest centroid for every country pixel. Returns (d2, totalD2). */
function computeNearestCentroidDistances(
  countryPixels: Lab[], centroids: Lab[],
): { d2: Float64Array; totalD2: number } {
  const d2 = new Float64Array(countryPixels.length);
  let totalD2 = 0;
  for (let i = 0; i < countryPixels.length; i++) {
    let minDist = Infinity;
    for (const ct of centroids) {
      const d = (countryPixels[i][0] - ct[0]) ** 2 + (countryPixels[i][1] - ct[1]) ** 2 + (countryPixels[i][2] - ct[2]) ** 2;
      if (d < minDist) minDist = d;
    }
    d2[i] = minDist;
    totalD2 += minDist;
  }
  return { d2, totalD2 };
}

/** Distance-weighted sampling of a pixel index using (d2, totalD2). */
function sampleWeightedIndex(d2: Float64Array, totalD2: number): number {
  // Math.random() is intentional here: K-means++ statistical sampling is not security-sensitive.
  let target = Math.random() * totalD2;
  for (let i = 0; i < d2.length; i++) {
    target -= d2[i];
    if (target <= 0) return i;
  }
  return 0;
}

/** True if `p` is within ~2 units of any existing centroid (squared distance < 4). */
function isTooCloseToExistingCentroid(p: Lab, centroids: Lab[]): boolean {
  for (const ct of centroids) {
    if ((p[0] - ct[0]) ** 2 + (p[1] - ct[1]) ** 2 + (p[2] - ct[2]) ** 2 < 4) return true;
  }
  return false;
}

/** Pick the next K-means++ centroid, retrying if the chosen point is too close to existing centers. */
function pickNextPlusPlusCentroid(countryPixels: Lab[], centroids: Lab[]): Lab {
  const { d2, totalD2 } = computeNearestCentroidDistances(countryPixels, centroids);
  let chosen = sampleWeightedIndex(d2, totalD2);
  for (let retries = 0; retries < 5; retries++) {
    if (!isTooCloseToExistingCentroid(countryPixels[chosen], centroids)) break;
    // Math.random() is intentional here: K-means++ centroid retry is not security-sensitive.
    chosen = Math.floor(Math.random() * countryPixels.length);
  }
  return [...countryPixels[chosen]];
}

/** K-means++ centroid initialization (normalized-Lab). */
function kmeansPlusPlusInit(countryPixels: Lab[], CK: number, randomSeed: boolean): Lab[] {
  const firstIdx = randomSeed
    // Math.random() is intentional here: K-means++ initial centroid is not security-sensitive.
    ? Math.floor(Math.random() * countryPixels.length)
    : Math.floor(countryPixels.length / 2);
  const centroids: Lab[] = [countryPixels[firstIdx]];
  for (let c = 1; c < CK; c++) {
    centroids.push(pickNextPlusPlusCentroid(countryPixels, centroids));
  }
  return centroids;
}

/** EM iterations for K-means (up to MAX_ITER, early exit on low movement). Mutates centroids. */
function runKmeansIterations(countryPixels: Lab[], centroids: Lab[]): void {
  const MAX_ITER = 40;
  const CK = centroids.length;
  for (let iter = 0; iter < MAX_ITER; iter++) {
    const sums = centroids.map(() => [0, 0, 0, 0]);
    for (const px of countryPixels) {
      const bestK = nearestCentroidIdx(px, centroids);
      sums[bestK][0] += px[0]; sums[bestK][1] += px[1]; sums[bestK][2] += px[2]; sums[bestK][3]++;
    }
    let totalMovement = 0;
    for (let k = 0; k < CK; k++) {
      if (sums[k][3] > 0) {
        const newC: Lab = [
          sums[k][0] / sums[k][3],
          sums[k][1] / sums[k][3],
          sums[k][2] / sums[k][3],
        ];
        totalMovement += Math.abs(newC[0] - centroids[k][0])
          + Math.abs(newC[1] - centroids[k][1])
          + Math.abs(newC[2] - centroids[k][2]);
        centroids[k] = newC;
      }
    }
    if (totalMovement < 1.0) {
      console.log(`  [K-means] Converged at iteration ${iter + 1}`);
      return;
    }
  }
}

/** Convert a normalized-Lab centroid back to an RGB triple for debug/shared pipeline output. */
function centroidNormalizedLabToRgb(c: Lab, s: LabStats, cv: Cv): [number, number, number] {
  const oL = Math.round(Math.min(255, Math.max(0, c[0] / s.wL + s.meanL)));
  const oA = Math.round(Math.min(255, Math.max(0, c[1] / s.wA + s.meanA)));
  const oB = Math.round(Math.min(255, Math.max(0, c[2] / s.wB + s.meanB)));
  const labPx = new cv.Mat(1, 1, cv.CV_8UC3);
  labPx.data[0] = oL; labPx.data[1] = oA; labPx.data[2] = oB;
  const rgbPx = new cv.Mat();
  cv.cvtColor(labPx, rgbPx, cv.COLOR_Lab2RGB);
  const rgb: [number, number, number] = [rgbPx.data[0], rgbPx.data[1], rgbPx.data[2]];
  labPx.delete(); rgbPx.delete();
  return rgb;
}

/** Assign each country pixel to its nearest centroid, returning labels + per-cluster counts. */
function assignPixelLabels(
  labBuf: Buffer, countryMask: Uint8Array, tp: number,
  centroids: Lab[], s: LabStats,
): { pixelLabels: Uint8Array; clusterCounts: number[] } {
  const CK = centroids.length;
  const pixelLabels = new Uint8Array(tp).fill(255);
  const clusterCounts = new Array(CK).fill(0);
  for (let i = 0; i < tp; i++) {
    if (!countryMask[i]) continue;
    const px = readNormalizedLab(labBuf, i, s);
    const bestK = nearestCentroidIdx(px, centroids);
    pixelLabels[i] = bestK;
    clusterCounts[bestK]++;
  }
  return { pixelLabels, clusterCounts };
}

/** Majority label + count in the square MODE_R neighborhood around (ix, iy). */
function neighborhoodMajority(
  pixelLabels: Uint8Array, ix: number, iy: number, MODE_R: number,
  TW: number, TH: number,
): { label: number; count: number } {
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
  let bestLabel = 255, bestCount = 0;
  for (const [lbl, cnt] of votes) {
    if (cnt > bestCount) { bestCount = cnt; bestLabel = lbl; }
  }
  return { label: bestLabel, count: bestCount };
}

/** Squared Euclidean distance between a normalized-Lab point and a centroid. */
function labDist2(p: Lab, c: Lab): number {
  return (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2 + (p[2] - c[2]) ** 2;
}

/**
 * Decide whether pixel `i`'s label should be replaced by its neighborhood majority.
 * Returns the replacement label, or -1 to leave unchanged.
 */
function modeFilterReplacementLabel(
  i: number, labBuf: Buffer,
  pixelLabels: Uint8Array,
  countryMask: Uint8Array, centroids: Lab[], s: LabStats,
  TW: number, TH: number, MODE_R: number,
): number {
  if (!countryMask[i] || pixelLabels[i] === 255) return -1;
  const ix = i % TW, iy = Math.floor(i / TW);
  const myLabel = pixelLabels[i];
  const { label: bestLabel } = neighborhoodMajority(pixelLabels, ix, iy, MODE_R, TW, TH);
  if (bestLabel === myLabel || bestLabel === 255) return -1;
  // Guard: only relabel if pixel's color is close enough to majority centroid
  const nLab = readNormalizedLab(labBuf, i, s);
  const distOwn = labDist2(nLab, centroids[myLabel]);
  const distMaj = labDist2(nLab, centroids[bestLabel]);
  return distMaj < distOwn * 2.0 ? bestLabel : -1;
}

/** Write `newLabels` back into `pixelLabels` and recompute per-cluster counts. */
function applyModeFilterLabels(
  pixelLabels: Uint8Array, newLabels: Uint8Array,
  countryMask: Uint8Array, clusterCounts: number[], tp: number,
): void {
  for (let i = 0; i < tp; i++) pixelLabels[i] = newLabels[i];
  clusterCounts.fill(0);
  for (let i = 0; i < tp; i++) {
    if (countryMask[i] && pixelLabels[i] < 255) clusterCounts[pixelLabels[i]]++;
  }
}

/**
 * Apply spatial mode filter: relabel a pixel to its neighborhood majority when the pixel's color
 * is reasonably close to the majority centroid. Returns the number of pixels relabeled.
 */
function applyModeFilter(
  labBuf: Buffer,
  pixelLabels: Uint8Array, clusterCounts: number[],
  countryMask: Uint8Array, centroids: Lab[], s: LabStats,
  TW: number, TH: number, tp: number, MODE_R: number,
): number {
  let modeRelabeled = 0;
  const newLabels = new Uint8Array(pixelLabels); // copy — don't modify during iteration
  for (let i = 0; i < tp; i++) {
    const replacement = modeFilterReplacementLabel(
      i, labBuf, pixelLabels, countryMask, centroids, s, TW, TH, MODE_R,
    );
    if (replacement >= 0) {
      newLabels[i] = replacement;
      modeRelabeled++;
    }
  }
  if (modeRelabeled > 0) {
    applyModeFilterLabels(pixelLabels, newLabels, countryMask, clusterCounts, tp);
    console.log(`  [Mode filter] Relabeled ${modeRelabeled} noisy pixels to neighborhood majority`);
  }
  return modeRelabeled;
}

/** Print per-cluster RGB and pixel-share summary. */
function logClusterSummary(
  clusterCounts: number[], rgbCentroids: Array<[number, number, number]>,
  CK: number, countrySize: number,
): void {
  console.log(`  [K-means] ${CK} clusters, countrySize=${countrySize}:`);
  for (let k = 0; k < CK; k++) {
    if (clusterCounts[k] === 0) continue;
    const pct = (clusterCounts[k] / countrySize * 100).toFixed(1);
    const c = rgbCentroids[k];
    console.log(`    cluster ${k}: RGB(${c[0]},${c[1]},${c[2]}) ${clusterCounts[k]}px (${pct}%)`);
  }
}

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
    colorBuf, countryMask, countrySize,
    expectedRegionCount,
    logStep,
  } = ctx;
  const { ckOverride, chromaBoost, randomSeed } = ctx;

  await logStep('K-means color clustering...');

  // Convert clean color buffer to CIELAB for perceptually-accurate K-means
  const labBuf = convertRgbToLabBuffer(cv, colorBuf, TW, TH);

  // Per-channel stats for z-score normalization (amplifies chromatic differences)
  const stats = computeLabStats(labBuf, countryMask, tp, chromaBoost);

  // K-means: use ~3x expected region count for enough color resolution
  // to separate similar-but-distinct regions. The merge step consolidates
  // truly redundant clusters afterward. Cap at 32, floor at 8.
  const CK = ckOverride ?? Math.max(8, Math.min(expectedRegionCount * 3, 32));
  console.log(`  [K-means] CK=${CK} (expectedRegions=${expectedRegionCount})`);

  const countryPixels = collectCountryLabPixels(labBuf, countryMask, tp, stats);

  // K-means++ initialization then EM iterations
  const colorCentroids = kmeansPlusPlusInit(countryPixels, CK, randomSeed);
  runKmeansIterations(countryPixels, colorCentroids);

  // Convert centroids: normalized Lab → original Lab → RGB (for debug viz + shared pipeline)
  const rgbCentroids: Array<[number, number, number]> = colorCentroids.map(
    c => centroidNormalizedLabToRgb(c, stats, cv),
  );

  // Assign labels to country pixels by nearest centroid
  const { pixelLabels, clusterCounts } = assignPixelLabels(labBuf, countryMask, tp, colorCentroids, stats);

  // Spatial mode filter: clean up salt-and-pepper noise from BFS seams and line residue.
  // For each pixel, if the majority of its neighborhood has a different label AND the
  // pixel's color is reasonably close to the majority's centroid, relabel it.
  const MODE_R = pxS(5); // radius in pixels (8 at TW=800)
  applyModeFilter(labBuf, pixelLabels, clusterCounts, countryMask, colorCentroids, stats, TW, TH, tp, MODE_R);

  // Log K-means results before processing
  logClusterSummary(clusterCounts, rgbCentroids, CK, countrySize);

  // Write results to ctx
  ctx.pixelLabels = pixelLabels;
  ctx.colorCentroids = rgbCentroids;
  ctx.clusterCounts = clusterCounts;
}
