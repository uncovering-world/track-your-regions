/**
 * The second door to OpenStreetMap: the public Overpass API, asked one batch
 * of Wikidata items at a time in Overpass QL.
 *
 * The fallback the QLever record names and ADR-0059 asks for: a mirror can
 * move house, and a run that read its silence as "no ruin is mapped here"
 * would refuse the sites the rule exists to admit. This door answers the
 * same question in the same shape — rows `foldOsmRows` reads — so nothing
 * above `readOsmObjects` learns which door it went through: the site door's
 * floor, the run's cache and the writer's extent are the same either way.
 *
 * The manners are the register record's
 * (`docs/sources/global/openstreetmap-overpass.md` § The fallback reader) and
 * are stricter than the mirror's, because the instance publishes its limits
 * and says in its own words that it is overloaded: one request at a time and
 * never two, a pause between them, a `[timeout:]` declared in every query so
 * the server can plan around it, the thirty seconds the wiki asks for after a
 * 429, the project's own `User-Agent` with the bot marker (ADR-0043's rule,
 * #864), and every answer kept for a day (ADR-0030). The geometry rule is the
 * same promise the mirror's query makes: `out geom` only for a ruin or a
 * protected area, `out tags` for everything else, so a city's administrative
 * outline never crosses the wire.
 */

import {
  withRetries, abortOn, exponentialBackoff, interruptibleDelay, RetrySignal, WaitBudget,
  type SourceWait,
} from '../sourceRetry.js';
import { isQid, waitMessage, type SparqlBinding } from '../wikidataUtils.js';
import { userAgent } from '../../../config/userAgent.js';
import { geometryOf, type OverpassElement } from './overpassGeometry.js';
import type { OsmDoor } from './readOsmObjects.js';
import {
  classifyOsmError, OSM_BACKOFF_CEILING_MS, OSM_MAX_RETRIES, refuseOrRetry,
} from './retry.js';
import { assertTagValues, OSM_TAG_KEYS, type KeepWkt } from './types.js';

export const OVERPASS_ENDPOINT = 'https://overpass-api.de/api/interpreter';

/** What every Overpass read tells the instance it is. Built once (#864), never spelled at a call site. */
const OVERPASS_USER_AGENT = userAgent({ bot: true });

/**
 * The run time every question declares, in seconds — the policy's own
 * mechanism ("if no maximum run time is declared then a default limit of 180
 * seconds applies"). A hundred items answered in five seconds on the day it
 * was measured; two minutes is far past that and lets the server refuse
 * early, with a 504, rather than hold a slot for a question it cannot finish.
 */
export const OVERPASS_QUERY_TIMEOUT_S = 120;

/** Ours, just past theirs: a socket that outlives the declared run time is one that will never close. */
const OVERPASS_TIMEOUT_MS = (OVERPASS_QUERY_TIMEOUT_S + 10) * 1000;

/**
 * The memory every question declares, in bytes — the other half of the same
 * mechanism, since the server "admits a request if and only if it is going to
 * use in both criteria at most half of the remaining available resources".
 * Left undeclared it would claim the default 512 MiB, which asks an instance
 * that calls itself overloaded to have a gigabyte free before it runs a
 * question whose answer is under a megabyte. The batch of 100 admitted sites
 * ran to completion under a declared 8 MiB on 2026-09-14; 64 MiB is eight
 * times that and an eighth of the default.
 */
export const OVERPASS_QUERY_MAXSIZE_B = 64 * 1024 * 1024;

/**
 * The pause between two questions, measured from the end of the last answer.
 *
 * The instance gives each address two slots and holds a request's slot for
 * its run time plus a cool-down "proportionate to the execution time", so a
 * run that fired its next batch the moment the last one landed would be
 * queueing on its own cool-down. Five seconds is about one batch's measured
 * run time, and twelve batches a run makes it a minute nobody notices.
 */
export const OVERPASS_PAUSE_MS = 5000;

/** What the wiki asks after a 429 that names no `Retry-After`: "pause for 30 seconds". */
export const OVERPASS_RATE_LIMIT_PAUSE_MS = 30000;

const RETRY_LABEL = 'Overpass';

const LOG_PREFIX_DEFAULT = '[OSM]';

/** A regular expression over a closed list of tag values, or nothing where the list is empty. */
function anyOf(key: string, values: string[]): string | null {
  if (values.length === 0) return null;
  return `nwr.asked["${key}"~"^(${assertTagValues(values).join('|')})$"];`;
}

/**
 * The one question, for one batch.
 *
 * An exact `nwr["wikidata"="Q…"]` per item rather than one regular expression
 * over the key, because the expression is matched against every object on
 * the planet carrying `wikidata=*` and the exact match is an index read. The
 * `drawn` set is the geometry rule spelled in this language: a ruin by its
 * `historic` value, by the presence of `ruins` or `archaeological_site`, by
 * its `man_made` value, or a protected area by its `boundary` value — the
 * same five clauses the mirror's `BIND(IF(…))` carries — and it is the only
 * set answered with `out geom`.
 */
export function overpassBatchQuery(qids: string[], keep: KeepWkt): string {
  for (const qid of qids) {
    if (!isQid(qid)) throw new Error(`${qid} is not a Wikidata id`);
  }
  const asked = qids.map((qid) => `  nwr["wikidata"="${qid}"];`).join('\n');
  const drawn = [
    anyOf('historic', keep.historic),
    'nwr.asked["ruins"];',
    'nwr.asked["archaeological_site"];',
    anyOf('man_made', keep.manMade),
    anyOf('boundary', keep.boundary),
  ].filter((clause): clause is string => clause !== null).map((clause) => `  ${clause}`).join('\n');
  return `[out:json][timeout:${OVERPASS_QUERY_TIMEOUT_S}][maxsize:${OVERPASS_QUERY_MAXSIZE_B}];
(
${asked}
)->.asked;
(
${drawn}
)->.drawn;
(.asked; - .drawn;)->.rest;
.rest out tags;
.drawn out geom;`;
}

/**
 * An Overpass answer as the rows the mirror would have sent.
 *
 * One row per element: the item it carries, the object as the URI
 * `osmRefOf` reads, the geometry's type word, the WKT where the query's own
 * rule sent a geometry and the empty string where it did not — which is the
 * mirror's spelling of "no geometry, not an empty one" — and every tag the
 * reader asks for that the object carries. An element with no `wikidata` tag
 * cannot be here (the query asks by it), and one that somehow is has no item
 * to be filed under and is dropped by `foldOsmRows`.
 */
export function rowsOf(elements: OverpassElement[]): SparqlBinding[] {
  return elements.map((element) => {
    const tags = element.tags ?? {};
    const geometry = geometryOf(element);
    const row: SparqlBinding = {
      q: tags.wikidata ? { value: tags.wikidata } : undefined,
      s: { value: `https://www.openstreetmap.org/${element.type}/${element.id}` },
      type: { value: `https://www.openstreetmap.org/${element.type}` },
      geomType: geometry.type ? { value: geometry.type } : undefined,
      wkt: { value: geometry.wkt ?? '' },
    };
    for (const key of OSM_TAG_KEYS) {
      if (tags[key] !== undefined) row[key] = { value: tags[key] };
    }
    return row;
  });
}

/**
 * How the instance reports a question it could not finish: HTTP 200, no
 * elements, and a `remark` such as "runtime error: Query timed out in "query"
 * at line 3 after 120 seconds." Read as "ask again later", never as "nothing
 * is mapped there".
 */
const RUNTIME_ERROR = /runtime error/i;

/**
 * The 429 backoff the policy asks for; the doubling for everything else. Both
 * yield to a `Retry-After` the server names.
 */
function overpassBackoff(status: number, retryAfterSeconds: number, attempt: number): number {
  if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) return retryAfterSeconds * 1000;
  if (status === 429) return OVERPASS_RATE_LIMIT_PAUSE_MS;
  return exponentialBackoff(attempt, OSM_BACKOFF_CEILING_MS);
}

async function askOverpass(
  query: string,
  options: { userAgent: string; isCancelled?: () => boolean; fetchImpl?: typeof fetch },
  attempt: number,
): Promise<SparqlBinding[]> {
  const { signal, release } = abortOn(OVERPASS_TIMEOUT_MS, options.isCancelled);
  try {
    const response = await (options.fetchImpl ?? fetch)(OVERPASS_ENDPOINT, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': options.userAgent,
      },
      body: new URLSearchParams({ data: query }),
      signal,
    });
    if (!response.ok) {
      await refuseOrRetry(response, attempt, { label: RETRY_LABEL, backoffMs: overpassBackoff });
    }
    let body: { elements?: OverpassElement[]; remark?: string };
    try {
      body = await response.json() as { elements?: OverpassElement[]; remark?: string };
    } catch {
      throw new Error('OpenStreetMap answered with something that is not JSON');
    }
    if (body.remark && RUNTIME_ERROR.test(body.remark)) {
      if (attempt < OSM_MAX_RETRIES) {
        throw new RetrySignal(
          exponentialBackoff(attempt, OSM_BACKOFF_CEILING_MS), `${RETRY_LABEL} runtime error`,
        );
      }
      throw new Error(`OpenStreetMap could not finish the question: ${body.remark.substring(0, 300)}`);
    }
    if (!body.elements) throw new Error('OpenStreetMap answered without any elements');
    return rowsOf(body.elements);
  } finally {
    release();
  }
}

/**
 * A run's door to the public instance: paced, interruptible, and able to say
 * it is waiting — the mirror door's shape, with the pause the policy asks for
 * kept here, since it is this endpoint's manner and not the read's.
 *
 * The budget is the *run's*, handed in rather than minted here, for the
 * reason the mirror's is (#886). `now` is the clock, replaceable by a test
 * that must not wait five seconds to see the pause.
 */
export function overpassOsmDoor(
  progress: { cancel: boolean; statusMessage: string },
  budget: WaitBudget,
  logPrefix: string = LOG_PREFIX_DEFAULT,
  options: { fetchImpl?: typeof fetch; now?: () => number } = {},
): OsmDoor {
  const now = options.now ?? Date.now;
  let lastAnsweredAt: number | null = null;
  const isCancelled = () => progress.cancel;

  const send = async (query: string): Promise<SparqlBinding[]> => {
    if (lastAnsweredAt !== null) {
      const due = lastAnsweredAt + OVERPASS_PAUSE_MS - now();
      if (due > 0) await interruptibleDelay(due, isCancelled);
    }
    try {
      return await withRetries(
        (attempt) => askOverpass(query, {
          userAgent: OVERPASS_USER_AGENT, isCancelled, fetchImpl: options.fetchImpl,
        }, attempt),
        {
          logPrefix,
          retries: OSM_MAX_RETRIES,
          budget,
          isCancelled,
          onWait: (wait: SourceWait) => {
            progress.statusMessage = waitMessage('OpenStreetMap', wait, budget);
          },
          classify: (error, attempt, retries) => classifyOsmError(error, attempt, retries, RETRY_LABEL),
        },
      );
    } finally {
      // Measured from the end of the exchange, answered or not: a refusal held
      // a slot for as long as an answer did.
      lastAnsweredAt = now();
    }
  };
  return { name: 'overpass', question: overpassBatchQuery, send };
}
