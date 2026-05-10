/**
 * Shared Wikidata SPARQL utilities
 *
 * Used by museum and landmark sync services for querying Wikidata.
 */

// =============================================================================
// Constants
// =============================================================================

export const WIKIDATA_ENDPOINT = 'https://query.wikidata.org/sparql';
export const WIKIDATA_USER_AGENT = 'TrackYourRegions/1.0 (https://github.com/trackyourregions; contact@trackyourregions.com)';
export const SPARQL_DELAY_MS = 1000;
export const SPARQL_TIMEOUT_MS = 130000; // Client-side abort — slightly above server-side limit
export const SPARQL_SERVER_TIMEOUT_MS = 120000; // Ask Wikidata for 120s server-side timeout
export const SPARQL_MAX_RETRIES = 4;

export type SparqlBinding = Record<string, { value: string } | undefined>;

// =============================================================================
// Helpers
// =============================================================================

/**
 * Delay helper for rate limiting
 */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Extract QID from Wikidata entity URI
 * e.g., "http://www.wikidata.org/entity/Q12418" -> "Q12418"
 */
export function extractQid(uri: string): string {
  return uri.replace('http://www.wikidata.org/entity/', '');
}

/**
 * Parse WKT Point coordinates: "Point(lon lat)" -> { lat, lon }
 */
export function parseWktPoint(wkt: string): { lat: number; lon: number } | null {
  const match = wkt.match(/Point\(([-\d.]+)\s+([-\d.]+)\)/i);
  if (!match) return null;
  const lon = parseFloat(match[1]);
  const lat = parseFloat(match[2]);
  if (isNaN(lat) || isNaN(lon)) return null;
  return { lat, lon };
}

// =============================================================================
// SPARQL Query Execution
// =============================================================================

/**
 * Sentinel thrown to signal the retry loop should sleep and try again.
 * Carries the backoff duration and a label for logging.
 */
class RetrySignal extends Error {
  constructor(public backoffMs: number, public label: string) {
    super(label);
  }
}

function exponentialBackoff(attempt: number): number {
  return Math.min(30000, 5000 * Math.pow(2, attempt));
}

function backoffFromRetryAfter(retryAfter: number, attempt: number): number {
  return Number.isFinite(retryAfter) && retryAfter > 0
    ? retryAfter * 1000
    : exponentialBackoff(attempt);
}

async function fetchSparqlResponse(query: string, signal: AbortSignal): Promise<Response> {
  return fetch(WIKIDATA_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': 'application/sparql-results+json',
      'User-Agent': WIKIDATA_USER_AGENT,
    },
    body: `query=${encodeURIComponent(query)}&timeout=${SPARQL_SERVER_TIMEOUT_MS}`,
    signal,
  });
}

async function readSparqlBindings(response: Response): Promise<SparqlBinding[]> {
  const data = await response.json() as {
    results: { bindings: Record<string, { type: string; value: string }>[] };
  };
  return data.results.bindings;
}

async function handleSparqlHttpError(
  response: Response,
  attempt: number,
  retries: number,
): Promise<never> {
  const text = await response.text();
  const retriable = response.status >= 500 || response.status === 429;
  if (attempt < retries && retriable) {
    const retryAfter = Number(response.headers.get('retry-after'));
    const backoff = backoffFromRetryAfter(retryAfter, attempt);
    throw new RetrySignal(backoff, `SPARQL ${response.status}`);
  }
  throw new Error(`Wikidata SPARQL error ${response.status}: ${text.substring(0, 500)}`);
}

function classifySparqlException(
  error: unknown,
  attempt: number,
  retries: number,
): RetrySignal | Error {
  if (error instanceof RetrySignal) return error;
  const isAbort = error instanceof Error && error.name === 'AbortError';
  if (attempt < retries && (isAbort || error instanceof TypeError)) {
    return new RetrySignal(
      exponentialBackoff(attempt),
      isAbort ? 'SPARQL timeout' : 'SPARQL network error',
    );
  }
  const message = error instanceof Error ? error.message : String(error);
  return new Error(`Wikidata SPARQL request failed: ${message}`);
}

async function attemptSparqlOnce(
  query: string,
  attempt: number,
  retries: number,
): Promise<SparqlBinding[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SPARQL_TIMEOUT_MS);
  try {
    const response = await fetchSparqlResponse(query, controller.signal);
    if (!response.ok) await handleSparqlHttpError(response, attempt, retries);
    return await readSparqlBindings(response);
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Execute a SPARQL query against Wikidata with retry for transient errors.
 *
 * @param query - The SPARQL query string
 * @param logPrefix - Prefix for log messages (e.g., "[Museum Sync]")
 * @param retries - Number of retry attempts (default: SPARQL_MAX_RETRIES)
 */
export async function sparqlQuery(
  query: string,
  logPrefix: string,
  retries: number = SPARQL_MAX_RETRIES,
): Promise<SparqlBinding[]> {
  const maxAttempts = retries + 1;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await attemptSparqlOnce(query, attempt, retries);
    } catch (error) {
      const classified = classifySparqlException(error, attempt, retries);
      if (classified instanceof RetrySignal) {
        console.warn(
          `${logPrefix} ${classified.label}, retrying in ${Math.round(classified.backoffMs / 1000)}s (attempt ${attempt + 1}/${maxAttempts})`,
        );
        await delay(classified.backoffMs);
        continue;
      }
      throw classified;
    }
  }
  throw new Error('SPARQL query failed after all retries');
}
