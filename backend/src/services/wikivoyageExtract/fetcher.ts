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
      // Rate limiting
      const now = Date.now();
      const wait = MIN_REQUEST_INTERVAL_MS - (now - this.lastRequestTime);
      if (wait > 0) {
        await sleep(wait);
      }
      this.lastRequestTime = Date.now();

      try {
        const url = new URL(API_URL);
        for (const [key, value] of Object.entries(params)) {
          url.searchParams.set(key, String(value));
        }
        url.searchParams.set('format', 'json');

        const resp = await fetch(url.toString(), {
          headers: { 'User-Agent': USER_AGENT },
          signal: AbortSignal.timeout(30000),
        });

        if (resp.status === 429) {
          const retryAfter = parseInt(resp.headers.get('Retry-After') ?? '5', 10);
          console.log(`[WV Fetch] 429 — waiting ${retryAfter}s...`);
          await sleep(retryAfter * 1000);
          continue;
        }

        if (resp.status >= 500) {
          console.log(`[WV Fetch] ${resp.status} — retrying (${attempt + 1}/${MAX_RETRIES})...`);
          await sleep(3000 * (attempt + 1));
          continue;
        }

        if (!resp.ok) {
          throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
        }

        const data = (await resp.json()) as Record<string, unknown>;

        // Cache the result
        this.cache.set(cacheKey, data);
        this.requestCount++;
        this.progress.apiRequests = this.requestCount;

        return data;
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') {
          console.log(`[WV Fetch] Timeout — retrying (${attempt + 1}/${MAX_RETRIES})...`);
        } else if (attempt < MAX_RETRIES - 1) {
          console.log(`[WV Fetch] Request error (${attempt + 1}/${MAX_RETRIES}): ${err}`);
        }
        await sleep(3000 * (attempt + 1));
      }
    }

    return { error: { code: 'fetch_failed' } };
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

      // Collect redirected titles
      const redirectMap = new Map<string, string>();
      const redirects = query['redirects'] as Array<{ from: string; to: string }> | undefined;
      if (redirects) {
        for (const r of redirects) redirectMap.set(r.from, r.to);
      }

      const pages = query['pages'] as Record<string, { title: string; missing?: string }> | undefined;
      if (pages) {
        // Build a set of existing page titles
        const existingTitles = new Set<string>();
        for (const page of Object.values(pages)) {
          if (!('missing' in page)) {
            existingTitles.add(page.title);
          }
        }
        // Map original titles to existence (following redirects)
        // A redirect back to the parent page means this isn't a real subregion page
        for (const title of batch) {
          const resolvedTitle = redirectMap.get(title) ?? title;
          const exists = existingTitles.has(resolvedTitle);
          const redirectsToParent = parentTitle && redirectMap.has(title) && resolvedTitle === parentTitle;
          result.set(title, exists && !redirectsToParent);
        }
      }
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
