/**
 * HTTP client for the Python CV microservice.
 *
 * Calls the FastAPI service running at CV_PYTHON_URL (default: http://cv-python:8000)
 * with binary multipart image data. Used when the admin toggles CV pipeline to "python".
 *
 * Responses are NDJSON streams: each line is a JSON object with type "progress",
 * "result", or "error". Progress lines are forwarded to the caller via onProgress.
 */

import { Agent, setGlobalDispatcher } from 'undici';

// eslint-disable-next-line sonarjs/no-clear-text-protocols -- Internal Docker-network fallback URL; container-to-container traffic is on a private bridge, not public internet
const CV_PYTHON_URL = process.env.CV_PYTHON_URL ?? 'http://cv-python:8000';

// undici (used by Node's built-in fetch) defaults bodyTimeout to 5 min — long
// CV phases (k-means on high-k maps, RANSAC matching on dense GADM polygons)
// can exceed that between progress messages, producing a spurious
// UND_ERR_BODY_TIMEOUT. Install a global dispatcher with 30-min timeouts so
// the native `fetch` calls below (which are the ones that reliably handle
// native FormData + Blob) pick up the longer limit. The global scope is
// fine: all outbound HTTP from this backend is through a small number of
// first-party services that benefit from the longer limit.
//
// Exported as an explicit init function — call once from server startup —
// so the global side-effect is visible at the call site rather than firing
// on import (which would silently affect every fetch in the process,
// including Wikimedia downloads and OpenAI calls, the moment any module
// imports this client).
let dispatcherInstalled = false;
export function initCvDispatcher(): void {
  if (dispatcherInstalled) return;
  setGlobalDispatcher(new Agent({
    bodyTimeout: 30 * 60 * 1000,
    headersTimeout: 30 * 60 * 1000,
  }));
  dispatcherInstalled = true;
}

interface NdjsonMessage<T> {
  type: string;
  step?: string;
  data?: T;
  message?: string;
  // Interactive-review envelope (Python emits {type:"review", kind:"water", reviewId:..., data:{...}})
  kind?: string;
  reviewId?: string;
}

export interface ReviewRequest {
  kind: string;
  reviewId: string;
  data: unknown;
}

/**
 * Handle a single parsed NDJSON message.
 * Returns the result value when type === 'result', otherwise undefined.
 * Throws on error messages.
 */
async function handleNdjsonMessage<T>(
  msg: NdjsonMessage<T>,
  phaseName: string,
  onProgress?: (step: string) => void | Promise<void>,
  onReview?: (req: ReviewRequest) => void | Promise<void>,
): Promise<T | undefined> {
  if (msg.type === 'progress' && msg.step) {
    if (onProgress) await onProgress(msg.step);
    return undefined;
  }
  if (msg.type === 'review' && msg.kind && msg.reviewId) {
    if (onReview) await onReview({ kind: msg.kind, reviewId: msg.reviewId, data: msg.data });
    return undefined;
  }
  if (msg.type === 'result') {
    return msg.data;
  }
  if (msg.type === 'error') {
    throw new Error(`${phaseName}: ${msg.message}`);
  }
  return undefined;
}

/**
 * Drain complete NDJSON lines from a buffer, returning the unconsumed remainder
 * and the latest result message (if any).
 */
async function drainNdjsonLines<T>(
  buffer: string,
  phaseName: string,
  onProgress?: (step: string) => void | Promise<void>,
  onReview?: (req: ReviewRequest) => void | Promise<void>,
): Promise<{ remainder: string; result: T | undefined }> {
  let remainder = buffer;
  let result: T | undefined;

  let newlineIdx = remainder.indexOf('\n');
  while (newlineIdx !== -1) {
    const line = remainder.slice(0, newlineIdx).trim();
    remainder = remainder.slice(newlineIdx + 1);
    if (line) {
      const msg = JSON.parse(line) as NdjsonMessage<T>;
      const maybeResult = await handleNdjsonMessage(msg, phaseName, onProgress, onReview);
      if (maybeResult !== undefined) result = maybeResult;
    }
    newlineIdx = remainder.indexOf('\n');
  }

  return { remainder, result };
}

/** Parse an NDJSON response stream, forwarding progress and returning the result. */
async function parseNdjsonStream<T>(
  res: Response,
  phaseName: string,
  onProgress?: (step: string) => void | Promise<void>,
  onReview?: (req: ReviewRequest) => void | Promise<void>,
): Promise<T> {
  const body = res.body;
  if (!body) throw new Error(`${phaseName}: no response body`);

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let result: T | undefined;

  while (true) {
    const { done, value } = await reader.read();
    if (value) buffer += decoder.decode(value, { stream: true });

    const drained = await drainNdjsonLines<T>(buffer, phaseName, onProgress, onReview);
    buffer = drained.remainder;
    if (drained.result !== undefined) result = drained.result;

    if (done) break;
  }

  // Flush the decoder and parse any final NDJSON object that wasn't terminated
  // by a newline. Without this, a result-bearing trailing frame would be lost.
  buffer += decoder.decode();
  if (buffer.trim()) {
    const drained = await drainNdjsonLines<T>(`${buffer}\n`, phaseName, onProgress, onReview);
    if (drained.result !== undefined) result = drained.result;
  }

  // Use === undefined so a falsy-but-valid result (e.g. {} or 0) is accepted.
  if (result === undefined) throw new Error(`${phaseName}: no result received`);
  return result;
}

/**
 * Forward an operator decision to a Python review that's blocked on /pipeline/respond.
 * Used by the backend when the frontend responds to a Python-originated review.
 */
export async function cvRespondToReview(reviewId: string, decision: unknown): Promise<void> {
  const res = await fetch(`${CV_PYTHON_URL}/pipeline/respond/${encodeURIComponent(reviewId)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(decision),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`CV respond failed: ${res.status} ${await res.text()}`);
}

/** Check if the Python CV service is available. */
export async function cvHealthCheck(): Promise<boolean> {
  try {
    const res = await fetch(`${CV_PYTHON_URL}/health`, { signal: AbortSignal.timeout(3000) });
    return res.ok;
  } catch {
    return false;
  }
}

/** Phase 1: Preprocess + water detection. Streams progress via onProgress. */
export async function cvPhase1(
  imageBuffer: Buffer,
  params: { tw: number; th: number; origW: number; origH: number },
  onProgress?: (step: string) => void | Promise<void>,
  onReview?: (req: ReviewRequest) => void | Promise<void>,
): Promise<{
  filteredImage: string;
  waterMask: string;
  waterComponents: Array<{ id: number; pct: number }>;
  countryMask: string;
  /**
   * Union of per-pixel masks from every "erase text/line/road" step in phase 1,
   * dilated to cover anti-aliased halos and clipped to the country interior.
   * Pass to phase 2 so K-means can exclude these pixels from voting.
   */
  knownNoiseMask: string;
  countrySize: number;
  debugImages: Array<{ label: string; dataUrl: string }>;
}> {
  const form = new FormData();
  form.append('image', new Blob([imageBuffer]), 'image.png');
  form.append('params', JSON.stringify(params));

  const res = await fetch(`${CV_PYTHON_URL}/pipeline/phase1`, {
    method: 'POST',
    body: form,
    signal: AbortSignal.timeout(30 * 60 * 1000), // 30 minutes (dispatcher handles bodyTimeout)
  });
  if (!res.ok) throw new Error(`CV Phase 1 failed: ${res.status} ${await res.text()}`);

  return parseNdjsonStream(res, 'CV Phase 1', onProgress, onReview);
}

/** Phase 2: Clustering + superpixels. Streams progress via onProgress. */
export async function cvPhase2(
  filteredImageBuffer: Buffer,
  countryMaskBuffer: Buffer,
  params: { tw: number; th: number; numClusters?: number; randomSeed?: number },
  onProgress?: (step: string) => void | Promise<void>,
  knownNoiseMaskBuffer?: Buffer,
): Promise<{
  pixelLabels: string;
  colorCentroids: Array<[number, number, number]>;
  superpixelLabels: string;
  clusterInfo: Array<{ label: number; color: string; pct: number; isSmall: boolean; componentCount: number }>;
  borderPaths: Array<{ id: string; points: Array<[number, number]>; type: string; clusters: [number, number] }>;
  quantizedImage: string;
  debugImages: Array<{ label: string; dataUrl: string }>;
  pipelineSize: { w: number; h: number };
}> {
  const form = new FormData();
  form.append('filteredImage', new Blob([filteredImageBuffer]), 'filtered.png');
  form.append('countryMask', new Blob([countryMaskBuffer]), 'mask.png');
  form.append('params', JSON.stringify(params));
  if (knownNoiseMaskBuffer) {
    form.append('knownNoiseMask', new Blob([knownNoiseMaskBuffer]), 'noise.png');
  }

  const res = await fetch(`${CV_PYTHON_URL}/pipeline/phase2`, {
    method: 'POST',
    body: form,
    signal: AbortSignal.timeout(30 * 60 * 1000), // 30 minutes (dispatcher handles bodyTimeout)
  });
  if (!res.ok) throw new Error(`CV Phase 2 failed: ${res.status} ${await res.text()}`);

  return parseNdjsonStream(res, 'CV Phase 2', onProgress);
}

/** Match phase: ICP alignment + division assignment. Streams progress via onProgress. */
export async function cvMatch(
  pixelLabelsBuffer: Buffer,
  icpMaskBuffer: Buffer,
  params: {
    tw: number;
    th: number;
    origW: number;
    origH: number;
    divisionPaths: unknown;
    centroids: unknown;
    colorCentroids: unknown;
    countryPath: unknown;
    countryBbox: unknown;
  },
  onProgress?: (step: string) => void | Promise<void>,
): Promise<{
  transform: { matrix: number[][]; cosLat: number; sx: number; sy: number };
  divAssignments: Array<{
    divisionId: number;
    clusterId: number;
    confidence: number;
    isSplit: boolean;
    splitClusters?: Array<{ clusterId: number; share: number }>;
  }>;
  outOfBounds: number[];
  alignmentMethod: string;
  alignmentError: number;
  inlierRatio: number;
  debugImages: Array<{ label: string; dataUrl: string }>;
}> {
  const form = new FormData();
  form.append('pixelLabels', new Blob([pixelLabelsBuffer]), 'pixel_labels.png');
  form.append('icpMask', new Blob([icpMaskBuffer]), 'icp_mask.png');
  // Send params as a file upload to bypass multipart 1MB field limit
  // (GADM SVG paths can be several MB for detailed coastlines)
  form.append('params', new Blob([JSON.stringify(params)], { type: 'application/json' }), 'params.json');

  const res = await fetch(`${CV_PYTHON_URL}/pipeline/match`, {
    method: 'POST',
    body: form,
    signal: AbortSignal.timeout(30 * 60 * 1000), // 30 minutes (dispatcher handles bodyTimeout)
  });
  if (!res.ok) throw new Error(`CV Match failed: ${res.status} ${await res.text()}`);

  return parseNdjsonStream(res, 'CV Match', onProgress);
}
