/**
 * The tables the Wikidata items each Wikivoyage edition uses are kept in
 * (#1768, decided on #1718), and how a build writes them. A build keeps each edition's
 * items in a `_next` copy and swaps it in whole with the record of the build,
 * as the redirects are kept (`redirectTables.ts`), so a reader never sees half
 * a build.
 *
 * Beside the usage, a build keeps the guide articles that use each item
 * (`wikivoyage_articles`, #2520): what a curator opens behind a guide's yes.
 * It is a table of its own so the usage stays one row per item and edition,
 * whatever number of articles use the item there, and the witness and the
 * edition count fame reads stay what they were (ADR-0177). A curator's read
 * lists the articles, so that table is serving and lives in `public`
 * (ADR-0124); its `_next` copy is made, indexed and swapped in with the
 * usage's, in the same transaction.
 */

import type { PoolClient } from 'pg';
import { pool } from '../../../db/index.js';
import { WORKBENCH_SCHEMA } from '../../../db/workbench.js';
import type { CopyNeeds } from '../wikidata/buildRules.js';
import { cancellable, indexesOf } from '../wikidata/subsetTables.js';

/** A table a build replaces whole, and the schema it lives in. */
interface KeptTable { table: string; schema: string }

const USAGE: KeptTable = { table: 'wikivoyage_usage', schema: WORKBENCH_SCHEMA };
const ARTICLES: KeptTable = { table: 'wikivoyage_articles', schema: 'public' };
/** Both tables, swapped in together. */
const KEPT: readonly KeptTable[] = [USAGE, ARTICLES];

const live = ({ table, schema }: KeptTable) => `${schema}.${table}`;
const next = ({ table, schema }: KeptTable) => `${schema}.${table}_next`;

/** A guide article that uses an item: its page id and its title as a reader reads it. */
export interface GuideArticle { item: string; pageId: number; title: string }

/** Fresh, empty `_next` copies without their indexes. */
export async function createNextTable(): Promise<void> {
  await dropNextTable();
  for (const kept of KEPT) {
    await pool.query(`CREATE UNLOGGED TABLE ${next(kept)} (LIKE ${live(kept)} INCLUDING DEFAULTS INCLUDING CONSTRAINTS)`);
  }
}

/** Drop the `_next` copies: a build that failed or was cancelled leaves nothing behind. */
export async function dropNextTable(): Promise<void> {
  for (const kept of KEPT) await pool.query(`DROP TABLE IF EXISTS ${next(kept)}`);
}

/** Keep the items one edition uses, each once. */
export async function keepUsage(site: string, items: readonly string[]): Promise<void> {
  if (items.length === 0) return;
  await pool.query(`INSERT INTO ${next(USAGE)} (item, site) SELECT unnest($2::text[]), $1`, [site, items]);
}

/** Keep a batch of the articles of one edition that use an item, each (item, article) once. */
export async function keepArticles(site: string, articles: readonly GuideArticle[]): Promise<void> {
  if (articles.length === 0) return;
  await pool.query(
    `INSERT INTO ${next(ARTICLES)} (item, site, page_id, title)
     SELECT a.item, $1, a.page_id, a.title FROM unnest($2::text[], $3::int[], $4::text[]) AS a(item, page_id, title)`,
    [site, articles.map(a => a.item), articles.map(a => a.pageId), articles.map(a => a.title)],
  );
}

/** Give the `_next` copies the live tables' indexes and keys, under the live names with `_next` appended. */
export async function indexNextTable(signal: AbortSignal): Promise<void> {
  const statements: string[] = [];
  const client = await pool.connect();
  try {
    for (const kept of KEPT) {
      for (const index of await indexesOf(client, kept.table, kept.schema)) {
        statements.push(index.constraint
          ? `ALTER TABLE ${next(kept)} ADD CONSTRAINT ${index.name}_next ${index.definition}`
          : index.definition.replace(`INDEX ${index.name} ON`, `INDEX ${index.name}_next ON`).replace(`ON ${live(kept)} `, `ON ${next(kept)} `));
      }
    }
  } finally {
    client.release();
  }
  for (const statement of statements) await cancellable(signal, statement);
}

/**
 * Swap the `_next` copies in and record the build, in one transaction. A cancel
 * that arrived while the swap was being made rolls it back, and the usage and
 * its articles in place stay.
 */
export async function swapIn(buildId: number, dumpDate: string, editions: Record<string, number>, signal: AbortSignal): Promise<void> {
  const client: PoolClient = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const kept of KEPT) {
      const indexes = await indexesOf(client, kept.table, kept.schema);
      await client.query(`DROP TABLE ${live(kept)}`);
      await client.query(`ALTER TABLE ${next(kept)} RENAME TO ${kept.table}`);
      for (const index of indexes) await client.query(`ALTER INDEX ${kept.schema}.${index.name}_next RENAME TO ${index.name}`);
    }
    await client.query(
      'INSERT INTO wikivoyage_usage_builds (build_id, dump_date, editions) VALUES ($1, $2, $3)',
      [buildId, dumpDate, JSON.stringify(editions)],
    );
    signal.throwIfAborted();
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * The usage in place, if any: its dump date and when it was swapped in. A crash empties the record with the table.
 * A copy built before the articles were kept (#2520) holds none, since a build that keeps no item never swaps in, so
 * it needs a rebuild: the Public Dumps card says so, and its Update keeps them.
 */
export async function latestUsage(): Promise<{ dumpDate: string; swappedAt: Date; needs: CopyNeeds } | null> {
  const result = await pool.query<{ dump_date: string; swapped_at: Date; articles_kept: boolean }>(
    `SELECT to_char(dump_date, 'YYYY-MM-DD') AS dump_date, swapped_at,
            EXISTS (SELECT 1 FROM ${live(ARTICLES)}) AS articles_kept
       FROM wikivoyage_usage_builds
      ORDER BY swapped_at DESC LIMIT 1`,
  );
  const row = result.rows[0];
  return row ? { dumpDate: row.dump_date, swappedAt: row.swapped_at, needs: row.articles_kept ? 'nothing' : 'rebuild' } : null;
}

/** The items among `items` some Wikivoyage edition uses: the travel-guide witness. */
export async function usedByAGuide(items: readonly string[]): Promise<Set<string>> {
  if (items.length === 0) return new Set();
  const result = await pool.query<{ item: string }>(
    'SELECT DISTINCT item FROM wikivoyage_usage WHERE item = ANY($1::text[])',
    [items],
  );
  return new Set(result.rows.map(row => row.item));
}

/** How many Wikivoyage editions use each of `items`; an item no edition uses is absent. */
export async function guideEditions(items: readonly string[]): Promise<Map<string, number>> {
  if (items.length === 0) return new Map();
  const result = await pool.query<{ item: string; editions: number }>(
    'SELECT item, count(DISTINCT site)::int AS editions FROM wikivoyage_usage WHERE item = ANY($1::text[]) GROUP BY item',
    [items],
  );
  return new Map(result.rows.map(row => [row.item, row.editions]));
}
