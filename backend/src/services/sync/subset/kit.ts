/**
 * The shared questions every kind sync asks, answered from the local
 * Wikidata subset (#1458): the direct subclasses of a frontier, the whole
 * subclass tree under a root, and how many Wikipedia editions write about an
 * item. Each answers what its live twin in `wikidataQueries.ts` answers.
 *
 * `wdt:` reads an item's best statements: its preferred ones where it has
 * any, its normal ones otherwise, never a deprecated one (`BEST`), which is
 * what the live tree walks.
 */

import { pool } from '../../../db/index.js';

/**
 * Whether claim `c` is one of its subject's best subclass-of statements: no
 * statement of the subject outranks it. Every rank of the property counts,
 * an unknown or no value included, as it does for `wdt:`: an item whose
 * preferred P279 is an unknown value reads none of its normal ones.
 */
const BEST = `NOT EXISTS (
  SELECT 1 FROM wikidata_claims h WHERE h.subject = c.subject AND h.property = 'P279' AND h.rank > c.rank)`;

/** Direct subclasses of any of `parents`, as `fetchSubclasses` answers. */
export async function subsetSubclasses(parents: string[]): Promise<string[]> {
  if (!parents.length) return [];
  const result = await pool.query<{ subject: string }>(
    `SELECT DISTINCT c.subject FROM wikidata_claims c
      WHERE c.property = 'P279' AND c.value_item = ANY($1::text[]) AND c.rank >= 0 AND ${BEST}
      ORDER BY c.subject`,
    [parents],
  );
  return result.rows.map(row => row.subject);
}

/** Every class under `root` through best-rank subclass of, root included, as `fetchClassTree` answers. */
export async function subsetClassTree(root: string): Promise<Set<string>> {
  // Walked by the value index, one level at a time: each step reads the
  // subclasses of the classes the last one found, never every P279 claim.
  const result = await pool.query<{ class: string }>(
    `WITH RECURSIVE tree(class) AS (
       SELECT $1::text
       UNION
       SELECT c.subject FROM tree
         JOIN wikidata_claims c ON c.property = 'P279' AND c.value_item = tree.class AND c.rank >= 0
        WHERE ${BEST}
     )
     SELECT class FROM tree`,
    [root],
  );
  return new Set(result.rows.map(row => row.class));
}

/**
 * The sites of the Wikimedia projects that end in `wiki` and are no Wikipedia
 * edition, which `wikibase:wikiGroup "wikipedia"` leaves out of the live
 * count. Every other `…wiki` site is one edition (`enwiki`, `simplewiki`).
 */
export const NOT_WIKIPEDIA = [
  'commonswiki', 'specieswiki', 'metawiki', 'wikidatawiki', 'mediawikiwiki', 'sourceswiki', 'wikimaniawiki',
  'foundationwiki', 'incubatorwiki', 'outreachwiki', 'wikifunctionswiki',
];

/** How many Wikipedia editions write about each item, 0 where none does, as `fetchWikipediaEditions` answers. */
export async function subsetWikipediaEditions(qids: string[]): Promise<Map<string, number>> {
  if (!qids.length) return new Map();
  const result = await pool.query<{ id: string; editions: number }>(
    `SELECT q.id, count(l.site)::int AS editions
       FROM unnest($1::text[]) AS q(id)
       LEFT JOIN wikidata_sitelinks l ON l.id = q.id AND l.site LIKE '%wiki' AND l.site <> ALL($2::text[])
      GROUP BY q.id`,
    [qids, NOT_WIKIPEDIA],
  );
  return new Map(result.rows.map(row => [row.id, row.editions]));
}
