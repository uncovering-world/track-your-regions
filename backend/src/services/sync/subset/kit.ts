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
import { articleUrl } from './values.js';

/**
 * Whether claim `c` is one of its subject's best subclass-of statements: no
 * statement of the subject outranks it. Every rank of the property counts,
 * an unknown or no value included, as it does for `wdt:`: an item whose
 * preferred P279 is an unknown value reads none of its normal ones.
 */
const BEST = `NOT EXISTS (
  SELECT 1 FROM wikidata_claims h WHERE h.subject = c.subject AND h.property = 'P279' AND h.rank > c.rank)`;

/**
 * Whether claim `alias`'s coordinate is on the Earth. A point on the Moon or
 * Mars, which Wikidata states with its globe, lies near no place on the map,
 * however its latitude and longitude read; a coordinate with no globe is the
 * Earth's, as Wikidata reads it. Read by the component items' search and the
 * finds' sites (#2242); the place pass's surroundings pool still spells it itself.
 */
export const onEarthSql = (alias: string): string =>
  `COALESCE(${alias}.value->>'globe', 'http://www.wikidata.org/entity/Q2') = 'http://www.wikidata.org/entity/Q2'`;

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

/**
 * Every name the subset holds for each item: its labels, in every language
 * kept, and the titles of its Wikipedia articles, which name it in its own
 * country's language where no kept label does (Kraków's market square is
 * *Rynek Główny w Krakowie* on the Polish Wikipedia). A title's closing
 * parenthesis tells it from a namesake and is no part of the name.
 */
export async function subsetNamesOf(qids: string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (!qids.length) return out;
  const result = await pool.query<{ id: string; name: string }>(
    `SELECT id, label AS name FROM wikidata_labels WHERE id = ANY($1::text[]) AND label IS NOT NULL
     UNION
     SELECT id, regexp_replace(title, '\\s+\\([^()]*\\)$', '') FROM wikidata_sitelinks
      WHERE id = ANY($1::text[]) AND site LIKE '%wiki' AND site <> ALL($2::text[])`,
    [qids, NOT_WIKIPEDIA],
  );
  for (const row of result.rows) {
    const name = row.name.trim();
    if (!name) continue;
    const names = out.get(row.id) ?? [];
    if (!names.includes(name)) names.push(name);
    out.set(row.id, names);
  }
  return out;
}

/** The English Wikipedia article of each item that has one, as `fetchEnglishArticles` answers live (#1608). */
export async function subsetEnglishArticles(qids: string[]): Promise<Map<string, string>> {
  if (!qids.length) return new Map();
  const result = await pool.query<{ id: string; title: string }>(
    `SELECT id, title FROM wikidata_sitelinks WHERE site = 'enwiki' AND id = ANY($1::text[])`,
    [qids],
  );
  return new Map(result.rows.map(row => [row.id, articleUrl(row.title)]));
}
