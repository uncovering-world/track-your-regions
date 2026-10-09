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
  interruptibleDelay,
  CANCEL_POLL_MS,
  exponentialBackoff,
  backoffFromRetryAfter,
  RetrySignal,
  WaitBudget,
  type SourceWait,
} from './sourceRetry.js';
import { userAgent } from '../../config/userAgent.js';

export { WaitBudget } from './sourceRetry.js';
export type { SourceWait } from './sourceRetry.js';

// =============================================================================
// Constants
// =============================================================================

export const WIKIDATA_ENDPOINT = 'https://query.wikidata.org/sparql';
/**
 * What every run tells Wikidata and Commons it is. Built by `userAgent()` and
 * named here because the sync services pass it on to the credit and picture
 * readers as a value; the string itself is decided in one place (#864).
 */
export const WIKIDATA_USER_AGENT = userAgent({ bot: true });
export const SPARQL_DELAY_MS = 1000;

/**
 * The fallback chain the label service is asked for, everywhere we ask it.
 *
 * Without `mul`, the National Gallery of Art comes back as the bare string
 * `Q214867` — a label service given one language answers with the QID for
 * anything that has no label in it. Shared rather than per-collector, because a
 * query that asks for `"en"` alone is a query whose answers can contain QIDs
 * where a reader expects a name, and that is not a per-source preference.
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
 * minutes. Four retries with a 30-second ceiling give up after about 65
 * seconds, which is not "the service is down", it is "the service was busy for
 * a minute" — and a run that gives up there has paid for the class closure and
 * written nothing (run 61).
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
 * Of two pictures an item carries at its best rank, the one every reader keeps
 * (ADR-0085): the first by its Commons URL, which is what UNESCO's lookup takes
 * with `MIN(?img)` (`unescoWikidata.ts`).
 *
 * Wikidata often holds several pictures at equal rank — three for the Dome of
 * the Rock, a summer and a winter photograph of the Gol Stave Church — and a
 * reader that kept the first row SPARQL returned kept a different one per
 * query, so two sources reading one item reported two pictures. The rule is
 * arbitrary in what it prefers and fixed in what it answers, which is the
 * point: one item, one picture, whichever source asks. A null is no picture.
 */
export function preferredPicture(a: string | null, b: string | null): string | null {
  if (a === null || a === '') return b || null;
  if (b === null || b === '') return a;
  return b < a ? b : a;
}

/** Decimal places of the coordinate's more finely written axis, the precision Wikidata stored it at. */
function decimalsOf(wkt: string): number {
  const match = /Point\(([-\d.]+)\s+([-\d.]+)\)/i.exec(wkt);
  if (!match) return -1;
  return Math.max(...[match[1], match[2]].map(axis => (axis.split('.')[1] ?? '').length));
}

/**
 * Of two coordinates an item carries at its best rank (as WKT), the one every
 * reader keeps (ADR-0085): the more precisely written, then the smaller latitude
 * and longitude, so the answer does not depend on the order rows arrive in.
 *
 * The Cave of Altamira holds two: one to the arc-second and one rounded to the
 * arc-minute, 752 m away, and two sources each kept a different one. A WKT that
 * does not parse loses to one that does.
 */
export function preferredCoordinate(a: string | null, b: string | null): string | null {
  if (!a) return b || null;
  if (!b) return a;
  const [pa, pb] = [parseWktPoint(a), parseWktPoint(b)];
  if (!pb) return a;
  if (!pa) return b;
  const [da, db] = [decimalsOf(a), decimalsOf(b)];
  if (da !== db) return da > db ? a : b;
  if (pa.lat !== pb.lat) return pa.lat < pb.lat ? a : b;
  if (pa.lon !== pb.lon) return pa.lon < pb.lon ? a : b;
  // One point written on two globes: the text decides, so whether it is on
  // Earth does not depend on the rows' order either.
  return a <= b ? a : b;
}

/** The picture and the coordinate (as WKT) a reader keeps of one item so far. */
export interface PreferredValues {
  imageUrl: string | null;
  wkt: string | null;
}

/**
 * Fold one more row of an item into what is kept of it, by the two rules
 * above. A reader keeps this per item over every row it is answered with, and
 * applies it once the rows are read, so the order they arrived in is no part
 * of the answer (#1246).
 */
export function foldPreferred(
  kept: PreferredValues | undefined,
  imageUrl: string | null,
  wkt: string | null,
): PreferredValues {
  return {
    imageUrl: preferredPicture(kept?.imageUrl ?? null, imageUrl),
    wkt: preferredCoordinate(kept?.wkt ?? null, wkt),
  };
}

/**
 * Write what was kept of each item onto its entry, once every row is read: the
 * picture, the point, and — for an entry that records it — whether the point is
 * on this planet (Wikidata writes a point on another globe with the globe's IRI
 * in front of it).
 */
export function applyPreferred<T extends { imageUrl: string | null; lat: number | null; lon: number | null }>(
  entries: Map<string, T>,
  kept: Map<string, PreferredValues>,
): void {
  for (const [qid, entry] of entries) {
    const { imageUrl, wkt } = kept.get(qid) ?? { imageUrl: null, wkt: null };
    const at = wkt ? parseWktPoint(wkt) : null;
    Object.assign(entry, { imageUrl, lat: at?.lat ?? null, lon: at?.lon ?? null });
    if ('onEarth' in entry) Object.assign(entry, { onEarth: !wkt?.startsWith('<') });
  }
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

/**
 * The query service's processing-time rule, kept for the whole process.
 *
 * One client — our User-Agent from this address — is allowed 60 seconds of the
 * service's processing time in every 60, and a client over it is throttled
 * (Wikidata Query Service User Manual, § Query limits). Every query this
 * process sends therefore takes its turn here: one at a time, whichever run
 * sent it, and the next starts only after a pause at least as long as the last
 * attempt took. That keeps a run near half the allowance however slow the
 * service is that day. A query that ran into the deadline — 55 seconds asked,
 * answered with a timeout or a gateway error — is the case it was written for:
 * its retry waits out a minute of the service's time rather than the 5 seconds
 * the backoff would have given it, so the retry never lands in the minute the
 * failed attempt used up. A 429's `Retry-After` or a 5xx's backoff holds back
 * every run's next query, not only the one that received it, up to the
 * backoff's ceiling; a run that did not earn the hold has it reported and
 * charged to its own wait budget (`heldByService`).
 */
let turn: Promise<void> = Promise.resolve();
/** When the next query may start by the pacing rule: the last attempt's cost, mirrored. */
let nextStartAt = 0;
/** When the service said this client may ask again: a 429's `Retry-After` or a 5xx's backoff. */
let throttledUntil = 0;

/** What a run gives the turn, so a hold another run earned is reported and paid for like its own. */
interface TurnWatch {
  isCancelled?: () => boolean;
  onWait?: (wait: SourceWait) => void;
  budget: WaitBudget;
}

/**
 * The hold the service put on this client, past the ordinary pacing pause, as
 * a run about to send sees it. A run that did not earn it waits it out all the
 * same, so it is said on that run's panel and charged to its patience: a wait
 * nobody can see is the one this client exists to prevent.
 */
function heldByService(pace: number, watch: TurnWatch): number {
  const hold = throttledUntil - Date.now();
  const extra = hold - Math.max(pace, 0);
  if (extra <= 0) return 0;
  if (extra > watch.budget.remainingMs) {
    throw new Error(
      `Wikidata asked this server to wait, and this run's ${Math.round(watch.budget.totalMs / 60000)} min of waiting is spent`,
    );
  }
  watch.onWait?.({
    reason: 'Wikidata asked this server to wait',
    attempt: 0,
    backoffMs: hold,
    waitedMs: watch.budget.totalMs - watch.budget.remainingMs,
  });
  watch.budget.spend(extra);
  return hold;
}

/**
 * Waits for the query ahead to finish, noticing a cancel within a second: the
 * query ahead may be another run's, and its request and pause together can
 * last two minutes. False when the run was cancelled before its turn came.
 */
async function turnArrives(previous: Promise<void>, isCancelled?: () => boolean): Promise<boolean> {
  let arrived = false;
  const arrival = previous.then(() => { arrived = true; });
  while (!arrived) {
    if (isCancelled?.()) return false;
    await Promise.race([arrival, new Promise((resolve) => setTimeout(resolve, CANCEL_POLL_MS))]);
  }
  return true;
}

async function inTurn<T>(watch: TurnWatch, send: () => Promise<T>): Promise<T> {
  const { isCancelled } = watch;
  const previous = turn;
  let done!: () => void;
  const mine = new Promise<void>((resolve) => { done = resolve; });
  // The next query waits for the one ahead of this as well as for this one, so
  // a run cancelled while it queues can give up its place at once without the
  // run behind it starting alongside the query still in flight.
  turn = previous.then(() => mine);
  try {
    if (!(await turnArrives(previous, isCancelled))) throw new Error('Sync cancelled');
    const pace = nextStartAt - Date.now();
    await interruptibleDelay(Math.max(pace, heldByService(pace, watch)), isCancelled);
    if (isCancelled?.()) throw new Error('Sync cancelled');
    const startedAt = Date.now();
    try {
      return await send();
    } catch (error) {
      // An HTTP answer that asks us to wait — a 429's Retry-After, a 5xx's
      // backoff — was said to this client, not to this one query, so every
      // run's next query waits too, up to the ceiling a backoff has. (A
      // timeout or a dropped connection is classified after the turn, and its
      // cost is already in the pacing pause.)
      if (error instanceof RetrySignal) {
        throttledUntil = Math.max(throttledUntil, Date.now() + Math.min(error.backoffMs, SPARQL_BACKOFF_CEILING_MS));
      }
      throw error;
    } finally {
      const took = Date.now() - startedAt;
      nextStartAt = Math.max(nextStartAt, Date.now() + Math.max(SPARQL_DELAY_MS, took));
    }
  } finally {
    done();
  }
}

async function attemptSparqlOnce(
  query: string,
  attempt: number,
  retries: number,
  watch: TurnWatch,
): Promise<SparqlBinding[]> {
  return inTurn(watch, async () => {
    const { signal, release } = abortOn(SPARQL_TIMEOUT_MS, watch.isCancelled);
    try {
      const response = await fetchSparqlResponse(query, signal);
      if (!response.ok) await handleSparqlHttpError(response, attempt, retries);
      return await readSparqlBindings(response);
    } finally {
      release();
    }
  });
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
  // Attempt 0 is a hold another run earned (`heldByService`): this run has
  // sent nothing yet, so there is nothing to retry.
  if (wait.attempt === 0) {
    return `${wait.reason} — next query in ${next}s, about ${spent} of ${total} min of waiting spent`;
  }
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
  const budget = options.budget ?? new WaitBudget(SPARQL_WAIT_BUDGET_MS);
  return withRetries(
    (attempt) => attemptSparqlOnce(query, attempt, retries, { isCancelled, onWait, budget }),
    {
      logPrefix,
      retries,
      budget,
      isCancelled,
      onWait,
      classify: classifySparqlException,
    },
  );
}
