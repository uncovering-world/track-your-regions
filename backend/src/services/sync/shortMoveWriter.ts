/**
 * A point a reader sees that its source moved a short way takes the new spot
 * without a curator (#1837, ADR-0140).
 *
 * Under a gated source a moved point is an unread arrival that holds the old
 * point's withdrawal until a curator publishes it (`locationWriter.ts`). Where
 * the move is short (`shortMovePassesSql`) and a curator had verified the old
 * point, this publishes the arrival as verified and ends the hold: the
 * curator's pass carries over a move nobody would notice. A point nobody
 * verified (`auto`) stays a question, since an arrival may only move from
 * `pending` to `verified` (ADR-0070), and that would claim a pass nobody gave.
 * The writer's withdrawal arm then marks the old point missing as it marks any
 * point the source no longer lists, and keeps it on the map while another
 * source still places it (ADR-0084). The old
 * point names the one it moved to (`moved_to_location_id`), so it raises no
 * question about where it went (`withdrawnPointOpenSql`), and a run that lists
 * the old spot again clears the pointer.
 *
 * Only an arrival under the reference of the point it holds is a move: an
 * arrival paired by position alone is a renumbering, and stays a question.
 * And only of a point the arriving membership placed as its own: a point it
 * adopted from another source (ADR-0137) is that source's to move. A
 * coordinate a curator claimed is the claim's (ADR-0029), and an arrival a
 * curator turned down stays turned down.
 */

import type { PoolClient } from 'pg';
import { shortMovePassesSql } from '../../db/shortMove.js';
import type { ContentItemChange } from './types.js';

/** One point that took its short move: the stored point, and the coordinate it moved to. */
export interface ShortMove {
  name: string | null;
  externalRef: string | null;
  from: { lon: number; lat: number };
  to: { lon: number; lat: number };
}

/**
 * Publish the arrivals in `arrivals` that are short moves of the visible point
 * they hold, and answer the moves. Runs on the location writer's client, under
 * the place's lock, after the arrivals have taken their holds.
 */
export async function settleShortMoves(
  client: PoolClient,
  placeId: number,
  arrivals: readonly number[],
): Promise<ShortMove[]> {
  const result = await client.query<{
    name: string | null; external_ref: string | null;
    old_lon: number; old_lat: number; new_lon: number; new_lat: number;
  }>(
    `WITH moves AS (
       SELECT arrived.id AS new_id, old.id AS old_id
         FROM experience_locations arrived
         JOIN experience_locations old ON old.id = arrived.withdrawal_deferred_for_location_id
        WHERE arrived.id = ANY($2::int[])
          AND arrived.curation_state = 'pending' AND arrived.refused_at IS NULL
          AND old.curation_state = 'verified'
          AND old.external_ref IS NOT NULL AND old.external_ref = arrived.external_ref
          AND NOT old.curated_fields ? 'location'
          -- The membership that places the arrival placed the old point as
          -- its own, not adopted from another source under another
          -- reference (ADR-0137): another source's point is never moved
          -- by this one's run.
          AND EXISTS (SELECT 1 FROM experience_location_placements own
                        JOIN experience_location_placements came ON came.membership_id = own.membership_id
                       WHERE own.location_id = old.id AND own.adopted_ref IS NULL
                         AND came.location_id = arrived.id)
          AND ${shortMovePassesSql('$1::int', 'old.location', 'arrived.location')}
     ), published AS (
       UPDATE experience_locations arrived
          SET curation_state = 'verified', withdrawal_deferred_for_location_id = NULL
         FROM moves
        WHERE arrived.id = moves.new_id
       RETURNING arrived.id, arrived.location
     )
     UPDATE experience_locations old
        SET moved_to_location_id = published.id
       FROM moves JOIN published ON published.id = moves.new_id
      WHERE old.id = moves.old_id
     RETURNING old.name, old.external_ref,
               ST_X(old.location) AS old_lon, ST_Y(old.location) AS old_lat,
               ST_X(published.location) AS new_lon, ST_Y(published.location) AS new_lat`,
    [placeId, arrivals],
  );
  return result.rows.map(row => ({
    name: row.name,
    externalRef: row.external_ref,
    from: { lon: Number(row.old_lon), lat: Number(row.old_lat) },
    to: { lon: Number(row.new_lon), lat: Number(row.new_lat) },
  }));
}

/**
 * A short move as the run records it: the point, named as it was, with its
 * coordinate written past the gate and saying why.
 */
export function shortMoveChange(move: ShortMove): ContentItemChange {
  return {
    item: { name: move.name, ref: move.externalRef },
    fields: [{
      field: 'location', old: move.from, new: move.to, significance: 'minor',
      curatedConflict: false, held: false, passedTheGate: 'short-move',
    }],
  };
}
