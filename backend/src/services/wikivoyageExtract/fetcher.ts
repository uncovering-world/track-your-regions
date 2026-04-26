/**
 * WikivoyageFetcher — HTTP + rate limiting + retry + file cache
 *
 * Ported from Python WikivoyageFetcher class.
 * Uses an async queue to serialize concurrent calls (Node.js doesn't need
 * locks but needs call ordering for rate limiting).
 */

import type { ExtractionProgress } from './types.js';
import { FileCache } from './cache.js';

const API_URL = 'https://en.wikivoyage.org/w/api.php';
const USER_AGENT =
  'TrackYourRegions/1.0 (https://github.com/nikolay/track-your-regions; region hierarchy extraction)';
const MIN_REQUEST_INTERVAL_MS = 350;
const MAX_RETRIES = 5;

type FetchOutcome =
  | { kind: 'success'; data: Record<string, unknown> }
  | { kind: 'retry' };

export class WikivoyageFetcher {
  private cache: FileCache;
  private lastRequestTime = 0;
  private requestCount = 0;
  private pendingRequest: Promise<void> = Promise.resolve();
  private progress: ExtractionProgress;

  constructor(cachePath: string, progress: ExtractionProgress) {
    this.cache = new FileCache(cachePath);
    this.progress = progress;
  }

  /**
   * Make a cached, rate-limited, retrying API call.
   * Serializes requests to honor rate limiting.
   */
  async apiGet(params: Record<string, string | number>): Promise<Record<string, unknown>> {
    const cacheKey = FileCache.buildKey(params);

    // Check cache first (no serialization needed)
    if (this.cache.has(cacheKey)) {
      this.progress.cacheHits++;
      return this.cache.get(cacheKey) as Record<string, unknown>;
    }

    // Serialize requests to enforce rate limiting
    const result = new Promise<Record<string, unknown>>((resolve, reject) => {
      this.pendingRequest = this.pendingRequest.then(async () => {
        try {
          const data = await this.fetchWithRetry(params, cacheKey);
          resolve(data);
        } catch (err) {
          reject(err);
        }
      });
    });

    return result;
  }

  private async fetchWithRetry(
    params: Record<string, string | number>,
    cacheKey: string,
  ): Promise<Record<string, unknown>> {
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      await this.waitForRateLimit();
      const outcome = await this.attemptFetch(params, cacheKey, attempt);
      if (outcome.kind === 'success') return outcome.data;
    }

    return { error: { code: 'fetch_failed' } };
  }

  /** Enforce the minimum interval between outbound requests. */
  private async waitForRateLimit(): Promise<void> {
    const now = Date.now();
    const wait = MIN_REQUEST_INTERVAL_MS - (now - this.lastRequestTime);
    if (wait > 0) {
      await sleep(wait);
    }
    this.lastRequestTime = Date.now();
  }

  /** Single fetch attempt; on failure reports a retry outcome. */
  private async attemptFetch(
    params: Record<string, string | number>,
    cacheKey: string,
    attempt: number,
  ): Promise<FetchOutcome> {
    try {
      const resp = await this.dispatchRequest(params);
      return await this.handleResponse(resp, cacheKey, attempt);
    } catch (err) {
      logFetchError(err, attempt);
      await sleep(3000 * (attempt + 1));
      return { kind: 'retry' };
    }
  }

  /** Build URL from params and perform the HTTP request. */
  private async dispatchRequest(params: Record<string, string | number>): Promise<Response> {
    const url = new URL(API_URL);
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, String(value));
    }
    url.searchParams.set('format', 'json');

    return fetch(url.toString(), {
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(30000),
    });
  }

  /** Interpret response status and convert it into a success or retry outcome. */
  private async handleResponse(
    resp: Response,
    cacheKey: string,
    attempt: number,
  ): Promise<FetchOutcome> {
    if (resp.status === 429) {
      // RFC 7231: Retry-After can be either delta-seconds or an HTTP-date.
      // Default to 60s on parse failure rather than 5s — a server saying
      // "slow down" with an unparseable header should not be hammered.
      const raw = resp.headers.get('Retry-After');
      let retryAfter = 60;
      if (raw) {
        const asInt = Number.parseInt(raw, 10);
        if (Number.isFinite(asInt) && asInt > 0) {
          retryAfter = asInt;
        } else {
          const asDate = Date.parse(raw);
          if (Number.isFinite(asDate)) {
            retryAfter = Math.max(1, Math.ceil((asDate - Date.now()) / 1000));
          }
        }
      }
      console.log(`[WV Fetch] 429 — waiting ${retryAfter}s...`);
      await sleep(retryAfter * 1000);
      return { kind: 'retry' };
    }

    if (resp.status >= 500) {
      console.log(`[WV Fetch] ${resp.status} — retrying (${attempt + 1}/${MAX_RETRIES})...`);
      await sleep(3000 * (attempt + 1));
      return { kind: 'retry' };
    }

    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
    }

    const data = (await resp.json()) as Record<string, unknown>;
    this.cache.set(cacheKey, data);
    this.requestCount++;
    this.progress.apiRequests = this.requestCount;
    return { kind: 'success', data };
  }

  /**
   * Batch-check which page titles exist on Wikivoyage.
   * Uses the query API (up to 50 titles per request). Results are cached.
   * @param parentTitle — if provided, titles that redirect back to this page are treated as non-existent
   */
  async checkPagesExist(titles: string[], parentTitle?: string): Promise<Map<string, boolean>> {
    if (titles.length === 0) return new Map();

    const result = new Map<string, boolean>();
    // MediaWiki API accepts up to 50 titles per query
    for (let i = 0; i < titles.length; i += 50) {
      const batch = titles.slice(i, i + 50);
      const data = await this.apiGet({
        action: 'query',
        titles: batch.join('|'),
        redirects: '1',
      });

      const query = data['query'] as Record<string, unknown> | undefined;
      if (!query) continue;

      applyBatchExistence(batch, query, parentTitle, result);
    }

    return result;
  }

  /** Save cache to disk */
  save(): void {
    this.cache.save();
  }

  get apiRequestCount(): number {
    return this.requestCount;
  }

  get cacheSize(): number {
    return this.cache.size;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Log a fetch error consistently across retry attempts. */
function logFetchError(err: unknown, attempt: number): void {
  if (err instanceof Error && err.name === 'AbortError') {
    console.log(`[WV Fetch] Timeout — retrying (${attempt + 1}/${MAX_RETRIES})...`);
  } else if (attempt < MAX_RETRIES - 1) {
    console.log(`[WV Fetch] Request error (${attempt + 1}/${MAX_RETRIES}): ${err}`);
  }
}

/** Build a map of redirected titles (from → to) from a MediaWiki query response. */
function buildRedirectMap(query: Record<string, unknown>): Map<string, string> {
  const redirectMap = new Map<string, string>();
  const redirects = query['redirects'] as Array<{ from: string; to: string }> | undefined;
  if (redirects) {
    for (const r of redirects) redirectMap.set(r.from, r.to);
  }
  return redirectMap;
}

/** Build a map of normalized titles (raw → normalized) from a MediaWiki query response. */
function buildNormalizedMap(query: Record<string, unknown>): Map<string, string> {
  const normalizedMap = new Map<string, string>();
  const normalized = query['normalized'] as Array<{ from: string; to: string }> | undefined;
  if (normalized) {
    for (const n of normalized) normalizedMap.set(n.from, n.to);
  }
  return normalizedMap;
}

/**
 * Resolve a raw input title through normalization + redirect chains until a
 * fixed point. Returns the final title. Bounded by `MAX_HOPS` to prevent
 * infinite loops on adversarial cycles.
 */
function resolveTitle(
  raw: string,
  normalizedMap: Map<string, string>,
  redirectMap: Map<string, string>,
): string {
  const MAX_HOPS = 10;
  const seen = new Set<string>();
  let current = normalizedMap.get(raw) ?? raw;
  for (let i = 0; i < MAX_HOPS; i++) {
    if (seen.has(current)) break;
    seen.add(current);
    const next = redirectMap.get(current);
    if (!next || next === current) break;
    current = next;
  }
  return current;
}

/** Build the set of resolved page titles that exist on Wikivoyage. */
function collectExistingTitles(
  pages: Record<string, { title: string; missing?: string }> | undefined,
): Set<string> {
  const existing = new Set<string>();
  if (!pages) return existing;
  for (const page of Object.values(pages)) {
    if (!('missing' in page)) {
      existing.add(page.title);
    }
  }
  return existing;
}

/**
 * Apply MediaWiki query results to the batch, honoring redirects and treating
 * redirects back to the parent page as non-existent entries.
 */
function applyBatchExistence(
  batch: string[],
  query: Record<string, unknown>,
  parentTitle: string | undefined,
  result: Map<string, boolean>,
): void {
  const pages = query['pages'] as Record<string, { title: string; missing?: string }> | undefined;
  if (!pages) return;

  const redirectMap = buildRedirectMap(query);
  const normalizedMap = buildNormalizedMap(query);
  const existingTitles = collectExistingTitles(pages);

  for (const title of batch) {
    const resolvedTitle = resolveTitle(title, normalizedMap, redirectMap);
    const exists = existingTitles.has(resolvedTitle);
    // Treat a redirect that lands on the parent page as non-existent so we
    // don't import a child that's just an alias for its parent.
    const redirectsToParent = parentTitle && resolvedTitle !== title && resolvedTitle === parentTitle;
    result.set(title, exists && !redirectsToParent);
  }
}
