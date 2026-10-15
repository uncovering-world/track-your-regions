/**
 * The tables of the local Wikidata subset (ADR-0105) and how a build replaces
 * them. A build writes a `_next` copy of each table beside the live one, made
 * like it, fills the kept entities, derives the rest from them in SQL, gives
 * the copies the live tables' indexes, and swaps them in one transaction: a
 * reader sees the old subset or the new one, never half of either.
 *
 * Everything but `wikidata_entities` is derived from it, so a table a reader
 * needs that the build does not yet make is a statement here, not a new pass
 * over the dump.
 */

import type { PoolClient } from 'pg';
import { pool } from '../../../db/index.js';
import { arrayItemOf } from './compactEntity.js';

/** The tables a build replaces, the entities first. */
export const SUBSET_TABLES = [
  'wikidata_entities', 'wikidata_claims', 'wikidata_labels', 'wikidata_sitelinks', 'wikidata_class_closure',
] as const;
type SubsetTable = typeof SUBSET_TABLES[number];

const next = (table: SubsetTable) => `${table}_next`;

/**
 * The properties `wikidata_claims` holds a row for: what the catalogue reads
 * today (#1434). Any other statement is in the entity, and adding a property
 * here takes effect on the next build without a new pass over the dump.
 */
export const CLAIM_PROPERTIES = [
  'P31', 'P279', 'P17', 'P18', 'P131', 'P170', 'P189', 'P195', 'P276', 'P361', 'P527', 'P571', 'P576',
  'P625', 'P757', 'P856', 'P1082', 'P1435', 'P1770', 'P381', 'P4009',
];

/**
 * Run one long statement on a client of its own, cancelled in the database
 * when `signal` aborts: a derivation over the whole subset runs for many
 * minutes, and a cancel must not wait for it to end.
 */
async function cancellable(signal: AbortSignal, sql: string, params: unknown[] = []): Promise<void> {
  signal.throwIfAborted();
  const client = await pool.connect();
  let cancelling: Promise<unknown> = Promise.resolve();
  const onAbort = () => {
    cancelling = pool.query('SELECT pg_cancel_backend($1)', [(client as PoolClient & { processID: number }).processID])
      .catch(() => undefined);
  };
  signal.addEventListener('abort', onAbort, { once: true });
  try {
    await client.query(sql, params);
  } finally {
    signal.removeEventListener('abort', onAbort);
    // A cancel that lands after the statement ended would stop whatever runs
    // next on this backend, so an aborted client is closed, never pooled.
    await cancelling;
    client.release(signal.aborted);
  }
  signal.throwIfAborted();
}

/** Empty `_next` copies of every table, made like the live ones but with no index yet: they load faster without. */
export async function createNextTables(): Promise<void> {
  for (const table of SUBSET_TABLES) {
    await pool.query(`DROP TABLE IF EXISTS ${next(table)}`);
    await pool.query(
      `CREATE UNLOGGED TABLE ${next(table)} (LIKE ${table} INCLUDING DEFAULTS INCLUDING CONSTRAINTS INCLUDING COMPRESSION INCLUDING STORAGE)`,
    );
  }
  await pool.query(`ALTER TABLE ${next('wikidata_entities')} SET (toast_tuple_target = 128)`);
}

export async function dropNextTables(): Promise<void> {
  for (const table of SUBSET_TABLES) await pool.query(`DROP TABLE IF EXISTS ${next(table)}`);
}

/**
 * A kept entity to insert: its compact JSON, or that JSON already quoted as an
 * element of a Postgres array literal (`arrayItemOf`), as a worker thread
 * makes it (#1479) — so the thread that inserts does not escape every quote
 * of every entity, and the row crosses threads once, not twice.
 */
export type EntityRow = { id: string; sitelinkCount: number } & ({ entity: string } | { arrayItem: string });

export async function insertEntities(rows: EntityRow[]): Promise<void> {
  if (rows.length === 0) return;
  await pool.query(
    `INSERT INTO ${next('wikidata_entities')} (id, sitelink_count, entity)
     SELECT * FROM unnest($1::text[], $2::int[], $3::jsonb[])`,
    [rows.map(r => r.id), rows.map(r => r.sitelinkCount), `{${rows.map(r => ('arrayItem' in r ? r.arrayItem : arrayItemOf(r.entity))).join(',')}}`],
  );
}

export interface LabelRow {
  id: string;
  language: string;
  label: string | null;
  description: string | null;
}

export async function insertLabels(rows: LabelRow[]): Promise<void> {
  if (rows.length === 0) return;
  await pool.query(
    `INSERT INTO ${next('wikidata_labels')} (id, language, label, description)
     SELECT * FROM unnest($1::text[], $2::text[], $3::text[], $4::text[])`,
    [rows.map(r => r.id), rows.map(r => r.language), rows.map(r => r.label), rows.map(r => r.description)],
  );
}

/**
 * The claims, the kept entities' labels and the sitelinks, derived from the
 * entities. An item value is told from a string by its property's datatype,
 * which the kept property entities carry, and from an unknown or no value
 * (`{"somevalue": true}`, `{"novalue": true}`) by being a string: those stay
 * in `value`, so `value_item` only ever holds an id.
 */
export async function deriveFromEntities(signal: AbortSignal): Promise<void> {
  await cancellable(
    signal,
    `INSERT INTO ${next('wikidata_claims')} (subject, property, statement_id, rank, value_item, value, qualifiers)
     SELECT e.id, c.property, s->>'id',
            CASE s->>'rank' WHEN 'preferred' THEN 1 WHEN 'deprecated' THEN -1 ELSE 0 END,
            CASE WHEN p.entity->>'datatype' = 'wikibase-item' AND jsonb_typeof(s->'value') = 'string' THEN s->>'value' END,
            CASE WHEN p.entity->>'datatype' = 'wikibase-item' AND jsonb_typeof(s->'value') = 'string' THEN NULL ELSE s->'value' END,
            s->'qualifiers'
       FROM ${next('wikidata_entities')} e
      CROSS JOIN LATERAL jsonb_each(e.entity->'claims') AS c(property, statements)
      CROSS JOIN LATERAL jsonb_array_elements(c.statements) AS s
       LEFT JOIN ${next('wikidata_entities')} p ON p.id = c.property
      WHERE e.id LIKE 'Q%' AND c.property = ANY($1::text[])`,
    [CLAIM_PROPERTIES],
  );
  await cancellable(
    signal,
    // The languages of either term object. `->` and `||` bind alike and from
    // the left, so each object is bracketed before the merge, or it reads as
    // `(labels || entity)->'descriptions'`: the description languages alone.
    `INSERT INTO ${next('wikidata_labels')} (id, language, label, description)
     SELECT e.id, k.language, e.entity->'labels'->>k.language, e.entity->'descriptions'->>k.language
       FROM ${next('wikidata_entities')} e
      CROSS JOIN LATERAL jsonb_object_keys((e.entity->'labels') || (e.entity->'descriptions')) AS k(language)`,
  );
  await cancellable(
    signal,
    `INSERT INTO ${next('wikidata_sitelinks')} (id, site, title)
     SELECT e.id, l.site, l.title
       FROM ${next('wikidata_entities')} e
      CROSS JOIN LATERAL jsonb_each_text(e.entity->'sitelinks') AS l(site, title)`,
  );
}

/**
 * For every class a kept item is an instance of, the class and every class
 * above it through subclass of; a deprecated statement is not followed. Run
 * after the claims have their indexes: the walk reads them by subject.
 */
export async function deriveClassClosure(signal: AbortSignal): Promise<void> {
  await cancellable(
    signal,
    `INSERT INTO ${next('wikidata_class_closure')} (class, ancestor)
     WITH RECURSIVE up(class, ancestor) AS (
       SELECT DISTINCT value_item, value_item FROM ${next('wikidata_claims')}
        WHERE property = 'P31' AND value_item IS NOT NULL
       UNION
       SELECT up.class, s.value_item
         FROM up JOIN ${next('wikidata_claims')} s
           ON s.subject = up.ancestor AND s.property = 'P279' AND s.value_item IS NOT NULL AND s.rank >= 0
     )
     SELECT class, ancestor FROM up`,
  );
}

interface IndexDefinition {
  name: string;
  constraint: 'p' | 'u' | null;
  definition: string;
}

/** The live table's indexes and key constraints, as statements on its `_next` copy. */
async function indexesOf(client: PoolClient, table: SubsetTable): Promise<IndexDefinition[]> {
  const result = await client.query<{ name: string; constraint: 'p' | 'u' | null; index_def: string; constraint_def: string | null }>(
    `SELECT i.relname AS name, con.contype AS constraint, pg_get_indexdef(i.oid) AS index_def,
            pg_get_constraintdef(con.oid) AS constraint_def
       FROM pg_index x
       JOIN pg_class i ON i.oid = x.indexrelid
       JOIN pg_class t ON t.oid = x.indrelid
       JOIN pg_namespace n ON n.oid = t.relnamespace
       LEFT JOIN pg_constraint con ON con.conindid = i.oid AND con.contype IN ('p', 'u')
      WHERE n.nspname = 'public' AND t.relname = $1`,
    [table],
  );
  return result.rows.map(row => ({
    name: row.name,
    constraint: row.constraint,
    definition: row.constraint ? row.constraint_def! : row.index_def,
  }));
}

/** Give each `_next` copy the indexes its live table has, under the live names with `_next` appended. */
export async function indexNextTables(signal: AbortSignal, only: readonly SubsetTable[] = SUBSET_TABLES): Promise<void> {
  const statements: string[] = [];
  const client = await pool.connect();
  try {
    for (const table of only) {
      for (const index of await indexesOf(client, table)) {
        statements.push(index.constraint
          ? `ALTER TABLE ${next(table)} ADD CONSTRAINT ${index.name}_next ${index.definition}`
          : index.definition
            .replace(`INDEX ${index.name} ON`, `INDEX ${index.name}_next ON`)
            .replace(`ON public.${table} `, `ON public.${next(table)} `));
      }
    }
  } finally {
    client.release();
  }
  for (const statement of statements) await cancellable(signal, statement);
}

/** Replace the live tables with their `_next` copies and record the build, in one transaction. */
export async function swapIn(buildId: number, dumpDate: string, counts: Record<string, number>): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const table of SUBSET_TABLES) {
      const indexes = await indexesOf(client, table);
      await client.query(`DROP TABLE ${table}`);
      await client.query(`ALTER TABLE ${next(table)} RENAME TO ${table}`);
      for (const index of indexes) await client.query(`ALTER INDEX ${index.name}_next RENAME TO ${index.name}`);
    }
    await client.query(
      'INSERT INTO wikidata_subset_builds (build_id, dump_date, counts) VALUES ($1, $2, $3)',
      [buildId, dumpDate, JSON.stringify(counts)],
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/** The subset build now in place, if any. */
export async function latestSubset(): Promise<{ dumpDate: string; swappedAt: Date } | null> {
  const result = await pool.query<{ dump_date: string; swapped_at: Date }>(
    `SELECT to_char(dump_date, 'YYYY-MM-DD') AS dump_date, swapped_at FROM wikidata_subset_builds
      ORDER BY swapped_at DESC LIMIT 1`,
  );
  const row = result.rows[0];
  return row ? { dumpDate: row.dump_date, swappedAt: row.swapped_at } : null;
}
