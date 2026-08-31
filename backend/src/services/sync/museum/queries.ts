/**
 * Every Wikidata query the works-first museum import sends, and the parsing of what comes back.
 *
 * Kept apart from `pipeline.ts` so that the composition of the pure modules reads as
 * composition, and so each query shape sits next to the measurement that produced it. All of
 * these were run against the live endpoint on 2026-08-06; the notes are not decoration:
 *
 *   - the statement-level form (`p:`/`ps:`/`wikibase:rank`) does not survive over the whole
 *     pool — it 502s and then times out — so it is batched by the caller;
 *   - `wikibase:rank` must sit *inside* each UNION branch. With it outside, a batch of five
 *     works took over 65 s and was cut off by the gateway; inside, fifty works answer in 79 s
 *     cold and half a second warm;
 *   - the label service needs `mul` in its fallback chain, or the National Gallery of Art comes
 *     back as the bare string `Q214867`;
 *   - `wdt:P170` (creator) needs the same blank-node filter the venue bindings get: 51 works in
 *     the pool carry a `.well-known/genid/…` creator today, and every creator is
 *     collected rather than whichever won a race (#720), so the filter is load-bearing.
 *
 * Each exported fetcher sends one query, with one exception: the broad pool is asked in fame
 * bands, and takes the runner so that pacing and cancellation still happen between them. What
 * else to batch is the pipeline's decision, since only it knows how long a run may take.
 */

import { extractQid, isQid, parseWktPoint, LABEL_LANGS, type SparqlBinding } from '../wikidataUtils.js';
import { foldLabel } from '../labelFold.js';
import type { CacheDescriptor } from '../wikidataCache.js';

/**
 * A door to the source, optionally told what the question is about.
 *
 * The descriptor is what the cache files an answer under, and it comes from the
 * call site because only the call site knows: this `SELECT ?c` is the class
 * closure, that one is a pool of works. A cache classifying by pattern-matching
 * SPARQL would be one refactor away from filing a pool under `classes` and
 * keeping it for a week. Omitting it means "do not keep this", which is the
 * right default for a one-off.
 */
export type SparqlFn =
  (query: string, descriptor?: CacheDescriptor) => Promise<SparqlBinding[]>;

/**
 * A paced, interruptible way to send them. `step` is awaited before every query: it is where a
 * cancelled run throws and where the rate limit is spent, so no fetcher has to know either.
 */
export interface QueryRunner {
  sparql: SparqlFn;
  phase: (message: string) => void;
  step: () => Promise<void>;
}

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export function unique(values: string[]): string[] {
  return [...new Set(values)];
}

export { LABEL_LANGS, isQid };

const ENTITY_PREFIX = 'http://www.wikidata.org/entity/';

/**
 * Everything below the class `museum` (Q33506) is a museum-like class — 373 of them, measured.
 * The traversal is in *class* space, which is cheap; it is the instance-space `P31/P279*` join
 * that times the endpoint out.
 */
export const MUSEUM_ROOT = 'Q33506';

/**
 * A work is worth collecting well below the iconic threshold of 22 sitelinks: the hysteresis
 * that keeps an already-iconic treasure marked until it falls below 18 can only work if works
 * in that band are still fetched, and a museum's contents list is not limited to its famous
 * rooms. Measured: the whole pool at this floor is ~2080 works.
 */
export const POOL_MIN_SITELINKS = 10;

/** No pool query has ever returned this many rows; one that does stops the run. */
export const POOL_LIMIT = 3000;



/** QIDs of a binding column, blank nodes dropped. */
function qidsOf(rows: SparqlBinding[], column: string): string[] {
  const out: string[] = [];
  for (const row of rows) {
    const value = row[column]?.value;
    if (!value) continue;
    const qid = extractQid(value);
    if (isQid(qid)) out.push(qid);
  }
  return out;
}

function values(qids: string[]): string {
  return qids.map((q) => `wd:${q}`).join(' ');
}

/**
 * A truncated *pool* query stops the run.
 *
 * The pool decides which museums this category admits (ADR-0024), so a pool cut
 * off at its LIMIT withdraws real museums and reports success — the one failure
 * the admission axis exists to prevent, and the reason ADR-0030 makes a *failed*
 * band fatal. A *truncated* band is the same short pool arrived at more quietly,
 * so it is fatal too. Worse, in fact: a banded query carries no `ORDER BY`, so
 * the rows kept are an arbitrary subset rather than the most famous ones.
 *
 * The remedy belongs to a person, not to a retry: a band whose range holds more
 * than the limit needs splitting, and the message says which one so that the
 * next edit is obvious.
 */
function failIfTruncated(rows: SparqlBinding[], limit: number, label: string): void {
  if (rows.length < limit) return;
  throw new Error(
    `${label} returned exactly its LIMIT of ${limit} rows. The pool decides which museums `
    + 'this category admits, so a short one would withdraw museums and call the run a success. '
    + 'Split this band, or raise its limit.',
  );
}

// =============================================================================
// Classes
// =============================================================================

/** Direct `P279` children of a frontier — one hop, for `boundedClosure`. */
export async function fetchSubclasses(sparql: SparqlFn, parents: string[]): Promise<string[]> {
  if (!parents.length) return [];
  const rows = await sparql(
    `SELECT DISTINCT ?c WHERE { VALUES ?p { ${values(parents)} } ?c wdt:P279 ?p }`,
    { kind: 'classes', label: `subclasses of ${parents.length} class(es)` },
  );
  return qidsOf(rows, 'c');
}

/** The whole `P279*` tree under `museum`, which is what the venue test tests against. */
export async function fetchMuseumClasses(sparql: SparqlFn): Promise<Set<string>> {
  const rows = await sparql(
    `SELECT ?c WHERE { ?c wdt:P279* wd:${MUSEUM_ROOT} }`,
    { kind: 'classes', label: 'museum classes' },
  );
  return new Set(qidsOf(rows, 'c'));
}

// =============================================================================
// The artwork pool
// =============================================================================

export interface PoolWork {
  qid: string;
  label: string;
  sitelinks: number;
  imageUrl: string | null;
  /**
   * Every maker the source names, deduped, in the order the answer arrived (#720).
   *
   * A list because the query below already answers with one row per creator and
   * the parse used to keep whichever arrived first — which is how `Morning in a
   * Pine Forest` came to be Savitsky's alone, and `The Feast of the Gods`
   * Titian's.
   *
   * **The order here is storage, not a claim** (ADR-0040). SPARQL exposes no
   * statement order, so what a query answers in is its planner's: measured
   * against a real run's cached answers, the banded pool returns the creators in
   * *reverse* statement order — which is also the whole of run 64's churn, the
   * old parse having kept the first row and so the last statement. Nothing here
   * sorts it either. Who leads is a curator's judgement, recorded by the work
   * edit endpoint and counted by a Catalogue Checks watch until it is made.
   */
  creators: string[];
  year: number | null;
  /** The class the work was collected under, as a reader sees it: `painting`, `fresco`, `icon`. */
  type: string;
  /**
   * That class as a QID. Carried because the medium question — is this a thing
   * that exists in one original, or in an edition — is answered against the
   * subclass tree, and a label cannot be asked that.
   */
  typeQid: string | null;
}

interface Band {
  min: number;
  /** Exclusive; `null` is the open top band. */
  max: number | null;
}

/**
 * How famous a work has to be to appear, sliced into bands.
 *
 * Only the three broad roots are asked this way, and the reason is the failure
 * that motivated it: run 61 died asking for every instance of `painting` — half
 * a million of them — with each one's sitelink count read and the lot sorted.
 * Measured on 2026-08-21 against the live endpoint, that shape cannot be made to
 * fit the sixty seconds the service allows: without the sort it still timed out,
 * and stripped down to two columns it came back 502.
 *
 * What works is asking the *other* question first. `?w wikibase:sitelinks ?sl`
 * with a range hint is an index scan over the entities in the band, and the
 * class is then a probe on what that scan found rather than a scan of its own.
 * Same answer, different order, and the top band went from a gateway error to
 * seven seconds. The bands exist because that scan is proportional to the width
 * of the range: 10–19 took 61 seconds, 10–11 took 33, so the bottom of the range
 * is cut finer than the top, where far fewer entities live per sitelink.
 *
 * Each band is a separate question with its own cache entry, so a run that dies
 * in the fourth band keeps the first three. The bands are open at the top and
 * closed at the bottom, and they tile the range with no gap and no overlap,
 * because a work appearing in two bands would be counted twice by anything
 * downstream that trusts the pool's length.
 */
export const POOL_BANDS: Band[] = [
  { min: 100, max: null },
  { min: 50, max: 100 },
  { min: 30, max: 50 },
  { min: 20, max: 30 },
  { min: 15, max: 20 },
  { min: 12, max: 15 },
  { min: POOL_MIN_SITELINKS, max: 12 },
];

/**
 * Blazegraph's query hints, which is what makes a band affordable.
 *
 * `optimizer "None"` fixes the join order to the order written — without it the
 * planner puts the class first again, which is the shape that times out — and
 * `rangeSafe` lets the sitelink filter become an index range scan instead of a
 * predicate applied to every row it could have matched.
 */
const HINT_PREFIX = 'PREFIX hint: <http://www.bigdata.com/queryHints#>';

/** Everything about a work that is not why it was collected. */
const POOL_DETAILS = `
      OPTIONAL { ?w wdt:P18 ?img }
      OPTIONAL { ?w wdt:P170 ?creator . FILTER(STRSTARTS(STR(?creator), "${ENTITY_PREFIX}Q")) }
      OPTIONAL { ?w wdt:P571 ?inception }
      SERVICE wikibase:label { bd:serviceParam wikibase:language "${LABEL_LANGS}" }`;

function bandFilter(band: Band): string {
  return band.max === null
    ? `FILTER(?sl >= ${band.min})`
    : `FILTER(?sl >= ${band.min} && ?sl < ${band.max})`;
}

function bandLabel(band: Band): string {
  return band.max === null ? `${band.min}+ sitelinks` : `${band.min}–${band.max - 1} sitelinks`;
}

/**
 * One band of one broad class.
 *
 * No `ORDER BY`: a band is already a slice of fame, so sorting inside one buys
 * nothing and costs the materialisation of every row. No anchor either — the
 * ownership requirement that used to keep this query small is what made it
 * unaffordable once the join order was fixed, and it cost the catalogue
 * Sunflowers and the Burghers of Calais on the way. A work with nowhere to hang
 * is simply homeless when placement runs, which is a thing the pipeline already
 * counts and reports.
 */
function bandedPoolQuery(rootQid: string, band: Band, limit: number): string {
  return `${HINT_PREFIX}
    SELECT ?w ?wLabel ?sl ?img ?creator ?creatorLabel (YEAR(?inception) AS ?year) WHERE {
      hint:Query hint:optimizer "None" .
      ?w wikibase:sitelinks ?sl .
      hint:Prior hint:rangeSafe true .
      ${bandFilter(band)}
      ?w wdt:P31 wd:${rootQid} .${POOL_DETAILS}
    }
    LIMIT ${limit}`;
}

/**
 * A batch of narrow classes, whole.
 *
 * Left in the shape that has always answered: a class with a few thousand
 * instances is cheap to scan, and the sort over what it finds is cheap too. The
 * band treatment above is for the three roots big enough to need it, and
 * applying it here would turn thirty affordable questions into two hundred.
 */
function classPoolQuery(classQids: string[], limit: number): string {
  return `
    SELECT ?w ?wLabel ?sl ?img ?creator ?creatorLabel (YEAR(?inception) AS ?year) ?cls ?clsLabel WHERE {
      VALUES ?cls { ${values(classQids)} }
      ?w wdt:P31 ?cls ; wikibase:sitelinks ?sl .
      FILTER(?sl >= ${POOL_MIN_SITELINKS})${POOL_DETAILS}
    }
    ORDER BY DESC(?sl)
    LIMIT ${limit}`;
}

/**
 * The name of the class a work was collected under, or the generic one.
 *
 * The label service answers with the bare QID when a class has no label in any of the eight
 * languages, which 46 of the 760 artwork classes do not. That string is not a type a reader can
 * use, and it would beat `painting` on merge precisely because it looks like a narrow name.
 */
function typeOf(row: SparqlBinding, fallbackType: string): string {
  const label = row.clsLabel?.value;
  return label && !isQid(label) ? label : fallbackType;
}

/**
 * The QID of the class a work was collected under.
 *
 * Unbound for the three broad roots, whose banded query names the class literally
 * rather than binding it — the caller passes the root it asked for.
 */
function typeQidOf(row: SparqlBinding, fallbackQid: string | null): string | null {
  const uri = row.cls?.value;
  if (!uri) return fallbackQid;
  const qid = extractQid(uri);
  return isQid(qid) ? qid : fallbackQid;
}

/**
 * Add one row's creator to a work, if it says anything new.
 *
 * Deduped twice over, because the query answers with a row per combination of
 * creator, image and inception and a work with two of each arrives four times.
 * By QID first: that is the statement's own identity. By folded label as well,
 * for the shape a QID cannot catch — Q2415079 (*The Washington Family*) names
 * "Edward Savage" twice under two entities, and a card reading "Edward Savage
 * and Edward Savage" is the source's duplicate made ours.
 *
 * A row whose `?creator` is unbound still counts if it carries a label: the
 * blank-node filter lives in the query, and a shape that binds only the label
 * has said a name.
 */
function addCreator(into: PoolWork, seen: Set<string>, row: SparqlBinding): void {
  const label = row.creatorLabel?.value;
  if (!label) return;
  const qid = row.creator ? extractQid(row.creator.value) : '';
  // A label that *is* a QID is the label service answering with the bare entity
  // id, which names nobody. `typeOf` drops the same shape for the same reason.
  if (isQid(label)) return;
  const keys = [`label:${foldLabel(label)}`, ...(isQid(qid) ? [`qid:${qid}`] : [])];
  if (keys.some(key => seen.has(key))) return;
  for (const key of keys) seen.add(key);
  into.creators.push(label);
}

/**
 * The works one answer describes, one entry per work.
 *
 * The first row of a work fixes everything single-valued about it and every row
 * contributes its creator, which is the asymmetry worth naming: the other
 * OPTIONALs cross-multiply and any of their rows answers the question asked,
 * while `P170` is the one column where a second row is a second fact rather
 * than a repetition (#720).
 */
function parsePool(rows: SparqlBinding[], fallbackType: string, fallbackQid: string | null = null): PoolWork[] {
  const works = new Map<string, PoolWork>();
  const seenCreators = new Map<string, Set<string>>();
  for (const row of rows) {
    const uri = row.w?.value;
    if (!uri) continue;
    const qid = extractQid(uri);
    if (!isQid(qid)) continue;
    let work = works.get(qid);
    if (!work) {
      work = {
        qid,
        label: row.wLabel?.value || qid,
        sitelinks: parseInt(row.sl?.value || '0', 10),
        imageUrl: row.img?.value || null,
        creators: [],
        year: row.year?.value ? parseInt(row.year.value, 10) : null,
        type: typeOf(row, fallbackType),
        typeQid: typeQidOf(row, fallbackQid),
      };
      works.set(qid, work);
      seenCreators.set(qid, new Set());
    }
    addCreator(work, seenCreators.get(qid)!, row);
  }
  return [...works.values()];
}

/**
 * Works of one broad class, band by band, merged into one pool.
 *
 * The runner rather than the bare door, because a band is now a unit of work a
 * person can be told about and can interrupt: seven questions that each take
 * tens of seconds are minutes in which Cancel has to mean something, and a phase
 * message naming the band is the difference between a run that is working and a
 * run that looks hung.
 *
 * Merged by QID rather than concatenated: the bands do not overlap, but the same
 * work can arrive from a later class query, and `parsePool` only dedupes within
 * one answer.
 *
 * A band that fails after its retries fails the run, exactly as the single query
 * did. This is deliberate: the pool decides which museums this category admits
 * (ADR-0024), so a quietly short pool would withdraw real museums and report
 * success — the one failure mode the whole admission axis exists to prevent.
 * What the bands buy is that each question is small enough to answer, and that a
 * retry after a failure starts from the cached bands rather than from nothing.
 */
export async function fetchBroadPool(
  run: QueryRunner,
  root: { qid: string; type: string },
  limit = POOL_LIMIT,
): Promise<PoolWork[]> {
  const works = new Map<string, PoolWork>();
  for (let i = 0; i < POOL_BANDS.length; i++) {
    const band = POOL_BANDS[i];
    run.phase(`Fetching ${root.type}s, ${bandLabel(band)} (band ${i + 1}/${POOL_BANDS.length})...`);
    await run.step();
    const rows = await run.sparql(
      bandedPoolQuery(root.qid, band, limit),
      { kind: 'pool', label: `pool: ${root.type}, ${bandLabel(band)}` },
    );
    failIfTruncated(rows, limit, `pool: ${root.type} (${bandLabel(band)})`);
    for (const work of parsePool(rows, root.type, root.qid)) works.set(work.qid, work);
  }
  return [...works.values()];
}

/**
 * Works of the narrow classes the closure found, taken whole — no ownership requirement at all.
 * Losing a work on the way in is worse than deciding later that it has no placeable venue.
 */
export async function fetchClassPool(
  sparql: SparqlFn,
  classQids: string[],
  limit = POOL_LIMIT,
): Promise<PoolWork[]> {
  if (!classQids.length) return [];
  const rows = await sparql(
    classPoolQuery(classQids, limit),
    { kind: 'pool', label: `pool: ${classQids.length} narrow classes` },
  );
  failIfTruncated(rows, limit, `pool: ${classQids.length} narrow classes`);
  return parsePool(rows, 'artwork', null);
}

// =============================================================================
// Venue statements
// =============================================================================

export interface RawStatement {
  work: string;
  venue: string;
  property: 'P195' | 'P276';
  rank: 'preferred' | 'normal';
}

function statementBranch(property: 'P195' | 'P276'): string {
  return `{
      ?w p:${property} ?st .
      ?st ps:${property} ?venue ; wikibase:rank ?rank .
      FILTER NOT EXISTS { ?st pq:P582 ?ended }
      BIND("${property}" AS ?rel)
    }`;
}

/**
 * Where a batch of works says it is, statement by statement, with the rank Wikidata gives each.
 *
 * A statement carrying `pq:P582` (end time) is a loan that has ended or a transfer already made,
 * and is dropped in the query. A statement ranked deprecated is dropped in the parser: the two
 * ranks placement understands are `preferred` and `normal`, and a deprecated value is one
 * Wikidata itself marks as wrong — carrying it in as `normal` would give a known-wrong venue the
 * same standing as a correct one.
 */
export async function fetchVenueStatements(
  sparql: SparqlFn,
  workQids: string[],
): Promise<RawStatement[]> {
  if (!workQids.length) return [];
  const rows = await sparql(`
    SELECT ?w ?rel ?venue ?rank WHERE {
      VALUES ?w { ${values(workQids)} }
      ${statementBranch('P195')} UNION ${statementBranch('P276')}
    }`, { kind: 'statements', label: `venue statements for ${workQids.length} works` });

  const out: RawStatement[] = [];
  for (const row of rows) {
    const work = extractQid(row.w?.value ?? '');
    const venue = extractQid(row.venue?.value ?? '');
    const property = row.rel?.value;
    const rank = row.rank?.value ?? '';
    if (!isQid(work) || !isQid(venue)) continue;
    if (property !== 'P195' && property !== 'P276') continue;
    if (rank.endsWith('#DeprecatedRank')) continue;
    out.push({
      work,
      venue,
      property,
      rank: rank.endsWith('#PreferredRank') ? 'preferred' : 'normal',
    });
  }
  return out;
}

// =============================================================================
// Entity facts
// =============================================================================

/** Everything about a candidate venue that is single-valued, in one row per entity. */
export interface EntityDetails {
  qid: string;
  label: string;
  description: string | null;
  lat: number | null;
  lon: number | null;
  countryLabel: string | null;
  imageUrl: string | null;
  website: string | null;
  articleUrl: string | null;
  sitelinks: number;
  dissolved: string | null;
}

/** The multi-valued edges, fetched by UNION so classes and parents do not cross-multiply. */
export interface EntityEdges {
  classes: string[];
  parents: string[];
}

export async function fetchEntityDetails(
  sparql: SparqlFn,
  qids: string[],
): Promise<Map<string, EntityDetails>> {
  const out = new Map<string, EntityDetails>();
  if (!qids.length) return out;

  const rows = await sparql(`
    SELECT ?e ?eLabel ?eDescription ?coord ?dissolved ?img ?site ?article ?sl ?countryLabel WHERE {
      VALUES ?e { ${values(qids)} }
      OPTIONAL { ?e wdt:P625 ?coord }
      OPTIONAL { ?e wdt:P576 ?dissolved }
      OPTIONAL { ?e wdt:P18 ?img }
      OPTIONAL { ?e wdt:P856 ?site }
      OPTIONAL { ?e wdt:P17 ?country }
      OPTIONAL { ?e wikibase:sitelinks ?sl }
      OPTIONAL { ?article schema:about ?e ; schema:isPartOf <https://en.wikipedia.org/> }
      SERVICE wikibase:label { bd:serviceParam wikibase:language "${LABEL_LANGS}" }
    }`, { kind: 'entities', label: `details for ${qids.length} entities` });

  // First row per entity wins: the OPTIONALs still cross-multiply when an entity carries two
  // images or two countries, and any of those rows answers the questions asked here.
  for (const row of rows) {
    const qid = extractQid(row.e?.value ?? '');
    if (!isQid(qid) || out.has(qid)) continue;
    const coord = row.coord?.value ? parseWktPoint(row.coord.value) : null;
    out.set(qid, {
      qid,
      label: row.eLabel?.value || qid,
      description: row.eDescription?.value || null,
      lat: coord ? coord.lat : null,
      lon: coord ? coord.lon : null,
      countryLabel: row.countryLabel?.value || null,
      imageUrl: row.img?.value || null,
      website: row.site?.value || null,
      articleUrl: row.article?.value || null,
      sitelinks: parseInt(row.sl?.value || '0', 10),
      dissolved: row.dissolved?.value || null,
    });
  }
  return out;
}

export async function fetchEntityEdges(
  sparql: SparqlFn,
  qids: string[],
): Promise<Map<string, EntityEdges>> {
  const out = new Map<string, EntityEdges>();
  if (!qids.length) return out;
  for (const qid of qids) out.set(qid, { classes: [], parents: [] });

  const rows = await sparql(`
    SELECT ?e ?cls ?parent WHERE {
      VALUES ?e { ${values(qids)} }
      { ?e wdt:P31 ?cls } UNION { ?e wdt:P361 ?parent }
    }`, { kind: 'edges', label: `class and part-of edges for ${qids.length} entities` });

  for (const row of rows) {
    const qid = extractQid(row.e?.value ?? '');
    const edges = out.get(qid);
    if (!edges) continue;
    const cls = row.cls ? extractQid(row.cls.value) : null;
    const parent = row.parent ? extractQid(row.parent.value) : null;
    if (cls && isQid(cls)) edges.classes.push(cls);
    if (parent && isQid(parent)) edges.parents.push(parent);
  }
  return out;
}
