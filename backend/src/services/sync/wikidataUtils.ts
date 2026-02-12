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
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), SPARQL_TIMEOUT_MS);

    try {
      const response = await fetch(WIKIDATA_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': 'application/sparql-results+json',
          'User-Agent': WIKIDATA_USER_AGENT,
        },
        body: `query=${encodeURIComponent(query)}&timeout=${SPARQL_SERVER_TIMEOUT_MS}`,
        signal: controller.signal,
      });

      if (!response.ok) {
        const text = await response.text();
        const retriable = response.status >= 500 || response.status === 429;
        if (attempt < retries && retriable) {
          const retryAfter = Number(response.headers.get('retry-after'));
          const backoff = Number.isFinite(retryAfter) && retryAfter > 0
            ? retryAfter * 1000
            : Math.min(30000, 5000 * Math.pow(2, attempt));
          console.warn(
            `${logPrefix} SPARQL ${response.status}, retrying in ${Math.round(backoff / 1000)}s (attempt ${attempt + 1}/${maxAttempts})`
          );
          await delay(backoff);
          continue;
        }
        throw new Error(`Wikidata SPARQL error ${response.status}: ${text.substring(0, 500)}`);
      }

      const data = await response.json() as {
        results: { bindings: Record<string, { type: string; value: string }>[] };
      };
      return data.results.bindings;
    } catch (error) {
      const isAbort = error instanceof Error && error.name === 'AbortError';
      if (attempt < retries && (isAbort || error instanceof TypeError)) {
        const backoff = Math.min(30000, 5000 * Math.pow(2, attempt));
        console.warn(
          `${logPrefix} SPARQL ${isAbort ? 'timeout' : 'network error'}, retrying in ${Math.round(backoff / 1000)}s (attempt ${attempt + 1}/${maxAttempts})`
        );
        await delay(backoff);
        continue;
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Wikidata SPARQL request failed: ${message}`);
    } finally {
      clearTimeout(timeout);
    }
  }

  throw new Error('SPARQL query failed after all retries');
}
