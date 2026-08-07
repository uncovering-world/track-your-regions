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
 *     the pool carry a `.well-known/genid/…` artist today.
 *
 * Each exported fetcher sends exactly one query. Batching, pacing and cancellation belong to
 * the pipeline, which is the only place that knows how long a run is allowed to take.
 */

import { extractQid, parseWktPoint, type SparqlBinding } from '../wikidataUtils.js';

export type SparqlFn = (query: string) => Promise<SparqlBinding[]>;

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

/** Without `mul`, the National Gallery of Art comes back as the string `Q214867`. */
export const LABEL_LANGS = 'en,mul,en-gb,de,fr,es,it,nl';

const LOG_PREFIX = '[Museum Sync]';
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

/** No pool query has ever returned this many rows; a batch that does says so in the log. */
export const POOL_LIMIT = 3000;

/** A QID, not a blank node (`.well-known/genid/…`) and not a literal. */
export function isQid(value: string): boolean {
  return /^Q\d+$/.test(value);
}

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
 * Say so when a query came back holding exactly as many rows as it was allowed to return.
 * Silence there reads as "we fetched everything", which is the one thing it cannot mean.
 */
export function warnIfTruncated(rows: SparqlBinding[], limit: number, label: string): void {
  if (rows.length < limit) return;
  console.warn(
    `${LOG_PREFIX} ${label} returned exactly its LIMIT of ${limit} rows — `
    + 'the tail beyond it was never fetched',
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
  );
  return qidsOf(rows, 'c');
}

/** The whole `P279*` tree under `museum`, which is what the venue test tests against. */
export async function fetchMuseumClasses(sparql: SparqlFn): Promise<Set<string>> {
  const rows = await sparql(`SELECT ?c WHERE { ?c wdt:P279* wd:${MUSEUM_ROOT} }`);
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
  creator: string | null;
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

function poolQuery(head: string, limit: number): string {
  return `
    SELECT ?w ?wLabel ?sl ?img ?creatorLabel (YEAR(?inception) AS ?year) ?cls ?clsLabel WHERE {
      ${head}
      FILTER(?sl >= ${POOL_MIN_SITELINKS})
      OPTIONAL { ?w wdt:P18 ?img }
      OPTIONAL { ?w wdt:P170 ?creator . FILTER(STRSTARTS(STR(?creator), "${ENTITY_PREFIX}Q")) }
      OPTIONAL { ?w wdt:P571 ?inception }
      SERVICE wikibase:label { bd:serviceParam wikibase:language "${LABEL_LANGS}" }
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
 * Unbound for the three anchored roots, whose head names the class literally
 * rather than binding it — the caller passes the root it asked for.
 */
function typeQidOf(row: SparqlBinding, fallbackQid: string | null): string | null {
  const uri = row.cls?.value;
  if (!uri) return fallbackQid;
  const qid = extractQid(uri);
  return isQid(qid) ? qid : fallbackQid;
}

function parsePool(rows: SparqlBinding[], fallbackType: string, fallbackQid: string | null = null): PoolWork[] {
  const works = new Map<string, PoolWork>();
  for (const row of rows) {
    const uri = row.w?.value;
    if (!uri) continue;
    const qid = extractQid(uri);
    if (!isQid(qid) || works.has(qid)) continue;
    works.set(qid, {
      qid,
      label: row.wLabel?.value || qid,
      sitelinks: parseInt(row.sl?.value || '0', 10),
      imageUrl: row.img?.value || null,
      creator: row.creatorLabel?.value || null,
      year: row.year?.value ? parseInt(row.year.value, 10) : null,
      type: typeOf(row, fallbackType),
      typeQid: typeQidOf(row, fallbackQid),
    });
  }
  return [...works.values()];
}

/**
 * Works of one broad class, anchored by one of the two venue properties.
 *
 * The anchor is what keeps `painting` — half a million instances — inside a single query, and
 * it is why the broad roots are fetched twice: requiring an owner (`P195`) is what hid
 * Sunflowers, which is a series nobody owns, and Rodin's Burghers of Calais.
 */
export async function fetchAnchoredPool(
  sparql: SparqlFn,
  root: { qid: string; type: string },
  anchor: 'P195' | 'P276',
  limit = POOL_LIMIT,
): Promise<PoolWork[]> {
  const rows = await sparql(poolQuery(
    `?w wdt:P31 wd:${root.qid} ; wdt:${anchor} ?anchor ; wikibase:sitelinks ?sl .`,
    limit,
  ));
  warnIfTruncated(rows, limit, `${root.type} anchored by ${anchor}`);
  return parsePool(rows, root.type, root.qid);
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
  const rows = await sparql(poolQuery(
    `VALUES ?cls { ${values(classQids)} }
       ?w wdt:P31 ?cls ; wikibase:sitelinks ?sl .`,
    limit,
  ));
  warnIfTruncated(rows, limit, `${classQids.length} narrow classes`);
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
    }`);

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
    }`);

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
    }`);

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
