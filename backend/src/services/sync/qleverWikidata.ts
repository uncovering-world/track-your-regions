/**
 * Wikidata asked through QLever's mirror (`https://qlever.dev/api/wikidata`),
 * for two bulk questions the Wikidata Query Service could not answer within
 * its limits (#1272): the component-item search's near rule — which on
 * 2026-10-09 drew a 429 halfway through a pass paced at the query service's
 * own published rate, where QLever answered the same four-area question in
 * 0.43 s against 18 s — and the class-tree walk that tells the settlements
 * among its candidates and classes (`settlementsAmong`).
 *
 * The manners are those of the register record
 * (`docs/sources/global/wikidata-qlever.md`): the mirror has no formal terms
 * and no published rate limit, and its usage page asks a heavy user to run
 * their own copy. So every question waits its turn — one at a time in this
 * process, the next only after a pause at least as long as the last took and
 * never under a second — and carries the project's `User-Agent` with the bot
 * marker. A refusal (any 4xx, a 429 above all) ends the caller's pass; a
 * timeout or a 5xx is retried once and then reported as `SparqlUnanswered`,
 * so the caller can ask a smaller question. The lasting route is a local
 * subset of the Wikidata dump (#1312).
 */

import { userAgent } from '../../config/userAgent.js';
import { abortOn, interruptibleDelay } from './sourceRetry.js';
import { SparqlUnanswered, type SparqlBinding } from './wikidataUtils.js';

export const QLEVER_WIKIDATA_ENDPOINT = 'https://qlever.dev/api/wikidata';
const QLEVER_USER_AGENT = userAgent({ bot: true });
/** Ours, not theirs: the mirror's own deadline is ten minutes or more. */
const QUESTION_TIMEOUT_MS = 120000;
const MIN_PAUSE_MS = 1000;
/** One more try after a timeout or a 5xx, then the caller asks something smaller. */
const RETRIES = 1;
const RETRY_PAUSE_MS = 10000;

let turn: Promise<void> = Promise.resolve();
let nextStartAt = 0;

/** One question in its turn, the next held back for as long as this one took. */
async function inTurn<T>(isCancelled: (() => boolean) | undefined, send: () => Promise<T>): Promise<T> {
  const previous = turn;
  let done!: () => void;
  turn = new Promise((resolve) => { done = resolve; });
  try {
    await previous;
    await interruptibleDelay(nextStartAt - Date.now(), isCancelled);
    if (isCancelled?.()) throw new Error('Sync cancelled');
    const startedAt = Date.now();
    try {
      return await send();
    } finally {
      nextStartAt = Date.now() + Math.max(MIN_PAUSE_MS, Date.now() - startedAt);
    }
  } finally {
    done();
  }
}

async function askOnce(query: string, isCancelled?: () => boolean): Promise<SparqlBinding[]> {
  const { signal, release } = abortOn(QUESTION_TIMEOUT_MS, isCancelled);
  try {
    let response: Response;
    try {
      response = await fetch(QLEVER_WIKIDATA_ENDPOINT, {
        method: 'POST',
        headers: {
          'Accept': 'application/sparql-results+json',
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': QLEVER_USER_AGENT,
        },
        body: new URLSearchParams({ query }),
        signal,
      });
    } catch (error) {
      throw new SparqlUnanswered(`QLever did not answer: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (response.status >= 500) throw new SparqlUnanswered(`QLever error ${response.status}`);
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`QLever refused the question with ${response.status}: ${text.substring(0, 300)}`);
    }
    let body: { results?: { bindings?: SparqlBinding[] } };
    try {
      body = await response.json() as { results?: { bindings?: SparqlBinding[] } };
    } catch (error) {
      // The headers came and the body did not, within the deadline: unanswered,
      // and asked once more. A whole body that is not JSON is a different thing.
      if (signal.aborted) throw new SparqlUnanswered('QLever did not finish its answer in time');
      throw new Error(`QLever answered with something that is not JSON: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (!body.results?.bindings) throw new Error('QLever answered without any results');
    return body.results.bindings;
  } finally {
    release();
  }
}

/**
 * One SPARQL question to Wikidata on QLever, in this process's turn for the
 * mirror. Throws `SparqlUnanswered` when the mirror could not answer it twice.
 */
export async function qleverWikidataQuery(query: string, isCancelled?: () => boolean): Promise<SparqlBinding[]> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await inTurn(isCancelled, () => askOnce(query, isCancelled));
    } catch (error) {
      if (!(error instanceof SparqlUnanswered) || attempt >= RETRIES || isCancelled?.()) throw error;
      console.warn(`[QLever Wikidata] ${error.message}, asking once more in ${RETRY_PAUSE_MS / 1000}s`);
      await interruptibleDelay(RETRY_PAUSE_MS, isCancelled);
    }
  }
}
