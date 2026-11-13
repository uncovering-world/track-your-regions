/**
 * Experience Visit Controller
 *
 * Authenticated endpoints for tracking user visited experiences.
 */

import type { z } from 'zod/v4';
import type {
  ExperienceVisitMarked, ExperienceVisitUnmarked, TickedPlace, VisitedExperienceIds,
} from '../../api/responses/visited.js';
import { pool } from '../../db/index.js';
import type { ExperiencesRow, UserVisitedExperiencesRow } from '../../db/schema.generated.js';
import { claimablePlaceSql } from '../../db/readerPredicates.js';
import { placeHasKindSql } from '../../db/membership.js';
import {
  placeAtWriteSql, removedVisitsOf, removeVisits, showsOwnPointSql, showsPartsSql, tickedPlaceJsonSql, visitStatesSql,
} from '../../db/visits.js';
import { computeVisitedStatus } from '@tyr/shared/visits';
import { notFound } from '../../middleware/errorHandler.js';
import type { experienceIdParamSchema, markVisitedBodySchema, visitedIdsQuerySchema } from '../../types/index.js';

type ExperienceParams = z.output<typeof experienceIdParamSchema>;

/**
 * Mark experience as visited
 * POST /api/users/me/visited-experiences/:experienceId
 */
export async function markVisited(
  { params: { experienceId }, body, caller }: {
    params: ExperienceParams;
    body: z.output<typeof markVisitedBodySchema>;
    caller: Express.User;
  },
): Promise<ExperienceVisitMarked> {
  const userId = caller.id;
  const notes = body.notes || null;
  const rating = body.rating ?? null;

  // Verify the experience exists *and* is one this reader could have been
  // shown — `experienceOfferedToReaderSql`, the same predicate the other
  // experience-level claim-writer (`markNewBadgesSeen`) carries and the
  // experience-level half of what `markLocationVisited` carries. Both halves
  // matter and for the same reason (#520): a row that is unread, or that this
  // catalogue turned down, is on no list this caller could have seen, so a POST
  // naming its id is a guess rather than an action on something they were
  // shown. Without the pair this handler echoes the row's name back below, and
  // the visit it writes outlives the catalogue's verdict by design (ADR-0022),
  // so nothing would ever clear it.
  //
  // Gating the write does not touch that exemption: a visit already recorded
  // stays a visit after a refusal.
  //
  // A part of a serial site is a place a traveller visits (ADR-0100 decision
  // 5): offered where its whole is. The whole reads it from the part (#2120).
  const expResult = await pool.query<Pick<ExperiencesRow, 'name'> & { ticked: TickedPlace }>(
    `SELECT e.id, e.name, ${tickedPlaceJsonSql('e')} AS ticked FROM experiences e WHERE e.id = $1 AND ${claimablePlaceSql()}`,
    [experienceId],
  );
  if (expResult.rows.length === 0) throw notFound('Experience not found');

  // Upsert visited record, on the place as it stands when the row is
  // written: a share lock on it waits for a merge folding it to commit, and a
  // folded place takes no visit (#2120). Only a visit the tick made answers
  // the place in `ticked`, as for "Mark all": a tick that renews one, as from
  // a stale tab, offers no date for a visit the traveller already had.
  const result = await pool.query<Pick<UserVisitedExperiencesRow, 'id' | 'marked_at' | 'notes' | 'rating'> & { inserted: boolean }>(`
    INSERT INTO user_visited_experiences (user_id, experience_id, notes, rating, marked_at)
    ${placeAtWriteSql('$2', '$1, e.id, $3, $4, NOW()')}
    ON CONFLICT (user_id, experience_id) DO UPDATE SET
      notes = COALESCE($3, user_visited_experiences.notes),
      rating = COALESCE($4, user_visited_experiences.rating),
      marked_at = NOW()
    RETURNING id, marked_at, notes, rating, (xmax = 0) AS inserted
  `, [userId, experienceId, notes, rating]);

  if (result.rows.length === 0) throw notFound('Experience not found');
  const visit = result.rows[0];
  return {
    success: true,
    experienceId,
    experienceName: expResult.rows[0].name,
    id: visit.id,
    marked_at: visit.marked_at?.toISOString() ?? null,
    notes: visit.notes,
    rating: visit.rating,
    ticked: visit.inserted ? [expResult.rows[0].ticked] : [],
  };
}

/**
 * Unmark experience as visited
 * DELETE /api/users/me/visited-experiences/:experienceId
 *
 * The place's own visit only. A whole's parts were ticked one by one, some of
 * them in regions the traveller is not looking at, so taking back the whole's
 * own tick leaves them (#2120); its card's *Unmark all* clears them. Only a
 * place a reader may be shown: a stale page never clears the visit on a place
 * since folded or refused, which no click reaches.
 */
export async function unmarkVisited(
  { params: { experienceId }, caller }: { params: ExperienceParams; caller: Express.User },
): Promise<ExperienceVisitUnmarked> {
  // The place read as its visit is locked, under a share lock, as every visit
  // write reads what it writes for: a merge folding it commits first, and a
  // folded place's visit, which the merge copied onto the survivor, stays
  // (#2120). The visit goes with its trips, which the answer carries so the
  // untick can be undone in place (#2120).
  const visit = `SELECT v.id FROM user_visited_experiences v
      JOIN (${placeAtWriteSql('$2', 'e.id', claimablePlaceSql())}) pl ON v.experience_id = pl.id
     WHERE v.user_id = $1 FOR UPDATE OF v`;
  const rows = await removeVisits(visit, [caller.id, experienceId]);
  return { success: true, experienceId, removed: removedVisitsOf(rows) };
}

/**
 * Get visited experience IDs for quick lookup
 * GET /api/users/me/visited-experiences/ids
 *
 * Every place the reader has a state in, read one way for Map mode and
 * Discover alike (`visitStatesSql`, `computeVisitedStatus`): `visitedIds`
 * holds the places visited or partly visited, `partialIds` the partly
 * visited among them. Haghpat and Sanahin with two of its three monasteries
 * visited is in both. `wholeTickedIds` holds the wholes ticked as a whole,
 * which the whole's card offers to take back.
 */
export async function getVisitedIds(
  { query: { kindId }, caller }: { query: z.output<typeof visitedIdsQuerySchema>; caller: Express.User },
): Promise<VisitedExperienceIds> {
  const result = await pool.query<{
    place_id: number; ticked: boolean; total: number; visited: number; has_parts: boolean; has_own_point: boolean;
  }>(`
    SELECT s.place_id, s.ticked, s.total, s.visited,
           ${showsPartsSql('s.place_id')} AS has_parts,
           ${showsOwnPointSql('s.place_id')} AS has_own_point
      FROM ${visitStatesSql('$1')} s
      ${kindId
        // In the kind by any of its memberships, not only the one its first
        // source brought (ADR-0084, #1245).
        ? `JOIN experiences e ON e.id = s.place_id WHERE ${placeHasKindSql('e', '$2')}`
        : ''}
  `, kindId ? [caller.id, kindId] : [caller.id]);

  const visitedIds: number[] = [];
  const partialIds: number[] = [];
  const wholeTickedIds: number[] = [];
  for (const row of result.rows) {
    const status = computeVisitedStatus(row.visited, row.total, row.ticked);
    if (status === 'not_visited') continue;
    visitedIds.push(row.place_id);
    if (status === 'partial') partialIds.push(row.place_id);
    // Not a whole showing a point of its own: there the tick is that point's.
    if (row.ticked && row.has_parts && !row.has_own_point) wholeTickedIds.push(row.place_id);
  }

  return { visitedIds, partialIds, wholeTickedIds, total: visitedIds.length };
}
