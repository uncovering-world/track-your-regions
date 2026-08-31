/**
 * Shared Wikidata SPARQL utilities
 *
 * Used by museum and landmark sync services for querying Wikidata. How a failed
 * request is waited out is not here — that is `sourceRetry.ts`, shared with the
 * other sources; what lives here is what Wikidata's own failures mean.
 */

import {
  withRetries,
  abortOn,
  exponentialBackoff,
  backoffFromRetryAfter,
  RetrySignal,
  WaitBudget,
  type SourceWait,
} from './sourceRetry.js';

export { WaitBudget } from './sourceRetry.js';
export type { SourceWait } from './sourceRetry.js';

// =============================================================================
// Constants
// =============================================================================

export const WIKIDATA_ENDPOINT = 'https://query.wikidata.org/sparql';
export const WIKIDATA_USER_AGENT = 'TrackYourRegions/1.0 (https://github.com/trackyourregions; contact@trackyourregions.com)';
export const SPARQL_DELAY_MS = 1000;

/**
 * The fallback chain the label service is asked for, everywhere we ask it.
 *
 * Without `mul`, the National Gallery of Art comes back as the bare string
 * `Q214867` — a label service given one language answers with the QID for
 * anything that has no label in it. Shared rather than per-collector, because a
 * query that asks for `"en"` alone is a query whose answers can contain QIDs
 * where a reader expects a name, and that is not a per-category preference.
 */
export const LABEL_LANGS = 'en,mul,en-gb,de,fr,es,it,nl';

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
 * A QID, not a blank node (`.well-known/genid/…`) and not a literal.
 *
 * Beside `extractQid` because two collectors ask it of two different things. Of a
 * *URI*, it is "did the source name an entity or an anonymous node" — 51 works in
 * the museum pool carry a blank-node creator. Of a *label*, it is "did the label
 * service find a name at all": asked for a language chain it cannot satisfy, it
 * answers with the bare entity id, which is how the National Gallery of Art once
 * arrived as the string `Q214867`. A QID stored as a name names nobody, and both
 * the museum parse and the landmark parse drop that shape (#720).
 */
export function isQid(value: string): boolean {
  return /^Q\d+$/.test(value);
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

const backoffOf = (attempt: number) => exponentialBackoff(attempt, SPARQL_BACKOFF_CEILING_MS);

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
    const backoff = backoffFromRetryAfter(retryAfter, attempt, SPARQL_BACKOFF_CEILING_MS);
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
    return new RetrySignal(backoffOf(attempt), label);
  }
  const message = error instanceof Error ? error.message : String(error);
  return new Error(`Wikidata SPARQL request failed: ${message}`);
}

async function attemptSparqlOnce(
  query: string,
  attempt: number,
  retries: number,
  isCancelled?: () => boolean,
): Promise<SparqlBinding[]> {
  const { signal, release } = abortOn(SPARQL_TIMEOUT_MS, isCancelled);
  try {
    const response = await fetchSparqlResponse(query, signal);
    if (!response.ok) await handleSparqlHttpError(response, attempt, retries);
    return await readSparqlBindings(response);
  } finally {
    release();
  }
}

/**
 * Somewhere to say that a source is having a bad day, in the words a person
 * watching a run needs: what the service said, which attempt this is, how long
 * until the next one, and how much of the run's patience is gone.
 *
 * Shared by every collector rather than written per source, because it is the
 * same sentence three times over and it was written differently each time. What
 * a source may vary is its name, which is the argument.
 */
export function waitMessage(source: string, wait: SourceWait, budget: WaitBudget): string {
  const next = Math.round(wait.backoffMs / 1000);
  const spent = Math.round((wait.waitedMs + wait.backoffMs) / 60000);
  const total = Math.round(budget.totalMs / 60000);
  return `${source} is not answering (${wait.reason}) — retrying in ${next}s, `
    + `attempt ${wait.attempt}, about ${spent} of ${total} min of waiting spent`;
}

/**
 * A run's door to Wikidata: paced, interruptible, and able to say it is waiting.
 *
 * The three things every collector needs and each had written for itself. A
 * query sent without them is a query nobody can stop and a wait nobody can see,
 * which is what run 61 looked like from the panel — so the door is the shared
 * thing and the query is the caller's.
 */
export type WikidataDoor = (query: string, retries?: number) => Promise<SparqlBinding[]>;

export function wikidataDoor(
  progress: { cancel: boolean; statusMessage: string },
  budget: WaitBudget,
  logPrefix: string,
): WikidataDoor {
  return (query, retries = SPARQL_MAX_RETRIES) => sparqlQuery(query, logPrefix, {
    retries,
    budget,
    // Checked while waiting as well as between queries, because a backoff is up
    // to three minutes: without it, Cancel sits unhonoured for that long.
    isCancelled: () => progress.cancel,
    onWait: (wait) => { progress.statusMessage = waitMessage('Wikidata', wait, budget); },
  });
}

/**
 * What a caller may say about how a query should be attempted.
 *
 * Everything here except `retries` is the run's rather than the query's, which
 * is why it is passed in rather than defaulted: the patience is shared across a
 * few hundred queries, and the cancel flag belongs to the run that owns them.
 */
export interface SparqlOptions {
  retries?: number;
  /** Called before each wait, for a caller that has somewhere to show it. */
  onWait?: (wait: SourceWait) => void;
  /** Whether the run has been cancelled. Checked before each attempt and while waiting. */
  isCancelled?: () => boolean;
  /** How much waiting the whole run has left, shared across its queries. */
  budget?: WaitBudget;
}

/**
 * Execute a SPARQL query against Wikidata with retry for transient errors.
 *
 * Retries are bounded by *time*, not by a count: `SPARQL_MAX_RETRIES` caps the
 * attempts and the run's `WaitBudget` caps the waiting, whichever comes first.
 * The loop itself is `withRetries` — shared with every other source we import
 * from — and what is Wikidata's about it is `classifySparqlException`.
 *
 * @param query - The SPARQL query string
 * @param logPrefix - Prefix for log messages (e.g., "[Museum Sync]")
 * @param options - the reporter, the cancel check, and the run's shared wait budget
 */
export async function sparqlQuery(
  query: string,
  logPrefix: string,
  options: SparqlOptions = {},
): Promise<SparqlBinding[]> {
  const { retries = SPARQL_MAX_RETRIES, onWait, isCancelled } = options;
  return withRetries(
    (attempt) => attemptSparqlOnce(query, attempt, retries, isCancelled),
    {
      logPrefix,
      retries,
      budget: options.budget ?? new WaitBudget(SPARQL_WAIT_BUDGET_MS),
      isCancelled,
      onWait,
      classify: classifySparqlException,
    },
  );
}
