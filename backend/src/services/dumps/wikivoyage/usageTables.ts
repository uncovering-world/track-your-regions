/**
 * The table the Wikidata items each Wikivoyage edition uses are kept in
 * (#1768, decided on #1718), and how a build writes it. A build keeps each edition's
 * items in a `_next` copy and swaps it in whole with the record of the build,
 * as the redirects are kept (`redirectTables.ts`), so a reader never sees half
 * a build.
 */

import type { PoolClient } from 'pg';
import { pool } from '../../../db/index.js';
import { inWorkbench } from '../../../db/workbench.js';
import type { CopyNeeds } from '../wikidata/buildRules.js';
import { cancellable, indexesOf } from '../wikidata/subsetTables.js';

const TABLE = 'wikivoyage_usage';
const NEXT = inWorkbench(`${TABLE}_next`);

/** A fresh, empty `_next` copy without its indexes. */
export async function createNextTable(): Promise<void> {
  await dropNextTable();
  await pool.query(`CREATE UNLOGGED TABLE ${NEXT} (LIKE ${TABLE} INCLUDING DEFAULTS INCLUDING CONSTRAINTS)`);
}

/** Drop the `_next` copy: a build that failed or was cancelled leaves nothing behind. */
export async function dropNextTable(): Promise<void> {
  await pool.query(`DROP TABLE IF EXISTS ${NEXT}`);
}

/** Keep the items one edition uses, each once. */
export async function keepUsage(site: string, items: readonly string[]): Promise<void> {
  if (items.length === 0) return;
  await pool.query(`INSERT INTO ${NEXT} (item, site) SELECT unnest($2::text[]), $1`, [site, items]);
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
 * that arrived while the swap was being made rolls it back, and the usage in
 * place stays.
 */
export async function swapIn(buildId: number, dumpDate: string, editions: Record<string, number>, signal: AbortSignal): Promise<void> {
  const client: PoolClient = await pool.connect();
  try {
    await client.query('BEGIN');
    const indexes = await indexesOf(client, TABLE);
    await client.query(`DROP TABLE ${inWorkbench(TABLE)}`);
    await client.query(`ALTER TABLE ${NEXT} RENAME TO ${TABLE}`);
    for (const index of indexes) await client.query(`ALTER INDEX ${inWorkbench(index.name + '_next')} RENAME TO ${index.name}`);
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

/** The usage in place, if any: its dump date and when it was swapped in. A crash empties the record with the table. */
export async function latestUsage(): Promise<{ dumpDate: string; swappedAt: Date; needs: CopyNeeds } | null> {
  const result = await pool.query<{ dump_date: string; swapped_at: Date }>(
    `SELECT to_char(dump_date, 'YYYY-MM-DD') AS dump_date, swapped_at FROM wikivoyage_usage_builds
      ORDER BY swapped_at DESC LIMIT 1`,
  );
  const row = result.rows[0];
  return row ? { dumpDate: row.dump_date, swappedAt: row.swapped_at, needs: 'nothing' } : null;
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
