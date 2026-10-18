/**
 * The tables English Wikipedia's structure is kept in (#1440, ADR-0121), and
 * how a build writes them: `_next` copies beside the live tables, filled,
 * given the live tables' indexes and swapped in with one transaction, as the
 * Wikidata subset's are (ADR-0105 decision 4), so a reader never sees half a
 * build.
 */

import type { PoolClient } from 'pg';
import { pool } from '../../../db/index.js';
import type { CopyNeeds } from '../wikidata/buildRules.js';
import { cancellable, indexesOf } from '../wikidata/subsetTables.js';

export const STRUCTURE_TABLES = ['enwiki_pages', 'enwiki_page_items', 'enwiki_categories', 'enwiki_category_links'] as const;
export type StructureTable = typeof STRUCTURE_TABLES[number];

const next = (table: StructureTable) => `${table}_next`;

/** Fresh, empty `_next` copies of every table, without their indexes, which are built once the rows are in. */
export async function createNextTables(): Promise<void> {
  for (const table of STRUCTURE_TABLES) {
    await pool.query(`DROP TABLE IF EXISTS ${next(table)}`);
    await pool.query(`CREATE UNLOGGED TABLE ${next(table)} (LIKE ${table} INCLUDING DEFAULTS INCLUDING CONSTRAINTS)`);
  }
}

/** Drop the `_next` copies: a build that failed or was cancelled leaves nothing behind. */
export async function dropNextTables(): Promise<void> {
  await pool.query(`DROP TABLE IF EXISTS ${STRUCTURE_TABLES.map(next).join(', ')}`);
}

export interface PageRow { id: number; namespace: 0 | 14; title: string }

export async function insertPages(rows: readonly PageRow[]): Promise<void> {
  if (rows.length === 0) return;
  await pool.query(
    `INSERT INTO ${next('enwiki_pages')} (id, namespace, title)
     SELECT * FROM unnest($1::int[], $2::smallint[], $3::text[])`,
    [rows.map(r => r.id), rows.map(r => r.namespace), rows.map(r => r.title)],
  );
}

export async function insertItems(rows: ReadonlyArray<{ page: number; item: string }>): Promise<void> {
  if (rows.length === 0) return;
  await pool.query(
    `INSERT INTO ${next('enwiki_page_items')} (page, item) SELECT * FROM unnest($1::int[], $2::text[])`,
    [rows.map(r => r.page), rows.map(r => r.item)],
  );
}

export async function insertCategories(rows: ReadonlyArray<{ id: number; title: string }>): Promise<void> {
  if (rows.length === 0) return;
  await pool.query(
    `INSERT INTO ${next('enwiki_categories')} (id, title) SELECT * FROM unnest($1::int[], $2::text[])`,
    [rows.map(r => r.id), rows.map(r => r.title)],
  );
}

export interface LinkRow { page: number; category: number; subcat: boolean }

export async function insertLinks(rows: readonly LinkRow[]): Promise<void> {
  if (rows.length === 0) return;
  await pool.query(
    `INSERT INTO ${next('enwiki_category_links')} (page, category, subcat)
     SELECT * FROM unnest($1::int[], $2::int[], $3::bool[])`,
    [rows.map(r => r.page), rows.map(r => r.category), rows.map(r => r.subcat)],
  );
}

/** The titles of the hidden category pages among `pageIds`, read back from the pages the build has written. */
export async function hiddenCategoryTitles(pageIds: readonly number[]): Promise<Set<string>> {
  const result = await pool.query<{ title: string }>(
    `SELECT title FROM ${next('enwiki_pages')} WHERE namespace = 14 AND id = ANY($1::int[])`,
    [pageIds],
  );
  return new Set(result.rows.map(row => row.title));
}

/** Give each `_next` copy the live table's indexes and key constraints, under the live names with `_next` appended. */
export async function indexNextTables(signal: AbortSignal, onIndex?: (which: string) => void): Promise<void> {
  const statements: Array<{ name: string; sql: string }> = [];
  const client = await pool.connect();
  try {
    for (const table of STRUCTURE_TABLES) {
      for (const index of await indexesOf(client, table)) {
        statements.push({
          name: index.name,
          sql: index.constraint
            ? `ALTER TABLE ${next(table)} ADD CONSTRAINT ${index.name}_next ${index.definition}`
            : index.definition
              .replace(`INDEX ${index.name} ON`, `INDEX ${index.name}_next ON`)
              .replace(`ON public.${table} `, `ON public.${next(table)} `),
        });
      }
    }
  } finally {
    client.release();
  }
  for (const [at, statement] of statements.entries()) {
    onIndex?.(`index ${at + 1} of ${statements.length}, ${statement.name}`);
    await cancellable(signal, statement.sql);
  }
}

/**
 * Swap every `_next` copy in for its live table, and record the build, in one
 * transaction. A cancel that arrived while the swap was being made rolls it
 * back: the build is then the cancelled one it was asked to be, and the
 * structure in place stays.
 */
export async function swapIn(buildId: number, dumpDate: string, counts: Record<string, number>, signal: AbortSignal): Promise<void> {
  const client: PoolClient = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const table of STRUCTURE_TABLES) {
      const indexes = await indexesOf(client, table);
      await client.query(`DROP TABLE ${table}`);
      await client.query(`ALTER TABLE ${next(table)} RENAME TO ${table}`);
      for (const index of indexes) await client.query(`ALTER INDEX ${index.name}_next RENAME TO ${index.name}`);
    }
    await client.query(
      'INSERT INTO enwiki_structure_builds (build_id, dump_date, counts) VALUES ($1, $2, $3)',
      [buildId, dumpDate, JSON.stringify(counts)],
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

/** The structure in place, if any: its dump date and when it was swapped in. A crash empties the record with the tables. */
export async function latestStructure(): Promise<{ dumpDate: string; swappedAt: Date; needs: CopyNeeds } | null> {
  const result = await pool.query<{ dump_date: string; swapped_at: Date }>(
    `SELECT to_char(dump_date, 'YYYY-MM-DD') AS dump_date, swapped_at FROM enwiki_structure_builds
      ORDER BY swapped_at DESC LIMIT 1`,
  );
  const row = result.rows[0];
  return row ? { dumpDate: row.dump_date, swappedAt: row.swapped_at, needs: 'nothing' } : null;
}
