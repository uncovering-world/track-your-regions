/**
 * The colour match as this process runs it, on OpenCV's WASM build.
 *
 * The same sequence the Python service performs, in-process: the downscaled
 * buffers, the context every phase writes into, and the seven reclustering
 * presets a reviewer can ask for — more clusters, another seed, boosted
 * colours, the roads taken out, the holes filled, the small components
 * cleaned away in two strengths.
 *
 * OpenCV is initialised here, at module load, and cached on `globalThis` so a
 * hot reload does not pay for it twice; the orchestrator imports this module
 * statically so the cost lands at server startup rather than in a request.
 *
 * Split out of `wvImportMatchPipeline.ts`, which had reached the length the
 * lint draws the line at (#933).
 */

import type {
  SendEvent,
  LogStep,
  PushDebugImage,
  ImageDims,
  PipelineContext,
} from './wvImportMatchContext.js';
import sharp from 'sharp';
import { matchDivisionsFromClusters, type ReclusterSignal } from './wvImportMatchShared.js';
import { removeColoredLines } from './wvImportMatchHelpers.js';
import { runKMeansClustering } from './wvImportMatchCluster.js';
import { meanshiftPreprocess } from './wvImportMatchMeanshift.js';

// OpenCV WASM — eagerly initialized at module load to avoid tsx/esbuild overhead during requests.
// tsx transforms every dynamic import() through esbuild, which takes 30s+ for the 10MB opencv.js.
// By importing at module level, the cost is paid once at server startup.
// Cache OpenCV on globalThis so it survives tsx hot-reloads
// (each hot-reload re-evaluates this module, but globalThis persists)
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- OpenCV.js has no TypeScript types
const G = globalThis as unknown as { __cv?: any; __cvReady?: Promise<void> };
if (!G.__cvReady) {
  G.__cvReady = (async () => {
    try {
      const mod = await import('@techstark/opencv-js') as Record<string, unknown>;
      const cv = (mod.default ?? mod) as Record<string, unknown>;
      for (let i = 0; i < 600 && !cv.Mat; i++) {
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      if (cv.Mat) {
        G.__cv = cv;
        console.log('OpenCV WASM initialized');
      } else {
        console.error('OpenCV WASM failed to initialize');
      }
    } catch (err) {
      console.error('OpenCV WASM load error:', err);
    }
  })();
}


/** Downscale + median filter + color-line removal; keep a pristine origDownBuf for water crops. */
async function buildDownscaledBuffers(
  mapBuffer: Buffer, dims: ImageDims,
): Promise<{ origDownBuf: Buffer; rawBuf: Buffer; colorBuf: Buffer }> {
  const { TW, TH, RES_SCALE, oddK } = dims;
  const origDownBuf = await sharp(mapBuffer)
    .removeAlpha()
    .resize(TW, TH, { kernel: 'lanczos3' })
    .raw()
    .toBuffer();
  const rawBuf = await sharp(mapBuffer)
    .removeAlpha()
    .resize(TW, TH, { kernel: 'lanczos3' })
    .median(oddK(5))
    .raw()
    .toBuffer();
  removeColoredLines(rawBuf, TW, TH, RES_SCALE);
  const colorBuf = Buffer.from(origDownBuf);
  return { origDownBuf, rawBuf, colorBuf };
}

interface JsPipelineContextInput {
  cv: PipelineContext['cv'];
  regionId: number; worldViewId: number; regionName: string;
  knownDivisionIds: Set<number>;
  expectedRegionCount: number; mapBuffer: Buffer;
  dims: ImageDims;
  origDownBuf: Buffer; rawBuf: Buffer; colorBuf: Buffer;
  sendEvent: SendEvent;
  logStep: LogStep; pushDebugImage: PushDebugImage;
  debugImages: Array<{ label: string; dataUrl: string }>;
  startTime: number;
}

function buildJsPipelineContext(input: JsPipelineContextInput): PipelineContext {
  const { dims, cv, sendEvent, logStep, pushDebugImage, debugImages, startTime, regionName } = input;
  return {
    cv,
    regionId: input.regionId, worldViewId: input.worldViewId, regionName,
    knownDivisionIds: input.knownDivisionIds,
    expectedRegionCount: input.expectedRegionCount, mapBuffer: input.mapBuffer,
    TW: dims.TW, TH: dims.TH, tp: dims.tp, origW: dims.origW, origH: dims.origH, RES_SCALE: dims.RES_SCALE,
    origDownBuf: input.origDownBuf, rawBuf: input.rawBuf, colorBuf: input.colorBuf,
    hsvSharp: Buffer.alloc(0), labBufEarly: Buffer.alloc(0),
    hsvBuf: Buffer.alloc(0), inpaintedBuf: null,
    waterGrown: new Uint8Array(0),
    countryMask: new Uint8Array(0), countrySize: 0,
    coastalBand: new Uint8Array(0),
    pixelLabels: new Uint8Array(0),
    colorCentroids: [], clusterCounts: [],
    ckOverride: null, chromaBoost: 1.0, randomSeed: false,
    sendEvent: sendEvent as PipelineContext['sendEvent'],
    logStep, pushDebugImage, debugImages, startTime,
    oddK: dims.oddK, pxS: dims.pxS,
  };
}

/**
 * Morphological opening on the country mask — removes thin features (roads, border lines)
 * while preserving solid region fills. Mutates ctx.countryMask / countrySize / pixelLabels / clusterCounts.
 */
function applyRemoveRoadsPreset(ctx: PipelineContext): void {
  const { cv, TW, TH, tp } = ctx;
  const cmMat = cv.matFromArray(TH, TW, cv.CV_8UC1,
    Uint8Array.from(ctx.countryMask, (v: number) => v ? 255 : 0));
  const roadK = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(5, 5));
  const opened = new cv.Mat();
  cv.morphologyEx(cmMat, opened, cv.MORPH_OPEN, roadK);
  let removed = 0;
  for (let i = 0; i < tp; i++) {
    if (ctx.countryMask[i] && !opened.data[i]) {
      ctx.countryMask[i] = 0;
      ctx.countrySize--;
      if (ctx.pixelLabels[i] !== 255) {
        ctx.clusterCounts[ctx.pixelLabels[i]]--;
        ctx.pixelLabels[i] = 255;
      }
      removed++;
    }
  }
  cmMat.delete(); roadK.delete(); opened.delete();
  console.log(`  [Remove roads] Removed ${removed} thin pixels (${(removed / tp * 100).toFixed(1)}%)`);
}

/** Seed the BFS queue with all border inverse-mask pixels. */
function seedExteriorBorderQueue(
  inverseMask: Uint8Array, exterior: Uint8Array,
  TW: number, TH: number, queue: number[],
): void {
  for (let x = 0; x < TW; x++) {
    if (inverseMask[x]) { exterior[x] = 1; queue.push(x); }
    const bot = (TH - 1) * TW + x;
    if (inverseMask[bot]) { exterior[bot] = 1; queue.push(bot); }
  }
  for (let y = 0; y < TH; y++) {
    const left = y * TW;
    if (inverseMask[left]) { exterior[left] = 1; queue.push(left); }
    const right = y * TW + TW - 1;
    if (inverseMask[right]) { exterior[right] = 1; queue.push(right); }
  }
}

/** Push `n` onto the BFS queue if it's a valid, unmarked inverse-mask neighbor. */
function tryPushExteriorNeighbor(
  n: number, inverseMask: Uint8Array, exterior: Uint8Array,
  TW: number, TH: number, tp: number, queue: number[],
): void {
  if (n < 0 || n >= tp || !inverseMask[n] || exterior[n]) return;
  const nx = n % TW, ny = Math.floor(n / TW);
  if (nx < 0 || nx >= TW || ny < 0 || ny >= TH) return;
  exterior[n] = 1;
  queue.push(n);
}

/** Flood-fill `exterior` from all four image borders using the inverse country mask. */
function floodFillExteriorMask(
  inverseMask: Uint8Array, TW: number, TH: number, tp: number,
): Uint8Array {
  const exterior = new Uint8Array(tp);
  const queue: number[] = [];
  seedExteriorBorderQueue(inverseMask, exterior, TW, TH, queue);

  let head = 0;
  while (head < queue.length) {
    const p = queue[head++];
    tryPushExteriorNeighbor(p - 1, inverseMask, exterior, TW, TH, tp, queue);
    tryPushExteriorNeighbor(p + 1, inverseMask, exterior, TW, TH, tp, queue);
    tryPushExteriorNeighbor(p - TW, inverseMask, exterior, TW, TH, tp, queue);
    tryPushExteriorNeighbor(p + TW, inverseMask, exterior, TW, TH, tp, queue);
  }
  return exterior;
}

/** Collect interior hole pixels (not reachable from borders) and add them to the country mask. */
function collectAndFillInteriorHoles(
  ctx: PipelineContext, inverseMask: Uint8Array, exterior: Uint8Array, tp: number,
): number[] {
  const holePixels: number[] = [];
  for (let i = 0; i < tp; i++) {
    if (inverseMask[i] && !exterior[i]) {
      ctx.countryMask[i] = 1;
      ctx.countrySize++;
      holePixels.push(i);
    }
  }
  return holePixels;
}

/** Seed BFS queue: inherit a cluster label for each hole pixel from its first clustered neighbor. */
function seedHoleLabelsFromBoundary(
  ctx: PipelineContext, holePixels: number[], holeSet: Set<number>,
  tp: number, TW: number, fillQueue: number[],
): void {
  for (const hp of holePixels) {
    for (const n of [hp - 1, hp + 1, hp - TW, hp + TW]) {
      if (n < 0 || n >= tp || holeSet.has(n) || ctx.pixelLabels[n] === 255) continue;
      if (ctx.pixelLabels[hp] !== 255) break;
      ctx.pixelLabels[hp] = ctx.pixelLabels[n];
      ctx.clusterCounts[ctx.pixelLabels[n]]++;
      fillQueue.push(hp);
    }
  }
}

/** Propagate labels from the BFS queue into still-unlabeled hole pixels. */
function propagateHoleLabels(
  ctx: PipelineContext, holeSet: Set<number>,
  tp: number, TW: number, fillQueue: number[],
): void {
  let fHead = 0;
  while (fHead < fillQueue.length) {
    const p = fillQueue[fHead++];
    const label = ctx.pixelLabels[p];
    for (const n of [p - 1, p + 1, p - TW, p + TW]) {
      if (n >= 0 && n < tp && holeSet.has(n) && ctx.pixelLabels[n] === 255) {
        ctx.pixelLabels[n] = label;
        ctx.clusterCounts[label]++;
        fillQueue.push(n);
      }
    }
  }
}

/** BFS outward from hole-boundary cluster pixels, labelling adjacent hole pixels with neighbor's label. */
function bfsFillHoleLabels(
  ctx: PipelineContext, holePixels: number[], tp: number, TW: number,
): void {
  if (holePixels.length === 0) return;
  const holeSet = new Set(holePixels);
  const fillQueue: number[] = [];
  seedHoleLabelsFromBoundary(ctx, holePixels, holeSet, tp, TW, fillQueue);
  propagateHoleLabels(ctx, holeSet, tp, TW, fillQueue);
}

/** Fill interior holes (text/sign gaps) in the country mask. */
function applyFillHolesPreset(ctx: PipelineContext): void {
  const { TW, TH, tp } = ctx;
  const inverseMask = new Uint8Array(tp);
  for (let i = 0; i < tp; i++) {
    if (!ctx.countryMask[i]) inverseMask[i] = 1;
  }
  const exterior = floodFillExteriorMask(inverseMask, TW, TH, tp);
  const holePixels = collectAndFillInteriorHoles(ctx, inverseMask, exterior, tp);
  bfsFillHoleLabels(ctx, holePixels, tp, TW);
  console.log(`  [Fill holes] Filled ${holePixels.length} interior hole pixels (${(holePixels.length / tp * 100).toFixed(1)}%)`);
}

/** Grow one connected component starting at `seed`. Returns its size. */
function growConnectedComponent(
  seed: number, label: number,
  countryMask: Uint8Array, ccLabels: Int32Array,
  tp: number, TW: number, TH: number,
): number {
  const bfs = [seed];
  let size = 0;
  while (bfs.length > 0) {
    const p = bfs.pop()!;
    if (p < 0 || p >= tp || ccLabels[p] > 0 || !countryMask[p]) continue;
    ccLabels[p] = label;
    size++;
    const x = p % TW, y = Math.floor(p / TW);
    if (x > 0) bfs.push(p - 1);
    if (x < TW - 1) bfs.push(p + 1);
    if (y > 0) bfs.push(p - TW);
    if (y < TH - 1) bfs.push(p + TW);
  }
  return size;
}

/** Label connected components in the country mask using a BFS stack. */
function labelConnectedComponents(
  ctx: PipelineContext, tp: number, TW: number, TH: number,
): { ccLabels: Int32Array; ccSizes: Map<number, number> } {
  const ccLabels = new Int32Array(tp);
  let nextLabel = 1;
  const ccSizes = new Map<number, number>();
  for (let i = 0; i < tp; i++) {
    if (!ctx.countryMask[i] || ccLabels[i] > 0) continue;
    const label = nextLabel++;
    const size = growConnectedComponent(i, label, ctx.countryMask, ccLabels, tp, TW, TH);
    ccSizes.set(label, size);
  }
  return { ccLabels, ccSizes };
}

/** Remove small isolated pixel clusters (text remnants, icon fragments). */
function applyCleanSmallCCsPreset(
  ctx: PipelineContext, preset: 'clean_light' | 'clean_heavy',
): void {
  const { TW, TH, tp } = ctx;
  const threshold = preset === 'clean_light' ? 0.001 : 0.005;
  const minSize = Math.max(5, Math.round(ctx.countrySize * threshold));
  const { ccLabels, ccSizes } = labelConnectedComponents(ctx, tp, TW, TH);

  let removed = 0;
  const removedCCs = [...ccSizes.entries()].filter(([, s]) => s < minSize).length;
  for (let i = 0; i < tp; i++) {
    if (ccLabels[i] > 0 && (ccSizes.get(ccLabels[i]) ?? 0) < minSize) {
      ctx.countryMask[i] = 0;
      ctx.countrySize--;
      if (ctx.pixelLabels[i] !== 255) {
        ctx.clusterCounts[ctx.pixelLabels[i]]--;
        ctx.pixelLabels[i] = 255;
      }
      removed++;
    }
  }
  const variantLabel = preset === 'clean_light' ? 'light' : 'heavy';
  console.log(`  [Clean ${variantLabel}] Removed ${removed} pixels in ${removedCCs} small CCs (threshold: <${minSize}px = ${(threshold * 100).toFixed(1)}% of country)`);
}

/**
 * Apply a JS recluster preset to `ctx`. Returns `true` if the preset only cleans
 * existing clusters (skip K-means next iteration); `false` if K-means must re-run.
 */
function applyJsReclusterPreset(
  ctx: PipelineContext,
  preset: NonNullable<ReclusterSignal['preset']>,
  expectedRegionCount: number,
): boolean {
  if (preset === 'more_clusters') {
    const baseCK = ctx.ckOverride ?? Math.max(8, Math.min(expectedRegionCount * 3, 32));
    ctx.ckOverride = Math.min(baseCK + 4, 32);
    console.log(`  [Recluster] More clusters: CK → ${ctx.ckOverride}`);
    return false;
  }
  if (preset === 'different_seed') {
    ctx.randomSeed = true;
    console.log(`  [Recluster] Different seed: randomizing K-means++ init`);
    return false;
  }
  if (preset === 'boost_chroma') {
    ctx.chromaBoost = 1.5;
    console.log(`  [Recluster] Boost chroma: a*/b* weight → ${ctx.chromaBoost}`);
    return false;
  }
  if (preset === 'remove_roads') {
    applyRemoveRoadsPreset(ctx);
    return true;
  }
  if (preset === 'fill_holes') {
    applyFillHolesPreset(ctx);
    return true;
  }
  if (preset === 'clean_light' || preset === 'clean_heavy') {
    applyCleanSmallCCsPreset(ctx, preset);
    return true;
  }
  return false;
}

interface JsPipelineParams {
  mapBuffer: Buffer;
  dims: ImageDims;
  regionId: number; worldViewId: number; regionName: string;
  knownDivisionIds: Set<number>;
  childRegionMemberIds: Set<number>;
  countryIds: number[]; countryDepth: number;
  expectedRegionCount: number;
  sendEvent: SendEvent; logStep: LogStep; pushDebugImage: PushDebugImage;
  debugImages: Array<{ label: string; dataUrl: string }>;
  startTime: number;
}

/** Run the JavaScript CV branch: noise removal → mean-shift → K-means → match → recluster loop. */
export async function runJavaScriptPipeline(p: JsPipelineParams): Promise<void> {
  const { mapBuffer, dims, expectedRegionCount } = p;
  const { TW, TH, origW, origH } = dims;
  await p.logStep('Noise removal (downscale + median + line removal)...');
  if (!G.__cv) throw new Error('OpenCV WASM not available');
  const cv = G.__cv;

  const { origDownBuf, rawBuf, colorBuf } = await buildDownscaledBuffers(mapBuffer, dims);

  // Debug: show image after noise removal (before CV processing)
  const noiseRemovedPng = await sharp(Buffer.from(rawBuf), {
    raw: { width: TW, height: TH, channels: 3 },
  }).resize(origW, origH, { kernel: 'lanczos3' }).png().toBuffer();
  await p.pushDebugImage(
    'After noise removal (downscale + median + line removal)',
    `data:image/png;base64,${noiseRemovedPng.toString('base64')}`,
  );

  const ctx = buildJsPipelineContext({
    cv,
    regionId: p.regionId, worldViewId: p.worldViewId, regionName: p.regionName,
    knownDivisionIds: p.knownDivisionIds,
    expectedRegionCount, mapBuffer,
    dims, origDownBuf, rawBuf, colorBuf,
    sendEvent: p.sendEvent, logStep: p.logStep, pushDebugImage: p.pushDebugImage,
    debugImages: p.debugImages, startTime: p.startTime,
  });

  await meanshiftPreprocess(ctx);

  let reclusterResult: ReclusterSignal | void;
  let skipKmeans = false; // remove_roads / fill_holes / clean_* skip K-means
  do {
    if (!skipKmeans) await runKMeansClustering(ctx);
    skipKmeans = false;

    reclusterResult = await matchDivisionsFromClusters({
      worldViewId: p.worldViewId, regionId: p.regionId,
      knownDivisionIds: p.childRegionMemberIds,
      countryIds: p.countryIds, countryDepth: p.countryDepth,
      buf: ctx.colorBuf, origBuf: ctx.origDownBuf, mapBuffer,
      countryMask: ctx.countryMask,
      pixelLabels: ctx.pixelLabels, colorCentroids: ctx.colorCentroids,
      TW, TH, origW, origH,
      skipClusterReview: false,
      sendEvent: p.sendEvent as (event: Record<string, unknown>) => void,
      logStep: p.logStep, pushDebugImage: p.pushDebugImage,
      debugImages: p.debugImages, startTime: p.startTime,
    });

    if (reclusterResult?.recluster) {
      skipKmeans = applyJsReclusterPreset(ctx, reclusterResult.preset, expectedRegionCount);
      await p.logStep(skipKmeans ? 'Cleaning...' : 'Re-clustering...');
    }
  } while (reclusterResult?.recluster);
}
