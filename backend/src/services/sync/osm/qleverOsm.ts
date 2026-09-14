/**
 * The first door to OpenStreetMap: the QLever osm-planet mirror, asked one
 * batch of Wikidata items at a time in SPARQL.
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
import { assertTagValues, OSM_TAG_KEYS, type KeepWkt } from './types.js';

export const OSM_ENDPOINT = 'https://qlever.dev/api/osm-planet';

/** What every OSM read tells the mirror it is. Built once (#864), never spelled at a call site. */
const OSM_USER_AGENT = userAgent({ bot: true });

/**
 * How long one question may take.
 *
 * QLever's own deadline is ten minutes or more, so this is ours rather than
 * theirs: two minutes is far past the slowest batch measured (about eight
 * seconds) and short of a socket that will never close.
 */
const OSM_TIMEOUT_MS = 120000;

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
    if (!response.ok) await refuseOrRetry(response, attempt, { label: RETRY_LABEL });
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
  return { name: 'qlever', question: osmBatchQuery, send };
}
