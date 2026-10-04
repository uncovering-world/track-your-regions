/**
 * Which unread point is the object's own coordinate moving — one rule, asked by
 * the publish and by the queue alike.
 *
 * A gated run that finds an object somewhere else says so twice: it holds the
 * object's `location` as a field of the proposal, and it writes the moved point
 * as an unread row that names the stored pin it replaces (`locationWriter.ts`).
 * To a curator that is one move (#1233). The publish takes the point along when
 * it writes the coordinate (`pointMovedWithObject`, `publishContents.ts`), and
 * the queue names the same point on the card (`queryContents`,
 * `reviewQueueContents.ts`), and a no to the coordinate turns the same point
 * down (`pointMovedToProposed`, `declineHeldController.ts`) — so the row the card
 * marks is the row either answer takes, by construction rather than by copies of
 * a rule agreeing.
 */

import type { PoolClient } from 'pg';
import type { LockedExperience } from '../../db/experienceWriter.js';
import { offeredLocationSql } from '../../db/readerPredicates.js';
import { LOCATION_UNCHANGED_METERS } from '@tyr/shared/moves';
import { unreadPointSql } from './waitingCounts.js';

/**
 * The id of the unread offered point that replaces a pin still offered and sits
 * within `LOCATION_UNCHANGED_METERS` of `point` (ADR-0027: within it, two
 * coordinates are one place), as a scalar subquery — NULL where none does.
 *
 * The distance is what ties the point to the object's coordinate rather than to
 * a component's: on a serial site a component may move while the site's own
 * point does not, and then no point answers. Two arrivals within the distance
 * are a rare double write, ordered nearest first and then by id.
 *
 * `experienceId` and `point` are SQL expressions: the experience's id, and a
 * geometry in SRID 4326 — the object's coordinate as just written, or the one a
 * held proposal offers.
 */
export function pointMovedToSql(experienceId: string, point: string): string {
  return `(SELECT arrival.id
             FROM experience_locations arrival
            WHERE arrival.experience_id = ${experienceId}
              AND ${unreadPointSql('arrival')} AND ${offeredLocationSql('arrival')}
              AND EXISTS (SELECT 1 FROM experience_locations replaced
                           WHERE replaced.id = arrival.withdrawal_deferred_for_location_id
                             AND ${offeredLocationSql('replaced')})
              AND ST_DWithin(arrival.location::geography, (${point})::geography, ${LOCATION_UNCHANGED_METERS})
            ORDER BY ST_Distance(arrival.location::geography, (${point})::geography), arrival.id
            LIMIT 1)`;
}

/**
 * The unread point that is the move a held `location` proposes, or null: the
 * rule above, asked of the proposed coordinate rather than of one already
 * written. A refusal of the coordinate refuses this point with it, so a no to
 * the move is one answer as a yes is (#1233). `proposed` is the changeset's
 * `new` for the field; anything that is not a coordinate answers null.
 */
export async function pointMovedToProposed(
  client: PoolClient, lock: LockedExperience, proposed: unknown,
): Promise<number | null> {
  const at = proposed as { lon?: unknown; lat?: unknown } | null;
  if (typeof at?.lon !== 'number' || typeof at?.lat !== 'number') return null;
  const found = await client.query<{ id: number | null }>(
    `SELECT ${pointMovedToSql('$1::int', 'ST_SetSRID(ST_MakePoint($2::float8, $3::float8), 4326)')} AS id`,
    [lock.id, at.lon, at.lat],
  );
  return found.rows[0]?.id ?? null;
}
