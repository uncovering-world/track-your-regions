/**
 * Cluster cleaning phase for division matching.
 *
 * Orchestrates the sub-passes that run between k-means and the interactive review:
 *   1. Spatial split: break large clusters into spatially disconnected regions
 *   2. Tiny-cluster merge into nearest large neighbor (color-close merge)
 *   3. Small isolated-patch cleanup (circular-edge removal)
 *   4. Noise exclusion (color-outlier removal) — see `wvImportMatchClusterPasses.ts`
 *   5. Divisive split (merged adjacent regions) — see `wvImportMatchClusterPasses.ts`
 *   6. Fragmented-residue merge — see `wvImportMatchClusterPasses.ts`
 *   7. Quantized map + border overlay rendering
 *   8. ICP-mask construction (tiny-noise CC removal)
 */

import sharp from 'sharp';
import { traceBorderPaths, type BorderPath } from './wvImportMatchBorderTrace.js';
import {
  divisiveSplitClusters,
  mergeFragmentedClusters,
  excludeNoiseClusters,
} from './wvImportMatchClusterPasses.js';

// =============================================================================
// Types
// =============================================================================

export interface CleanParams {
  /** Pixel labels from clustering (mutated in place) */
  pixelLabels: Uint8Array;
  /** Color centroids per cluster (mutated: new entries added for split CCs) */
  colorCentroids: Array<[number, number, number] | null>;
  /** Mean-shifted image buffer */
  buf: Buffer;
  /** Original (pre-mean-shift) image buffer — used for divisive split with outlier filtering */
  origBuf?: Buffer;
  /** Country pixel mask */
  countryMask: Uint8Array;
  /** Country pixel count */
  countrySize: number;
  /** Image dimensions */
  TW: number; TH: number;
  /** Original image dimensions (for upscaling debug images) */
  origW: number; origH: number;
  /** Calibrated pixel scale function */
  pxS: (base: number) => number;
  /** Debug image callback */
  pushDebugImage: (label: string, dataUrl: string) => Promise<void>;
}

export interface CleanResult {
  /** Set of labels still active after cleaning */
  finalLabels: Set<number>;
  /** Per-cluster pixel counts */
  finalClusters: Map<number, number>;
  /** Quantized color buffer for debug images */
  quantBuf: Buffer;
  /** ICP mask (active cluster pixels, noise-cleaned) */
  icpMask: Uint8Array;
  /** Vector border paths traced from pixel labels */
  borderPaths: BorderPath[];
}

// =============================================================================
// Spatial split: break a large cluster into spatially disconnected regions
// =============================================================================

function findConnectedComponents(
  pixelLabels: Uint8Array,
  label: number,
  TW: number,
  tp: number,
): number[][] {
  const ccVisited = new Uint8Array(tp);
  const ccs: number[][] = [];
  for (let i = 0; i < tp; i++) {
    if (pixelLabels[i] !== label || ccVisited[i]) continue;
    const cc: number[] = [];
    const q = [i]; ccVisited[i] = 1; let h = 0;
    while (h < q.length) {
      const p = q[h++]; cc.push(p);
      for (const n of [p - TW, p + TW, p - 1, p + 1]) {
        if (n >= 0 && n < tp && !ccVisited[n] && pixelLabels[n] === label) { ccVisited[n] = 1; q.push(n); }
      }
    }
    ccs.push(cc);
  }
  return ccs;
}

function computeCCColors(
  largeCCs: number[][],
  buf: Buffer,
): Array<[number, number, number]> {
  return largeCCs.map(cc => {
    let rr = 0, gg = 0, bb = 0;
    for (const p of cc) { rr += buf[p * 3]; gg += buf[p * 3 + 1]; bb += buf[p * 3 + 2]; }
    return [Math.round(rr / cc.length), Math.round(gg / cc.length), Math.round(bb / cc.length)];
  });
}

function ccsDifferInColor(
  ccColors: Array<[number, number, number]>,
  threshold: number,
): boolean {
  for (let a = 0; a < ccColors.length; a++) {
    for (let b = a + 1; b < ccColors.length; b++) {
      const d = Math.sqrt(
        (ccColors[a][0] - ccColors[b][0]) ** 2 +
        (ccColors[a][1] - ccColors[b][1]) ** 2 +
        (ccColors[a][2] - ccColors[b][2]) ** 2,
      );
      if (d >= threshold) return true;
    }
  }
  return false;
}

function applySpatialSplit(
  k: number,
  largeCCs: number[][],
  ccColors: Array<[number, number, number]>,
  clusterCount: number,
  countrySize: number,
  pixelLabels: Uint8Array,
  colorCentroids: Array<[number, number, number] | null>,
  nextLabel: number,
): number {
  console.log(`  [Spatial] cluster ${k} (${(clusterCount / countrySize * 100).toFixed(1)}%): splitting ${largeCCs.length} CCs:`);
  console.log(`    CC 0: ${largeCCs[0].length}px RGB(${ccColors[0]}) → stays cluster ${k}`);
  colorCentroids[k] = ccColors[0];
  for (let ci = 1; ci < largeCCs.length; ci++) {
    const newLbl = nextLabel++;
    colorCentroids[newLbl] = ccColors[ci];
    console.log(`    CC ${ci}: ${largeCCs[ci].length}px RGB(${ccColors[ci]}) → new cluster ${newLbl}`);
    for (const p of largeCCs[ci]) pixelLabels[p] = newLbl;
  }
  return nextLabel;
}

function performSpatialSplit(
  pixelLabels: Uint8Array,
  colorCentroids: Array<[number, number, number] | null>,
  buf: Buffer,
  countrySize: number,
  pxS: (base: number) => number,
  TW: number,
  tp: number,
  CK: number,
): number {
  const SPATIAL_SPLIT_MIN_CLUSTER_PCT = 0.15;
  const SPATIAL_SPLIT_MIN_CC_PCT = 0.03;
  const SPATIAL_SPLIT_COLOR_DIST = 8;

  let nextLabel = CK;
  for (let k = 0; k < CK; k++) {
    let clusterCount = 0;
    for (let i = 0; i < tp; i++) { if (pixelLabels[i] === k) clusterCount++; }
    if (clusterCount / countrySize < SPATIAL_SPLIT_MIN_CLUSTER_PCT) continue;

    const ccs = findConnectedComponents(pixelLabels, k, TW, tp);
    ccs.sort((a, b) => b.length - a.length);
    const minCCSize = Math.max(pxS(500), Math.round(countrySize * SPATIAL_SPLIT_MIN_CC_PCT));
    const largeCCs = ccs.filter(cc => cc.length >= minCCSize);
    if (largeCCs.length < 2) continue;

    const ccColors = computeCCColors(largeCCs, buf);
    if (!ccsDifferInColor(ccColors, SPATIAL_SPLIT_COLOR_DIST)) {
      console.log(`  [Spatial] cluster ${k} (${(clusterCount / countrySize * 100).toFixed(1)}%): ${largeCCs.length} large CCs but colors too similar — no split`);
      continue;
    }

    nextLabel = applySpatialSplit(k, largeCCs, ccColors, clusterCount, countrySize, pixelLabels, colorCentroids, nextLabel);
  }
  return nextLabel;
}

async function pushPreMergeDebugImage(
  pixelLabels: Uint8Array,
  colorCentroids: Array<[number, number, number] | null>,
  TW: number,
  TH: number,
  origW: number,
  origH: number,
  tp: number,
  pushDebugImage: (label: string, dataUrl: string) => Promise<void>,
): Promise<void> {
  const preMergeBuf = Buffer.alloc(tp * 3);
  for (let i = 0; i < tp; i++) {
    if (pixelLabels[i] === 255) {
      preMergeBuf[i * 3] = 220; preMergeBuf[i * 3 + 1] = 220; preMergeBuf[i * 3 + 2] = 220;
    } else {
      const c = colorCentroids[pixelLabels[i]];
      if (c) { preMergeBuf[i * 3] = c[0]; preMergeBuf[i * 3 + 1] = c[1]; preMergeBuf[i * 3 + 2] = c[2]; }
    }
  }
  const preMergePng = await sharp(preMergeBuf, {
    raw: { width: TW, height: TH, channels: 3 },
  }).resize(origW, origH, { kernel: 'lanczos3' }).png().toBuffer();
  await pushDebugImage(
    `K-means + spatial split (before merge/cleanup)`,
    `data:image/png;base64,${preMergePng.toString('base64')}`,
  );
}

// =============================================================================
// Tiny-cluster merge into nearest large neighbor
// =============================================================================

/** Find the closest large-cluster neighbour by color centroid distance. */
function findClosestLargeCluster(
  k: number,
  allLabels: number[],
  postSplitCounts: Map<number, number>,
  colorCentroids: Array<[number, number, number] | null>,
  countrySize: number,
  mergeSizePct: number,
): { minDist: number; minK: number } {
  let minDist = Infinity, minK = k;
  for (const j of allLabels) {
    if (j === k) continue;
    const jCnt = postSplitCounts.get(j)!;
    if (jCnt / countrySize < mergeSizePct) continue;
    const ck = colorCentroids[k], cj = colorCentroids[j];
    if (!ck || !cj) continue;
    const d = (ck[0] - cj[0]) ** 2 + (ck[1] - cj[1]) ** 2 + (ck[2] - cj[2]) ** 2;
    if (d < minDist) { minDist = d; minK = j; }
  }
  return { minDist, minK };
}

/** Merge one tiny cluster into its nearest large cluster if within RGB threshold. */
function mergeOneTinyCluster(
  k: number,
  cnt: number,
  pixelLabels: Uint8Array,
  colorCentroids: Array<[number, number, number] | null>,
  postSplitCounts: Map<number, number>,
  allLabels: number[],
  countrySize: number,
  tp: number,
  mergeSizePct: number,
  mergeMaxDistSq: number,
): void {
  const { minDist, minK } = findClosestLargeCluster(k, allLabels, postSplitCounts, colorCentroids, countrySize, mergeSizePct);
  const rgbDist = Math.sqrt(minDist);
  if (minDist <= mergeMaxDistSq && minK !== k) {
    console.log(`  [Merge] cluster ${k} (${(cnt / countrySize * 100).toFixed(1)}%) → ${minK} (RGB dist=${rgbDist.toFixed(1)})`);
    for (let i = 0; i < tp; i++) { if (pixelLabels[i] === k) pixelLabels[i] = minK; }
    postSplitCounts.set(minK, postSplitCounts.get(minK)! + cnt);
    postSplitCounts.delete(k);
  } else if (minK !== k) {
    console.log(`  [Merge] cluster ${k} (${(cnt / countrySize * 100).toFixed(1)}%) KEPT — nearest ${minK} too far (RGB dist=${rgbDist.toFixed(1)} > 40)`);
  }
}

function mergeTinyClusters(
  pixelLabels: Uint8Array,
  colorCentroids: Array<[number, number, number] | null>,
  countrySize: number,
  tp: number,
): void {
  const MERGE_SIZE_PCT = 0.02;
  const MERGE_MAX_DIST_SQ = 40 * 40;
  const postSplitCounts = new Map<number, number>();
  for (let i = 0; i < tp; i++) {
    if (pixelLabels[i] < 255) postSplitCounts.set(pixelLabels[i], (postSplitCounts.get(pixelLabels[i]) || 0) + 1);
  }
  const allLabels = [...postSplitCounts.keys()];
  for (const k of allLabels) {
    const cnt = postSplitCounts.get(k)!;
    if (cnt / countrySize >= MERGE_SIZE_PCT) continue;
    mergeOneTinyCluster(k, cnt, pixelLabels, colorCentroids, postSplitCounts, allLabels, countrySize, tp, MERGE_SIZE_PCT, MERGE_MAX_DIST_SQ);
  }
}

// =============================================================================
// Small-patch cleanup (circular-edge removal within a cluster)
// =============================================================================

function findClusterPatches(
  pixelLabels: Uint8Array,
  label: number,
  TW: number,
  tp: number,
): number[][] {
  const visited = new Uint8Array(tp);
  const patches: number[][] = [];
  for (let i = 0; i < tp; i++) {
    if (pixelLabels[i] !== label || visited[i]) continue;
    const positions: number[] = [];
    const q = [i]; visited[i] = 1; let h = 0;
    while (h < q.length) {
      const p = q[h++]; positions.push(p);
      for (const n of [p - TW, p + TW, p - 1, p + 1]) {
        if (n >= 0 && n < tp && !visited[n] && pixelLabels[n] === label) { visited[n] = 1; q.push(n); }
      }
    }
    patches.push(positions);
  }
  return patches;
}

function pickBestPatchNeighbor(
  patch: number[],
  pixelLabels: Uint8Array,
  ownLabel: number,
  TW: number,
  tp: number,
): number | null {
  const nbrCounts = new Map<number, number>();
  for (const pos of patch) {
    for (const n of [pos - TW, pos + TW, pos - 1, pos + 1]) {
      if (n >= 0 && n < tp && pixelLabels[n] < 255 && pixelLabels[n] !== ownLabel) {
        nbrCounts.set(pixelLabels[n], (nbrCounts.get(pixelLabels[n]) || 0) + 1);
      }
    }
  }
  if (nbrCounts.size === 0) return null;
  let bestNbr = ownLabel, bestCnt = 0;
  for (const [nl, cnt] of nbrCounts) { if (cnt > bestCnt) { bestCnt = cnt; bestNbr = nl; } }
  return bestNbr === ownLabel ? null : bestNbr;
}

/** Reassign all small patches (except the largest) to their best neighbour label. */
function relabelSmallPatches(
  pixelLabels: Uint8Array,
  lbl: number,
  patches: number[][],
  minPatch: number,
  TW: number,
  tp: number,
): number {
  let count = 0;
  for (let pi = 1; pi < patches.length; pi++) {
    const patch = patches[pi];
    if (patch.length >= minPatch) continue;
    const bestNbr = pickBestPatchNeighbor(patch, pixelLabels, lbl, TW, tp);
    if (bestNbr == null) continue;
    count++;
    for (const pos of patch) pixelLabels[pos] = bestNbr;
  }
  return count;
}

function cleanupSmallPatches(
  pixelLabels: Uint8Array,
  countrySize: number,
  pxS: (base: number) => number,
  TW: number,
  tp: number,
): void {
  const MIN_PATCH = Math.max(pxS(20), Math.round(countrySize * 0.02));
  const uniqueLabels = new Set<number>();
  for (let i = 0; i < tp; i++) if (pixelLabels[i] < 255) uniqueLabels.add(pixelLabels[i]);

  let patchMergeCount = 0;
  for (const lbl of uniqueLabels) {
    const patches = findClusterPatches(pixelLabels, lbl, TW, tp);
    patches.sort((a, b) => b.length - a.length);
    if (patches.length <= 1) continue;
    patchMergeCount += relabelSmallPatches(pixelLabels, lbl, patches, MIN_PATCH, TW, tp);
  }
  if (patchMergeCount > 0) console.log(`  [Patch] ${patchMergeCount} small patches relabeled (threshold: ${MIN_PATCH}px)`);
}

// =============================================================================
// Debug + quantized-map rendering
// =============================================================================

async function pushFinalClusterViz(
  pixelLabels: Uint8Array,
  colorCentroids: Array<[number, number, number] | null>,
  finalLabels: Set<number>,
  TW: number,
  TH: number,
  origW: number,
  origH: number,
  tp: number,
  pushDebugImage: (label: string, dataUrl: string) => Promise<void>,
): Promise<void> {
  const vizBuf = Buffer.alloc(tp * 3, 220);
  for (let i = 0; i < tp; i++) {
    if (pixelLabels[i] !== 255 && colorCentroids[pixelLabels[i]]) {
      const c = colorCentroids[pixelLabels[i]]!;
      vizBuf[i * 3] = c[0]; vizBuf[i * 3 + 1] = c[1]; vizBuf[i * 3 + 2] = c[2];
    }
  }
  const vizPng = await sharp(vizBuf, { raw: { width: TW, height: TH, channels: 3 } })
    .resize(origW, origH, { kernel: 'lanczos3' }).png().toBuffer();
  await pushDebugImage(`Clusters (${finalLabels.size} final)`, `data:image/png;base64,${vizPng.toString('base64')}`);
}

/** Fill the quantized buffer with each pixel's centroid colour (or gray for background). */
function fillQuantBuf(
  pixelLabels: Uint8Array,
  colorCentroids: Array<[number, number, number] | null>,
  tp: number,
): Buffer {
  const quantBuf = Buffer.alloc(tp * 3);
  for (let i = 0; i < tp; i++) {
    if (pixelLabels[i] === 255) {
      quantBuf[i * 3] = 220; quantBuf[i * 3 + 1] = 220; quantBuf[i * 3 + 2] = 220;
    } else {
      const c = colorCentroids[pixelLabels[i]];
      if (c) { quantBuf[i * 3] = c[0]; quantBuf[i * 3 + 1] = c[1]; quantBuf[i * 3 + 2] = c[2]; }
    }
  }
  return quantBuf;
}

/** Classify a pixel's border status by inspecting its 4-neighbour labels. */
function classifyBorderPixel(
  pixelLabels: Uint8Array,
  p: number,
  TW: number,
): { isExt: boolean; isInt: boolean } {
  let isExt = false, isInt = false;
  for (const n of [p - TW, p + TW, p - 1, p + 1]) {
    if (pixelLabels[n] === pixelLabels[p]) continue;
    if (pixelLabels[n] === 255) isExt = true; else isInt = true;
  }
  return { isExt, isInt };
}

/** Paint border pixels onto the overlay buffer (red=external, blue=internal). */
function paintBordersIntoOverlay(
  pixelLabels: Uint8Array,
  overlayBuf: Buffer,
  TW: number,
  TH: number,
): void {
  for (let y = 1; y < TH - 1; y++) {
    for (let x = 1; x < TW - 1; x++) {
      const p = y * TW + x;
      if (pixelLabels[p] === 255) continue;
      const { isExt, isInt } = classifyBorderPixel(pixelLabels, p, TW);
      const o = p * 3;
      if (isExt) { overlayBuf[o] = 213; overlayBuf[o + 1] = 47; overlayBuf[o + 2] = 47; }
      else if (isInt) { overlayBuf[o] = 21; overlayBuf[o + 1] = 101; overlayBuf[o + 2] = 192; }
    }
  }
}

function buildQuantizedAndOverlayBuffers(
  pixelLabels: Uint8Array,
  colorCentroids: Array<[number, number, number] | null>,
  TW: number,
  TH: number,
  tp: number,
): { quantBuf: Buffer; overlayBuf: Buffer } {
  const quantBuf = fillQuantBuf(pixelLabels, colorCentroids, tp);
  const overlayBuf = Buffer.from(quantBuf);
  paintBordersIntoOverlay(pixelLabels, overlayBuf, TW, TH);
  return { quantBuf, overlayBuf };
}

// =============================================================================
// ICP-mask construction + tiny-CC noise cleanup
// =============================================================================

function listGrayClusterIds(
  colorCentroids: Array<[number, number, number] | null>,
  finalClusters: Map<number, number>,
): number[] {
  const grayClusterIds: number[] = [];
  for (const [clusterId] of finalClusters) {
    const c = colorCentroids[clusterId];
    if (!c) continue;
    const maxC = Math.max(c[0], c[1], c[2]);
    const minC = Math.min(c[0], c[1], c[2]);
    const sat = maxC > 0 ? ((maxC - minC) / maxC) * 255 : 0;
    if (sat < 20) grayClusterIds.push(clusterId);
  }
  return grayClusterIds;
}

function refineMaskExcludingGrayClusters(
  pixelLabels: Uint8Array,
  grayClusterIds: number[],
  tp: number,
): { refined: Uint8Array; refinedSize: number } {
  const refined = new Uint8Array(tp);
  let refinedSize = 0;
  const graySet = new Set(grayClusterIds);
  for (let i = 0; i < tp; i++) {
    if (pixelLabels[i] < 255 && !graySet.has(pixelLabels[i])) {
      refined[i] = 1;
      refinedSize++;
    }
  }
  return { refined, refinedSize };
}

function buildICPMask(
  pixelLabels: Uint8Array,
  countryMask: Uint8Array,
  colorCentroids: Array<[number, number, number] | null>,
  finalClusters: Map<number, number>,
  countrySize: number,
  tp: number,
): Uint8Array {
  const baseMask = new Uint8Array(tp);
  let baseSize = 0;
  for (let i = 0; i < tp; i++) {
    if (countryMask[i] && pixelLabels[i] !== 255) {
      baseMask[i] = 1;
      baseSize++;
    }
  }
  let icpMask: Uint8Array = baseMask;
  if (baseSize < countrySize) {
    console.log(`  [ICP] Excluded-cluster refinement: mask ${countrySize}→${baseSize} px (${(baseSize/tp*100).toFixed(0)}%)`);
  }

  const grayClusterIds = listGrayClusterIds(colorCentroids, finalClusters);
  if (grayClusterIds.length > 0) {
    const { refined, refinedSize } = refineMaskExcludingGrayClusters(pixelLabels, grayClusterIds, tp);
    if (refinedSize > tp * 0.15 && refinedSize < baseSize * 0.95) {
      console.log(`  [ICP] Excluding ${grayClusterIds.length} gray cluster(s): mask ${baseSize}→${refinedSize} px (${(refinedSize/tp*100).toFixed(0)}%)`);
      icpMask = refined;
    }
  }
  return icpMask;
}

/** BFS through unlabeled ICP pixels from `seed`, assigning `label` and counting them. */
function growICPComponent(
  seed: number,
  label: number,
  icpMask: Uint8Array,
  ccLabels: Int32Array,
  TW: number,
  TH: number,
  tp: number,
): number {
  let size = 0;
  const queue = [seed];
  while (queue.length > 0) {
    const p = queue.pop()!;
    if (p < 0 || p >= tp || ccLabels[p] > 0 || !icpMask[p]) continue;
    ccLabels[p] = label;
    size++;
    const x = p % TW, y = Math.floor(p / TW);
    if (x > 0) queue.push(p - 1);
    if (x < TW - 1) queue.push(p + 1);
    if (y > 0) queue.push(p - TW);
    if (y < TH - 1) queue.push(p + TW);
  }
  return size;
}

function labelICPComponents(
  icpMask: Uint8Array,
  TW: number,
  TH: number,
  tp: number,
): { ccLabels: Int32Array; ccSizes: Map<number, number> } {
  const ccLabels = new Int32Array(tp);
  let ccNextLabel = 1;
  const ccSizes = new Map<number, number>();
  for (let i = 0; i < tp; i++) {
    if (!icpMask[i] || ccLabels[i] > 0) continue;
    const label = ccNextLabel++;
    const size = growICPComponent(i, label, icpMask, ccLabels, TW, TH, tp);
    ccSizes.set(label, size);
  }
  return { ccLabels, ccSizes };
}

function removeICPNoiseCCs(
  icpMask: Uint8Array,
  TW: number,
  TH: number,
  tp: number,
): void {
  const { ccLabels, ccSizes } = labelICPComponents(icpMask, TW, TH, tp);
  if (ccSizes.size <= 1) return;

  const mainSize = Math.max(...ccSizes.values());
  const threshold = Math.max(10, Math.round(mainSize * 0.01));
  let removed = 0;
  for (let i = 0; i < tp; i++) {
    if (ccLabels[i] > 0 && (ccSizes.get(ccLabels[i]) ?? 0) < threshold) {
      icpMask[i] = 0;
      removed++;
    }
  }
  if (removed > 0) {
    console.log(`  [ICP] Noise cleanup: removed ${removed} pixels in ${[...ccSizes.values()].filter(s => s < threshold).length} tiny CCs (<1% of main)`);
  }
}

function logFinalClusterStats(
  pixelLabels: Uint8Array,
  colorCentroids: Array<[number, number, number] | null>,
  finalLabels: Set<number>,
  countrySize: number,
  CK: number,
  tp: number,
): void {
  console.log(`  [Clustering] Final: ${finalLabels.size} clusters (from ${CK} initial + spatial splits)`);
  for (const lbl of finalLabels) {
    let cnt = 0;
    for (let i = 0; i < tp; i++) if (pixelLabels[i] === lbl) cnt++;
    const c = colorCentroids[lbl];
    console.log(`    cluster ${lbl}: RGB(${c?.[0]},${c?.[1]},${c?.[2]}) ${cnt}px (${(cnt / countrySize * 100).toFixed(1)}%)`);
  }
}

// =============================================================================
// Main cleaning function
// =============================================================================

export async function cleanClusters(params: CleanParams): Promise<CleanResult> {
  const {
    pixelLabels, colorCentroids, buf, origBuf, countryMask, countrySize,
    TW, TH, origW, origH,
    pxS, pushDebugImage,
  } = params;

  const tp = TW * TH;

  // Compute CK from pixelLabels (max label + 1)
  let CK = 0;
  for (let i = 0; i < tp; i++) {
    if (pixelLabels[i] < 255 && pixelLabels[i] >= CK) CK = pixelLabels[i] + 1;
  }

  // Spatial split: break large clusters into spatially disconnected regions
  performSpatialSplit(pixelLabels, colorCentroids, buf, countrySize, pxS, TW, tp, CK);

  await pushPreMergeDebugImage(pixelLabels, colorCentroids, TW, TH, origW, origH, tp, pushDebugImage);

  // Auto-merge tiny clusters into nearest large cluster
  mergeTinyClusters(pixelLabels, colorCentroids, countrySize, tp);

  // Clean up small isolated patches per cluster
  cleanupSmallPatches(pixelLabels, countrySize, pxS, TW, tp);

  // Auto-exclude noise clusters
  excludeNoiseClusters(pixelLabels, colorCentroids, buf, countrySize, tp);

  // Divisive split: detect merged adjacent regions using original image colors
  if (origBuf) {
    divisiveSplitClusters(pixelLabels, colorCentroids, buf, origBuf, countrySize, TW, TH);
  }

  // Fragmented-residue merge
  mergeFragmentedClusters(pixelLabels, colorCentroids, countrySize, TW, TH);

  // Count final clusters
  const finalLabels = new Set<number>();
  for (let i = 0; i < tp; i++) if (pixelLabels[i] < 255) finalLabels.add(pixelLabels[i]);
  logFinalClusterStats(pixelLabels, colorCentroids, finalLabels, countrySize, CK, tp);

  await pushFinalClusterViz(pixelLabels, colorCentroids, finalLabels, TW, TH, origW, origH, tp, pushDebugImage);

  // Render quantized map + border overlay
  const { quantBuf, overlayBuf } = buildQuantizedAndOverlayBuffers(pixelLabels, colorCentroids, TW, TH, tp);

  const borderPaths = traceBorderPaths(pixelLabels, TW, TH);
  console.log(`  [Borders] Traced ${borderPaths.length} vector paths`);

  // Final cluster pixel counts
  const finalClusters = new Map<number, number>();
  for (let i = 0; i < tp; i++) {
    if (pixelLabels[i] < 255) finalClusters.set(pixelLabels[i], (finalClusters.get(pixelLabels[i]) || 0) + 1);
  }

  // Debug image: CV borders (upscaled)
  const upscaledBordersPng = await sharp(overlayBuf, { raw: { width: TW, height: TH, channels: 3 } })
    .resize(origW, origH, { kernel: 'lanczos3' })
    .png()
    .toBuffer();
  await pushDebugImage(
    `Step 2: Source map CV borders (${finalClusters.size} color regions, red=external, blue=internal)`,
    `data:image/png;base64,${upscaledBordersPng.toString('base64')}`,
  );

  // Build ICP mask from active (non-excluded) cluster pixels
  const icpMask = buildICPMask(pixelLabels, countryMask, colorCentroids, finalClusters, countrySize, tp);

  // Remove tiny noise CCs from ICP mask before bbox computation
  removeICPNoiseCCs(icpMask, TW, TH, tp);

  return { finalLabels, finalClusters, quantBuf, icpMask, borderPaths };
}
