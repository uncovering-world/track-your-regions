/**
 * WorldView Import Match — CV Pipeline Orchestrator
 *
 * The SSE run a reviewer watches: it opens the stream, resolves the region and
 * the divisions the match may touch (`wvImportMatchScope.ts`), fetches the
 * source map, and hands the picture to whichever branch the
 * `cv_pipeline_implementation` setting names — the Python service
 * (`wvImportMatchPythonBranch.ts`) or this process's own OpenCV build
 * (`wvImportMatchJsBranch.ts`). What each branch does with it — text, water,
 * background, parks, clustering, matching — is the branch's own business; this
 * file owns the stream, the working dimensions and the dispatch.
 */

import { Response } from 'express';
import sharp from 'sharp';
import type { AuthenticatedRequest } from '../../middleware/auth.js';
import {
  loadRegionAndMap, loadKnownDivisionIds, resolveCountryIds, countChildRegions,
  loadAllDivisionIds, loadAssignedMap, loadCentroids, loadDivPathsAndBorders,
  renderBorderDebugPng,
} from './wvImportMatchScope.js';
import { runPythonPipeline } from './wvImportMatchPythonBranch.js';
// Imported for its own sake as much as for the call: this module initialises
// OpenCV at load, and a static import puts that cost at server startup.
import { runJavaScriptPipeline } from './wvImportMatchJsBranch.js';
import type {
  SendEvent, LogStep, PushDebugImage, ImageDims,
} from './wvImportMatchContext.js';
import { markStreamBody } from '../../middleware/cacheHeaders.js';
import { fetchPicture } from '../../services/pictureFetch.js';

// =============================================================================
// colorMatchDivisionsSSE helpers — the stream, the dimensions, the dispatch
// =============================================================================

/** Configure SSE response headers and return the raw sendEvent + logStep helpers. */
function createSseHelpers(res: Response, startTime: number): { sendEvent: SendEvent; logStep: LogStep } {
  res.setHeader('Content-Type', 'text/event-stream');
  markStreamBody(res);
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  // CORS is handled globally by the cors() middleware (origin: FRONTEND_ORIGIN,
  // credentials: true). Setting Access-Control-Allow-Origin: * here would both
  // widen the policy AND break credentialed SSE (browsers reject '*' with
  // credentials). The same-origin admin frontend uses ?token=… so we don't
  // need a custom CORS header here.
  res.flushHeaders();
  res.socket?.setNoDelay(true);

  const sendEvent: SendEvent = (event) => {
    if (res.destroyed) return;
    try { res.write(`data: ${JSON.stringify(event)}\n\n`); } catch { /* client disconnected */ }
  };
  const logStep: LogStep = async (step) => {
    const elapsed = (Date.now() - startTime) / 1000;
    console.log(`[CV Match SSE] ${step} (${elapsed.toFixed(1)}s)`);
    sendEvent({ type: 'progress', step, elapsed });
    await new Promise(resolve => setImmediate(resolve));
  };
  return { sendEvent, logStep };
}

/** Create a `pushDebugImage` callback that appends to a shared array, streams via SSE, and persists to disk. */
function createPushDebugImage(
  sendEvent: SendEvent,
  regionName: string,
  debugImages: Array<{ label: string; dataUrl: string }>,
): PushDebugImage {
  let debugIdx = 0;
  const debugSlug = regionName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return async (label, dataUrl) => {
    const img = { label, dataUrl };
    debugImages.push(img);
    sendEvent({ type: 'debug_image', debugImage: img });
    try {
      const b64 = dataUrl.replace(/^data:image\/\w+;base64,/, '');
      const fs = await import('fs');
      const dir = `${process.cwd()}/data/cv-debug`;
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(`${dir}/${debugSlug}-${String(debugIdx++).padStart(2, '0')}.png`, Buffer.from(b64, 'base64'));
    } catch { /* ignore */ }
    await new Promise(resolve => setImmediate(resolve));
  };
}

/** Compute working image dimensions + pixel-constant scalers from the original size. */
function deriveImageDims(origW: number, origH: number): ImageDims {
  const TW = 800;
  const scale = TW / origW;
  const TH = Math.round(origH * scale);
  const tp = TW * TH;
  const RES_SCALE = TW / 500;
  const oddK = (base: number) => { const v = Math.round(base * RES_SCALE); return v | 1; };
  const pxS = (base: number) => Math.round(base * RES_SCALE);
  return { TW, TH, tp, origW, origH, RES_SCALE, oddK, pxS };
}

interface SourceMapPipelineParams {
  regionMapUrl: string;
  regionName: string;
  regionId: number; worldViewId: number;
  knownDivisionIds: Set<number>;
  childRegionMemberIds: Set<number>;
  countryIds: number[]; countryDepth: number;
  expectedRegionCount: number;
  sendEvent: SendEvent; logStep: LogStep; pushDebugImage: PushDebugImage;
  debugImages: Array<{ label: string; dataUrl: string }>;
  startTime: number;
}

/**
 * Fetch the source map image, normalize to PNG, derive working dimensions, then dispatch to
 * the Python or JavaScript CV branch based on the `cv_pipeline_implementation` setting.
 */
async function runSourceMapPipeline(p: SourceMapPipelineParams, res: Response): Promise<void> {
  await p.logStep('Fetching source map image...');
  // `loadRegionAndMap` has refused a first address the rule would not call;
  // null here is a redirect that left the two Commons hosts (#706).
  const mapResponse = await fetchPicture(p.regionMapUrl, 'CV border detection');
  if (!mapResponse) {
    p.sendEvent({ type: 'error', message: 'The region map redirected off Wikimedia Commons, so it was not read' });
    return;
  }
  if (!mapResponse.ok) {
    // Said to the admin and not only to the log, like the two refusals beside
    // it: this is the likelier one — a Commons file renamed or deleted since
    // the import, or a 429 — and the run ends here either way, so a silent
    // return leaves the log stopped at "Fetching source map image…".
    console.log(`  Source map fetch failed: ${mapResponse.status}`);
    p.sendEvent({ type: 'error', message: `Wikimedia Commons answered ${mapResponse.status} for this region's map, so it was not read` });
    return;
  }

  const rawMapBuffer = Buffer.from(await mapResponse.arrayBuffer());
  const origMeta = await sharp(rawMapBuffer).metadata();
  const origW = origMeta.width!;
  const origH = origMeta.height!;
  // Normalize to PNG for compatibility with Python CV (cv2.imdecode raster only)
  const mapBuffer = await sharp(rawMapBuffer).removeAlpha().png().toBuffer();

  try {
    await p.pushDebugImage(
      '__source_map__',
      `data:image/png;base64,${mapBuffer.toString('base64')}`,
    );
  } catch (err) {
    console.warn('[CV] Failed to push source map debug image:', err);
  }

  const dims = deriveImageDims(origW, origH);

  // Decide Python vs JS implementation
  const { getSetting } = await import('../../services/ai/aiSettingsService.js');
  const cvImpl = await getSetting('cv_pipeline_implementation') ?? 'javascript';
  if (cvImpl === 'python') {
    const handled = await runPythonPipeline({
      mapBuffer, dims, expectedRegionCount: p.expectedRegionCount,
      regionId: p.regionId, worldViewId: p.worldViewId,
      childRegionMemberIds: p.childRegionMemberIds,
      countryIds: p.countryIds, countryDepth: p.countryDepth,
      sendEvent: p.sendEvent, logStep: p.logStep, pushDebugImage: p.pushDebugImage,
      debugImages: p.debugImages, startTime: p.startTime,
    }, res);
    if (handled) return;
  }

  await runJavaScriptPipeline({
    mapBuffer, dims,
    regionId: p.regionId, worldViewId: p.worldViewId, regionName: p.regionName,
    knownDivisionIds: p.knownDivisionIds,
    childRegionMemberIds: p.childRegionMemberIds,
    countryIds: p.countryIds, countryDepth: p.countryDepth,
    expectedRegionCount: p.expectedRegionCount,
    sendEvent: p.sendEvent, logStep: p.logStep, pushDebugImage: p.pushDebugImage,
    debugImages: p.debugImages, startTime: p.startTime,
  });
}

// =============================================================================
// colorMatchDivisionsSSE — SSE-streaming CV pipeline orchestrator
// =============================================================================

export async function colorMatchDivisionsSSE(req: AuthenticatedRequest, res: Response): Promise<void> {
  const worldViewId = parseInt(String(req.params.worldViewId));
  const regionId = parseInt(String(req.query.regionId));

  const startTime = Date.now();
  const { sendEvent, logStep } = createSseHelpers(res, startTime);

  // 1. Load region name + map URL
  const regionInfo = await loadRegionAndMap(regionId, worldViewId, sendEvent, res);
  if (!regionInfo) return;
  const { regionName, regionMapUrl } = regionInfo;

  await logStep(`Loading divisions for ${regionName}...`);

  // 2. Resolve division scope
  const { knownDivisionIds, childRegionMemberIds } = await loadKnownDivisionIds(regionId, worldViewId);
  if (knownDivisionIds.size === 0) {
    sendEvent({ type: 'error', message: 'No divisions found in this region or its children — need at least one accepted division (region_members)' });
    res.end();
    return;
  }

  const countryIds = await resolveCountryIds(knownDivisionIds, childRegionMemberIds);
  if (countryIds.length === 0) {
    sendEvent({ type: 'error', message: 'Cannot determine GADM scope: region has no own division and no children with divisions assigned' });
    res.end();
    return;
  }
  const countryDepth = 0;

  const expectedRegionCount = await countChildRegions(regionId, worldViewId);

  // 3. Walk down the GADM tree to the target depth
  const allDivisionIds = await loadAllDivisionIds(
    countryIds, knownDivisionIds, expectedRegionCount, countryDepth,
  );
  if (allDivisionIds.length === 0) {
    sendEvent({ type: 'error', message: 'No divisions found at this level' });
    res.end();
    return;
  }

  const gapCount = allDivisionIds.length - childRegionMemberIds.size;
  await logStep(`Found ${allDivisionIds.length} divisions (${childRegionMemberIds.size} assigned to child regions, ${gapCount} to process)`);

  // 4. Load assignments + centroids
  const assignedMap = await loadAssignedMap(regionId, worldViewId);
  const centroids = await loadCentroids(allDivisionIds, assignedMap);

  await logStep(`Computing borders for ${centroids.length} divisions...`);

  // 5. Fetch SVG paths + classified borders, render "Step 1" debug image
  const borderData = await loadDivPathsAndBorders(allDivisionIds);
  if (!borderData) {
    sendEvent({ type: 'error', message: 'Could not compute borders' });
    res.end();
    return;
  }

  const borderPng = await renderBorderDebugPng(borderData, centroids);

  const debugImages: Array<{ label: string; dataUrl: string }> = [];
  const pushDebugImage = createPushDebugImage(sendEvent, regionName, debugImages);

  await pushDebugImage(
    'Step 1: GADM divisions with classified borders (red=external, blue dashed=internal, green dot=assigned, orange dot=unassigned)',
    `data:image/png;base64,${borderPng.toString('base64')}`,
  );

  // 6. Source map → CV pipeline (Python or JavaScript)
  try {
    await runSourceMapPipeline({
      regionMapUrl, regionName,
      regionId, worldViewId,
      knownDivisionIds, childRegionMemberIds,
      countryIds, countryDepth,
      expectedRegionCount,
      sendEvent, logStep, pushDebugImage,
      debugImages, startTime,
    }, res);
  } catch (mapErr) {
    const errMsg = mapErr instanceof Error ? mapErr.message : String(mapErr);
    console.error('  Source map border detection failed:', mapErr);
    await logStep(`CV processing error: ${errMsg}`);
  }

  if (!res.destroyed) res.end();
}
