/**
 * The door to OpenStreetMap: the QLever osm-planet mirror, asked one batch of
 * Wikidata items at a time.
 *
 * The manners are the register record's
 * (`docs/sources/global/openstreetmap-qlever.md`) and are not decoration. The
 * endpoint is a third-party mirror with no formal terms and no published rate
 * limit, whose usage page asks a heavy user to run their own copy and whose
 * logs keep an IP for a week against "a very large number of queries coming
 * from the same IP address". So: one batch of a hundred at a time, a pause
 * between them, the project's own `User-Agent` with the bot marker (ADR-0043's
 * rule, #864), and every answer kept for a day (ADR-0030, ADR-0047).
 *
 * POST, never GET — a hundred items in a `VALUES` clause is far past what a URL
 * carries, and the readership measurement has already met the Action API's 414
 * for the same reason.
 *
 * **A lost answer is never read as a fact**, and it takes two guards to mean
 * it. The whole point of asking OSM is to tell a ruin from a living town, so a
 * batch that came back empty because the mirror moved house would turn every
 * site in it into "no OSM object carries this item" and refuse the ones the
 * rule is there to admit. A batch that cannot be *read* throws here — the run
 * fails and nothing is written, the shape the Wikipedia category readers took
 * for the same reason (#887). But a mirror can also answer HTTP 200 with no
 * bindings at all, which this module cannot tell from a genuine "nothing is
 * mapped there": a renamed `osmkey:` IRI, a rebuilt dataset, the host moving
 * again. Only the caller knows how much silence is too much, so the second
 * guard is the site door's — `collectSitesByFame` counts the share of asked
 * items that came back with an object and fails the run below a floor
 * (`OSM_ANSWER_FLOOR`), before a single verdict is taken.
 */

import {
  withRetries, abortOn, exponentialBackoff, backoffFromRetryAfter, RetrySignal, WaitBudget,
  type SourceWait,
} from '../sourceRetry.js';
import { chunk, type QueryRunner, type SparqlFn } from '../wikidataQueries.js';
import { isQid, waitMessage, type SparqlBinding } from '../wikidataUtils.js';
import { userAgent } from '../../../config/userAgent.js';
import { foldOsmRows, OSM_TAG_KEYS, type OsmObject } from './types.js';

export const OSM_ENDPOINT = 'https://qlever.dev/api/osm-planet';

/** What every OSM read tells the mirror it is. Built once (#864), never spelled at a call site. */
const OSM_USER_AGENT = userAgent({ bot: true });

/** Items per question. A hundred answered in a few seconds across the whole measurement. */
export const OSM_BATCH = 100;

/**
 * How long one question may take.
 *
 * QLever's own deadline is ten minutes or more, so this is ours rather than
 * theirs: two minutes is far past the slowest batch measured (about eight
 * seconds) and short of a socket that will never close.
 */
const OSM_TIMEOUT_MS = 120000;

const OSM_MAX_RETRIES = 4;
const OSM_BACKOFF_CEILING_MS = 60000;

const LOG_PREFIX_DEFAULT = '[OSM]';

/** Which objects the query may send a geometry for; the kind decides the values. */
export interface KeepWkt {
  /** `historic` values that mean a ruin. */
  historic: string[];
  /** `man_made` values that mean one. */
  manMade: string[];
  /** `boundary` values worth an extent — a protected area, never an administrative one. */
  boundary: string[];
}

/** A tag value may be spliced into SPARQL only if it is one. */
const TAG_VALUE = /^[a-z0-9_:-]+$/;

function literals(values: string[]): string {
  for (const value of values) {
    if (!TAG_VALUE.test(value)) {
      throw new Error(`${value} is not an OSM tag value this reader will ask for`);
    }
  }
  return values.map((value) => `"${value}"`).join(', ');
}

/**
 * The one question, for one batch.
 *
 * **The WKT rule is in the query, not in the parse** — the promise the register
 * record makes under *What was read* and *Rate and manners*
 * (`docs/sources/global/openstreetmap-qlever.md`): this connector is not a
 * heavy user, and a city's outline it would throw away is bandwidth somebody
 * else pays for. The geometry is bound only for an object that carries a ruin
 * signal or a protected-area boundary, so a city's administrative outline never
 * crosses the wire. `IF` over `COALESCE`d tags
 * rather than a `FILTER` inside the `OPTIONAL`, because an unbound tag in an
 * `IN` is an error that would take the whole row with it.
 *
 * `SUBSTR(STR(?anyWkt), 1, 12)` is the geometry *type* of every object,
 * including the ones whose geometry is not sent — enough to say "this one is a
 * polygon" in a log without carrying the polygon.
 */
export function osmBatchQuery(qids: string[], keep: KeepWkt): string {
  for (const qid of qids) {
    if (!isQid(qid)) throw new Error(`${qid} is not a Wikidata id`);
  }
  const optionals = OSM_TAG_KEYS.map((key) => `  OPTIONAL { ?s osmkey:${key} ?${key} }`).join('\n');
  const columns = OSM_TAG_KEYS.map((key) => `?${key}`).join(' ');
  const keepWkt = [
    `COALESCE(?historic, "") IN (${literals(keep.historic)})`,
    'BOUND(?ruins)',
    'BOUND(?archaeological_site)',
    `COALESCE(?man_made, "") IN (${literals(keep.manMade)})`,
    `COALESCE(?boundary, "") IN (${literals(keep.boundary)})`,
  ].join(' || ');
  return `PREFIX osmkey: <https://www.openstreetmap.org/wiki/Key:>
PREFIX geo: <http://www.opengis.net/ont/geosparql#>
PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
SELECT ?q ?s ?type ?geomType ?wkt ${columns} WHERE {
  VALUES ?q { ${qids.map((qid) => `"${qid}"`).join(' ')} }
  ?s osmkey:wikidata ?q .
  OPTIONAL { ?s rdf:type ?type }
${optionals}
  OPTIONAL { ?s geo:hasGeometry/geo:asWKT ?anyWkt }
  BIND(SUBSTR(STR(?anyWkt), 1, 12) AS ?geomType)
  BIND(IF(${keepWkt}, STR(?anyWkt), "") AS ?wkt)
}`;
}

async function handleHttpError(response: Response, attempt: number): Promise<never> {
  const text = await response.text();
  if (attempt < OSM_MAX_RETRIES && (response.status >= 500 || response.status === 429)) {
    const retryAfter = Number(response.headers.get('retry-after'));
    throw new RetrySignal(
      backoffFromRetryAfter(retryAfter, attempt, OSM_BACKOFF_CEILING_MS),
      `OSM ${response.status}`,
    );
  }
  throw new Error(`OpenStreetMap answered ${response.status}: ${text.substring(0, 300)}`);
}

/**
 * What is worth another attempt: a timeout and a dropped connection, plus the
 * statuses above. A body that will not parse is not — a mirror answering HTML
 * answers HTML again a minute later.
 */
function classify(error: unknown, attempt: number, retries: number): RetrySignal | Error {
  if (error instanceof RetrySignal) return error;
  const isAbort = error instanceof Error && error.name === 'AbortError';
  if (attempt < retries && (isAbort || error instanceof TypeError)) {
    return new RetrySignal(
      exponentialBackoff(attempt, OSM_BACKOFF_CEILING_MS),
      isAbort ? 'OSM timeout' : 'OSM network error',
    );
  }
  return error instanceof Error ? error : new Error(String(error));
}

async function askQlever(
  query: string,
  options: { userAgent: string; isCancelled?: () => boolean; fetchImpl?: typeof fetch },
  attempt: number,
): Promise<SparqlBinding[]> {
  const { signal, release } = abortOn(OSM_TIMEOUT_MS, options.isCancelled);
  try {
    const response = await (options.fetchImpl ?? fetch)(OSM_ENDPOINT, {
      method: 'POST',
      headers: {
        'Accept': 'application/sparql-results+json',
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': options.userAgent,
      },
      body: new URLSearchParams({ query }),
      signal,
    });
    if (!response.ok) await handleHttpError(response, attempt);
    let body: { results?: { bindings?: SparqlBinding[] } };
    try {
      body = await response.json() as { results?: { bindings?: SparqlBinding[] } };
    } catch {
      throw new Error('OpenStreetMap answered with something that is not JSON');
    }
    const bindings = body.results?.bindings;
    if (!bindings) throw new Error('OpenStreetMap answered without any results');
    return bindings;
  } finally {
    release();
  }
}

/**
 * A run's door to the mirror: paced, interruptible, and able to say it is
 * waiting — `wikidataDoor`'s shape, on this endpoint's own errors.
 *
 * The budget is the *run's*, handed in rather than minted here: this run
 * already waits on Wikidata and on English Wikipedia, and a budget per door is
 * a run that waits three times the number any one of them was held to (#886).
 */
export function qleverOsmDoor(
  progress: { cancel: boolean; statusMessage: string },
  budget: WaitBudget,
  logPrefix: string = LOG_PREFIX_DEFAULT,
  options: { fetchImpl?: typeof fetch } = {},
): (query: string) => Promise<SparqlBinding[]> {
  return (query) => withRetries(
    (attempt) => askQlever(query, {
      userAgent: OSM_USER_AGENT,
      isCancelled: () => progress.cancel,
      fetchImpl: options.fetchImpl,
    }, attempt),
    {
      logPrefix,
      retries: OSM_MAX_RETRIES,
      budget,
      isCancelled: () => progress.cancel,
      onWait: (wait: SourceWait) => {
        progress.statusMessage = waitMessage('OpenStreetMap', wait, budget);
      },
      classify,
    },
  );
}

/**
 * Every object carrying `wikidata=<item>`, for each of a list of items.
 *
 * `send` rather than the door itself, so the caller composes the cache over it
 * (`withCache`) exactly as the Wikidata collectors do: this module knows how to
 * ask, and the run knows whether it is allowed to remember.
 */
export async function readOsmObjects(
  send: SparqlFn,
  qids: string[],
  keep: KeepWkt,
  run: Pick<QueryRunner, 'phase' | 'step'>,
): Promise<Map<string, OsmObject[]>> {
  const out = new Map<string, OsmObject[]>();
  const asked = [...new Set(qids.filter(isQid))];
  if (!asked.length) return out;
  for (const qid of asked) out.set(qid, []);

  const batches = chunk(asked, OSM_BATCH);
  for (let i = 0; i < batches.length; i++) {
    run.phase(`Asking OpenStreetMap what it maps at each site (batch ${i + 1}/${batches.length})...`);
    await run.step();
    const rows = await send(osmBatchQuery(batches[i], keep), {
      kind: 'osm',
      label: `OSM objects of ${batches[i].length} item${batches[i].length === 1 ? '' : 's'}`,
    });
    foldOsmRows(rows, out);
  }
  return out;
}
