/**
 * The colour match as the Python service runs it.
 *
 * Phase one hands the service the picture and takes back the buffers the rest
 * of the run needs; phase two is the loop a reclustering asks for, each pass
 * reported to the browser as it lands. The JavaScript branch beside it does
 * the same work in-process — `wvImportMatchJsBranch.ts`.
 *
 * Split out of `wvImportMatchPipeline.ts`, which had reached the length the
 * lint draws the line at (#933).
 */

import type { SendEvent, LogStep, PushDebugImage, ImageDims } from './wvImportMatchContext.js';
import { Response } from 'express';
import sharp from 'sharp';
import { matchDivisionsFromClusters, type ReclusterSignal } from './wvImportMatchShared.js';


interface PythonPipelineParams {
  mapBuffer: Buffer;
  dims: ImageDims;
  expectedRegionCount: number;
  regionId: number; worldViewId: number;
  childRegionMemberIds: Set<number>;
  countryIds: number[]; countryDepth: number;
  sendEvent: SendEvent; logStep: LogStep; pushDebugImage: PushDebugImage;
  debugImages: Array<{ label: string; dataUrl: string }>;
  startTime: number;
}

interface PythonPhase1Buffers {
  filteredBuf: Buffer;
  maskBuf: Buffer;
  noiseMaskBuf: Buffer | undefined;
  origDownBuf: Buffer;
  filteredRawBuf: Buffer;
}

/** Run Python Phase 1 and decode its outputs into reusable buffers. */
async function runPythonPhase1AndPrepareBuffers(
  cvPhase1: typeof import('../../services/cv/pythonCvClient.js').cvPhase1,
  mapBuffer: Buffer, dims: ImageDims,
  pyProgress: (step: string) => Promise<void>,
  logStep: LogStep, pushDebugImage: PushDebugImage,
  sendEvent: SendEvent,
): Promise<PythonPhase1Buffers> {
  const { TW, TH, origW, origH } = dims;
  // Handle interactive review requests emitted by Python (currently just water
  // review). Emit the equivalent SSE event to the frontend, wait for the
  // operator's response via POST /wv-import/water-review/:id, then forward
  // the decision to Python /pipeline/respond/:id so the worker unblocks.
  const { registerPythonReview } = await import('../../services/cv/pythonReviewBridge.js');
  const { cvRespondToReview } = await import('../../services/cv/pythonCvClient.js');
  const onReview = async (req: { kind: string; reviewId: string; data: unknown }) => {
    if (req.kind === 'water') {
      const data = (req.data ?? {}) as {
        components?: Array<{ id: number; pct: number; cropDataUrl: string; subClusters: Array<{ idx: number; pct: number; cropDataUrl: string }> }>;
        waterPxPercent?: number;
        waterMaskImage?: string;
      };
      sendEvent({
        type: 'water_review',
        reviewId: req.reviewId,
        waterPxPercent: data.waterPxPercent ?? 0,
        waterMaskImage: data.waterMaskImage ?? '',
        waterComponents: (data.components ?? []).map(c => ({
          id: c.id,
          pct: c.pct,
          cropDataUrl: c.cropDataUrl,
          subClusters: (c.subClusters ?? []).map(sc => ({ idx: sc.idx, pct: sc.pct, cropDataUrl: sc.cropDataUrl })),
        })),
      });
      const decision = await new Promise<unknown>((resolve) => {
        registerPythonReview(req.reviewId, resolve);
      });
      await cvRespondToReview(req.reviewId, decision);
    } else {
      console.warn(`[Python Review] Unknown review kind "${req.kind}" — continuing without response`);
      await cvRespondToReview(req.reviewId, {});
    }
  };

  const phase1 = await cvPhase1(mapBuffer, { tw: TW, th: TH, origW, origH }, pyProgress, onReview);
  for (const di of phase1.debugImages) await pushDebugImage(di.label, di.dataUrl);
  if (phase1.waterComponents.length > 0) {
    await logStep(`Python CV: water detection found ${phase1.waterComponents.length} component(s)`);
  }

  const filteredBuf = Buffer.from(phase1.filteredImage.replace(/^data:image\/png;base64,/, ''), 'base64');
  const maskBuf = Buffer.from(phase1.countryMask.replace(/^data:image\/png;base64,/, ''), 'base64');
  const noiseMaskBuf = phase1.knownNoiseMask
    ? Buffer.from(phase1.knownNoiseMask.replace(/^data:image\/png;base64,/, ''), 'base64')
    : undefined;
  const origDownBuf = await sharp(mapBuffer)
    .removeAlpha().resize(TW, TH, { kernel: 'lanczos3' }).raw().toBuffer();
  // Raw RGB version of the Python-filtered image (mean-shifted, text+road-inpainted).
  // Must NOT be origDownBuf — passing the dirty original re-introduces road/text pixel
  // colors into cluster centroids.
  const filteredRawBuf = await sharp(filteredBuf).removeAlpha().raw().toBuffer();
  return { filteredBuf, maskBuf, noiseMaskBuf, origDownBuf, filteredRawBuf };
}

interface PythonPhase2Outcome {
  pixelLabels: Uint8Array;
  colorCentroids: Array<[number, number, number] | null>;
  countryMask: Uint8Array;
}

/** Run Python Phase 2 for a single iteration and materialize its outputs into typed arrays. */
async function runPythonPhase2Iteration(
  cvPhase2: typeof import('../../services/cv/pythonCvClient.js').cvPhase2,
  buffers: PythonPhase1Buffers, dims: ImageDims,
  numClusters: number, randomSeed: number,
  pyProgress: (step: string) => Promise<void>,
  pushDebugImage: PushDebugImage,
): Promise<PythonPhase2Outcome> {
  const { TW, TH } = dims;
  const phase2 = await cvPhase2(
    buffers.filteredBuf, buffers.maskBuf,
    { tw: TW, th: TH, numClusters, randomSeed },
    pyProgress, buffers.noiseMaskBuf,
  );
  for (const di of phase2.debugImages) await pushDebugImage(di.label, di.dataUrl);

  const pixelLabels = new Uint8Array(Buffer.from(phase2.pixelLabels, 'base64'));
  const colorCentroids: Array<[number, number, number] | null> = new Array(32).fill(null);
  for (let i = 0; i < phase2.colorCentroids.length; i++) {
    colorCentroids[i] = phase2.colorCentroids[i];
  }
  if (phase2.quantizedImage) {
    await pushDebugImage('__quantized_map__', phase2.quantizedImage);
  }
  const countryMask = new Uint8Array(TW * TH);
  for (let i = 0; i < pixelLabels.length; i++) {
    countryMask[i] = pixelLabels[i] !== 255 ? 1 : 0;
  }
  return { pixelLabels, colorCentroids, countryMask };
}

/**
 * Execute the Python CV branch. Returns `true` when Python handled the request (caller should exit);
 * `false` when the Python service is unavailable and the caller should fall back to JavaScript.
 */
export async function runPythonPipeline(p: PythonPipelineParams, res: Response): Promise<boolean> {
  const { cvHealthCheck, cvPhase1, cvPhase2 } = await import('../../services/cv/pythonCvClient.js');
  const isAvailable = await cvHealthCheck();
  if (!isAvailable) {
    console.warn('[CV] Python service unavailable, falling back to JavaScript');
    return false;
  }
  console.log('[CV] Using Python CV pipeline');

  const { mapBuffer, dims, expectedRegionCount } = p;
  const { TW, TH, origW, origH } = dims;
  const pyProgress = (step: string) => p.logStep(`Python CV: ${step}`);

  const buffers = await runPythonPhase1AndPrepareBuffers(
    cvPhase1, mapBuffer, dims, pyProgress, p.logStep, p.pushDebugImage, p.sendEvent,
  );

  let pyNumClusters = Math.max(8, Math.min(expectedRegionCount * 3, 32));
  let pyRandomSeed = 0; // 0 = deterministic PP_CENTERS, >0 = RANDOM_CENTERS with this seed
  let pyRecluster: ReclusterSignal | void;
  do {
    const seedSuffix = pyRandomSeed ? `, seed #${pyRandomSeed}` : '';
    await p.logStep(`Python CV: clustering (k=${pyNumClusters}${seedSuffix}) + superpixels...`);
    const { pixelLabels, colorCentroids, countryMask } = await runPythonPhase2Iteration(
      cvPhase2, buffers, dims, pyNumClusters, pyRandomSeed, pyProgress, p.pushDebugImage,
    );

    pyRecluster = await matchDivisionsFromClusters({
      worldViewId: p.worldViewId, regionId: p.regionId,
      knownDivisionIds: p.childRegionMemberIds,
      countryIds: p.countryIds, countryDepth: p.countryDepth,
      buf: buffers.filteredRawBuf, origBuf: buffers.origDownBuf, mapBuffer,
      countryMask, pixelLabels, colorCentroids,
      TW, TH, origW, origH,
      skipClusterReview: false,
      sendEvent: p.sendEvent,
      logStep: p.logStep, pushDebugImage: p.pushDebugImage,
      debugImages: p.debugImages, startTime: p.startTime,
    });

    if (pyRecluster?.recluster) {
      const { next, seed } = applyPythonReclusterPreset(pyRecluster.preset, pyNumClusters, pyRandomSeed);
      pyNumClusters = next;
      pyRandomSeed = seed;
    }
  } while (pyRecluster?.recluster);

  res.end();
  return true;
}

/** Pure computation of updated (k, seed) from a Python recluster preset. */
function applyPythonReclusterPreset(
  preset: NonNullable<ReclusterSignal['preset']>,
  k: number, seed: number,
): { next: number; seed: number } {
  if (preset === 'more_clusters') {
    const nextK = Math.min(k + 4, 32);
    const nextSeed = seed + 1;
    console.log(`  [Python Recluster] More clusters: k → ${nextK}, seed #${nextSeed}`);
    return { next: nextK, seed: nextSeed };
  }
  if (preset === 'different_seed') {
    const nextSeed = seed + 1;
    console.log(`  [Python Recluster] Different seed #${nextSeed}`);
    return { next: k, seed: nextSeed };
  }
  if (preset === 'boost_chroma') {
    const nextSeed = seed + 1;
    console.log(`  [Python Recluster] Boost chroma, seed #${nextSeed}`);
    return { next: k, seed: nextSeed };
  }
  // remove_roads, fill_holes, clean_light, clean_heavy — Python re-runs full Phase 2
  console.log(`  [Python Recluster] ${preset}: re-running full Phase 2 (cleanup presets not yet optimized for Python)`);
  return { next: k, seed };
}
