/**
 * How crowded a review card's city is (ADR-0180, #2282): for each card's
 * membership in a kind with the display rule, the kind's limit and radius,
 * how many places of its kind and type the crowded-city window would list
 * around it, whether the display shadows it, and, for a shadowed one, how many
 * the recount counted above it.
 *
 * The card offers "Squares around (22)" and says a shadowed place is shadowed
 * from this, so the window is read only when a curator opens it: a page of
 * cards each reading the window would spend the curator's request budget,
 * which the answers share, on reads nobody asked for.
 *
 * One statement per page, after the cards are built, over the page's
 * memberships only. The count goes through the window's own predicate
 * (`aroundSql`), so the button's number is the window's. The count above a
 * shadowed place is the one the recount stored (`membership_crowding`), not
 * `crowding_better()` again: on dev that took 100 of the 125 ms a page of
 * fifty Roman churches cost, testing each place within 10 km for works.
 * No `crowding` for a kind with no rule, a type it exempts, a place holding a
 * work a reader is shown (always shown, ADR-0173) or a place with no point.
 */

import type { ReviewQueueItem } from '../../api/responses/reviewQueue.js';
import { pool } from '../../db/index.js';
import { CROWDING, KINDS, MEMBERSHIPS, membershipCrowdedSql } from '../../db/membership.js';
import { CURATOR_SCOPED_REGIONS_CTE } from '../../middleware/auth.js';
import { aroundSql } from './crowdingWindow.js';

interface CrowdingRow {
  membership_id: number;
  crowding_limit: number;
  radius_km: number;
  around: number;
  shadowed: boolean;
  outranked_by: number | null;
}

/** Each card's membership and how crowded its city is: `crowding` on every card, null where the rule does not reach it. */
export async function attachCrowding(
  items: readonly ReviewQueueItem[],
  caller: { userId: number; isAdmin: boolean },
): Promise<void> {
  const ids = [...new Set(items.flatMap(item => (item.membership_id == null ? [] : [item.membership_id])))];
  const found = new Map<number, NonNullable<ReviewQueueItem['crowding']>>();
  if (ids.length > 0) {
    // $1 the caller (the scope's prelude), $2 the page's memberships.
    const result = await pool.query<CrowdingRow>(`${CURATOR_SCOPED_REGIONS_CTE}
      SELECT c.id AS membership_id, k.crowding_limit, k.crowding_radius_km AS radius_km,
             around.places AS around,
             ${membershipCrowdedSql('c')} AS shadowed,
             (SELECT crowded.outranked_by FROM ${CROWDING} crowded WHERE crowded.membership_id = c.id) AS outranked_by
        FROM ${MEMBERSHIPS} c
        JOIN ${KINDS} k ON k.id = c.kind_id AND k.crowding_limit IS NOT NULL
        JOIN experiences ce ON ce.id = c.experience_id AND ce.location IS NOT NULL
        CROSS JOIN LATERAL (
          SELECT count(*)::int AS places
            FROM ${MEMBERSHIPS} m
            JOIN experiences e ON e.id = m.experience_id
           WHERE ${aroundSql(caller.isAdmin, { kind: 'c.kind_id', point: 'ce.location', radiusKm: 'k.crowding_radius_km' })}
             AND m.type IS NOT DISTINCT FROM c.type) around
       WHERE c.id = ANY($2::int[])
         AND NOT COALESCE(c.type = ANY(k.crowding_exempt_types), FALSE)
         AND NOT place_shows_works(ce.id)`,
    [caller.userId, ids]);
    for (const row of result.rows) {
      found.set(row.membership_id, {
        limit: row.crowding_limit,
        radiusKm: row.radius_km,
        around: row.around,
        shadowed: row.shadowed,
        outrankedBy: row.outranked_by,
      });
    }
  }
  for (const item of items) {
    item.crowding = item.membership_id == null ? null : found.get(item.membership_id) ?? null;
  }
}
