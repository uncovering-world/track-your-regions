/**
 * The water a source map shows, cut into the components a curator can answer
 * about.
 *
 * A mean-shift pass leaves one mask of everything that looked like water; what
 * a person can judge is a lake, a bay, a strait — so the mask is closed,
 * labelled, split where one component is really two, and each piece is cropped
 * out of the original image with its outline drawn on. What comes back is a
 * list of pictures with their share of the map.
 *
 * Split out of `wvImportMatchHelpers.ts`, which had reached the length the lint
 * draws the line at (#933); what is done with the answer is
 * `wvImportMatchWater.ts`.
 */

import type { CvNs, CvMat } from './wvImportMatchHelpers.js';
import sharp from 'sharp';

// =============================================================================
// Outline crop generation
// =============================================================================

/** Clamp a bounding box for cropping the original image (with padding). Null if too small. */
function computeCropRect(
  TW: number, TH: number,
  cxStat: number, cyStat: number, bwStat: number, bhStat: number,
  pad: number,
): { cropX: number; cropY: number; cropW: number; cropH: number } | null {
  const cropX = Math.max(0, cxStat - pad);
  const cropY = Math.max(0, cyStat - pad);
  const cropW = Math.min(TW - cropX, bwStat + pad * 2);
  const cropH = Math.min(TH - cropY, bhStat + pad * 2);
  if (cropW <= 3 || cropH <= 3) return null;
  return { cropX, cropY, cropW, cropH };
}

/** Copy the source region from `origDownBuf` into a fresh crop buffer. */
function copyCropPixels(
  origDownBuf: Buffer, TW: number,
  cropX: number, cropY: number, cropW: number, cropH: number,
): Buffer {
  const cropBuf = Buffer.alloc(cropW * cropH * 3);
  for (let y = 0; y < cropH; y++) {
    for (let x = 0; x < cropW; x++) {
      const si = (cropY + y) * TW + (cropX + x);
      const di = (y * cropW + x) * 3;
      cropBuf[di] = origDownBuf[si * 3];
      cropBuf[di + 1] = origDownBuf[si * 3 + 1];
      cropBuf[di + 2] = origDownBuf[si * 3 + 2];
    }
  }
  return cropBuf;
}

/** Return true if (cropX+x, cropY+y) is an edge pixel of the set defined by `pixelTest`. */
function isEdgePixel(
  TW: number, TH: number,
  pixelTest: (si: number) => boolean,
  cropX: number, cropY: number, x: number, y: number,
): boolean {
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      const ny = cropY + y + dy, nx = cropX + x + dx;
      if (ny < 0 || ny >= TH || nx < 0 || nx >= TW || !pixelTest(ny * TW + nx)) return true;
    }
  }
  return false;
}

/** Paint a 3x3 magenta stamp centered on (x,y) into the crop buffer. */
function stampMagenta3x3(cropBuf: Buffer, cropW: number, cropH: number, x: number, y: number): void {
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const py = y + dy, px = x + dx;
      if (py >= 0 && py < cropH && px >= 0 && px < cropW) {
        const di = (py * cropW + px) * 3;
        cropBuf[di] = 255;
        cropBuf[di + 1] = 0;
        cropBuf[di + 2] = 255;
      }
    }
  }
}

/** Draw magenta edges into `cropBuf` for every edge pixel of `pixelTest` within the crop window. */
function drawMagentaOutline(
  cropBuf: Buffer,
  TW: number, TH: number,
  cropX: number, cropY: number, cropW: number, cropH: number,
  pixelTest: (si: number) => boolean,
): void {
  for (let y = 0; y < cropH; y++) {
    for (let x = 0; x < cropW; x++) {
      const si = (cropY + y) * TW + (cropX + x);
      if (!pixelTest(si)) continue;
      if (isEdgePixel(TW, TH, pixelTest, cropX, cropY, x, y)) {
        stampMagenta3x3(cropBuf, cropW, cropH, x, y);
      }
    }
  }
}

/**
 * Generate a crop of the original image with magenta outline for a given pixel set.
 * Previously a closure inside colorMatchDivisionsSSE capturing `TW`, `TH`, `origDownBuf`, and `sharp`.
 */
export async function generateOutlineCrop(
  origDownBuf: Buffer, TW: number, TH: number,
  pixelTest: (si: number) => boolean,
  cxStat: number, cyStat: number, bwStat: number, bhStat: number,
): Promise<string | null> {
  const pad = 20;
  const rect = computeCropRect(TW, TH, cxStat, cyStat, bwStat, bhStat, pad);
  if (!rect) return null;
  const { cropX, cropY, cropW, cropH } = rect;

  const cropBuf = copyCropPixels(origDownBuf, TW, cropX, cropY, cropW, cropH);
  drawMagentaOutline(cropBuf, TW, TH, cropX, cropY, cropW, cropH, pixelTest);

  const targetW = Math.min(500, cropW * 2);
  const png = await sharp(cropBuf, { raw: { width: cropW, height: cropH, channels: 3 } })
    .resize(targetW, undefined, { kernel: 'lanczos3' }).png().toBuffer();
  return `data:image/png;base64,${png.toString('base64')}`;
}


// =============================================================================
// Shared water review & finalization
// =============================================================================

interface WaterSubCluster { idx: number; pct: number; cropDataUrl: string }
export interface WaterComponent { id: number; area: number; pct: number; cropDataUrl: string; subClusters: WaterSubCluster[] }

export interface CompStat { area: number; left: number; top: number; width: number; height: number }

/** Run morphological close on a 0/1 water mask and return the closed Mat (caller must delete). */
export function morphCloseWaterMask(
  cv: CvNs, waterMaskIn: Uint8Array, TW: number, TH: number, waterKernel: CvMat,
): CvMat {
  const waterRawMat = cv.matFromArray(TH, TW, cv.CV_8UC1,
    // Convert 0/1 mask to 0/255 for OpenCV
    Uint8Array.from(waterMaskIn, v => v ? 255 : 0));
  const waterClosedMat = new cv.Mat();
  cv.morphologyEx(waterRawMat, waterClosedMat, cv.MORPH_CLOSE, waterKernel);
  waterRawMat.delete();
  return waterClosedMat;
}

/** Collect stats for every non-background connected component. */
export function collectComponentStats(cv: CvNs, waterStats: CvMat, numWaterCC: number): Map<number, CompStat> {
  const compStats = new Map<number, CompStat>();
  for (let c = 1; c < numWaterCC; c++) {
    compStats.set(c, {
      area: waterStats.intAt(c, cv.CC_STAT_AREA),
      left: waterStats.intAt(c, cv.CC_STAT_LEFT),
      top: waterStats.intAt(c, cv.CC_STAT_TOP),
      width: waterStats.intAt(c, cv.CC_STAT_WIDTH),
      height: waterStats.intAt(c, cv.CC_STAT_HEIGHT),
    });
  }
  return compStats;
}

/** Build a 0/255 mask isolating a single labeled component. */
function buildComponentMask(waterLabelData: Int32Array, tp: number, label: number): Uint8Array {
  const ccMask = new Uint8Array(tp);
  for (let i = 0; i < tp; i++) {
    if (waterLabelData[i] === label) ccMask[i] = 255;
  }
  return ccMask;
}

/** Erode a component mask and return its connected-components results (caller deletes Mats). */
function erodeAndLabelComponent(
  cv: CvNs, ccMask: Uint8Array, TW: number, TH: number, splitKernel: CvMat,
): { erodedLabels: CvMat; erodedStats: CvMat; numEroded: number } {
  const compMaskMat = cv.matFromArray(TH, TW, cv.CV_8UC1, ccMask);
  const erodedMat = new cv.Mat();
  cv.erode(compMaskMat, erodedMat, splitKernel);
  compMaskMat.delete();

  const erodedLabels = new cv.Mat();
  const erodedStats = new cv.Mat();
  const erodedCents = new cv.Mat();
  const numEroded = cv.connectedComponentsWithStats(erodedMat, erodedLabels, erodedStats, erodedCents);
  erodedMat.delete();
  erodedCents.delete();

  return { erodedLabels, erodedStats, numEroded };
}

/** Pick eroded sub-components that are large enough to be considered separate blobs. */
function findSignificantSubComponents(
  cv: CvNs, erodedStats: CvMat, numEroded: number, minSubSize: number,
): Array<{ eLabel: number; area: number }> {
  const significantSubs: Array<{ eLabel: number; area: number }> = [];
  for (let sc = 1; sc < numEroded; sc++) {
    const subArea = erodedStats.intAt(sc, cv.CC_STAT_AREA);
    if (subArea >= minSubSize) significantSubs.push({ eLabel: sc, area: subArea });
  }
  return significantSubs;
}

/** Seed the BFS queue with eroded-core pixels relabeled to their new labels. */
function seedRelabelQueue(
  waterLabelData: Int32Array, erodedLabelData: Int32Array,
  tp: number, origLabel: number, subLabelMap: Map<number, number>,
): number[] {
  const bfsQueue: number[] = [];
  for (let i = 0; i < tp; i++) {
    if (waterLabelData[i] !== origLabel) continue;
    const newLabel = subLabelMap.get(erodedLabelData[i]);
    if (newLabel !== undefined) {
      waterLabelData[i] = newLabel;
      bfsQueue.push(i);
    }
  }
  return bfsQueue;
}

/** Spread the new label from `pi` into 8-connected neighbors that still hold origLabel. */
function propagateRelabel(
  waterLabelData: Int32Array, bfsQueue: number[],
  pi: number, label: number, origLabel: number,
  TW: number, TH: number,
): void {
  const px = pi % TW, py = Math.floor(pi / TW);
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      const nx = px + dx, ny = py + dy;
      if (nx < 0 || nx >= TW || ny < 0 || ny >= TH) continue;
      const ni = ny * TW + nx;
      if (waterLabelData[ni] !== origLabel) continue;
      waterLabelData[ni] = label;
      bfsQueue.push(ni);
    }
  }
}

/** Reassign labels of a single component into multiple sub-labels via BFS growth from cores. */
function relabelComponentBySubCores(
  waterLabelData: Int32Array, erodedLabelData: Int32Array,
  tp: number, TW: number, TH: number,
  origLabel: number, subLabelMap: Map<number, number>,
): void {
  const bfsQueue = seedRelabelQueue(waterLabelData, erodedLabelData, tp, origLabel, subLabelMap);

  let head = 0;
  while (head < bfsQueue.length) {
    const pi = bfsQueue[head++];
    const label = waterLabelData[pi];
    propagateRelabel(waterLabelData, bfsQueue, pi, label, origLabel, TW, TH);
  }
}

/** Compute bbox + area stats for a particular label across the whole image. */
function computeLabelBBoxStats(
  waterLabelData: Int32Array, tp: number, TW: number, TH: number, label: number,
): CompStat | null {
  let subArea = 0, minX = TW, minY = TH, maxX = 0, maxY = 0;
  for (let i = 0; i < tp; i++) {
    if (waterLabelData[i] !== label) continue;
    subArea++;
    const x = i % TW, y = Math.floor(i / TW);
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  if (subArea === 0) return null;
  return {
    area: subArea,
    left: minX,
    top: minY,
    width: maxX - minX + 1,
    height: maxY - minY + 1,
  };
}

/**
 * Attempt to split a single large component by erosion. Returns the next label id to use.
 * Mutates `waterLabelData` and `compStats` in place.
 */
function splitSingleComponent(
  cv: CvNs,
  c: number,
  stat: CompStat,
  waterLabelData: Int32Array,
  compStats: Map<number, CompStat>,
  tp: number, TW: number, TH: number,
  splitKernel: CvMat,
  nextWaterLabel: number,
): number {
  const ccMask = buildComponentMask(waterLabelData, tp, c);
  const { erodedLabels, erodedStats, numEroded } = erodeAndLabelComponent(cv, ccMask, TW, TH, splitKernel);

  const minSubSize = Math.max(50, Math.round(stat.area * 0.01));
  const significantSubs = findSignificantSubComponents(cv, erodedStats, numEroded, minSubSize);

  if (significantSubs.length < 2) {
    erodedLabels.delete();
    erodedStats.delete();
    return nextWaterLabel;
  }

  significantSubs.sort((a, b) => b.area - a.area);
  console.log(`  [Water] Splitting CC ${c} (${stat.area}px, ${(stat.area / tp * 100).toFixed(1)}%) into ${significantSubs.length} sub-blobs`);

  let label = nextWaterLabel;
  const subLabelMap = new Map<number, number>();
  for (const sub of significantSubs) {
    subLabelMap.set(sub.eLabel, label++);
  }

  relabelComponentBySubCores(waterLabelData, erodedLabels.data32S, tp, TW, TH, c, subLabelMap);

  for (const newLabel of subLabelMap.values()) {
    const bbox = computeLabelBBoxStats(waterLabelData, tp, TW, TH, newLabel);
    if (bbox) {
      compStats.set(newLabel, bbox);
      console.log(`    sub-blob → label ${newLabel}: ${bbox.area}px (${(bbox.area / tp * 100).toFixed(1)}%) bbox ${bbox.width}×${bbox.height}`);
    }
  }

  compStats.delete(c);
  erodedLabels.delete();
  erodedStats.delete();
  return label;
}

/** Iterate components and split any that exceed SPLIT_MIN_AREA using morphological erosion. */
export function splitLargeComponents(
  cv: CvNs,
  waterLabelData: Int32Array,
  compStats: Map<number, CompStat>,
  numWaterCC: number,
  tp: number, TW: number, TH: number,
  oddK: (base: number) => number,
): void {
  const SPLIT_MIN_AREA = Math.round(tp * 0.05);
  const splitKSize = oddK(10);
  const splitKernel = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(splitKSize, splitKSize));
  let nextWaterLabel = numWaterCC;

  for (let c = 1; c < numWaterCC; c++) {
    const stat = compStats.get(c);
    if (!stat || stat.area < SPLIT_MIN_AREA) continue;
    nextWaterLabel = splitSingleComponent(
      cv, c, stat, waterLabelData, compStats, tp, TW, TH, splitKernel, nextWaterLabel,
    );
  }
  splitKernel.delete();
}

/** Run K=2 k-means clustering on a component's pixels; returns final centroids + assignments. */
function kmeansTwoOnComponent(
  compPx: Array<[number, number, number, number]>,
): { cents: Array<[number, number, number]>; assignments: Uint8Array } {
  const cents: Array<[number, number, number]> = [[compPx[0][0], compPx[0][1], compPx[0][2]]];
  let maxD = 0, bestI = 0;
  for (let i = 1; i < compPx.length; i++) {
    const d = (compPx[i][0] - cents[0][0]) ** 2 + (compPx[i][1] - cents[0][1]) ** 2 + (compPx[i][2] - cents[0][2]) ** 2;
    if (d > maxD) { maxD = d; bestI = i; }
  }
  cents.push([compPx[bestI][0], compPx[bestI][1], compPx[bestI][2]]);

  const assignments = new Uint8Array(compPx.length);
  for (let iter = 0; iter < 20; iter++) {
    const sums = [[0, 0, 0, 0], [0, 0, 0, 0]];
    for (let i = 0; i < compPx.length; i++) {
      const [r, g, b] = compPx[i];
      const d0 = (r - cents[0][0]) ** 2 + (g - cents[0][1]) ** 2 + (b - cents[0][2]) ** 2;
      const d1 = (r - cents[1][0]) ** 2 + (g - cents[1][1]) ** 2 + (b - cents[1][2]) ** 2;
      const k = d0 <= d1 ? 0 : 1;
      assignments[i] = k;
      sums[k][0] += r; sums[k][1] += g; sums[k][2] += b; sums[k][3]++;
    }
    for (let k = 0; k < 2; k++) {
      if (sums[k][3] > 0) {
        cents[k] = [
          Math.round(sums[k][0] / sums[k][3]),
          Math.round(sums[k][1] / sums[k][3]),
          Math.round(sums[k][2] / sums[k][3]),
        ];
      }
    }
  }

  return { cents, assignments };
}

/** Compute pixel-index bounding box for an index set. */
function bboxOfPixelSet(subPixels: Set<number>, TW: number, TH: number): {
  minX: number; minY: number; maxX: number; maxY: number;
} {
  let minX = TW, minY = TH, maxX = 0, maxY = 0;
  for (const si of subPixels) {
    const spx = si % TW, spy = Math.floor(si / TW);
    if (spx < minX) minX = spx;
    if (spx > maxX) maxX = spx;
    if (spy < minY) minY = spy;
    if (spy > maxY) maxY = spy;
  }
  return { minX, minY, maxX, maxY };
}

/** Collect (r, g, b, index) tuples for pixels belonging to a given component inside its bbox. */
function collectComponentPixels(
  colorBuf: Buffer, waterLabelData: Int32Array,
  c: number, stat: CompStat, TW: number, TH: number,
): Array<[number, number, number, number]> {
  const compPx: Array<[number, number, number, number]> = [];
  const cx = stat.left, cy = stat.top, bw = stat.width, bh = stat.height;
  for (let y = cy; y < cy + bh && y < TH; y++) {
    for (let x = cx; x < cx + bw && x < TW; x++) {
      const si = y * TW + x;
      if (waterLabelData[si] === c) {
        compPx.push([colorBuf[si * 3], colorBuf[si * 3 + 1], colorBuf[si * 3 + 2], si]);
      }
    }
  }
  return compPx;
}

/** Build sub-cluster entries (with crops) for a component via K=2 k-means. */
async function computeSubClustersForComponent(
  origDownBuf: Buffer, colorBuf: Buffer, waterLabelData: Int32Array,
  c: number, stat: CompStat,
  TW: number, TH: number, tp: number,
  compSubCentroids: Map<number, Array<[number, number, number]>>,
): Promise<WaterSubCluster[]> {
  const subClusters: WaterSubCluster[] = [];
  const compPx = collectComponentPixels(colorBuf, waterLabelData, c, stat, TW, TH);
  if (compPx.length <= 20) return subClusters;

  const { cents, assignments } = kmeansTwoOnComponent(compPx);
  compSubCentroids.set(c, cents);

  const subPixelSets = [new Set<number>(), new Set<number>()];
  const subAreas = [0, 0];
  for (let i = 0; i < compPx.length; i++) {
    subPixelSets[assignments[i]].add(compPx[i][3]);
    subAreas[assignments[i]]++;
  }

  for (let k = 0; k < 2; k++) {
    if (subAreas[k] < 5) continue;
    const { minX, minY, maxX, maxY } = bboxOfPixelSet(subPixelSets[k], TW, TH);
    try {
      const subCrop = await generateOutlineCrop(
        origDownBuf, TW, TH, si => subPixelSets[k].has(si),
        minX, minY, maxX - minX + 1, maxY - minY + 1,
      );
      if (subCrop) {
        subClusters.push({
          idx: k,
          pct: Math.round(subAreas[k] / tp * 1000) / 10,
          cropDataUrl: subCrop,
        });
      }
    } catch { /* skip */ }
  }
  return subClusters;
}

/** Generate the outlined main crop for a component, or null if it fails. */
async function tryGenerateMainCrop(
  origDownBuf: Buffer, waterLabelData: Int32Array,
  c: number, stat: CompStat, TW: number, TH: number,
): Promise<string | null> {
  try {
    const crop = await generateOutlineCrop(
      origDownBuf, TW, TH, si => waterLabelData[si] === c,
      stat.left, stat.top, stat.width, stat.height,
    );
    return crop ?? null;
  } catch {
    return null;
  }
}

/** Decide whether a component is worth keeping (size + shape heuristics). */
function shouldKeepComponent(stat: CompStat, minWaterSize: number): boolean {
  if (stat.area < minWaterSize) return false;
  const { width: bw, height: bh, area } = stat;
  const aspect = Math.max(bw, bh) / Math.max(1, Math.min(bw, bh));
  const solidity = area / Math.max(1, bw * bh);
  // elongated + sparse = river
  return !(aspect > 4 && solidity < 0.3);
}

/** Run filtering + per-component crop/subcluster generation, populate output arrays. */
export async function buildWaterComponents(
  origDownBuf: Buffer, colorBuf: Buffer,
  waterLabelData: Int32Array, waterMask: Uint8Array,
  compStats: Map<number, CompStat>,
  tp: number, TW: number, TH: number,
  compSubCentroids: Map<number, Array<[number, number, number]>>,
): Promise<WaterComponent[]> {
  const waterComponents: WaterComponent[] = [];
  const minWaterSize = Math.round(tp * 0.003); // 0.3%

  for (const [c, stat] of compStats) {
    if (!shouldKeepComponent(stat, minWaterSize)) continue;

    for (let i = 0; i < tp; i++) {
      if (waterLabelData[i] === c) waterMask[i] = 1;
    }

    const mainCrop = await tryGenerateMainCrop(origDownBuf, waterLabelData, c, stat, TW, TH);
    if (!mainCrop) continue;

    const subClusters = await computeSubClustersForComponent(
      origDownBuf, colorBuf, waterLabelData, c, stat, TW, TH, tp, compSubCentroids,
    );

    waterComponents.push({
      id: c,
      area: stat.area,
      pct: Math.round(stat.area / tp * 1000) / 10,
      cropDataUrl: mainCrop,
      subClusters,
    });
  }
  return waterComponents;
}
