/**
 * The table the item redirects are kept in (ADR-0143 decision 3, #1895), and
 * how a build writes it. A build stages Wikidata's redirect pages and their
 * targets, keeps each item redirected to another in a `_next` copy, and swaps
 * it in whole with the record of the build, as the Wikipedia redirects are
 * kept (`wikipedia/redirectTables.ts`), so a reader never sees half a build.
 */

import type { PoolClient } from 'pg';
import { pool } from '../../../db/index.js';
import { inWorkbench } from '../../../db/workbench.js';
import type { CopyNeeds } from './buildRules.js';
import { cancellable, indexesOf } from './subsetTables.js';

const TABLE = 'wikidata_redirects';
const NEXT = inWorkbench(`${TABLE}_next`);
/** The redirect pages (id → item), and the items their redirect table points them to (id → target item). */
const PAGES = inWorkbench('wikidata_redirect_pages_stage');
const TARGETS = inWorkbench('wikidata_redirect_targets_stage');

/** A fresh, empty `_next` copy without its indexes, and empty staging tables. */
export async function createNextTable(): Promise<void> {
  await dropNextTable();
  await pool.query(`CREATE UNLOGGED TABLE ${NEXT} (LIKE ${inWorkbench(TABLE)} INCLUDING DEFAULTS INCLUDING CONSTRAINTS)`);
  await pool.query(`CREATE UNLOGGED TABLE ${PAGES} (id BIGINT NOT NULL, item TEXT NOT NULL)`);
  await pool.query(`CREATE UNLOGGED TABLE ${TARGETS} (id BIGINT NOT NULL, target TEXT NOT NULL)`);
}

/** Drop the `_next` copy and the staging tables: a build that failed or was cancelled leaves nothing behind. */
export async function dropNextTable(): Promise<void> {
  await pool.query(`DROP TABLE IF EXISTS ${NEXT}, ${PAGES}, ${TARGETS}`);
}

/** Stage redirect pages: a namespace-0 page that is a redirect, by its id and the item it is titled. */
export async function stagePages(rows: ReadonlyArray<{ id: number; item: string }>): Promise<void> {
  if (rows.length === 0) return;
  await pool.query(`INSERT INTO ${PAGES} (id, item) SELECT * FROM unnest($1::bigint[], $2::text[])`,
    [rows.map(r => r.id), rows.map(r => r.item)]);
}

/** Stage redirect targets: the redirect page's id and the item it points to. */
export async function stageTargets(rows: ReadonlyArray<{ id: number; target: string }>): Promise<void> {
  if (rows.length === 0) return;
  await pool.query(`INSERT INTO ${TARGETS} (id, target) SELECT * FROM unnest($1::bigint[], $2::text[])`,
    [rows.map(r => r.id), rows.map(r => r.target)]);
}

/**
 * Keep every staged item redirected to another item, and empty the staging
 * tables. A page redirected to itself is kept as nothing. Answers how many
 * were kept.
 */
export async function keepRedirects(signal: AbortSignal): Promise<number> {
  const [kept] = await cancellable<{ kept: string }>(signal, `
    WITH kept AS (
      INSERT INTO ${NEXT} (source, target)
      SELECT DISTINCT ON (p.item) p.item, t.target
        FROM ${PAGES} p
        JOIN ${TARGETS} t ON t.id = p.id
       WHERE p.item <> t.target
       ORDER BY p.item, t.target
      RETURNING 1)
    SELECT count(*) AS kept FROM kept`);
  await pool.query(`TRUNCATE ${PAGES}, ${TARGETS}`);
  return Number(kept.kept);
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
 * Swap the `_next` copy in and record the build, in one transaction, and drop
 * the staging tables. A cancel that arrived while the swap was being made
 * rolls it back, and the redirects in place stay.
 */
export async function swapIn(buildId: number, dumpDate: string, kept: number, signal: AbortSignal): Promise<void> {
  const client: PoolClient = await pool.connect();
  try {
    await client.query('BEGIN');
    const indexes = await indexesOf(client, TABLE);
    await client.query(`DROP TABLE ${inWorkbench(TABLE)}`);
    await client.query(`ALTER TABLE ${NEXT} RENAME TO ${TABLE}`);
    for (const index of indexes) await client.query(`ALTER INDEX ${inWorkbench(index.name + '_next')} RENAME TO ${index.name}`);
    await client.query(
      'INSERT INTO workbench.wikidata_redirect_builds (build_id, dump_date, kept) VALUES ($1, $2, $3)',
      [buildId, dumpDate, kept],
    );
    signal.throwIfAborted();
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
  await pool.query(`DROP TABLE IF EXISTS ${PAGES}, ${TARGETS}`);
}

/** The item redirects in place, if any: their dump date and when they were swapped in. A crash empties the record with the table. */
export async function latestWikidataRedirects(): Promise<{ dumpDate: string; swappedAt: Date; needs: CopyNeeds } | null> {
  const result = await pool.query<{ dump_date: string; swapped_at: Date }>(
    `SELECT to_char(dump_date, 'YYYY-MM-DD') AS dump_date, swapped_at FROM workbench.wikidata_redirect_builds
      ORDER BY swapped_at DESC LIMIT 1`,
  );
  const row = result.rows[0];
  return row ? { dumpDate: row.dump_date, swappedAt: row.swapped_at, needs: 'nothing' } : null;
}
