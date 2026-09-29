/**
 * The colour match as this process runs it, on OpenCV's WASM build.
 *
 * The same sequence the Python service performs, in-process: the downscaled
 * buffers (`colorMatch/pixels/colorLines.ts`), the context every phase writes
 * into, and the loop that re-runs the match with the reclustering preset a
 * reviewer asks for (`colorMatch/cluster/reclusterPresets.ts`).
 *
 * OpenCV is initialised here, at module load, and cached on `globalThis` so a
 * hot reload does not pay for it twice; the orchestrator imports this module
 * statically so the cost lands at server startup rather than in a request.
 * Nothing under `services/` loads OpenCV: the passes there read the instance
 * this module leaves, from the pipeline context or from `globalThis.__cv`.
 */

import type {
  SendEvent,
  LogStep,
  PushDebugImage,
  ImageDims,
  PipelineContext,
} from '../../services/worldViewImport/colorMatch/context.js';
import sharp from 'sharp';
import { matchDivisionsFromClusters, type ReclusterSignal } from './wvImportMatchShared.js';
import { buildDownscaledBuffers } from '../../services/worldViewImport/colorMatch/pixels/colorLines.js';
import { runKMeansClustering } from '../../services/worldViewImport/colorMatch/cluster/kmeans.js';
import { applyJsReclusterPreset } from '../../services/worldViewImport/colorMatch/cluster/reclusterPresets.js';
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
    sendEvent,
    logStep, pushDebugImage, debugImages, startTime,
    oddK: dims.oddK, pxS: dims.pxS,
  };
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
      sendEvent: p.sendEvent,
      logStep: p.logStep, pushDebugImage: p.pushDebugImage,
      debugImages: p.debugImages, startTime: p.startTime,
    });

    if (reclusterResult?.recluster) {
      skipKmeans = applyJsReclusterPreset(ctx, reclusterResult.preset, expectedRegionCount);
      await p.logStep(skipKmeans ? 'Cleaning...' : 'Re-clustering...');
    }
  } while (reclusterResult?.recluster);
}
