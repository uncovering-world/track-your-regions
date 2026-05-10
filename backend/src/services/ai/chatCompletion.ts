/**
 * Model-agnostic chat completion wrapper.
 *
 * Tries the request with optional params (temperature, top_p, max_completion_tokens).
 * If the model rejects a param (400 "Unsupported parameter/value"), retries without it.
 * Caches unsupported params per model so subsequent calls skip them immediately.
 *
 * Also logs per-call timing for performance diagnostics.
 */

import type OpenAI from 'openai';
import type { ChatCompletionCreateParamsNonStreaming } from 'openai/resources/chat/completions.js';

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
 * Retry the completion with the offending param stripped.
 */
async function retryWithoutParam(
  client: OpenAI,
  cleanParams: ChatCompletionCreateParamsNonStreaming,
  model: string,
  badParam: OptionalParam,
): Promise<OpenAI.Chat.Completions.ChatCompletion> {
  rememberUnsupportedParam(model, badParam);
  console.log(`[AI] Model "${model}" does not support "${badParam}" — retrying without it`);

  const retryParams = { ...cleanParams };

  delete (retryParams as unknown as Record<string, unknown>)[badParam];
  const t1 = performance.now();
  const result = await client.chat.completions.create(retryParams);
  const ms = performance.now() - t1;
  const tokens = result.usage?.total_tokens ?? 0;
  console.log(`[AI] ${model} ${tokens}tok ${ms.toFixed(0)}ms (retry w/o ${badParam})`);
  return result;
}

/**
 * Create a chat completion with automatic parameter negotiation.
 *
 * Pass `temperature`, `top_p`, etc. as normal — they'll be silently
 * dropped for models that don't support them, and used for those that do.
 */
export async function chatCompletion(
  client: OpenAI,
  params: ChatCompletionCreateParamsNonStreaming,
): Promise<OpenAI.Chat.Completions.ChatCompletion> {
  const model = params.model;
  const cleanParams = stripKnownUnsupportedParams(params, model);

  const t0 = performance.now();
  try {
    const result = await client.chat.completions.create(cleanParams);
    const ms = performance.now() - t0;
    const tokens = result.usage?.total_tokens ?? 0;
    console.log(`[AI] ${model} ${tokens}tok ${ms.toFixed(0)}ms`);
    return result;
  } catch (err: unknown) {
    const apiErr = err as ApiError;

    if (apiErr.status === 429) {
      logRateLimit(model, apiErr, t0);
    }

    const badParam = getUnsupportedOptionalParam(apiErr);
    if (badParam) {
      return retryWithoutParam(client, cleanParams, model, badParam);
    }
    throw err;
  }
}
