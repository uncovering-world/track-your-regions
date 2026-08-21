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

/**
 * What we ask the service to spend on one query, and what we wait for.
 *
 * **Their deadline is 60 seconds and asking for more does not move it.** We used
 * to send `timeout=120000`, which the server clamps, so a query that could not
 * finish spent their full 60 seconds and then came back to us as a *gateway*
 * error — 504 or 502 from the front end, which says nothing about what went
 * wrong. Asking for 55 gets the answer from the query engine instead: a clean
 * SPARQL timeout, classified as such, five seconds sooner, and five seconds of
 * their cluster returned to whoever is next in the queue.
 *
 * The client-side abort sits above it with room for the response to travel:
 * without one a socket that never closes hangs a whole run.
 */
export const SPARQL_SERVER_TIMEOUT_MS = 55000;
export const SPARQL_TIMEOUT_MS = 70000;

/**
 * How long a run keeps waiting for a service that is having a bad day.
 *
 * The published guidance is to assume the service is degraded or unavailable and
 * to retry accordingly, and their own status pages measure outages in tens of
 * minutes. The old shape — four retries with a 30-second ceiling — gave up after
 * about 65 seconds, which is not "the service is down", it is "the service was
 * busy for a minute". Run 61 died that way with nothing written after the class
 * closure had already been paid for.
 *
 * So the bound is a duration rather than a count: keep trying while the whole
 * wait is under fifteen minutes, with each pause capped at three. A run that
 * cannot get an answer in fifteen minutes is one for a human to restart, and
 * fifteen minutes of a quarter-hour import is a proportionate thing to wait.
 *
 * The count is deliberately set high enough that the budget is what actually
 * stops the loop — 5 + 10 + 20 + 40 + 80 + 160 and then three-minute pauses
 * reaches the budget on the tenth wait. A count low enough to bite first would
 * make the budget decorative, which is how the old shape read: four retries and
 * a 30-second ceiling gave up after about a minute whatever the constant said.
 */
export const SPARQL_MAX_RETRIES = 12;
export const SPARQL_BACKOFF_CEILING_MS = 180000;
export const SPARQL_WAIT_BUDGET_MS = 900000;

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
  return Math.min(SPARQL_BACKOFF_CEILING_MS, 5000 * Math.pow(2, attempt));
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

/**
 * A body that arrived but did not parse.
 *
 * Its own class because the retry logic has to tell it from a query this
 * endpoint will never accept. Run 51 died on "Bad control character in string
 * literal at position 835402" seven minutes in, having written nothing — a
 * single stray byte 800 kB into one response ended a run that takes a quarter
 * of an hour, and `SyntaxError` is neither an abort nor a `TypeError`, so the
 * retry that exists for exactly this never fired.
 */
class MalformedSparqlBody extends Error {}

/**
 * How much of the body to quote when it will not parse — enough to see what
 * arrived, bounded so a megabyte of HTML never reaches a log.
 */
const MALFORMED_BODY_CONTEXT = 200;

async function readSparqlBindings(response: Response): Promise<SparqlBinding[]> {
  // Read as text and parse here, rather than `response.json()`, so a bad body
  // can be quoted. Without the snippet the failure names a position in
  // something nobody kept.
  const body = await response.text();
  let data: { results: { bindings: Record<string, { type: string; value: string }>[] } };
  try {
    data = JSON.parse(body);
  } catch (error) {
    const at = positionFromParseError(error);
    const from = Math.max(0, at - MALFORMED_BODY_CONTEXT / 2);
    throw new MalformedSparqlBody(
      `${error instanceof Error ? error.message : String(error)} — `
      + `${Buffer.byteLength(body, 'utf8')} bytes, near: ${JSON.stringify(body.slice(from, from + MALFORMED_BODY_CONTEXT))}`,
    );
  }
  return data.results.bindings;
}

/**
 * The position a JSON parse error names, or 0 when it names none.
 *
 * A code-unit index into the string, not a byte offset — which is why the
 * snippet is sliced with it and the size beside it is measured separately. A
 * SPARQL answer is mostly non-ASCII labels, so the two differ by a lot.
 */
function positionFromParseError(error: unknown): number {
  const match = /position (\d+)/.exec(error instanceof Error ? error.message : '');
  return match ? Number(match[1]) : 0;
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
  // A body that will not parse is retried like a 502, and for the same reason:
  // the endpoint answered, so the query is acceptable to it, and what arrived
  // was damaged in transit or serialised wrong once. Retried rather than
  // repaired — a run that quietly patched up bytes it did not understand would
  // be worse than one that stopped and said so.
  const isMalformed = error instanceof MalformedSparqlBody;
  if (attempt < retries && (isAbort || isMalformed || error instanceof TypeError)) {
    let label = 'SPARQL network error';
    if (isAbort) label = 'SPARQL timeout';
    else if (isMalformed) label = 'SPARQL malformed body';
    return new RetrySignal(exponentialBackoff(attempt), label);
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
 * Told when a query is about to wait, so a screen can say so.
 *
 * A run that is waiting for Wikidata looks exactly like a run that has hung:
 * the collection phase has no denominator, so the bar sits at zero, and the
 * retries went to a container log nobody was watching. Run 61 spent over a
 * minute that way and then failed. One callback is enough to end that — the
 * caller decides whether it becomes a status message, a log line, or nothing.
 */
export interface SparqlWait {
  /** What the service said, in the words the log uses: `SPARQL 504`, `Rate limited`. */
  reason: string;
  attempt: number;
  /** How long we are about to wait, in milliseconds. */
  backoffMs: number;
  /** How much of the wait budget is already spent, so a caller can say "9 of 15 min". */
  waitedMs: number;
}

/**
 * Execute a SPARQL query against Wikidata with retry for transient errors.
 *
 * Retries are bounded by *time*, not by a count: `SPARQL_MAX_RETRIES` caps the
 * attempts and `SPARQL_WAIT_BUDGET_MS` caps the waiting, whichever comes first.
 * The budget is what makes the difference between "busy for a minute" — which is
 * ordinary and worth waiting out — and a service that is genuinely down.
 *
 * @param query - The SPARQL query string
 * @param logPrefix - Prefix for log messages (e.g., "[Museum Sync]")
 * @param retries - Number of retry attempts (default: SPARQL_MAX_RETRIES)
 * @param onWait - Called before each wait, for a caller that has somewhere to show it
 */
export async function sparqlQuery(
  query: string,
  logPrefix: string,
  retries: number = SPARQL_MAX_RETRIES,
  onWait?: (wait: SparqlWait) => void,
): Promise<SparqlBinding[]> {
  const maxAttempts = retries + 1;
  let waitedMs = 0;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await attemptSparqlOnce(query, attempt, retries);
    } catch (error) {
      const classified = classifySparqlException(error, attempt, retries);
      if (classified instanceof RetrySignal) {
        // The budget is checked before the wait rather than after it, so the run
        // never sleeps three minutes only to give up on waking.
        if (waitedMs + classified.backoffMs > SPARQL_WAIT_BUDGET_MS) {
          throw new Error(
            `${classified.label}, and the wait budget of ${Math.round(SPARQL_WAIT_BUDGET_MS / 60000)} min is spent`,
          );
        }
        console.warn(
          `${logPrefix} ${classified.label}, retrying in ${Math.round(classified.backoffMs / 1000)}s (attempt ${attempt + 1}/${maxAttempts})`,
        );
        onWait?.({
          reason: classified.label, attempt: attempt + 1, backoffMs: classified.backoffMs, waitedMs,
        });
        waitedMs += classified.backoffMs;
        await delay(classified.backoffMs);
        continue;
      }
      throw classified;
    }
  }
  throw new Error('SPARQL query failed after all retries');
}
