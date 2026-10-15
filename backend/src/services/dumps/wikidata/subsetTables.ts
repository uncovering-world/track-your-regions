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

import { availableParallelism } from 'node:os';
import type { PoolClient, QueryResultRow } from 'pg';
import { pool } from '../../../db/index.js';
import { arrayItemOf } from './compactEntity.js';
import { insertRefusing, type Refusals } from './refusals.js';

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
async function cancellable<Row extends QueryResultRow = QueryResultRow>(
  signal: AbortSignal, sql: string, params: unknown[] = [],
): Promise<Row[]> {
  signal.throwIfAborted();
  const client = await pool.connect();
  let cancelling: Promise<unknown> = Promise.resolve();
  const onAbort = () => {
    cancelling = pool.query('SELECT pg_cancel_backend($1)', [(client as PoolClient & { processID: number }).processID])
      .catch(() => undefined);
  };
  signal.addEventListener('abort', onAbort, { once: true });
  let rows: Row[];
  try {
    rows = (await client.query<Row>(sql, params)).rows;
  } finally {
    signal.removeEventListener('abort', onAbort);
    // A cancel that lands after the statement ended would stop whatever runs
    // next on this backend, so an aborted client is closed, never pooled.
    await cancelling;
    client.release(signal.aborted);
  }
  signal.throwIfAborted();
  return rows;
}

/**
 * The build's own record of pass 2 (#1493), beside the `_next` copies and as
 * unlogged as they are, so a database crash that empties them empties it too:
 * which build the copies are for (`RESUME_TABLE`, its key), and every piece of
 * the dump whose rows are written (`PIECES_TABLE`), with what the build keeps
 * of it in memory — its lines, its rows written, its terms spooled and where
 * the spool ended, the items its kept entities name (the labels ring) and the
 * rows Postgres refused. A piece's record is written in the transaction that
 * writes its rows, so a piece is either wholly done or not done at all.
 */
const RESUME_TABLE = 'wikidata_build_resume_next';
/** How many piece transactions may be open at once: each holds a client of the pool the API shares (`db/index.ts`). */
export const PIECES_IN_FLIGHT = 6;
const PIECES_TABLE = 'wikidata_build_pieces_next';

/** Empty `_next` copies of every table, made like the live ones but with no index yet: they load faster without. */
export async function createNextTables(resumeKey: string, spoolPath: string): Promise<void> {
  for (const table of SUBSET_TABLES) {
    await pool.query(`DROP TABLE IF EXISTS ${next(table)}`);
    await pool.query(
      `CREATE UNLOGGED TABLE ${next(table)} (LIKE ${table} INCLUDING DEFAULTS INCLUDING CONSTRAINTS INCLUDING COMPRESSION INCLUDING STORAGE)`,
    );
  }
  await pool.query(`ALTER TABLE ${next('wikidata_entities')} SET (toast_tuple_target = 128)`);
  await pool.query(`DROP TABLE IF EXISTS ${RESUME_TABLE}, ${PIECES_TABLE}`);
  await pool.query(`CREATE UNLOGGED TABLE ${RESUME_TABLE} (key text NOT NULL, spool text NOT NULL)`);
  await pool.query(`INSERT INTO ${RESUME_TABLE} (key, spool) VALUES ($1, $2)`, [resumeKey, spoolPath]);
  await pool.query(
    `CREATE UNLOGGED TABLE ${PIECES_TABLE} (
       piece integer PRIMARY KEY, lines integer NOT NULL, written integer NOT NULL, spooled integer NOT NULL,
       spool_end bigint NOT NULL, ring bytea NOT NULL, refused jsonb NOT NULL)`,
  );
}

/** What a piece of pass 2 leaves behind once its rows are written. */
export interface PieceRecord {
  piece: number;
  lines: number;
  spooled: number;
  /** The spool's size once this piece's terms were appended to it. */
  spoolEnd: number;
  ring: Uint32Array;
}

/** A refused row, for the build's notes. */
export interface RefusedRow { id: string; reason: string }

/**
 * Write a piece's rows and its record in one transaction; answers how many
 * rows were written. A batch Postgres refuses for its data is written again
 * row by row inside the transaction, each attempt behind a savepoint, and the
 * rows still refused are left out, counted in `refusals` and kept in the
 * piece's record.
 */
export async function commitPiece(
  record: PieceRecord, rows: EntityRow[], refusals: Pick<Refusals, 'refuse'>,
): Promise<number> {
  const client = await pool.connect();
  let healthy = true;
  try {
    await client.query('BEGIN');
    const refused: RefusedRow[] = [];
    const own = { refuse: (id: string, error: unknown) => { refused.push({ id, reason: (error as Error).message }); refusals.refuse(id, error); } };
    const behindSavepoint = async (batch: EntityRow[]) => {
      await client.query('SAVEPOINT row_batch');
      try {
        await insertEntitiesOn(client, batch);
        await client.query('RELEASE SAVEPOINT row_batch');
      } catch (error) {
        await client.query('ROLLBACK TO SAVEPOINT row_batch');
        throw error;
      }
    };
    let written = 0;
    for (let at = 0; at < rows.length; at += ENTITY_BATCH) {
      written += await insertRefusing(rows.slice(at, at + ENTITY_BATCH), row => row.id, behindSavepoint, own);
    }
    await client.query(
      `INSERT INTO ${PIECES_TABLE} (piece, lines, written, spooled, spool_end, ring, refused) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [record.piece, record.lines, written, record.spooled, record.spoolEnd,
        Buffer.from(record.ring.buffer, record.ring.byteOffset, record.ring.byteLength), JSON.stringify(refused)],
    );
    await client.query('COMMIT');
    return written;
  } catch (error) {
    healthy = false;
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release(!healthy);
  }
}

/** The spool an earlier build left beside its copies, whatever it was built from: removed when a build starts afresh. */
export async function earlierSpool(): Promise<string | null> {
  const present = await pool.query<{ ok: boolean }>('SELECT to_regclass($1) IS NOT NULL AS ok', [RESUME_TABLE]);
  if (!present.rows[0]?.ok) return null;
  const row = await pool.query<{ spool: string }>(`SELECT spool FROM ${RESUME_TABLE}`);
  return row.rows[0]?.spool ?? null;
}

/** What the entities copy holds on disk now: what a build picking up after it does not write again. */
export async function entitiesCopySize(): Promise<number> {
  const result = await pool.query<{ size: string | null }>('SELECT pg_total_relation_size(to_regclass($1)) AS size', [next('wikidata_entities')]);
  return Number(result.rows[0]?.size ?? 0);
}

/** What an earlier build of the same file and scope left to pick up after (#1493). */
export interface ResumeState {
  pieces: Map<number, { lines: number; written: number; spooled: number; ring: Uint32Array; refused: RefusedRow[] }>;
  /** Where the spool's last written piece ended: what of the spool is kept. */
  spoolEnd: number;
}

/**
 * The pieces an earlier build wrote, when its `_next` copies are there and
 * are for `resumeKey` (the same file and scope); else null, and the build
 * starts afresh.
 */
export async function resumableBuild(resumeKey: string): Promise<ResumeState | null> {
  const present = await pool.query<{ ok: boolean }>(
    `SELECT to_regclass($1) IS NOT NULL AND to_regclass($2) IS NOT NULL AND to_regclass($3) IS NOT NULL AS ok`,
    [RESUME_TABLE, PIECES_TABLE, next('wikidata_entities')],
  );
  if (!present.rows[0]?.ok) return null;
  const key = await pool.query<{ key: string }>(`SELECT key FROM ${RESUME_TABLE}`);
  if (key.rows.length !== 1 || key.rows[0].key !== resumeKey) return null;
  const rows = await pool.query<{ piece: number; lines: number; written: number; spooled: number; spool_end: string; ring: Buffer; refused: RefusedRow[] }>(
    `SELECT piece, lines, written, spooled, spool_end, ring, refused FROM ${PIECES_TABLE}`,
  );
  const state: ResumeState = { pieces: new Map(), spoolEnd: 0 };
  for (const row of rows.rows) {
    const ring = new Uint32Array(row.ring.byteLength / 4);
    new Uint8Array(ring.buffer).set(row.ring);
    state.pieces.set(row.piece, { lines: row.lines, written: row.written, spooled: row.spooled, ring, refused: row.refused });
    state.spoolEnd = Math.max(state.spoolEnd, Number(row.spool_end));
  }
  return state;
}

/**
 * Before a build picks up after its pass 2, undo what came after the pass:
 * the tables derived from the entities are made empty again and the
 * entities copy loses any index it was given, so the steps after the pass
 * run once, on the whole.
 */
export async function resetAfterPassTwo(): Promise<void> {
  for (const table of SUBSET_TABLES) {
    if (table === 'wikidata_entities') continue;
    await pool.query(`DROP TABLE IF EXISTS ${next(table)}`);
    await pool.query(
      `CREATE UNLOGGED TABLE ${next(table)} (LIKE ${table} INCLUDING DEFAULTS INCLUDING CONSTRAINTS INCLUDING COMPRESSION INCLUDING STORAGE)`,
    );
  }
  const client = await pool.connect();
  try {
    for (const index of await indexesOf(client, 'wikidata_entities')) {
      await client.query(index.constraint
        ? `ALTER TABLE ${next('wikidata_entities')} DROP CONSTRAINT IF EXISTS ${index.name}_next`
        : `DROP INDEX IF EXISTS ${index.name}_next`);
    }
  } finally {
    client.release();
  }
}

export async function dropNextTables(): Promise<void> {
  for (const table of SUBSET_TABLES) await pool.query(`DROP TABLE IF EXISTS ${next(table)}`);
  await pool.query(`DROP TABLE IF EXISTS ${RESUME_TABLE}, ${PIECES_TABLE}`);
}

/**
 * A kept entity to insert: its compact JSON, or that JSON already quoted as an
 * element of a Postgres array literal (`arrayItemOf`), as a worker thread
 * makes it (#1479) — so the thread that inserts does not escape every quote
 * of every entity, and the row crosses threads once, not twice.
 */
export type EntityRow = { id: string; sitelinkCount: number } & ({ entity: string } | { arrayItem: string });

/** Rows per insert statement: a few megabytes of JSON. */
const ENTITY_BATCH = 2000;

async function insertEntitiesOn(client: PoolClient, rows: EntityRow[]): Promise<void> {
  if (rows.length === 0) return;
  await client.query(
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
 * How many disjoint statements a derivation runs at once, each on a client
 * and a core of its own: as one statement, deriving the claims of a full
 * build's entities took the better part of an hour (22 s for 192 MB of
 * entities, #1479). A part is the entities whose id hashes to it, so the
 * parts never overlap and together are the whole. At most four: each holds a
 * client of the pool the API shares (`db/index.ts`) for minutes, and the
 * cores counted are the backend's, not the database's.
 */
const DERIVE_PARTS = Math.min(4, Math.max(1, availableParallelism()));

/**
 * Run the statement `sql(at)` makes once per part, all at once; `at` is the
 * condition that picks a part's entities, over the two parameters after
 * `params`. A part that fails cancels the others and is the error thrown, so
 * no statement is left inserting into a table the failed build drops.
 */
async function inParts(signal: AbortSignal, parts: number, params: unknown[], sql: (at: string) => string): Promise<void> {
  // An abort that came before this would never reach `follow` below.
  signal.throwIfAborted();
  // bigint: abs() of the one int hashtext() can answer with no positive twin would overflow.
  const at = `abs(hashtext(e.id)::bigint) % $${params.length + 1} = $${params.length + 2}`;
  const local = new AbortController();
  const follow = () => local.abort(signal.reason);
  signal.addEventListener('abort', follow, { once: true });
  let first: unknown = null;
  try {
    const settled = await Promise.allSettled(Array.from({ length: parts }, (_, part) =>
      cancellable(local.signal, sql(at), [...params, parts, part]).catch((error: unknown) => {
        first ??= error;
        local.abort(error);
        throw error;
      })));
    if (settled.some(outcome => outcome.status === 'rejected')) throw first;
  } finally {
    signal.removeEventListener('abort', follow);
  }
  signal.throwIfAborted();
}

/**
 * The claims, the kept entities' labels and the sitelinks, derived from the
 * entities. An item value is told from a string by its property's datatype,
 * which the kept property entities carry, and from an unknown or no value
 * (`{"somevalue": true}`, `{"novalue": true}`) by being a string: those stay
 * in `value`, so `value_item` only ever holds an id.
 *
 * Which of the claimed properties take an item is read once, before the
 * parts start, and handed to each as a list (#1523). Joining the entities
 * table for it instead had every part hash all of the table, which has no
 * index yet: 24 million rows and tens of gigabytes of temporary files on a
 * full build, to find a few dozen property entities.
 */
export async function deriveFromEntities(signal: AbortSignal, parts = DERIVE_PARTS): Promise<void> {
  const itemProperties = (await cancellable<{ id: string }>(
    signal,
    `SELECT id FROM ${next('wikidata_entities')}
      WHERE id = ANY($1::text[]) AND entity->>'datatype' = 'wikibase-item'`,
    [CLAIM_PROPERTIES],
  )).map(row => row.id);
  await inParts(signal, parts, [CLAIM_PROPERTIES, itemProperties], at =>
    `INSERT INTO ${next('wikidata_claims')} (subject, property, statement_id, rank, value_item, value, qualifiers)
     SELECT e.id, c.property, s->>'id',
            CASE s->>'rank' WHEN 'preferred' THEN 1 WHEN 'deprecated' THEN -1 ELSE 0 END,
            CASE WHEN c.property = ANY($2::text[]) AND jsonb_typeof(s->'value') = 'string' THEN s->>'value' END,
            CASE WHEN c.property = ANY($2::text[]) AND jsonb_typeof(s->'value') = 'string' THEN NULL ELSE s->'value' END,
            s->'qualifiers'
       FROM ${next('wikidata_entities')} e
      CROSS JOIN LATERAL jsonb_each(e.entity->'claims') AS c(property, statements)
      CROSS JOIN LATERAL jsonb_array_elements(c.statements) AS s
      WHERE e.id LIKE 'Q%' AND c.property = ANY($1::text[]) AND ${at}`);
  // The languages of either term object. `->` and `||` bind alike and from
  // the left, so each object is bracketed before the merge, or it reads as
  // `(labels || entity)->'descriptions'`: the description languages alone.
  await inParts(signal, parts, [], at =>
    `INSERT INTO ${next('wikidata_labels')} (id, language, label, description)
     SELECT e.id, k.language, e.entity->'labels'->>k.language, e.entity->'descriptions'->>k.language
       FROM ${next('wikidata_entities')} e
      CROSS JOIN LATERAL jsonb_object_keys((e.entity->'labels') || (e.entity->'descriptions')) AS k(language)
      WHERE ${at}`);
  await inParts(signal, parts, [], at =>
    `INSERT INTO ${next('wikidata_sitelinks')} (id, site, title)
     SELECT e.id, l.site, l.title
       FROM ${next('wikidata_entities')} e
      CROSS JOIN LATERAL jsonb_each_text(e.entity->'sitelinks') AS l(site, title)
      WHERE ${at}`);
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
    await client.query(`DROP TABLE IF EXISTS ${RESUME_TABLE}, ${PIECES_TABLE}`);
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
