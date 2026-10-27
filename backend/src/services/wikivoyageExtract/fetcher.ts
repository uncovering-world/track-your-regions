/**
 * WikivoyageFetcher — HTTP + rate limiting + retry against the live Action API
 *
 * Ported from Python WikivoyageFetcher class. The extraction reads English
 * Wikivoyage's copy instead (`pageCopy.ts`, #2089); this is what the review of
 * one region's children asks the live wiki with.
 * Uses an async queue to serialize concurrent calls (Node.js doesn't need
 * locks but needs call ordering for rate limiting).
 */

import { userAgent } from '../../config/userAgent.js';
import { assertRobotsAllow, RobotsRefusal } from '../robots/robotsSignals.js';

const API_URL = 'https://en.wikivoyage.org/w/api.php';
const USER_AGENT = userAgent({ bot: true, purpose: 'region hierarchy extraction' });
const MIN_REQUEST_INTERVAL_MS = 350;
const MAX_RETRIES = 5;

type FetchOutcome =
  | { kind: 'success'; data: Record<string, unknown> }
  | { kind: 'retry' };

export class WikivoyageFetcher {
  private lastRequestTime = 0;
  private pendingRequest: Promise<void> = Promise.resolve();

  /**
   * Make a rate-limited, retrying API call.
   * Serializes requests to honor rate limiting.
   */
  async apiGet(params: Record<string, string | number>): Promise<Record<string, unknown>> {
    // Serialize requests to enforce rate limiting
    const result = new Promise<Record<string, unknown>>((resolve, reject) => {
      this.pendingRequest = this.pendingRequest.then(async () => {
        try {
          const data = await this.fetchWithRetry(params);
          resolve(data);
        } catch (err) {
          reject(err);
        }
      });
    });

    return result;
  }

  private async fetchWithRetry(params: Record<string, string | number>): Promise<Record<string, unknown>> {
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      await this.waitForRateLimit();
      const outcome = await this.attemptFetch(params, attempt);
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
    attempt: number,
  ): Promise<FetchOutcome> {
    try {
      const resp = await this.dispatchRequest(params);
      return await this.handleResponse(resp, attempt);
    } catch (err) {
      // A host's refusal is final, and the caller keeps its reason.
      if (err instanceof RobotsRefusal) throw err;
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

    await assertRobotsAllow(url.toString());
    return fetch(url.toString(), {
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(30000),
    });
  }

  /** Interpret response status and convert it into a success or retry outcome. */
  private async handleResponse(
    resp: Response,
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
    return { kind: 'success', data };
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
