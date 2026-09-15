/**
 * The first door to OpenStreetMap: the QLever osm-planet mirror, asked in
 * SPARQL — one batch of Wikidata items at a time for the per-item read, and
 * the whole planet's digs in one question for the enumeration (#895).
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
 * What the mirror answers is read by `readOsmObjects`, which is also where a
 * lost answer is kept from becoming a fact; the second door (`overpassOsm.ts`)
 * is the same shape on the public Overpass API.
 */

import { withRetries, abortOn, WaitBudget, type SourceWait } from '../sourceRetry.js';
import { isQid, waitMessage, type SparqlBinding } from '../wikidataUtils.js';
import { userAgent } from '../../../config/userAgent.js';
import type { OsmDoor } from './readOsmObjects.js';
import { classifyOsmError, OSM_MAX_RETRIES, refuseOrRetry } from './retry.js';
import { assertTagValues, OSM_TAG_KEYS, type DigTags, type KeepWkt } from './types.js';

export const OSM_ENDPOINT = 'https://qlever.dev/api/osm-planet';

/** What every OSM read tells the mirror it is. Built once (#864), never spelled at a call site. */
const OSM_USER_AGENT = userAgent({ bot: true });

/**
 * How long one batch may take.
 *
 * QLever's own deadline is ten minutes or more, so this is ours rather than
 * theirs: two minutes is far past the slowest batch measured (about eight
 * seconds) and short of a socket that will never close.
 */
export const OSM_TIMEOUT_MS = 120000;

/**
 * How long the enumeration may take (#895): the heaviest question the mirror
 * is asked — 66,417 rows, answered in seconds on an ordinary day and in
 * minutes on the afternoon of 2026-09-15, when a probe of three items took
 * 213 s. Under the batch's budget it would be cut and the run ended. Nine
 * minutes, where the Overpass door declares 600 s for the same list
 * (`OVERPASS_ENUMERATION_TIMEOUT_S`): inside the mirror's own ten-minute
 * deadline, so the cut is still ours — an abort retried as a timeout — and
 * never theirs, which would arrive as a 200 with no bindings and end the
 * run naming the wrong cause.
 */
export const OSM_ENUMERATION_TIMEOUT_MS = 540000;

/**
 * A question's budget, declared in the question itself the way an Overpass
 * question declares its `[timeout:…]`: a first-line SPARQL comment the mirror
 * ignores, `# timeout: 540s`. A question declaring none waits the batch's.
 */
export function questionBudgetMs(query: string): number {
  const declared = /^# timeout: (\d+)s\n/.exec(query);
  return declared ? Number(declared[1]) * 1000 : OSM_TIMEOUT_MS;
}

const RETRY_LABEL = 'OSM';

const LOG_PREFIX_DEFAULT = '[OSM]';

function literals(values: string[]): string {
  return assertTagValues(values).map((value) => `"${value}"`).join(', ');
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

/**
 * The enumeration (#895): every object tagged as a dig or as ruins that
 * carries an item or an article — names, never outlines. One question a run
 * (the mirror answers it whole; `osm/overpassOsm.ts` cannot and splits),
 * 66,417 rows on 2026-09-15, answered in seconds without the geometry and in
 * minutes with it, which is why `geo:asWKT` is not here: the per-item read
 * fetches the outline of what the rule admits, and only that.
 *
 * `ruins=no` is a mapper saying the opposite and is left out; every other
 * value of the key — `yes`, a type, a date — says ruins.
 */
export function osmDigsQueries(tags: DigTags): string[] {
  const historic = literals(tags.historic);
  const keys = assertTagValues(tags.keys);
  const byKey = keys.map((key) => `  { ?s osmkey:${key} ?${key} . FILTER(?${key} != "no") }`);
  const columns = keys.map((key) => `?${key}`).join(' ');
  return [`# timeout: ${OSM_ENUMERATION_TIMEOUT_MS / 1000}s
PREFIX osmkey: <https://www.openstreetmap.org/wiki/Key:>
SELECT ?q ?wp ?s ?historic ${columns} ?name WHERE {
  {
  { ?s osmkey:historic ?historic . FILTER(?historic IN (${historic})) }
${byKey.map((clause) => `  UNION\n${clause}`).join('\n')}
  }
  OPTIONAL { ?s osmkey:wikidata ?q }
  OPTIONAL { ?s osmkey:wikipedia ?wp }
  OPTIONAL { ?s osmkey:name ?name }
  FILTER(BOUND(?q) || BOUND(?wp))
}`];
}

async function askQlever(
  query: string,
  options: { userAgent: string; isCancelled?: () => boolean; fetchImpl?: typeof fetch },
  attempt: number,
): Promise<SparqlBinding[]> {
  const { signal, release } = abortOn(questionBudgetMs(query), options.isCancelled);
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
    if (!response.ok) await refuseOrRetry(response, attempt, { label: RETRY_LABEL });
    let body: { results?: { bindings?: SparqlBinding[] } };
    try {
      body = await response.json() as { results?: { bindings?: SparqlBinding[] } };
    } catch (error) {
      // A body cut mid-stream by the door's own deadline is a timeout, and is
      // retried as one; only a whole answer that is not JSON is that.
      if (signal.aborted || (error instanceof Error && error.name === 'AbortError')) throw error;
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
): OsmDoor {
  const send = (query: string): Promise<SparqlBinding[]> => withRetries(
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
      classify: (error, attempt, retries) => classifyOsmError(error, attempt, retries, RETRY_LABEL),
    },
  );
  return { name: 'qlever', question: osmBatchQuery, digsQuestions: osmDigsQueries, send };
}
