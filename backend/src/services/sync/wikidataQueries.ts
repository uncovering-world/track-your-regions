/**
 * The query kit every Wikidata collector shares: the door with a cache
 * descriptor, the paced runner, the class-tree questions, the fame-band shapes
 * and the small parsing helpers.
 *
 * Extracted from the museum import's `museum/queries.ts` once a second source —
 * public art — asked the same questions of the same endpoint. What is here is
 * what any source needs; what a query *asks for* (the columns of a pool of
 * works, of a pool of monuments) stays with the source that asks it.
 */

import { extractQid, isQid, type SparqlBinding } from './wikidataUtils.js';
import type { CacheDescriptor } from './wikidataCache.js';

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

export const ENTITY_PREFIX = 'http://www.wikidata.org/entity/';

/** QIDs of a binding column, blank nodes dropped. */
export function qidsOf(rows: SparqlBinding[], column: string): string[] {
  const out: string[] = [];
  for (const row of rows) {
    const value = row[column]?.value;
    if (!value) continue;
    const qid = extractQid(value);
    if (isQid(qid)) out.push(qid);
  }
  return out;
}

/**
 * What a fetcher may be handed: a bare door, or the run's paced runner. A
 * fetcher that asks more than one question — its own, then a recount — steps a
 * runner before each, so a paced run keeps its pace and a cancelled one stops
 * between them; a bare door (a test, a one-off repair) is asked straight.
 */
export type Door = SparqlFn | Pick<QueryRunner, 'sparql' | 'step'>;

/** A door as its two halves: the question, and what runs ahead of every one. */
export function doorOf(door: Door): { sparql: SparqlFn; step: () => Promise<void> } {
  return typeof door === 'function' ? { sparql: door, step: () => Promise.resolve() } : door;
}

/** Items per question when counting Wikipedia editions: a cheap join, well inside the endpoint's limits. */
export const WIKIPEDIA_EDITIONS_BATCH = 400;

/**
 * How many Wikipedia language editions hold an article about each item
 * (ADR-0082).
 *
 * Every fame line a run draws reads this number, never `wikibase:sitelinks`:
 * that one counts every site linking the item — a Commons category, a
 * Wikivoyage or Wikiquote page — so on 2026-10-03 it stood one above the
 * Wikipedia count for most of the catalogue, and a line written as "22 editions"
 * admitted on 21. The collecting questions keep reading `wikibase:sitelinks`,
 * which is stored and range-indexed and is never smaller than this count, so
 * they gather a superset; the rows are then recounted here and held to the line.
 *
 * Every item asked about is answered, 0 where no Wikipedia writes about it:
 * `VALUES` binds each one and the count runs over an `OPTIONAL`.
 */
export async function fetchWikipediaEditions(
  sparql: SparqlFn,
  qids: string[],
  before: () => Promise<void> = () => Promise.resolve(),
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const asked = unique(qids.filter(isQid));
  for (const batch of chunk(asked, WIKIPEDIA_EDITIONS_BATCH)) {
    await before();
    const rows = await sparql(`
      SELECT ?e (COUNT(DISTINCT ?article) AS ?editions) WHERE {
        VALUES ?e { ${values(batch)} }
        OPTIONAL {
          ?article schema:about ?e ; schema:isPartOf ?wiki .
          ?wiki wikibase:wikiGroup "wikipedia" .
        }
      }
      GROUP BY ?e`, { kind: 'edges', label: `Wikipedia editions of ${batch.length} items` });
    for (const row of rows) {
      const qid = extractQid(row.e?.value ?? '');
      const editions = parseInt(row.editions?.value ?? '', 10);
      if (isQid(qid) && Number.isFinite(editions)) out.set(qid, editions);
    }
  }
  return out;
}

/**
 * The same items with `sitelinks` holding their Wikipedia editions, and those
 * below `floor` left out: what a collecting question gathered by every site,
 * held to the line it was meant to draw. `qidOf` names the item a row is about
 * where that is not its `qid` (a holding's `work`). An item the count did not
 * answer for keeps nothing it cannot prove and reads 0. `before` runs ahead of
 * every question, which is where a paced run steps and a cancelled one stops.
 */
export async function inWikipediaEditions<T extends { qid: string; sitelinks: number }>(
  sparql: SparqlFn,
  items: T[],
  options?: { floor?: number; before?: () => Promise<void> },
): Promise<T[]>;
export async function inWikipediaEditions<T extends { sitelinks: number }>(
  sparql: SparqlFn,
  items: T[],
  options: { floor?: number; before?: () => Promise<void>; qidOf: (item: T) => string },
): Promise<T[]>;
export async function inWikipediaEditions<T extends { sitelinks: number; qid?: string }>(
  sparql: SparqlFn,
  items: T[],
  { floor = 0, before, qidOf = (item: T) => item.qid ?? '' }: {
    floor?: number; before?: () => Promise<void>; qidOf?: (item: T) => string;
  } = {},
): Promise<T[]> {
  if (!items.length) return items;
  const editions = await fetchWikipediaEditions(sparql, items.map(qidOf), before);
  for (const item of items) item.sitelinks = editions.get(qidOf(item)) ?? 0;
  return items.filter((item) => item.sitelinks >= floor);
}

/** A `VALUES` list of entities. */
export function values(qids: string[]): string {
  return qids.map((q) => `wd:${q}`).join(' ');
}

/**
 * The statements of `property` on `subject` that still hold, each binding
 * its value to `object`: best-ranked — what `wdt:` would answer — and
 * carrying no end time (`pq:P582`). The end-time rule is the museum
 * import's (`statementBranch` in `museum/queries.ts`): the Bust of
 * Nefertiti's own statements still name the museum it left in 2009, and the
 * Horses of Saint Mark carry nine ended locations. Per statement rather than
 * per value, so a value that has both an ended and a standing statement of
 * the same rank — a work that left a museum and came back — keeps the
 * standing one instead of being dropped with the ended one.
 *
 * Best rank is read the way `wdt:` reads it, because a preferred statement
 * is how Wikidata marks the current one — the signal the museum placement
 * weighs highest — where `statementBranch` keeps every rank for that
 * weighing to happen later. So an ended statement ranked preferred over a
 * standing one ranked normal would leave the work placeless: an editing
 * error upstream (preferred is for what holds now), and none on the pool of
 * 603 on 2026-09-05 — 13 preferred statements across the three properties,
 * not one of them ended.
 *
 * The shared kit's (ADR-0030), because every importer that reads where a
 * thing stands asks it this way: the public-art facts (`publicArt/queries.ts`),
 * a find's discovery place (`P189`, `archaeology/queries.ts`) and the museum
 * import's container walk for the door rule (`fetchEntityEdges`,
 * `museum/queries.ts`, #812).
 */
export function standing(subject: string, property: string, object: string): string {
  const st = `?st${property.slice(1)}`;
  return `${subject} p:${property} ${st} . ${st} a wikibase:BestRank ; ps:${property} ${object} .
        FILTER NOT EXISTS { ${st} pq:P582 ?ended }`;
}

/**
 * A truncated *pool* query stops the run.
 *
 * The pool decides which rows a source admits (ADR-0024), so a pool cut off
 * at its LIMIT withdraws real rows and reports success — the one failure the
 * admission axis exists to prevent, and the reason ADR-0030 makes a *failed*
 * band fatal. A *truncated* band is the same short pool arrived at more quietly,
 * so it is fatal too. Worse, in fact: a banded query carries no `ORDER BY`, so
 * the rows kept are an arbitrary subset rather than the most famous ones.
 *
 * The remedy belongs to a person, not to a retry: a band whose range holds more
 * than the limit needs splitting, and the message says which one so that the
 * next edit is obvious.
 */
export function failIfTruncated(rows: SparqlBinding[], limit: number, label: string): void {
  if (rows.length < limit) return;
  throw new Error(
    `${label} returned exactly its LIMIT of ${limit} rows. The pool decides which rows `
    + 'this source admits, so a short one would withdraw rows and call the run a success. '
    + 'Split this band, or raise its limit.',
  );
}

// =============================================================================
// Classes
// =============================================================================

/**
 * Everything below the class `museum` (Q33506) is a museum-like class — 373 of them, measured.
 * The venue test of the museum import tests against the tree, and the public-art rule reads
 * the same tree to know when a work stands inside one.
 */
export const MUSEUM_ROOT = 'Q33506';

/** Direct `P279` children of a frontier — one hop, for `boundedClosure`. */
export async function fetchSubclasses(sparql: SparqlFn, parents: string[]): Promise<string[]> {
  if (!parents.length) return [];
  const rows = await sparql(
    `SELECT DISTINCT ?c WHERE { VALUES ?p { ${values(parents)} } ?c wdt:P279 ?p }`,
    { kind: 'classes', label: `subclasses of ${parents.length} class(es)` },
  );
  return qidsOf(rows, 'c');
}

/**
 * The whole `P279*` tree under one root, root included.
 *
 * The traversal is in *class* space, which is cheap — 373 classes under
 * `museum`, 1265 under `structure of worship`, measured — where the
 * instance-space `P31/P279*` join is what times the endpoint out. Only for a
 * root whose tree is known to be that size: `sculpture` reaches 142 841
 * classes at its second hop and is walked with `boundedClosure` instead.
 */
export async function fetchClassTree(
  sparql: SparqlFn,
  root: string,
  label: string,
): Promise<Set<string>> {
  const rows = await sparql(
    `SELECT ?c WHERE { ?c wdt:P279* wd:${root} }`,
    { kind: 'classes', label },
  );
  return new Set(qidsOf(rows, 'c'));
}

// =============================================================================
// Fame bands
// =============================================================================

export interface Band {
  min: number;
  /** Exclusive; `null` is the open top band. */
  max: number | null;
}

/**
 * Blazegraph's query hints, which is what makes a band affordable.
 *
 * `optimizer "None"` fixes the join order to the order written — without it the
 * planner puts the class first again, which is the shape that times out — and
 * `rangeSafe` lets the sitelink filter become an index range scan instead of a
 * predicate applied to every row it could have matched.
 */
export const HINT_PREFIX = 'PREFIX hint: <http://www.bigdata.com/queryHints#>';

export function bandFilter(band: Band): string {
  return band.max === null
    ? `FILTER(?sl >= ${band.min})`
    : `FILTER(?sl >= ${band.min} && ?sl < ${band.max})`;
}

export function bandLabel(band: Band): string {
  return band.max === null ? `${band.min}+ sitelinks` : `${band.min}–${band.max - 1} sitelinks`;
}
