/**
 * The table the redirects readership folds are kept in (#1650, ADR-0055
 * decision 2), and how a build writes it. A build stages each edition's
 * redirect pages and their targets, keeps the redirects whose target is a
 * sitelink of the local subset in a `_next` copy, and swaps it in whole with
 * the record of the build, as English Wikipedia's structure is kept
 * (`structureTables.ts`), so a reader never sees half a build.
 */

import type { PoolClient } from 'pg';
import { pool } from '../../../db/index.js';
import type { CopyNeeds } from '../wikidata/buildRules.js';
import { cancellable, indexesOf } from '../wikidata/subsetTables.js';

const TABLE = 'wikipedia_redirects';
const NEXT = `${TABLE}_next`;
/** One edition's redirect pages (id → title), and the targets its redirect table gives them (id → title). */
const PAGES = 'wikipedia_redirect_pages_stage';
const TARGETS = 'wikipedia_redirect_targets_stage';

/** A fresh, empty `_next` copy without its indexes, and empty staging tables. */
export async function createNextTable(): Promise<void> {
  await dropNextTable();
  await pool.query(`CREATE UNLOGGED TABLE ${NEXT} (LIKE ${TABLE} INCLUDING DEFAULTS INCLUDING CONSTRAINTS)`);
  await pool.query(`CREATE UNLOGGED TABLE ${PAGES} (id BIGINT NOT NULL, title TEXT NOT NULL)`);
  await pool.query(`CREATE UNLOGGED TABLE ${TARGETS} (id BIGINT NOT NULL, target TEXT NOT NULL)`);
}

/** Drop the `_next` copy and the staging tables: a build that failed or was cancelled leaves nothing behind. */
export async function dropNextTable(): Promise<void> {
  await pool.query(`DROP TABLE IF EXISTS ${NEXT}, ${PAGES}, ${TARGETS}`);
}

/** Stage redirect pages of one edition: a namespace-0 page that is a redirect, its title with spaces. */
export async function stagePages(rows: ReadonlyArray<{ id: number; title: string }>): Promise<void> {
  if (rows.length === 0) return;
  await pool.query(`INSERT INTO ${PAGES} (id, title) SELECT * FROM unnest($1::bigint[], $2::text[])`,
    [rows.map(r => r.id), rows.map(r => r.title)]);
}

/** Stage redirect targets of one edition: the redirect page's id and the namespace-0 title it points to, with spaces. */
export async function stageTargets(rows: ReadonlyArray<{ id: number; target: string }>): Promise<void> {
  if (rows.length === 0) return;
  await pool.query(`INSERT INTO ${TARGETS} (id, target) SELECT * FROM unnest($1::bigint[], $2::text[])`,
    [rows.map(r => r.id), rows.map(r => r.target)]);
}

/**
 * Keep one edition's staged redirects whose target is an article of the local
 * subset (a sitelink of `site`), and empty the staging tables for the next
 * edition. A redirect to a page no item names counts for nothing, so it is not
 * kept, and a redirect that is itself an item's sitelink is that item's, so it
 * is not kept either. Answers how many were kept.
 */
export async function keepEdition(site: string, signal: AbortSignal): Promise<number> {
  const [kept] = await cancellable<{ kept: string }>(signal, `
    WITH kept AS (
      INSERT INTO ${NEXT} (site, title, target)
      SELECT DISTINCT ON (p.title) $1, p.title, t.target
        FROM ${PAGES} p
        JOIN ${TARGETS} t ON t.id = p.id
       WHERE p.title <> t.target
         AND EXISTS (SELECT 1 FROM wikidata_sitelinks l WHERE l.site = $1 AND l.title = t.target)
         -- A redirect that is an item's own sitelink (Wikidata's "intentional
         -- sitelink to redirect") is read as that item's, not its target's.
         AND NOT EXISTS (SELECT 1 FROM wikidata_sitelinks own WHERE own.site = $1 AND own.title = p.title)
       ORDER BY p.title, t.target
      RETURNING 1)
    SELECT count(*) AS kept FROM kept`, [site]);
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
      : index.definition.replace(`INDEX ${index.name} ON`, `INDEX ${index.name}_next ON`).replace(`ON public.${TABLE} `, `ON public.${NEXT} `)));
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
export async function swapIn(buildId: number, dumpDate: string, editions: Record<string, number>, signal: AbortSignal): Promise<void> {
  const client: PoolClient = await pool.connect();
  try {
    await client.query('BEGIN');
    const indexes = await indexesOf(client, TABLE);
    await client.query(`DROP TABLE ${TABLE}`);
    await client.query(`ALTER TABLE ${NEXT} RENAME TO ${TABLE}`);
    for (const index of indexes) await client.query(`ALTER INDEX ${index.name}_next RENAME TO ${index.name}`);
    await client.query(
      'INSERT INTO wikipedia_redirect_builds (build_id, dump_date, editions) VALUES ($1, $2, $3)',
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
  await pool.query(`DROP TABLE IF EXISTS ${PAGES}, ${TARGETS}`);
}

/** The redirects in place, if any: their dump date and when they were swapped in. A crash empties the record with the table. */
export async function latestRedirects(): Promise<{ dumpDate: string; swappedAt: Date; needs: CopyNeeds } | null> {
  const result = await pool.query<{ dump_date: string; swapped_at: Date }>(
    `SELECT to_char(dump_date, 'YYYY-MM-DD') AS dump_date, swapped_at FROM wikipedia_redirect_builds
      ORDER BY swapped_at DESC LIMIT 1`,
  );
  const row = result.rows[0];
  return row ? { dumpDate: row.dump_date, swappedAt: row.swapped_at, needs: 'nothing' } : null;
}
