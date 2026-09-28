/**
 * The second door to OpenStreetMap: the public Overpass instances, asked in
 * Overpass QL — one batch of Wikidata items at a time for the per-item read,
 * and the planet's digs as eight exact-match questions for the enumeration
 * (#895), since an instance cannot answer that list whole.
 *
 * The fallback the QLever record names and ADR-0059 asks for, taken by the run
 * on its own when the mirror fails (`oneDoorPerRun.ts`): a mirror can move
 * house, and a run that read its silence as "no ruin is mapped here" would
 * refuse the sites the rule exists to admit. This door answers the same
 * questions in the same shapes — rows `foldOsmRows` reads for the per-item
 * answer, rows `foldOsmDigRows` reads for the enumeration, the article-only
 * ones included — so nothing above `readOsmObjects` learns which door it went
 * through: the site door's floor, the run's cache and the writer's extent are
 * the same either way.
 *
 * The manners are the register record's
 * (`docs/sources/global/openstreetmap-overpass.md` § The fallback reader) and
 * are stricter than the mirror's, because the main instance publishes its
 * limits and says in its own words that it is overloaded: one request at a time and
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
  classifyOsmError, OSM_BACKOFF_CEILING_MS, OSM_MAX_RETRIES, OsmQuestionRefusedError, refuseOrRetry,
} from './retry.js';
import { assertTagValues, OSM_TAG_KEYS, type DigTags, type KeepWkt } from './types.js';

/**
 * The public instances this door may ask, in the order it asks them.
 *
 * One dataset behind several servers: every instance serves the OpenStreetMap
 * planet, so the instance that answered changes the log line and never the
 * provenance (ADR-0059 decision 2 names OpenStreetMap, not a host). The main
 * instance first, because it is the one whose usage page quotes its limits and
 * whose operators the register record answered to first; then the two free
 * global instances whose policy the same record quotes, dated
 * (`docs/sources/global/openstreetmap-overpass.md` § The other public
 * instances) — the one whose data was current with the main instance's before
 * the one that was months behind. An instance behind a key or a payment is not on the list: none
 * is configured, and a keyed one is named only where a key is.
 *
 * Sequence, never parallel — the operators' one request of a client that knows
 * several of them is that it does not spread load across them — and each
 * instance is asked under the same manners, the strictest of the three
 * policies (the main instance's), so no instance is asked harder than the one
 * that publishes a number.
 */
export const OVERPASS_INSTANCES: readonly { name: string; endpoint: string }[] = [
  { name: 'overpass-api.de', endpoint: 'https://overpass-api.de/api/interpreter' },
  { name: 'maps.mail.ru', endpoint: 'https://maps.mail.ru/osm/tools/overpass/api/interpreter' },
  { name: 'overpass.private.coffee', endpoint: 'https://overpass.private.coffee/api/interpreter' },
];

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
 * How long the door waits for one question: what the question itself
 * declares, plus ten seconds for the answer to travel.
 *
 * Read off the query text rather than fixed, because the door sends two
 * kinds of question under two budgets — a batch at 120 s and the
 * enumeration at 600 s (#895) — and a door that hung up at the batch's
 * margin cut the enumeration's 9.6 MB body mid-stream on dry run 135, which
 * parsed as "not JSON". A question declaring no budget waits the batch's.
 */
export function declaredTimeoutMs(query: string): number {
  const declared = /\[timeout:(\d+)\]/.exec(query);
  return declared ? (Number(declared[1]) + 10) * 1000 : OVERPASS_TIMEOUT_MS;
}

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
 * `historic` value, by the presence of `ruins` or `archaeological_site` with
 * a value other than `no` (the mapper saying the opposite, which `saidOf`
 * reads as nothing), by its `man_made` value, or a protected area by its
 * `boundary` value — the same five clauses the mirror's `BIND(IF(…))` carries
 * — and it is the only set answered with `out geom`.
 */
export function overpassBatchQuery(qids: string[], keep: KeepWkt): string {
  for (const qid of qids) {
    if (!isQid(qid)) throw new Error(`${qid} is not a Wikidata id`);
  }
  const asked = qids.map((qid) => `  nwr["wikidata"="${qid}"];`).join('\n');
  const drawn = [
    anyOf('historic', keep.historic),
    'nwr.asked["ruins"]["ruins"!="no"];',
    'nwr.asked["archaeological_site"]["archaeological_site"!="no"];',
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
 * How long one enumeration question may run, declared to the instance.
 *
 * The enumeration is a heavier question than a batch and says so: one
 * selector alone — `historic=archaeological_site` with an item, 26,767
 * objects and 9.6 MB of tags — ran past the batch budget of 120 s in its
 * print phase on 2026-09-15 (131 s), where the whole set as one question
 * ran past 300 s. Ten minutes is far past one selector's measured cost and
 * still a bound the instance is told about rather than left to guess.
 */
export const OVERPASS_ENUMERATION_TIMEOUT_S = 600;

/**
 * The enumeration (#895) in this language: every object tagged as a dig or
 * as ruins carrying an item, and every one carrying an article and no item,
 * `out tags` and never `out geom` — **one question per selector**, and each
 * an exact match.
 *
 * Exact and not a regular expression, because `historic~"^(a|b)$"` is a scan
 * of every `historic` object on the planet and timed out at that line
 * (2026-09-15), where `historic="a"` is an index read. One selector per
 * question, because even the exact form answered whole ran past 300 s in
 * its print phase, and a selector on its own fits the enumeration's declared
 * budget. Eight questions a run, one at a time with the door's pause between
 * them: the register record's manners for this instance.
 */
export function overpassDigsQueries(tags: DigTags): string[] {
  const historic = assertTagValues(tags.historic).map((value) => `["historic"="${value}"]`);
  // A key's presence names a dig or ruins, except where the mapper wrote the
  // opposite: `ruins=no` is left out, as the mirror's `FILTER(?ruins != "no")` leaves it out.
  const keys = assertTagValues(tags.keys).map((key) => `["${key}"]["${key}"!="no"]`);
  const selectors = [...historic, ...keys];
  const links = ['["wikidata"]', '["wikipedia"][!"wikidata"]'];
  return links.flatMap((link) => selectors.map((selector) => (
    `[out:json][timeout:${OVERPASS_ENUMERATION_TIMEOUT_S}][maxsize:${OVERPASS_QUERY_MAXSIZE_B}];
nwr${selector}${link};
out tags;`
  )));
}

/**
 * An Overpass answer as the rows the mirror would have sent.
 *
 * One row per element: the item it carries, the object as the URI
 * `osmRefOf` reads, the geometry's type word, the WKT where the query's own
 * rule sent a geometry and the empty string where it did not — which is the
 * mirror's spelling of "no geometry, not an empty one" — and every tag the
 * reader asks for that the object carries. The per-item read asks by the
 * `wikidata` tag, so an element without one has no item to be filed under
 * and `foldOsmRows` drops it; the enumeration's four `["wikipedia"][!"wikidata"]`
 * questions send exactly such elements (Nemrut's tumulus), and `foldOsmDigRows`
 * files them under the article the `wp` column carries (#895).
 */
export function rowsOf(elements: OverpassElement[]): SparqlBinding[] {
  return elements.map((element) => {
    const tags = element.tags ?? {};
    const geometry = geometryOf(element);
    const row: SparqlBinding = {
      q: tags.wikidata ? { value: tags.wikidata } : undefined,
      // The article, for the enumeration's rows about an object carrying no
      // item (#895); the per-item read never sees one, since it asks by item.
      wp: tags.wikipedia ? { value: tags.wikipedia } : undefined,
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
  endpoint: string,
  query: string,
  options: { userAgent: string; isCancelled?: () => boolean; fetchImpl?: typeof fetch },
  attempt: number,
): Promise<SparqlBinding[]> {
  const { signal, release } = abortOn(declaredTimeoutMs(query), options.isCancelled);
  try {
    const response = await (options.fetchImpl ?? fetch)(endpoint, {
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
    } catch (error) {
      // A body cut mid-stream by the door's own deadline is a timeout, and is
      // retried as one; only a whole answer that is not JSON is that.
      if (signal.aborted) throw error;
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
 * A run's door to the public instances: paced, interruptible, and able to say
 * it is waiting — the mirror door's shape, with the pause the policy asks for
 * kept here, since it is this endpoint's manner and not the read's.
 *
 * **An instance closed to this run hands the same question to the next one**
 * (`OVERPASS_INSTANCES`). Closed means the question could not be answered
 * there once the retries and the run's wait budget were spent — a 429 or a
 * 5xx that outlasted them, a runtime error the instance kept reporting, a
 * dropped connection, a body that is not an answer — and the run continues on
 * the next instance from that question, and stays there: an instance that
 * turned this run away is not asked again by it, so the run never goes back
 * and forth between two servers. A 400 is not a closure: the question was
 * refused as asked, every instance runs the same engine, and the next one
 * would refuse it too (`OsmQuestionRefusedError`). When the last instance
 * closes the door fails, naming every instance and why it left each.
 *
 * The budget is the *run's*, handed in rather than minted here, for the
 * reason the mirror's is (#886); an instance entered after the budget is spent
 * still gets its first attempt, which is what makes the move worth anything.
 * `now` is the clock, replaceable by a test that must not wait five seconds to
 * see the pause.
 */
export function overpassOsmDoor(
  progress: { cancel: boolean; statusMessage: string },
  budget: WaitBudget,
  logPrefix: string = LOG_PREFIX_DEFAULT,
  options: { fetchImpl?: typeof fetch; now?: () => number } = {},
): OsmDoor {
  const now = options.now ?? Date.now;
  let lastAnsweredAt: number | null = null;
  let current = 0;
  const closures: string[] = [];
  const isCancelled = () => progress.cancel;

  const askInstance = (endpoint: string, query: string) => withRetries(
    (attempt) => askOverpass(endpoint, query, {
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

  /** The instance turned the run away: note why, and move to the next one for good. */
  const close = (instance: { name: string }, error: unknown): void => {
    const why = error instanceof Error ? error.message : String(error);
    closures.push(`${instance.name}: ${why}`);
    console.warn(`${logPrefix} Overpass instance ${instance.name} is closed to this run: ${why}`);
    current += 1;
    const next = OVERPASS_INSTANCES[current]?.name;
    if (!next) return;
    console.log(`${logPrefix} Asking the same question of the next Overpass instance, ${next}`);
    progress.statusMessage = `Overpass instance ${instance.name} is not answering; asking ${next}...`;
  };

  /** The question, of the instance the run is on and then of each after it. */
  const askInOrder = async (query: string): Promise<SparqlBinding[]> => {
    for (let instance = OVERPASS_INSTANCES[current]; instance; instance = OVERPASS_INSTANCES[current]) {
      try {
        return await askInstance(instance.endpoint, query);
      } catch (error) {
        if (isCancelled() || error instanceof OsmQuestionRefusedError) throw error;
        close(instance, error);
      }
    }
    throw new Error(`Every public Overpass instance is closed to this run — ${closures.join('; ')}`);
  };

  const send = async (query: string): Promise<SparqlBinding[]> => {
    if (lastAnsweredAt !== null) {
      const due = lastAnsweredAt + OVERPASS_PAUSE_MS - now();
      if (due > 0) await interruptibleDelay(due, isCancelled);
    }
    try {
      return await askInOrder(query);
    } finally {
      // Measured from the end of the exchange, answered or not: a refusal held
      // a slot for as long as an answer did.
      lastAnsweredAt = now();
    }
  };
  return { name: 'overpass', question: overpassBatchQuery, digsQuestions: overpassDigsQueries, send };
}
