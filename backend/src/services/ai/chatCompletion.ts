/**
 * Model-agnostic chat completion wrapper.
 *
 * Tries the request with optional params (temperature, top_p, max_completion_tokens).
 * If the model rejects a param (400 "Unsupported parameter/value"), retries without it.
 * Caches unsupported params per model so subsequent calls skip them immediately.
 *
 * Enforces a request timeout via AbortSignal so a hung OpenAI call can't stall
 * a sync indefinitely (#365). Default 120s — overridable per-call. Pass
 * `timeoutMs: null` to opt out entirely. An external `signal` can be passed
 * for caller-driven cancellation; it's combined with the timeout signal.
 *
 * Also logs per-call timing for performance diagnostics.
 */

import type OpenAI from 'openai';
import type { ChatCompletionCreateParamsNonStreaming } from 'openai/resources/chat/completions.js';

/** Default request timeout in ms. Single non-streaming completion → 120s is generous. */
export const DEFAULT_AI_TIMEOUT_MS = 120_000;

export interface ChatCompletionOptions {
  /**
   * Per-call request timeout in ms.
   * - `undefined` (default) → DEFAULT_AI_TIMEOUT_MS
   * - positive number → use that as the timeout
   * - `null` → no timeout (rely on SDK default ~10 min)
   */
  timeoutMs?: number | null;
  /**
   * External AbortSignal for caller-driven cancellation. Combined with the
   * timeout signal — whichever fires first aborts the request.
   */
  signal?: AbortSignal;
}

/**
 * Thrown when a chatCompletion call hits its `timeoutMs` budget. Distinct
 * from a caller-cancelled abort (which surfaces as the SDK's own abort
 * error) so callers can handle the two cases separately — e.g. retry on
 * timeout but bail on cancellation.
 */
export class ChatCompletionTimeoutError extends Error {
  readonly isTimeout = true as const;
  constructor(
    public readonly timeoutMs: number,
    public readonly model: string,
    public readonly elapsedMs: number,
  ) {
    super(`AI request to model "${model}" timed out after ${elapsedMs.toFixed(0)}ms (limit ${timeoutMs}ms)`);
    this.name = 'ChatCompletionTimeoutError';
  }
}

/** In-memory cache: model → set of param names the model doesn't support */
const unsupportedParams = new Map<string, Set<string>>();

/** Params we may need to strip for compatibility */
const OPTIONAL_PARAMS = ['temperature', 'top_p', 'max_completion_tokens'] as const;
type OptionalParam = (typeof OPTIONAL_PARAMS)[number];

const UNSUPPORTED_RE = /Unsupported (?:parameter|value): '(\w+)'/;

interface ApiError {
  status?: number;
  message?: string;
  headers?: Record<string, string>;
}

/**
 * Strip params from a base request that are already known to be unsupported
 * by this model. Returns a new object if any were stripped; otherwise the
 * original reference.
 */
function stripKnownUnsupportedParams(
  params: ChatCompletionCreateParamsNonStreaming,
  model: string,
): ChatCompletionCreateParamsNonStreaming {
  const known = unsupportedParams.get(model);
  if (!known || known.size === 0) return params;
  const cleaned = { ...params };
  for (const p of known) {

    delete (cleaned as unknown as Record<string, unknown>)[p];
  }
  return cleaned;
}

/**
 * Log a 429 rate-limit event with retry-after details.
 */
function logRateLimit(model: string, apiErr: ApiError, startedAt: number): void {
  const retryAfter = apiErr.headers?.['retry-after'] ?? apiErr.headers?.['Retry-After'] ?? '?';
  console.warn(`[AI] 429 rate-limited on "${model}" — retry-after: ${retryAfter}s (${(performance.now() - startedAt).toFixed(0)}ms)`);
}

/**
 * Extract an unsupported optional param name from an API error, if the
 * error indicates one.
 */
function getUnsupportedOptionalParam(apiErr: ApiError): OptionalParam | null {
  if (apiErr.status !== 400 || !apiErr.message) return null;
  const match = UNSUPPORTED_RE.exec(apiErr.message);
  if (!match) return null;
  const badParam = match[1] as OptionalParam;
  return OPTIONAL_PARAMS.includes(badParam) ? badParam : null;
}

/**
 * Record a param as unsupported for the given model so future calls strip it.
 */
function rememberUnsupportedParam(model: string, param: OptionalParam): void {
  if (!unsupportedParams.has(model)) {
    unsupportedParams.set(model, new Set());
  }
  unsupportedParams.get(model)!.add(param);
}

/**
 * Retry the completion with the offending param stripped. Reuses the same
 * abort signal so the timeout budget still applies to the retry attempt
 * (the unsupported-param branch only fires on a fast 400, so most of the
 * timeout window is still available).
 */
async function retryWithoutParam(
  client: OpenAI,
  cleanParams: ChatCompletionCreateParamsNonStreaming,
  model: string,
  badParam: OptionalParam,
  signal?: AbortSignal,
): Promise<OpenAI.Chat.Completions.ChatCompletion> {
  rememberUnsupportedParam(model, badParam);
  console.log(`[AI] Model "${model}" does not support "${badParam}" — retrying without it`);

  const retryParams = { ...cleanParams };

  delete (retryParams as unknown as Record<string, unknown>)[badParam];
  const t1 = performance.now();
  const result = await client.chat.completions.create(retryParams, signal ? { signal } : undefined);
  const ms = performance.now() - t1;
  const tokens = result.usage?.total_tokens ?? 0;
  console.log(`[AI] ${model} ${tokens}tok ${ms.toFixed(0)}ms (retry w/o ${badParam})`);
  return result;
}

/**
 * Build the AbortSignal passed to the OpenAI SDK call. Combines a fresh
 * timeout signal (if `timeoutMs > 0`) with an external caller-supplied
 * signal (if any). Uses manual `setTimeout + AbortController` rather than
 * `AbortSignal.timeout()` so vitest fake timers can intercept the timer
 * (the platform AbortSignal.timeout() bypasses vi.useFakeTimers).
 *
 * Returns the signal that goes to the SDK, plus the timeout signal handle
 * so the caller can detect "this aborted because of OUR timeout vs the
 * caller's cancellation", plus a cleanup function to clear the timer.
 */
function buildRequestSignal(
  timeoutMs: number | null | undefined,
  externalSignal: AbortSignal | undefined,
): {
  requestSignal: AbortSignal | undefined;
  timeoutSignal: AbortSignal | undefined;
  cleanup: () => void;
} {
  let timeoutSignal: AbortSignal | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  if (typeof timeoutMs === 'number' && timeoutMs > 0) {
    const ctl = new AbortController();
    timer = setTimeout(() => ctl.abort(new Error('timeout')), timeoutMs);
    timeoutSignal = ctl.signal;
  }
  const cleanup = (): void => {
    if (timer) clearTimeout(timer);
  };

  const signals = [externalSignal, timeoutSignal].filter((s): s is AbortSignal => s != null);
  let requestSignal: AbortSignal | undefined;
  if (signals.length === 0) requestSignal = undefined;
  else if (signals.length === 1) requestSignal = signals[0];
  else requestSignal = AbortSignal.any(signals);
  return { requestSignal, timeoutSignal, cleanup };
}

/**
 * Create a chat completion with automatic parameter negotiation and a
 * request timeout.
 *
 * Pass `temperature`, `top_p`, etc. as normal — they'll be silently
 * dropped for models that don't support them, and used for those that do.
 *
 * @throws ChatCompletionTimeoutError if `options.timeoutMs` (default 120s)
 *   elapses before a response. Distinct from a caller-cancelled abort.
 */
export async function chatCompletion(
  client: OpenAI,
  params: ChatCompletionCreateParamsNonStreaming,
  options: ChatCompletionOptions = {},
): Promise<OpenAI.Chat.Completions.ChatCompletion> {
  const { timeoutMs = DEFAULT_AI_TIMEOUT_MS, signal: externalSignal } = options;
  const model = params.model;
  const cleanParams = stripKnownUnsupportedParams(params, model);

  const { requestSignal, timeoutSignal, cleanup } = buildRequestSignal(timeoutMs, externalSignal);

  const t0 = performance.now();
  try {
    const result = await client.chat.completions.create(
      cleanParams,
      requestSignal ? { signal: requestSignal } : undefined,
    );
    const ms = performance.now() - t0;
    const tokens = result.usage?.total_tokens ?? 0;
    console.log(`[AI] ${model} ${tokens}tok ${ms.toFixed(0)}ms`);
    return result;
  } catch (err: unknown) {
    // Distinguish "we hit our timeout" from "caller cancelled" or other errors.
    // timeoutSignal.aborted is the precise signal that fired; checking it (vs
    // requestSignal.aborted) avoids mis-classifying a caller cancellation as
    // a timeout. (timeoutSignal only exists when timeoutMs > 0, so the cast
    // below is safe.)
    if (timeoutSignal?.aborted) {
      throw makeTimeoutError(model, timeoutMs as number, performance.now() - t0);
    }

    const apiErr = err as ApiError;
    if (apiErr.status === 429) {
      logRateLimit(model, apiErr, t0);
    }

    const badParam = getUnsupportedOptionalParam(apiErr);
    if (badParam) {
      // `await` is load-bearing: without it, the retry's AbortError would
      // escape past this catch and reach the caller as a raw AbortError
      // instead of the contracted ChatCompletionTimeoutError.
      try {
        return await retryWithoutParam(client, cleanParams, model, badParam, requestSignal);
      } catch (retryErr) {
        if (timeoutSignal?.aborted) {
          throw makeTimeoutError(model, timeoutMs as number, performance.now() - t0, /*duringRetry*/ true);
        }
        throw retryErr;
      }
    }
    throw err;
  } finally {
    cleanup();
  }
}

/** Build the ChatCompletionTimeoutError + emit a uniform log line. */
function makeTimeoutError(
  model: string,
  timeoutMs: number,
  elapsedMs: number,
  duringRetry = false,
): ChatCompletionTimeoutError {
  const where = duringRetry ? ' during retry' : '';
  console.warn(`[AI] ${model} request timed out${where} after ${elapsedMs.toFixed(0)}ms (limit ${timeoutMs}ms)`);
  return new ChatCompletionTimeoutError(timeoutMs, model, elapsedMs);
}
