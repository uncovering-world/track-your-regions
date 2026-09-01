/**
 * Getting the World Heritage list out of UNESCO's open-data portal.
 *
 * `data.unesco.org` runs Opendatasoft's Explore API v2.1, and its rules are
 * published in its own response headers — read live on 2026-08-21:
 *
 *   x-ratelimit-limit: 10000        calls a day, anonymous
 *   x-ratelimit-remaining: 9986     what is left of it
 *   x-ratelimit-reset: 2026-08-22 00:00:00+00:00
 *
 * Two things follow. The first is that `/records` is the wrong endpoint for what
 * we want: it is capped at 100 rows and at `offset + limit <= 10000`, so the
 * whole list took thirteen paginated calls — thirteen of a daily allowance, and
 * a loop that would have spun forever against a page that came back empty.
 * `/exports` has no such cap and is what the platform documents for taking a
 * dataset whole: one call, 1273 records, measured at 0.9 s.
 *
 * The second is `select`. Asking for the 22 fields the importer actually reads,
 * rather than all 54, took the answer from 24 MB to 3.7 MB — the descriptions in
 * six languages and the video captions are most of that dataset by weight, and
 * we use none of them.
 *
 * Beyond that this client owes the portal what any client owes a server it does
 * not own: a User-Agent that says who is calling, a deadline so a hung socket
 * cannot hang a run, and a retry that waits rather than gives up — which the old
 * one did not have, so a single 502 from their front end ended the run.
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
import { waitMessage } from './wikidataUtils.js';
import type { SyncProgress, UnescoApiRecord } from './types.js';

const LOG_PREFIX = '[UNESCO Sync]';

const EXPORT_URL =
  'https://data.unesco.org/api/explore/v2.1/catalog/datasets/whc001/exports/json';

/** Sent to Wikimedia and to UNESCO alike: a server we do not own should know who is calling. */
export const UNESCO_USER_AGENT =
  'TrackYourRegions/1.0 (https://github.com/trackyourregions; contact@trackyourregions.com)';

/**
 * The fields the importer reads, and no others.
 *
 * Every name here was checked against the dataset on 2026-08-21, which is how a
 * four-year-old bug surfaced: the code asked for `criteria`, a field this
 * dataset does not have and never had, so all 1272 imported sites carry no
 * criterion tag at all. The real field is `criteria_txt` — "(i)(ii)(iii)(iv)"
 * for the Bamiyan Valley — and asking the portal for the list by name is what
 * makes a wrong name a 400 with the field named in it, rather than silence.
 */
const EXPORT_FIELDS = [
  'id_no',
  'name_en', 'name_fr', 'name_es', 'name_ru', 'name_ar', 'name_zh',
  'short_description_en', 'short_description_fr',
  'category', 'coordinates', 'iso_codes', 'states_names',
  // Not `main_image_url`, `main_image_author` or `main_image_copyright`: the
  // picture they describe is the World Heritage Centre's own, which its terms
  // do not let this product show, so the run takes a site's picture from
  // Commons instead and has no use for the portal's (ADR-0043, #557).
  'date_inscribed', 'danger', 'danger_list', 'criteria_txt', 'region',
  'area_hectares', 'transboundary', 'components_list',
];

/**
 * Long, because the whole list in one answer is megabytes and their portal is
 * not fast every day; still finite, because a socket that never closes would
 * otherwise hang the run with nothing on screen.
 */
const UNESCO_TIMEOUT_MS = 120000;
const UNESCO_MAX_RETRIES = 6;
/** Their portal is not Wikidata's query cluster; a minute between attempts is patient enough. */
const UNESCO_BACKOFF_CEILING_MS = 60000;

/** A body that arrived and would not parse — retried like a 502, for the same reason. */
class MalformedUnescoBody extends Error {}

/** How much of an unparseable body to quote: enough to see, bounded so a log stays a log. */
const BODY_CONTEXT = 200;

async function handleHttpError(response: Response, attempt: number, retries: number): Promise<never> {
  const text = await response.text();
  const retriable = response.status >= 500 || response.status === 429;
  if (attempt < retries && retriable) {
    const retryAfter = Number(response.headers.get('retry-after'));
    throw new RetrySignal(
      backoffFromRetryAfter(retryAfter, attempt, UNESCO_BACKOFF_CEILING_MS),
      `UNESCO ${response.status}`,
    );
  }
  throw new Error(`UNESCO API error ${response.status}: ${text.substring(0, 500)}`);
}

function classifyUnescoException(error: unknown, attempt: number, retries: number): RetrySignal | Error {
  if (error instanceof RetrySignal) return error;
  const isAbort = error instanceof Error && error.name === 'AbortError';
  const isMalformed = error instanceof MalformedUnescoBody;
  if (attempt < retries && (isAbort || isMalformed || error instanceof TypeError)) {
    let label = 'UNESCO network error';
    if (isAbort) label = 'UNESCO timeout';
    else if (isMalformed) label = 'UNESCO malformed body';
    return new RetrySignal(exponentialBackoff(attempt, UNESCO_BACKOFF_CEILING_MS), label);
  }
  const message = error instanceof Error ? error.message : String(error);
  return new Error(`UNESCO API request failed: ${message}`);
}

/**
 * What is left of today's allowance, said once per run.
 *
 * Not enforced here — the portal enforces it with a 429 that the retry already
 * waits out — but a run that finds 200 calls left is a run whose next few
 * attempts are worth thinking about, and that number is otherwise invisible.
 */
function logQuota(response: Response): void {
  const remaining = response.headers.get('x-ratelimit-remaining');
  const limit = response.headers.get('x-ratelimit-limit');
  if (!remaining || !limit) return;
  console.log(`${LOG_PREFIX} Daily API allowance: ${remaining} of ${limit} calls left`);
}

async function attemptExport(attempt: number, isCancelled?: () => boolean): Promise<UnescoApiRecord[]> {
  const url = `${EXPORT_URL}?select=${encodeURIComponent(EXPORT_FIELDS.join(','))}`;
  const { signal, release } = abortOn(UNESCO_TIMEOUT_MS, isCancelled);
  try {
    const response = await fetch(url, {
      headers: { 'Accept': 'application/json', 'User-Agent': UNESCO_USER_AGENT },
      signal,
    });
    if (!response.ok) await handleHttpError(response, attempt, UNESCO_MAX_RETRIES);
    logQuota(response);
    // Read as text and parse here so a bad body can be quoted: without the
    // snippet the failure names a position in something nobody kept.
    const body = await response.text();
    try {
      const parsed: unknown = JSON.parse(body);
      // `JSON.parse` accepts any valid JSON, and a cast is not a check: a 200
      // carrying an error envelope would otherwise become a `records.length` of
      // `undefined` and an orchestrator iterating a non-array. Treated as a
      // malformed body, so the retry above handles it like any other.
      if (!Array.isArray(parsed)) {
        throw new MalformedUnescoBody(`expected an array of records, got ${typeof parsed}`);
      }
      return parsed as UnescoApiRecord[];
    } catch (error) {
      if (error instanceof MalformedUnescoBody) throw error;
      throw new MalformedUnescoBody(
        `${error instanceof Error ? error.message : String(error)} — `
        + `${Buffer.byteLength(body, 'utf8')} bytes, near: ${JSON.stringify(body.slice(0, BODY_CONTEXT))}`,
      );
    }
  } finally {
    release();
  }
}

/**
 * The whole World Heritage list, in one request.
 *
 * No pagination and so no page count to report: the answer arrives as one thing,
 * and what the panel can honestly say while it is in flight is that it is
 * waiting — which is also what it says when the portal is having a bad day,
 * through the same reporter the Wikidata collectors use.
 */
export async function fetchUnescoRecords(
  progress: SyncProgress,
  budget = new WaitBudget(900000),
): Promise<UnescoApiRecord[]> {
  progress.status = 'fetching';
  progress.statusMessage = 'Fetching the World Heritage list from UNESCO...';

  const records = await withRetries(
    (attempt) => attemptExport(attempt, () => progress.cancel),
    {
      logPrefix: LOG_PREFIX,
      retries: UNESCO_MAX_RETRIES,
      budget,
      isCancelled: () => progress.cancel,
      onWait: (wait: SourceWait) => {
        progress.statusMessage = waitMessage('UNESCO', wait, budget);
      },
      classify: classifyUnescoException,
    },
  );

  // The denominator, not the numerator. `progress` is how many records have been
  // *processed*, and setting it here would park the bar at 100% through the
  // Wikipedia-link query and the whole write phase — the same parked bar this
  // change set exists to stop showing.
  progress.total = records.length;
  progress.statusMessage = `Fetched ${records.length} records`;
  console.log(`${LOG_PREFIX} Fetched ${records.length} records in one export request`);
  return records;
}
