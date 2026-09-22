/**
 * What a run does about the water it found: ask, and then finish.
 *
 * The mask is first narrowed to what touches the image's own border — an inland
 * lake is not the sea — and grown back by a dilation, then the components go to
 * a curator as pictures. Their decision comes back as a mask the rest of the
 * pipeline works from, and the run records what was decided and why.
 *
 * Split out of `wvImportMatchHelpers.ts`, which had reached the length the lint
 * draws the line at (#933); the components themselves are built in
 * `wvImportMatchWaterComponents.ts`.
 */

import type { CvNs } from './wvImportMatchHelpers.js';
import {
  WaterComponent, CompStat, morphCloseWaterMask, collectComponentStats, splitLargeComponents, buildWaterComponents,
} from './wvImportMatchWaterComponents.js';
import sharp from 'sharp';
import { registerWaterReview, storeWaterCrops, type WaterReviewDecision } from './wvImportMatchReview.js';
import type { PipelineContext } from './wvImportMatchContext.js';

/** Mark a pixel as border-connected and push it to the BFS queue if non-zero in erodedData. */
function seedBorderPixel(
  erodedData: Uint8Array | Int32Array,
  borderConnected: Uint8Array, bq: number[], idx: number,
): void {
  if (erodedData[idx]) {
    borderConnected[idx] = 1;
    bq.push(idx);
  }
}

/** Seed all image-border pixels (top/bottom/left/right) into the BFS queue. */
function seedImageBorders(
  erodedData: Uint8Array | Int32Array,
  borderConnected: Uint8Array, bq: number[],
  TW: number, TH: number,
): void {
  for (let x = 0; x < TW; x++) {
    seedBorderPixel(erodedData, borderConnected, bq, x);
    seedBorderPixel(erodedData, borderConnected, bq, (TH - 1) * TW + x);
  }
  for (let y = 0; y < TH; y++) {
    seedBorderPixel(erodedData, borderConnected, bq, y * TW);
    seedBorderPixel(erodedData, borderConnected, bq, y * TW + TW - 1);
  }
}

/** BFS along the image border through eroded-water pixels and return the connected set. */
function computeBorderConnectedSet(
  erodedData: Uint8Array | Int32Array,
  TW: number, TH: number, tp: number,
): Uint8Array {
  const borderConnected = new Uint8Array(tp);
  const bq: number[] = [];

  seedImageBorders(erodedData, borderConnected, bq, TW, TH);

  let head = 0;
  while (head < bq.length) {
    const p = bq[head++];
    for (const n of [p - 1, p + 1, p - TW, p + TW]) {
      if (n >= 0 && n < tp && erodedData[n] && !borderConnected[n]) {
        borderConnected[n] = 1;
        bq.push(n);
      }
    }
  }
  return borderConnected;
}

/** Remove water pixels that are not connected (via eroded+dilated mask) to the image border. */
function applyEdgeConnectivityFilter(
  cv: CvNs, waterMask: Uint8Array, TW: number, TH: number, tp: number,
  oddK: (base: number) => number,
): void {
  const wmMat = cv.matFromArray(TH, TW, cv.CV_8UC1, waterMask);
  const erodeSize = oddK(15);
  const erodeK2 = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(erodeSize, erodeSize));
  const erodedWater = new cv.Mat();
  cv.erode(wmMat, erodedWater, erodeK2);
  erodeK2.delete();
  wmMat.delete();

  const borderConnected = computeBorderConnectedSet(erodedWater.data, TW, TH, tp);
  erodedWater.delete();

  const bcMat = cv.matFromArray(TH, TW, cv.CV_8UC1, borderConnected);
  const dilateSize = oddK(17);
  const dilateK2 = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(dilateSize, dilateSize));
  const bcDilated = new cv.Mat();
  cv.dilate(bcMat, bcDilated, dilateK2);
  dilateK2.delete();
  bcMat.delete();

  let removed = 0;
  for (let i = 0; i < tp; i++) {
    if (waterMask[i] && !bcDilated.data[i]) {
      waterMask[i] = 0;
      removed++;
    }
  }
  bcDilated.delete();
  if (removed > 0) {
    console.log(`  [Water] Edge-connectivity filter: removed ${removed} inland water pixels (${(removed / tp * 100).toFixed(1)}%)`);
  }
}

/** Dilate a binary water mask and return a fresh Uint8Array (0/255 from OpenCV). */
function dilateWaterMask(
  cv: CvNs, waterMask: Uint8Array, TW: number, TH: number,
  oddK: (base: number) => number,
): Uint8Array {
  const waterMaskMat = cv.matFromArray(TH, TW, cv.CV_8UC1, waterMask);
  const wdSize = oddK(5);
  const waterDilateKernel = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(wdSize, wdSize));
  const waterGrownMat = new cv.Mat();
  cv.dilate(waterMaskMat, waterGrownMat, waterDilateKernel);
  const result = new Uint8Array(waterGrownMat.data);
  waterMaskMat.delete();
  waterGrownMat.delete();
  waterDilateKernel.delete();
  return result;
}

/** Produce a debug PNG overlaying water pixels in red on top of the color buffer. */
async function renderWaterDebugImage(
  colorBuf: Buffer, waterGrown: Uint8Array, tp: number,
  TW: number, TH: number, origW: number, origH: number,
): Promise<{ dataUrl: string; waterPxCount: number }> {
  const waterVizBuf = Buffer.from(colorBuf);
  let waterPxCount = 0;
  for (let i = 0; i < tp; i++) {
    if (waterGrown[i]) {
      waterVizBuf[i * 3] = 255;
      waterVizBuf[i * 3 + 1] = 0;
      waterVizBuf[i * 3 + 2] = 0;
      waterPxCount++;
    }
  }
  const waterDebugPng = await sharp(Buffer.from(waterVizBuf), {
    raw: { width: TW, height: TH, channels: 3 },
  }).resize(origW, origH, { kernel: 'lanczos3' }).png().toBuffer();
  return {
    dataUrl: `data:image/png;base64,${waterDebugPng.toString('base64')}`,
    waterPxCount,
  };
}

/** Mix-decision: decide if an individual pixel should be kept based on sub-cluster approval. */
function keepMixedPixel(
  i: number,
  colorBuf: Buffer,
  approvedSubs: Set<number>,
  cents: Array<[number, number, number]> | undefined,
): boolean {
  if (!cents) return false;
  const r = colorBuf[i * 3], g = colorBuf[i * 3 + 1], b = colorBuf[i * 3 + 2];
  const d0 = (r - cents[0][0]) ** 2 + (g - cents[0][1]) ** 2 + (b - cents[0][2]) ** 2;
  const d1 = (r - cents[1][0]) ** 2 + (g - cents[1][1]) ** 2 + (b - cents[1][2]) ** 2;
  const nearest = d0 <= d1 ? 0 : 1;
  return approvedSubs.has(nearest);
}

/** Rebuild the water mask in place from the user decision (approved whole / mixed sub-clusters). */
function rebuildMaskFromDecision(
  waterMask: Uint8Array,
  savedWaterLabels: Int32Array,
  compStats: Map<number, CompStat>,
  approvedSet: Set<number>,
  mixMap: Map<number, Set<number>>,
  compSubCentroids: Map<number, Array<[number, number, number]>>,
  colorBuf: Buffer,
  tp: number,
): void {
  waterMask.fill(0);
  for (let i = 0; i < tp; i++) {
    const label = savedWaterLabels[i];
    if (label <= 0) continue;
    if (!compStats.has(label)) continue;

    if (approvedSet.has(label)) {
      waterMask[i] = 1;
    } else if (mixMap.has(label)) {
      const approvedSubs = mixMap.get(label)!;
      const cents = compSubCentroids.get(label);
      if (keepMixedPixel(i, colorBuf, approvedSubs, cents)) {
        waterMask[i] = 1;
      }
    }
  }
}

/** Emit the water_review SSE event and await the curator's decision. */
async function requestWaterReview(
  regionId: number,
  waterComponents: WaterComponent[],
  waterPxCount: number,
  tp: number,
  sendEvent: (event: Record<string, unknown>) => void,
): Promise<WaterReviewDecision> {
  const reviewId = `wr-${regionId}-${Date.now()}`;
  storeWaterCrops(reviewId, waterComponents);
  const cropCount = waterComponents.reduce((n, wc) => n + 1 + wc.subClusters.length, 0);
  console.log(`  [Water] Stored ${cropCount} crop(s) for review ${reviewId}`);

  sendEvent({
    type: 'water_review',
    reviewId,
    waterPxPercent: Math.round(waterPxCount / tp * 1000) / 10,
    waterComponents: waterComponents.map(wc => ({
      id: wc.id,
      pct: wc.pct,
      cropDataUrl: '',
      subClusters: wc.subClusters.map(sc => ({ idx: sc.idx, pct: sc.pct, cropDataUrl: '' })),
    })),
  });
  await new Promise(resolve => setImmediate(resolve));

  return new Promise<WaterReviewDecision>((resolve) => {
    registerWaterReview(reviewId, resolve);
  });
}

/** Log decision metadata and return parsed approval sets. */
function describeReviewDecision(
  decision: WaterReviewDecision,
  waterComponents: WaterComponent[],
  waterGrown: Uint8Array,
  tp: number,
): {
  approvedSet: Set<number>;
  mixMap: Map<number, Set<number>>;
  rejectedIds: number[];
  needsRebuild: boolean;
  preRebuildWaterPx: number;
} {
  const approvedSet = new Set(decision.approvedIds);
  const mixMap = new Map(decision.mixDecisions.map(m => [m.componentId, new Set(m.approvedSubClusters)]));
  const rejectedIds = waterComponents
    .filter(wc => !approvedSet.has(wc.id) && !mixMap.has(wc.id))
    .map(wc => wc.id);
  const needsRebuild = rejectedIds.length > 0 || mixMap.size > 0;
  let preRebuildWaterPx = 0;
  for (let i = 0; i < tp; i++) if (waterGrown[i]) preRebuildWaterPx++;
  console.log(`  [Water] Decision received: approved=[${[...approvedSet]}] rejected=[${rejectedIds}] mix=[${[...mixMap.keys()]}] all_components=[${waterComponents.map(wc => wc.id)}] needsRebuild=${needsRebuild} preRebuildWaterPx=${preRebuildWaterPx}`);
  return { approvedSet, mixMap, rejectedIds, needsRebuild, preRebuildWaterPx };
}

/** Apply a curator's review decision to the mask and emit a refreshed debug image. */
async function applyReviewDecision(
  ctx: PipelineContext,
  waterMask: Uint8Array,
  waterGrown: Uint8Array,
  savedWaterLabels: Int32Array,
  compStats: Map<number, CompStat>,
  compSubCentroids: Map<number, Array<[number, number, number]>>,
  colorBuf: Buffer,
  waterComponents: WaterComponent[],
  decision: WaterReviewDecision,
): Promise<void> {
  const { cv, TW, TH, tp, oddK, origW, origH, logStep, pushDebugImage } = ctx;
  const { approvedSet, mixMap, needsRebuild, preRebuildWaterPx } =
    describeReviewDecision(decision, waterComponents, waterGrown, tp);

  if (!needsRebuild) return;

  const changes: string[] = [];
  const rejected = waterComponents.filter(wc => !approvedSet.has(wc.id) && !mixMap.has(wc.id));
  if (rejected.length) changes.push(`${rejected.length} rejected`);
  if (mixMap.size) changes.push(`${mixMap.size} mixed`);
  await logStep(`Rebuilding water mask (${changes.join(', ')})...`);

  rebuildMaskFromDecision(waterMask, savedWaterLabels, compStats, approvedSet, mixMap, compSubCentroids, colorBuf, tp);

  const newGrown = dilateWaterMask(cv, waterMask, TW, TH, oddK);
  for (let i = 0; i < tp; i++) waterGrown[i] = newGrown[i];

  let postRebuildWaterPx = 0;
  for (let i = 0; i < tp; i++) if (waterGrown[i]) postRebuildWaterPx++;
  console.log(`  [Water] Rebuild complete: ${preRebuildWaterPx} → ${postRebuildWaterPx} water px (delta: ${postRebuildWaterPx - preRebuildWaterPx})`);

  const { dataUrl, waterPxCount: cnt } = await renderWaterDebugImage(colorBuf, waterGrown, tp, TW, TH, origW, origH);
  await pushDebugImage(`Water mask (corrected, ${cnt} px = ${(cnt / tp * 100).toFixed(1)}%)`, dataUrl);
}

/**
 * Shared water review pipeline: CC analysis → narrow-neck splitting →
 * component filtering → crop generation → edge-connectivity filter →
 * final dilation → interactive review → mask rebuild.
 *
 * Called by the mean-shift pipeline (meanshiftPreprocess) after its water
 * detection, and by nothing else.
 *
 * @param waterMaskIn  Binary water mask (1 = water). Modified in place.
 * @param colorBuf     Color buffer for sub-clustering (inpaintedBuf or mean-shift colorBuf).
 * @param ctx          Pipeline context (for origDownBuf, cv, dimensions, helpers).
 * @returns            Final dilated water mask (waterGrown).
 */
export async function reviewAndFinalizeWater(
  waterMaskIn: Uint8Array,
  colorBuf: Buffer,
  ctx: PipelineContext,
): Promise<Uint8Array> {
  const { cv, TW, TH, tp, oddK, origW, origH, regionId, pushDebugImage, sendEvent, origDownBuf } = ctx;

  // --- Morphological close to fill small gaps ---
  const wkSize = oddK(7);
  const waterKernel = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(wkSize, wkSize));
  const waterClosedMat = morphCloseWaterMask(cv, waterMaskIn, TW, TH, waterKernel);

  // --- Connected components ---
  const waterLabels = new cv.Mat();
  const waterStats = new cv.Mat();
  const waterCents = new cv.Mat();
  const numWaterCC = cv.connectedComponentsWithStats(waterClosedMat, waterLabels, waterStats, waterCents);
  waterClosedMat.delete();
  waterCents.delete();

  const waterMask = new Uint8Array(tp);
  const waterLabelData: Int32Array = waterLabels.data32S;
  const compSubCentroids = new Map<number, Array<[number, number, number]>>();

  // --- Narrow-neck splitting of large blobs ---
  const compStats = collectComponentStats(cv, waterStats, numWaterCC);
  splitLargeComponents(cv, waterLabelData, compStats, numWaterCC, tp, TW, TH, oddK);

  // --- Component filtering + crop generation + sub-clustering ---
  const waterComponents = await buildWaterComponents(
    origDownBuf, colorBuf, waterLabelData, waterMask,
    compStats, tp, TW, TH, compSubCentroids,
  );

  const savedWaterLabels = new Int32Array(waterLabelData);
  waterLabels.delete();
  waterStats.delete();
  console.log(`  [Water] ${waterComponents.length} component(s) after CC filter (from ${numWaterCC - 1} raw)`);

  // --- Edge-connectivity filter: remove thin water tentacles extending into land ---
  applyEdgeConnectivityFilter(cv, waterMask, TW, TH, tp, oddK);

  // --- Final dilation ---
  const waterGrown = dilateWaterMask(cv, waterMask, TW, TH, oddK);
  waterKernel.delete();

  // --- Debug image: water mask overlay ---
  const { dataUrl: debugDataUrl, waterPxCount } =
    await renderWaterDebugImage(colorBuf, waterGrown, tp, TW, TH, origW, origH);
  await pushDebugImage(
    `Water mask (red, ${waterPxCount} px = ${(waterPxCount / tp * 100).toFixed(1)}%)`,
    debugDataUrl,
  );

  // --- Interactive per-component water review ---
  if (waterComponents.length > 0) {
    const decision = await requestWaterReview(regionId, waterComponents, waterPxCount, tp, sendEvent);
    await applyReviewDecision(
      ctx, waterMask, waterGrown, savedWaterLabels, compStats, compSubCentroids,
      colorBuf, waterComponents, decision,
    );
  }

  return waterGrown;
}
