/**
 * The table the OpenStreetMap layer is kept in (ADR-0134), and how a build
 * swaps a new one in. osm2pgsql creates and loads the `_next` copy itself
 * (`layer.lua`); the build gives it the live table's key and indexes and
 * swaps it in whole with the record of the build, as the Wikivoyage usage is
 * kept (`usageTables.ts`), so a reader never sees half a layer.
 */

import type { PoolClient } from 'pg';
import { pool } from '../../../db/index.js';
import { inWorkbench } from '../../../db/workbench.js';
import type { CopyNeeds } from '../wikidata/buildRules.js';
import { cancellable, indexesOf } from '../wikidata/subsetTables.js';

const TABLE = 'osm_objects';
/** The name osm2pgsql creates the copy under, in the workbench schema (`OSM_LAYER_TABLE`). */
export const NEXT_TABLE = `${TABLE}_next`;
const NEXT = inWorkbench(NEXT_TABLE);
/** What osm2pgsql leaves beside its tables: the settings of its import, which a layer that is never updated in place does not need. */
const PROPERTIES = inWorkbench('osm2pgsql_properties');

/**
 * osm2pgsql's node store, under the build's prefix (`--prefix=osm_layer_middle`):
 * `--drop` removes it only when a load ends well.
 */
export const MIDDLE_PREFIX = 'osm_layer_middle';
const MIDDLE = ['nodes', 'ways', 'rels', 'users'].map(part => inWorkbench(`${MIDDLE_PREFIX}_${part}`));

/** Drop the `_next` copy and what osm2pgsql left beside it: a build that failed or was cancelled leaves nothing behind. */
export async function dropNextTable(): Promise<void> {
  await pool.query(`DROP TABLE IF EXISTS ${[NEXT, PROPERTIES, ...MIDDLE].join(', ')}`);
}

/** Drop the record osm2pgsql leaves of its import once the copy is loaded. */
export async function dropImportProperties(): Promise<void> {
  await pool.query(`DROP TABLE IF EXISTS ${PROPERTIES}`);
}

/** How many objects the `_next` copy holds. */
export async function nextTableCount(): Promise<number> {
  const result = await pool.query<{ objects: string }>(`SELECT count(*) AS objects FROM ${NEXT}`);
  return Number(result.rows[0].objects);
}

/** Give the `_next` copy the live table's key and indexes, under the live names with `_next` appended. */
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

export interface LayerRecord {
  buildId: number;
  planetFile: string;
  dumpDate: string;
  /** The replication timestamp the planet was current to, as an ISO instant. */
  replicatedAt: string;
  objects: number;
  pinned: number;
  /** How many of the objects the catalogue names the planet no longer holds. */
  pinnedGone: number;
}

/**
 * Swap the `_next` copy in and record the build, in one transaction. A cancel
 * that arrived while the swap was being made rolls it back, and the layer in
 * place stays.
 */
export async function swapIn(record: LayerRecord, signal: AbortSignal): Promise<void> {
  const client: PoolClient = await pool.connect();
  try {
    await client.query('BEGIN');
    const indexes = await indexesOf(client, TABLE);
    await client.query(`DROP TABLE ${inWorkbench(TABLE)}`);
    await client.query(`ALTER TABLE ${NEXT} RENAME TO ${TABLE}`);
    for (const index of indexes) await client.query(`ALTER INDEX ${inWorkbench(index.name + '_next')} RENAME TO ${index.name}`);
    await client.query(
      `INSERT INTO osm_layer_builds (build_id, planet_file, dump_date, replicated_at, objects, pinned, pinned_gone)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [record.buildId, record.planetFile, record.dumpDate, record.replicatedAt, record.objects, record.pinned, record.pinnedGone],
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
 * The instant the layer in place is current to, or null where none is: the
 * one statement of "the layer in place" the schedule and the layer's door both
 * read (`layerSchedule.ts`, `sync/osm/localOsm.ts`).
 */
export async function layerCurrentTo(): Promise<Date | null> {
  const result = await pool.query<{ replicated_at: Date }>('SELECT replicated_at FROM osm_layer_builds ORDER BY swapped_at DESC LIMIT 1');
  return result.rows[0]?.replicated_at ?? null;
}

/** The layer in place, if any: its planet's date and when it was swapped in. */
export async function latestLayer(): Promise<{ dumpDate: string; swappedAt: Date; needs: CopyNeeds } | null> {
  const result = await pool.query<{ dump_date: string; swapped_at: Date }>(
    `SELECT to_char(dump_date, 'YYYY-MM-DD') AS dump_date, swapped_at FROM osm_layer_builds
      ORDER BY swapped_at DESC LIMIT 1`,
  );
  const row = result.rows[0];
  return row ? { dumpDate: row.dump_date, swappedAt: row.swapped_at, needs: 'nothing' } : null;
}
