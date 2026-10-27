/**
 * The table English Wikivoyage's articles are kept in (#2089), and how a
 * build writes it. A build keeps the pages in a `_next` copy and swaps it in
 * whole with the record of the build, as the item usage is kept
 * (`usageTables.ts`), so the extraction never reads half a dump.
 */

import type { PoolClient } from 'pg';
import { pool } from '../../../db/index.js';
import { inWorkbench } from '../../../db/workbench.js';
import type { CopyNeeds } from '../wikidata/buildRules.js';
import { cancellable, indexesOf } from '../wikidata/subsetTables.js';
import type { DumpPage } from './pageLine.js';

const TABLE = 'wikivoyage_pages';
const NEXT = inWorkbench(`${TABLE}_next`);

/** A page as it is kept: the dump's page with the Wikidata item its page properties give it. */
export type KeptPage = DumpPage & { wikidataId: string | null };

/** A fresh, empty `_next` copy without its indexes. */
export async function createNextTable(): Promise<void> {
  await dropNextTable();
  await pool.query(`CREATE UNLOGGED TABLE ${NEXT} (LIKE ${TABLE} INCLUDING DEFAULTS INCLUDING CONSTRAINTS)`);
}

/** Drop the `_next` copy: a build that failed or was cancelled leaves nothing behind. */
export async function dropNextTable(): Promise<void> {
  await pool.query(`DROP TABLE IF EXISTS ${NEXT}`);
}

/** Keep a batch of pages. */
export async function keepPages(pages: readonly KeptPage[]): Promise<void> {
  if (pages.length === 0) return;
  await pool.query(
    `INSERT INTO ${NEXT} (title, page_id, redirect_to, wikitext, wikidata_id)
     SELECT * FROM unnest($1::text[], $2::int[], $3::text[], $4::text[], $5::text[])`,
    [pages.map(p => p.title), pages.map(p => p.id), pages.map(p => p.redirectTo), pages.map(p => p.wikitext), pages.map(p => p.wikidataId)],
  );
}

/** Give the `_next` copy the live table's indexes and key, under the live names with `_next` appended. */
export async function indexNextTable(signal: AbortSignal): Promise<void> {
  const client = await pool.connect();
  let statements: string[];
  try {
    statements = (await indexesOf(client, TABLE)).map(index => (index.constraint
      ? `ALTER TABLE ${NEXT} ADD CONSTRAINT ${index.name}_next ${index.definition}`
      : index.definition.replace(`INDEX ${index.name} ON`, `INDEX ${index.name}_next ON`).replace(`ON ${inWorkbench(TABLE)} `, `ON ${NEXT} `)));
  } finally {
    client.release();
  }
  for (const statement of statements) await cancellable(signal, statement);
}

/**
 * Swap the `_next` copy in and record the build, in one transaction. A cancel
 * that arrived while the swap was being made rolls it back, and the pages in
 * place stay.
 */
export async function swapIn(
  buildId: number, dumpDate: string, counts: { articles: number; redirects: number; items: number }, signal: AbortSignal,
): Promise<void> {
  const client: PoolClient = await pool.connect();
  try {
    await client.query('BEGIN');
    const indexes = await indexesOf(client, TABLE);
    await client.query(`DROP TABLE ${inWorkbench(TABLE)}`);
    await client.query(`ALTER TABLE ${NEXT} RENAME TO ${TABLE}`);
    for (const index of indexes) await client.query(`ALTER INDEX ${inWorkbench(index.name + '_next')} RENAME TO ${index.name}`);
    await client.query(
      'INSERT INTO wikivoyage_pages_builds (build_id, dump_date, articles, redirects, items) VALUES ($1, $2, $3, $4, $5)',
      [buildId, dumpDate, counts.articles, counts.redirects, counts.items],
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

/** The pages in place, if any: their dump date and when they were swapped in. A crash empties the record with the table. */
export async function latestPages(): Promise<{ dumpDate: string; swappedAt: Date; needs: CopyNeeds } | null> {
  const result = await pool.query<{ dump_date: string; swapped_at: Date }>(
    `SELECT to_char(dump_date, 'YYYY-MM-DD') AS dump_date, swapped_at FROM wikivoyage_pages_builds
      ORDER BY swapped_at DESC LIMIT 1`,
  );
  const row = result.rows[0];
  return row ? { dumpDate: row.dump_date, swappedAt: row.swapped_at, needs: 'nothing' } : null;
}
