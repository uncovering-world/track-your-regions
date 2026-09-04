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

/** A `VALUES` list of entities. */
export function values(qids: string[]): string {
  return qids.map((q) => `wd:${q}`).join(' ');
}

/**
 * A truncated *pool* query stops the run.
 *
 * The pool decides which rows a category admits (ADR-0024), so a pool cut off
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
    + 'this category admits, so a short one would withdraw rows and call the run a success. '
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
