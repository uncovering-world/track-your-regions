/**
 * The works other kinds refused as held at a place, read once per run of a
 * works kind (ADR-0102).
 *
 * Public Art refuses the Bamberg Horseman as "inside Bamberg Cathedral" and
 * records where it found it held (`experience_hand_overs`, `recordHandOvers`),
 * whether or not it ever held the horseman as a row. The places of worship,
 * which admit the cathedral, take the horseman in their venue-side read
 * (`venueSide.ts`). The hand-over is a read of another kind's recorded refusal,
 * never a write into another kind's rows, so each kind's run stays the one
 * writer of what it shows (ADR-0084).
 */

import { pool } from '../../db/index.js';
import { KINDS } from '../../db/membership.js';
import type { FilteredEntity } from './syncContract.js';
import type { HandOver } from './museum/venueSide.js';

/**
 * Record what this run refused as another place's (ADR-0102), and the works
 * part of which another place holds although it did not refuse them as that
 * place's (`FetchResult.handOvers`, #2036),
 * replacing the source's set: called once the run's fetch has answered whole, so a work it
 * no longer refuses this way leaves the set. Nothing on a dry run.
 */
export async function recordHandOvers(
  sourceId: number, filtered: FilteredEntity[], syncLogId: number | null, dryRun: boolean,
): Promise<number> {
  if (dryRun) return 0;
  const held = filtered.filter((entity) => entity.heldIn?.length);
  // One text per row, since UNNEST flattens an array of arrays: the chain
  // joined by spaces, which no item id holds.
  const result = await pool.query(
    `WITH named AS (
       SELECT * FROM UNNEST($2::text[], $3::text[], $4::text[], $5::text[]) AS n(external_id, name, reason, held_in)
     ), dropped AS (
       DELETE FROM experience_hand_overs h
        WHERE h.source_id = $1 AND NOT EXISTS (SELECT 1 FROM named WHERE named.external_id = h.external_id)
     )
     INSERT INTO experience_hand_overs (source_id, external_id, name, reason, held_in, sync_log_id, recorded_at)
     SELECT $1, external_id, name, reason, string_to_array(held_in, ' '), $6, NOW() FROM named
     ON CONFLICT (source_id, external_id) DO UPDATE
       SET name = EXCLUDED.name, reason = EXCLUDED.reason, held_in = EXCLUDED.held_in,
           sync_log_id = EXCLUDED.sync_log_id, recorded_at = EXCLUDED.recorded_at`,
    [
      sourceId,
      held.map((entity) => entity.externalId),
      held.map((entity) => entity.name),
      held.map((entity) => entity.reason),
      held.map((entity) => entity.heldIn!.join(' ')),
      syncLogId,
    ],
  );
  return result.rowCount ?? 0;
}

/** Every work another source refused as held at a place, by its item id. `sourceId` is the reading run's own. */
export async function readHandOvers(sourceId: number): Promise<Map<string, HandOver>> {
  const result = await pool.query<{ external_id: string; kind: string; reason: string; held_in: string[] }>(
    `SELECT h.external_id, k.name AS kind, h.reason, h.held_in
       FROM experience_hand_overs h
       JOIN experience_sources s ON s.id = h.source_id
       JOIN ${KINDS} k ON k.id = s.kind_id
      WHERE h.source_id <> $1`,
    [sourceId],
  );
  return new Map(result.rows.map((row) => [
    row.external_id,
    { by: row.kind, reason: row.reason, heldIn: row.held_in },
  ]));
}
