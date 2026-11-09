/**
 * Every Wikipedia edition's article about the items the catalogue links
 * (#2209), kept where a reader route may read it.
 *
 * A place's and a work's link is one English article (`metadata.wikipediaUrl`,
 * `treasures.wikipedia_url`), while the item behind it is written about in
 * about 27 editions: the Altes Museum's in 44, Russian, German and Greek among
 * them. Those editions are in the local Wikidata subset's sitelinks, which no
 * reader or curator route reads (ADR-0124), so the end of every real run copies
 * them into the serving table `wikipedia_editions`.
 *
 * The item is found by the English article the catalogue shows, never by the
 * id a source knows the place by: a place shows the article of the item a
 * curator or a rule chose for it (#1963, #1964, ADR-0094), and the languages a
 * reader switches among are that article's. An English title the subset does
 * not hold leaves its link English.
 *
 * The table is replaced whole in one transaction: a run cannot tell which
 * items another source's runs gave or took away a link since the last one, and
 * the subset is rebuilt between runs anyway. Two runs of different sources may
 * end together, so a refresh locks the table against the other writer first
 * and reads what the catalogue links under the lock: the second waits, then
 * replaces what the first wrote with what is linked by then, and readers read
 * on. A subset that is not there, or holds no sitelinks yet, leaves the table
 * as it is; any other failure reaches the run's log.
 */

import type { PoolClient } from 'pg';
import { pool } from '../../db/index.js';
import { articleOf } from '../wikipediaCoordinate.js';
import { NOT_WIKIPEDIA } from './subset/kit.js';

/** Every English article a place, a part or a work links: what the editions are kept for. */
async function linkedEnglishTitles(client: PoolClient): Promise<string[]> {
  const result = await client.query<{ url: string }>(
    `SELECT metadata->>'wikipediaUrl' AS url FROM experiences
      WHERE metadata->>'wikipediaUrl' LIKE 'https://en.wikipedia.org/wiki/%'
     UNION
     SELECT wikipedia_url FROM treasures WHERE wikipedia_url LIKE 'https://en.wikipedia.org/wiki/%'`,
  );
  const titles = new Set<string>();
  for (const { url } of result.rows) {
    const article = articleOf(url);
    if (article?.wiki === 'en') titles.add(article.title);
  }
  return [...titles];
}

/**
 * Copies the editions of every item whose English article the catalogue links
 * from the subset into `wikipedia_editions`, replacing what it held. Answers
 * how many items and editions it kept, or null where the subset holds no
 * sitelinks and nothing was replaced.
 */
export async function refreshWikipediaEditions(): Promise<{ items: number; editions: number } | null> {
  // Only a subset that is not there is "not ready"; any other failure of the
  // question is the run's to log, never read as an empty subset.
  const table = await pool.query<{ present: boolean }>(
    `SELECT to_regclass('workbench.wikidata_sitelinks') IS NOT NULL AS present`,
  );
  if (!table.rows[0]?.present) return null;
  const built = await pool.query<{ built: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM wikidata_sitelinks WHERE site = 'enwiki') AS built`,
  );
  if (!built.rows[0]?.built) return null;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('LOCK TABLE wikipedia_editions IN SHARE ROW EXCLUSIVE MODE');
    // Read under the lock: a refresh that waited for another's must keep what
    // the catalogue links now, not what it linked before the wait.
    const titles = await linkedEnglishTitles(client);
    await client.query('DELETE FROM wikipedia_editions');
    const kept = await client.query<{ items: number; editions: number }>(
      `WITH items AS (
         SELECT DISTINCT s.id FROM wikidata_sitelinks s WHERE s.site = 'enwiki' AND s.title = ANY($1::text[])
       ), written AS (
         INSERT INTO wikipedia_editions (item, wiki, title)
         SELECT l.id, l.site, l.title FROM wikidata_sitelinks l JOIN items ON items.id = l.id
          WHERE l.site LIKE '%wiki' AND l.site <> ALL($2::text[])
         RETURNING item
       )
       SELECT count(DISTINCT item)::int AS items, count(*)::int AS editions FROM written`,
      [titles, NOT_WIKIPEDIA],
    );
    await client.query('COMMIT');
    return kept.rows[0];
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
