/**
 * Less-frequently-used cluster-cleaning passes.
 *
 * Extracted from `wvImportMatchClusterClean.ts` to keep the orchestrator small:
 *   - Divisive split: detect merged adjacent regions within a single cluster
 *   - Fragmented merge: fold heavily-fragmented small clusters into color-close
 *     larger neighbours
 *   - Noise exclusion: mark desaturated/tiny clusters as background and
 *     reassign their pixels to the nearest valid cluster
 */

// =============================================================================
// Divisive split: detect merged adjacent regions within a single cluster
// =============================================================================

// Thresholds — kept as named constants for easy tuning / reversal
const DIVISIVE_MIN_CLUSTER_PCT = 0.10;  // only consider clusters >10% of country
const DIVISIVE_MIN_COLOR_DIST = 12;     // min RGB distance between sub-clusters
const DIVISIVE_MIN_COHERENCE = 0.50;    // each sub-cluster's main CC must be >50%
const DIVISIVE_MIN_SHARPNESS = 0.25;    // boundary contrast / centroid distance
const DIVISIVE_MIN_VARIANCE = 50;       // per-pixel RGB variance within cluster

/**
 * Try to split large clusters that contain two visually distinct regions whose
 * colors were merged by mean-shift smoothing.
 *
 * Uses the ORIGINAL (pre-mean-shift) image colors to detect differences that
 * K-means couldn't see. Three guards prevent false splits:
 *  1. Spatial coherence — each sub-cluster must form a contiguous region
 *  2. Color distance — sub-cluster centroids must differ by ≥ DIVISIVE_MIN_COLOR_DIST
 *  3. Boundary sharpness — the ratio of per-pixel contrast at the split boundary
 *     to centroid distance must be ≥ DIVISIVE_MIN_SHARPNESS (rejects gradients)
 */
function computeCentroidSaturation(cc: [number, number, number] | null): number {
  if (!cc) return 255;
  const maxC = Math.max(cc[0], cc[1], cc[2]);
  const minC = Math.min(cc[0], cc[1], cc[2]);
  return maxC > 0 ? ((maxC - minC) / maxC) * 255 : 0;
}

/** Collect pixel indices belonging to a cluster label. */
function collectClusterPixels(pixelLabels: Uint8Array, label: number, tp: number): number[] {
  const clusterPixels: number[] = [];
  for (let i = 0; i < tp; i++) {
    if (pixelLabels[i] === label) clusterPixels.push(i);
  }
  return clusterPixels;
}

/**
 * Filter cluster pixels, excluding text/road outliers. Returns their original-buf colors.
 */
function filterClusterColors(
  clusterPixels: number[],
  origBuf: Buffer,
  buf: Buffer,
  cc: [number, number, number] | null,
): Array<[number, number, number]> {
  const OUTLIER_DIST_SQ = 60 * 60;
  const TEXT_RESIDUE_GAP = 20;
  const filtered: Array<[number, number, number]> = [];
  for (const i of clusterPixels) {
    const r = origBuf[i * 3], g = origBuf[i * 3 + 1], b = origBuf[i * 3 + 2];
    if (cc) {
      const dOrigSq = (r - cc[0]) ** 2 + (g - cc[1]) ** 2 + (b - cc[2]) ** 2;
      if (dOrigSq > OUTLIER_DIST_SQ) continue;
      const fr = buf[i * 3], fg = buf[i * 3 + 1], fb = buf[i * 3 + 2];
      const dBufSq = (fr - cc[0]) ** 2 + (fg - cc[1]) ** 2 + (fb - cc[2]) ** 2;
      if (Math.sqrt(dOrigSq) > Math.sqrt(dBufSq) + TEXT_RESIDUE_GAP) continue;
    }
    filtered.push([r, g, b]);
  }
  return filtered;
}

function computeColorVariance(colors: Array<[number, number, number]>): number {
  const mR = colors.reduce((s, c) => s + c[0], 0) / colors.length;
  const mG = colors.reduce((s, c) => s + c[1], 0) / colors.length;
  const mB = colors.reduce((s, c) => s + c[2], 0) / colors.length;
  return colors.reduce((s, c) => s + (c[0] - mR) ** 2 + (c[1] - mG) ** 2 + (c[2] - mB) ** 2, 0) / colors.length;
}

/** Seed K=2 by picking the most-distant pair among sampled colors. */
function seedFarthestPair(colors: Array<[number, number, number]>): { c0: number[]; c1: number[] } {
  const sampleCount = Math.min(colors.length, 100);
  const stride = Math.max(1, Math.floor(colors.length / sampleCount));
  const sampleIdx: number[] = [];
  for (let s = 0; s < colors.length && sampleIdx.length < sampleCount; s += stride) sampleIdx.push(s);

  let maxDist = 0, s0 = 0, s1 = Math.min(1, colors.length - 1);
  for (let a = 0; a < sampleIdx.length; a++) {
    for (let b = a + 1; b < sampleIdx.length; b++) {
      const ai = sampleIdx[a], bi = sampleIdx[b];
      const d = (colors[ai][0] - colors[bi][0]) ** 2 +
                (colors[ai][1] - colors[bi][1]) ** 2 +
                (colors[ai][2] - colors[bi][2]) ** 2;
      if (d > maxDist) { maxDist = d; s0 = ai; s1 = bi; }
    }
  }
  return { c0: [...colors[s0]], c1: [...colors[s1]] };
}

/** Run K=2 K-means on a color list. Returns the two centroid colors. */
function runK2KMeans(colors: Array<[number, number, number]>): { c0: number[]; c1: number[] } {
  let { c0, c1 } = seedFarthestPair(colors);
  const assign = new Uint8Array(colors.length);
  for (let iter = 0; iter < 20; iter++) {
    for (let i = 0; i < colors.length; i++) {
      const d0 = (colors[i][0] - c0[0]) ** 2 + (colors[i][1] - c0[1]) ** 2 + (colors[i][2] - c0[2]) ** 2;
      const d1 = (colors[i][0] - c1[0]) ** 2 + (colors[i][1] - c1[1]) ** 2 + (colors[i][2] - c1[2]) ** 2;
      assign[i] = d0 <= d1 ? 0 : 1;
    }
    const sums = [[0, 0, 0, 0], [0, 0, 0, 0]];
    for (let i = 0; i < colors.length; i++) {
      const k = assign[i];
      sums[k][0] += colors[i][0]; sums[k][1] += colors[i][1]; sums[k][2] += colors[i][2]; sums[k][3]++;
    }
    if (!sums[0][3] || !sums[1][3]) break;
    c0 = [sums[0][0] / sums[0][3], sums[0][1] / sums[0][3], sums[0][2] / sums[0][3]];
    c1 = [sums[1][0] / sums[1][3], sums[1][1] / sums[1][3], sums[1][2] / sums[1][3]];
  }
  return { c0, c1 };
}

/** Assign all cluster pixels to the nearest centroid. */
function assignPixelsToCentroids(
  clusterPixels: number[],
  buf: Buffer,
  c0: number[],
  c1: number[],
): { fullAssign: Uint8Array; pixAssign: Map<number, number>; sub0: number[]; sub1: number[] } {
  const fullAssign = new Uint8Array(clusterPixels.length);
  for (let idx = 0; idx < clusterPixels.length; idx++) {
    const i = clusterPixels[idx];
    const r = buf[i * 3], g = buf[i * 3 + 1], b = buf[i * 3 + 2];
    const d0 = (r - c0[0]) ** 2 + (g - c0[1]) ** 2 + (b - c0[2]) ** 2;
    const d1 = (r - c1[0]) ** 2 + (g - c1[1]) ** 2 + (b - c1[2]) ** 2;
    fullAssign[idx] = d0 <= d1 ? 0 : 1;
  }

  const pixAssign = new Map<number, number>();
  for (let idx = 0; idx < clusterPixels.length; idx++) pixAssign.set(clusterPixels[idx], fullAssign[idx]);
  const sub0 = clusterPixels.filter((_, i) => fullAssign[i] === 0);
  const sub1 = clusterPixels.filter((_, i) => fullAssign[i] === 1);
  return { fullAssign, pixAssign, sub0, sub1 };
}

/** BFS size of a single 4-connected component; mutates the visited set. */
function growCCSize(
  seed: number,
  pSet: Set<number>,
  visited: Set<number>,
  TW: number,
  TH: number,
): number {
  let sz = 0;
  const q = [seed];
  while (q.length > 0) {
    const cur = q.pop()!;
    if (visited.has(cur) || !pSet.has(cur)) continue;
    visited.add(cur); sz++;
    const cx = cur % TW, cy = Math.floor(cur / TW);
    if (cy > 0) q.push(cur - TW);
    if (cy < TH - 1) q.push(cur + TW);
    if (cx > 0) q.push(cur - 1);
    if (cx < TW - 1) q.push(cur + 1);
  }
  return sz;
}

/** Fraction of pixels that belong to the largest 4-connected component. */
function largestCCFraction(pixels: number[], TW: number, TH: number): number {
  const pSet = new Set(pixels);
  const visited = new Set<number>();
  let maxCC = 0;
  for (const p of pixels) {
    if (visited.has(p)) continue;
    const sz = growCCSize(p, pSet, visited, TW, TH);
    if (sz > maxCC) maxCC = sz;
  }
  return maxCC / pixels.length;
}

/** Accumulate contrast across the cross-boundary neighbours of a single pixel. */
function accumulatePixelBoundaryContrast(
  p: number,
  pixAssign: Map<number, number>,
  buf: Buffer,
  TW: number,
  TH: number,
): { sum: number; count: number } {
  const px = p % TW, py = Math.floor(p / TW);
  const neighbors = [
    py > 0 ? p - TW : -1,
    py < TH - 1 ? p + TW : -1,
    px > 0 ? p - 1 : -1,
    px < TW - 1 ? p + 1 : -1,
  ];
  let sum = 0, count = 0;
  for (const n of neighbors) {
    if (n < 0 || pixAssign.get(n) !== 1) continue;
    const dr = buf[p * 3] - buf[n * 3];
    const dg = buf[p * 3 + 1] - buf[n * 3 + 1];
    const db = buf[p * 3 + 2] - buf[n * 3 + 2];
    sum += Math.sqrt(dr * dr + dg * dg + db * db);
    count++;
  }
  return { sum, count };
}

/** Compute ratio of boundary contrast to centroid distance (sharpness ratio). */
function computeBoundarySharpness(
  sub0: number[],
  pixAssign: Map<number, number>,
  buf: Buffer,
  TW: number,
  TH: number,
  colorDist: number,
): number {
  let contrastSum = 0, bCount = 0;
  for (const p of sub0) {
    const { sum, count } = accumulatePixelBoundaryContrast(p, pixAssign, buf, TW, TH);
    contrastSum += sum;
    bCount += count;
  }
  return bCount > 0 && colorDist > 0 ? (contrastSum / bCount) / colorDist : 0;
}

/** Apply a validated split: relabel smaller sub-cluster + update centroids. */
function applyDivisiveSplit(
  label: number,
  newLabel: number,
  sub0: number[],
  sub1: number[],
  c0: number[],
  c1: number[],
  pixelLabels: Uint8Array,
  colorCentroids: Array<[number, number, number] | null>,
  count: number,
  countrySize: number,
  colorDist: number,
  sharpness: number,
): void {
  const smaller = sub0.length <= sub1.length ? sub0 : sub1;
  const larger = sub0.length > sub1.length ? sub0 : sub1;
  const smallerCentroid = sub0.length <= sub1.length ? c0 : c1;
  const largerCentroid = sub0.length > sub1.length ? c0 : c1;

  for (const p of smaller) pixelLabels[p] = newLabel;
  colorCentroids[label] = [Math.round(largerCentroid[0]), Math.round(largerCentroid[1]), Math.round(largerCentroid[2])];
  colorCentroids[newLabel] = [Math.round(smallerCentroid[0]), Math.round(smallerCentroid[1]), Math.round(smallerCentroid[2])];

  console.log(`  [Divisive] cluster ${label} (${(count / countrySize * 100).toFixed(1)}%): split → ` +
    `${larger.length}px RGB(${colorCentroids[label]}) + ${smaller.length}px RGB(${colorCentroids[newLabel]}) as cluster ${newLabel} ` +
    `(dist=${colorDist.toFixed(1)}, sharpness=${sharpness.toFixed(2)})`);
}

/** Try to split a single cluster. Returns true if a split was applied. */
function tryDivisiveSplitOne(
  label: number,
  count: number,
  pixelLabels: Uint8Array,
  colorCentroids: Array<[number, number, number] | null>,
  buf: Buffer,
  origBuf: Buffer,
  countrySize: number,
  TW: number,
  TH: number,
  tp: number,
  nextLabel: number,
): boolean {
  if (count / countrySize < DIVISIVE_MIN_CLUSTER_PCT) return false;

  const cc = colorCentroids[label];
  if (computeCentroidSaturation(cc) < 25) return false;

  const clusterPixels = collectClusterPixels(pixelLabels, label, tp);
  const filteredColors = filterClusterColors(clusterPixels, origBuf, buf, cc);
  if (filteredColors.length < count * 0.5) return false;

  const variance = computeColorVariance(filteredColors);
  if (variance < DIVISIVE_MIN_VARIANCE) return false;

  const { c0, c1 } = runK2KMeans(filteredColors);

  const colorDist = Math.sqrt((c0[0] - c1[0]) ** 2 + (c0[1] - c1[1]) ** 2 + (c0[2] - c1[2]) ** 2);
  if (colorDist < DIVISIVE_MIN_COLOR_DIST) return false;

  const { pixAssign, sub0, sub1 } = assignPixelsToCentroids(clusterPixels, buf, c0, c1);

  const coh0 = largestCCFraction(sub0, TW, TH), coh1 = largestCCFraction(sub1, TW, TH);
  if (coh0 < DIVISIVE_MIN_COHERENCE || coh1 < DIVISIVE_MIN_COHERENCE) return false;

  const sharpness = computeBoundarySharpness(sub0, pixAssign, buf, TW, TH, colorDist);
  if (sharpness < DIVISIVE_MIN_SHARPNESS) {
    console.log(`  [Divisive] cluster ${label} (${(count / countrySize * 100).toFixed(1)}%): var=${variance.toFixed(0)}, dist=${colorDist.toFixed(1)}, sharpness=${sharpness.toFixed(3)} — gradual boundary, skip`);
    return false;
  }

  applyDivisiveSplit(label, nextLabel, sub0, sub1, c0, c1, pixelLabels, colorCentroids, count, countrySize, colorDist, sharpness);
  return true;
}

export function divisiveSplitClusters(
  pixelLabels: Uint8Array,
  colorCentroids: Array<[number, number, number] | null>,
  buf: Buffer,
  origBuf: Buffer,
  countrySize: number,
  TW: number,
  TH: number,
): number {
  const tp = TW * TH;

  let maxLabel = 0;
  for (let i = 0; i < tp; i++) {
    if (pixelLabels[i] < 255 && pixelLabels[i] > maxLabel) maxLabel = pixelLabels[i];
  }
  let nextLabel = maxLabel + 1;

  const clusterCounts = new Map<number, number>();
  for (let i = 0; i < tp; i++) {
    if (pixelLabels[i] < 255) clusterCounts.set(pixelLabels[i], (clusterCounts.get(pixelLabels[i]) || 0) + 1);
  }

  let splitCount = 0;
  for (const [label, count] of clusterCounts) {
    if (tryDivisiveSplitOne(label, count, pixelLabels, colorCentroids, buf, origBuf, countrySize, TW, TH, tp, nextLabel)) {
      nextLabel++;
      splitCount++;
    }
  }

  return splitCount;
}

// =============================================================================
// Fragmented-residue merge
// =============================================================================

/** Build a 0/1 mask for a single cluster label and return the pixel area. */
function buildClusterMask(
  pixelLabels: Uint8Array,
  lbl: number,
  tp: number,
): { mask: Uint8Array; area: number } {
  const mask = new Uint8Array(tp);
  let area = 0;
  for (let i = 0; i < tp; i++) if (pixelLabels[i] === lbl) { mask[i] = 1; area++; }
  return { mask, area };
}

/** Erode a mask N times by requiring all 4-neighbours to be set. */
function erodeMask(
  mask: Uint8Array,
  iterations: number,
  TW: number,
  TH: number,
  tp: number,
): Uint8Array {
  let eroded = mask;
  for (let e = 0; e < iterations; e++) {
    const next = new Uint8Array(tp);
    for (let i = 0; i < tp; i++) {
      if (!eroded[i]) continue;
      const x = i % TW, y = (i - x) / TW;
      if (x > 0 && x < TW - 1 && y > 0 && y < TH - 1 &&
          eroded[i - 1] && eroded[i + 1] && eroded[i - TW] && eroded[i + TW]) {
        next[i] = 1;
      }
    }
    eroded = next;
  }
  return eroded;
}

/** Count connected components larger than `minCompSize` pixels. */
function countLargeCCs(
  mask: Uint8Array,
  TW: number,
  tp: number,
  minCompSize: number,
): number {
  const seen = new Uint8Array(tp);
  let parts = 0;
  for (let i = 0; i < tp; i++) {
    if (!mask[i] || seen[i]) continue;
    const queue = [i]; seen[i] = 1; let head = 0; let size = 0;
    while (head < queue.length) {
      const p = queue[head++]; size++;
      for (const n of [p - TW, p + TW, p - 1, p + 1]) {
        if (n >= 0 && n < tp && !seen[n] && mask[n]) {
          seen[n] = 1; queue.push(n);
        }
      }
    }
    if (size >= minCompSize) parts++;
  }
  return parts;
}

/** Compute area + erosion-based parts count for one cluster label. */
function computeClusterStats(
  pixelLabels: Uint8Array,
  lbl: number,
  tp: number,
  TW: number,
  TH: number,
): { area: number; parts: number } {
  const erosionIter = 2;
  const minCompSize = 20;

  const { mask, area } = buildClusterMask(pixelLabels, lbl, tp);
  let eroded = mask;
  if (area > 200) {
    eroded = erodeMask(mask, erosionIter, TW, TH, tp);
    let erodedCount = 0;
    for (let i = 0; i < tp; i++) if (eroded[i]) erodedCount++;
    if (erodedCount < Math.max(20, minCompSize / 4)) eroded = mask;
  }
  const parts = countLargeCCs(eroded, TW, tp, minCompSize);
  return { area, parts };
}

/** Find the best merge target (color-closest larger neighbour) for a given label. */
function findBestMergeTarget(
  lbl: number,
  area: number,
  cL: [number, number, number],
  stats: Map<number, { area: number; parts: number }>,
  colorCentroids: Array<[number, number, number] | null>,
  maxRgbDist: number,
): { bestTarget: number; bestDist: number } {
  let bestTarget = -1, bestDist = Infinity;
  for (const [other, { area: oa }] of stats) {
    if (other === lbl || oa <= area) continue;
    const cO = colorCentroids[other];
    if (!cO) continue;
    const d = Math.sqrt((cL[0] - cO[0]) ** 2 + (cL[1] - cO[1]) ** 2 + (cL[2] - cO[2]) ** 2);
    if (d > maxRgbDist) continue;
    if (d < bestDist) { bestDist = d; bestTarget = other; }
  }
  return { bestTarget, bestDist };
}

/** Relabel every pixel with label `from` → `to` in-place. */
function relabelCluster(pixelLabels: Uint8Array, from: number, to: number, tp: number): void {
  for (let i = 0; i < tp; i++) {
    if (pixelLabels[i] === from) pixelLabels[i] = to;
  }
}

/** Apply fragmentation-merge for each eligible cluster in `stats`. */
function applyFragMerges(
  stats: Map<number, { area: number; parts: number }>,
  pixelLabels: Uint8Array,
  colorCentroids: Array<[number, number, number] | null>,
  countrySize: number,
  tp: number,
  minFragRatio: number,
  minParts: number,
  maxAreaPct: number,
  maxRgbDist: number,
): void {
  for (const [lbl, { area, parts }] of stats) {
    const areaPct = (area / countrySize) * 100;
    if (areaPct > maxAreaPct * 100) continue;
    if (parts < minParts) continue;
    const fragRatio = parts / Math.max(areaPct, 0.1);
    if (fragRatio < minFragRatio) continue;
    const cL = colorCentroids[lbl];
    if (!cL) continue;

    const { bestTarget, bestDist } = findBestMergeTarget(lbl, area, cL, stats, colorCentroids, maxRgbDist);
    if (bestTarget >= 0) {
      console.log(`  [FragMerge-TS] cluster ${lbl} (${areaPct.toFixed(1)}%, ${parts} parts, frag=${fragRatio.toFixed(1)}) → ${bestTarget} (RGB dist=${bestDist.toFixed(1)})`);
      relabelCluster(pixelLabels, lbl, bestTarget, tp);
    }
  }
}

export function mergeFragmentedClusters(
  pixelLabels: Uint8Array,
  colorCentroids: Array<[number, number, number] | null>,
  countrySize: number,
  TW: number,
  TH: number,
  minFragRatio: number = 1.0,   // parts / area_pct
  minParts: number = 4,
  maxAreaPct: number = 0.10,
  maxRgbDist: number = 40,
): void {
  const tp = TW * TH;

  const stats = new Map<number, { area: number; parts: number }>();
  const labelsSeen = new Set<number>();
  for (let i = 0; i < tp; i++) if (pixelLabels[i] !== 255) labelsSeen.add(pixelLabels[i]);

  for (const lbl of labelsSeen) {
    stats.set(lbl, computeClusterStats(pixelLabels, lbl, tp, TW, TH));
  }

  console.log(`  [FragMerge-TS] Evaluating ${stats.size} clusters for fragmentation merge...`);
  for (const [lbl, { area, parts }] of stats) {
    const areaPct_dbg = (area / countrySize) * 100;
    console.log(`    cluster ${lbl}: area=${area} (${areaPct_dbg.toFixed(1)}%), parts=${parts}, fragRatio=${(parts / Math.max(areaPct_dbg, 0.1)).toFixed(2)}`);
  }
  applyFragMerges(stats, pixelLabels, colorCentroids, countrySize, tp, minFragRatio, minParts, maxAreaPct, maxRgbDist);
}

// =============================================================================
// Noise exclusion (color-outlier removal)
// =============================================================================

function classifyClusterNoise(
  colorCentroids: Array<[number, number, number] | null>,
  preCounts: Map<number, number>,
  countrySize: number,
): { noiseIds: number[]; validIds: number[] } {
  const NOISE_MIN_SAT = 25;
  const NOISE_MIN_VAL = 60;
  const NOISE_TINY_PCT = 0.5;
  const noiseIds: number[] = [];
  const validIds: number[] = [];
  for (const [lbl, cnt] of preCounts) {
    const c = colorCentroids[lbl];
    if (!c) { noiseIds.push(lbl); continue; }
    const pct = cnt / countrySize * 100;
    const maxC = Math.max(c[0], c[1], c[2]);
    const minC = Math.min(c[0], c[1], c[2]);
    const sat = maxC > 0 ? ((maxC - minC) / maxC) * 255 : 0;
    const val = maxC;
    const isColorful = sat >= NOISE_MIN_SAT && val >= NOISE_MIN_VAL;
    const tinyThreshold = isColorful ? 0.15 : NOISE_TINY_PCT;
    if (pct < tinyThreshold) { noiseIds.push(lbl); continue; }
    if ((sat < NOISE_MIN_SAT || val < NOISE_MIN_VAL) && pct < 15) {
      noiseIds.push(lbl); continue;
    }
    validIds.push(lbl);
  }
  return { noiseIds, validIds };
}

function reassignNoisePixels(
  pixelLabels: Uint8Array,
  colorCentroids: Array<[number, number, number] | null>,
  buf: Buffer,
  noiseIds: number[],
  validIds: number[],
  tp: number,
): number {
  let reassigned = 0;
  const noiseSet = new Set(noiseIds);
  for (let i = 0; i < tp; i++) {
    if (!noiseSet.has(pixelLabels[i])) continue;
    let bestDist = Infinity, bestLbl = pixelLabels[i];
    const r = buf[i * 3], g = buf[i * 3 + 1], b = buf[i * 3 + 2];
    for (const vl of validIds) {
      const vc = colorCentroids[vl];
      if (!vc) continue;
      const d = (r - vc[0]) ** 2 + (g - vc[1]) ** 2 + (b - vc[2]) ** 2;
      if (d < bestDist) { bestDist = d; bestLbl = vl; }
    }
    pixelLabels[i] = bestLbl;
    reassigned++;
  }
  return reassigned;
}

export function excludeNoiseClusters(
  pixelLabels: Uint8Array,
  colorCentroids: Array<[number, number, number] | null>,
  buf: Buffer,
  countrySize: number,
  tp: number,
): void {
  const preCounts = new Map<number, number>();
  for (let i = 0; i < tp; i++) {
    if (pixelLabels[i] < 255) preCounts.set(pixelLabels[i], (preCounts.get(pixelLabels[i]) || 0) + 1);
  }
  const { noiseIds, validIds } = classifyClusterNoise(colorCentroids, preCounts, countrySize);
  if (noiseIds.length === 0 || validIds.length < 3) return;

  const reassigned = reassignNoisePixels(pixelLabels, colorCentroids, buf, noiseIds, validIds, tp);
  console.log(`  [Noise] Auto-excluded ${noiseIds.length} noise cluster(s) (${reassigned} px reassigned to nearest valid cluster)`);
  for (const nl of noiseIds) {
    const c = colorCentroids[nl];
    const cnt = preCounts.get(nl) || 0;
    console.log(`    excluded ${nl}: RGB(${c?.[0]},${c?.[1]},${c?.[2]}) ${cnt}px (${(cnt / countrySize * 100).toFixed(1)}%)`);
  }
}
