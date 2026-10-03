/**
 * The Wikipedia-editions question (`fetchWikipediaEditions`), answered by a test
 * world: one row per item asked about, carrying the count the world gives it.
 *
 * A fixture's own sitelink counts are what its tests were written against, so
 * each world answers the recount with those numbers and its tests read the
 * lines exactly as before (ADR-0082). A test that is about the difference
 * between the two counts answers this question itself.
 */

import { ENTITY_PREFIX } from './wikidataQueries.js';
import type { SparqlBinding } from './wikidataUtils.js';

/** Whether a query is the editions count. */
export function isWikipediaEditionsQuery(query: string): boolean {
  return query.includes('wikibase:wikiGroup "wikipedia"');
}

/** The items a `VALUES ?e { … }` list names. */
function itemsOf(query: string): string[] {
  const list = /VALUES \?e \{([^}]*)\}/.exec(query)?.[1] ?? '';
  return [...list.matchAll(/wd:(Q\d+)/g)].map((m) => m[1]);
}

/** The editions answer for every item asked about, 0 for one the world does not know. */
export function wikipediaEditionsRows(
  query: string,
  countOf: (qid: string) => number | undefined,
): SparqlBinding[] {
  return itemsOf(query).map((qid) => ({
    e: { value: `${ENTITY_PREFIX}${qid}` },
    editions: { value: String(countOf(qid) ?? 0) },
  }));
}


/**
 * The counts a canned answer already carries, read off its `?sl` column by the
 * item the row is about (`?e` or `?w`): what a test that hands a fetcher one
 * fixed answer gives the recount, so its rows keep the numbers it wrote.
 */
function editionsOfRows(rows: SparqlBinding[]): (qid: string) => number | undefined {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const qid = (row.e?.value ?? row.w?.value ?? '').replace(ENTITY_PREFIX, '');
    const sl = parseInt(row.sl?.value ?? '', 10);
    if (qid && Number.isFinite(sl) && !counts.has(qid)) counts.set(qid, sl);
  }
  return (qid) => counts.get(qid);
}

/** A door that answers every question with `rows`, and the recount with the counts they carry. */
export function answeringWith(rows: SparqlBinding[]): (query: string) => Promise<SparqlBinding[]> {
  return (query) => Promise.resolve(
    isWikipediaEditionsQuery(query) ? wikipediaEditionsRows(query, editionsOfRows(rows)) : rows,
  );
}
