/**
 * Experience Visit Controller
 *
 * Authenticated endpoints for tracking user visited experiences.
 */

import type { z } from 'zod/v4';
import type { ExperienceVisitMarked, ExperienceVisitUnmarked, VisitedExperienceIds } from '../../api/responses/visited.js';
import { pool } from '../../db/index.js';
import type { ExperiencesRow, UserVisitedExperiencesRow } from '../../db/schema.generated.js';
import { experienceOfferedToReaderSql } from '../../db/readerPredicates.js';
import { rowKindJoinSql } from '../../db/membership.js';
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
  const expResult = await pool.query<Pick<ExperiencesRow, 'name'>>(
    `SELECT e.id, e.name FROM experiences e WHERE e.id = $1 AND ${experienceOfferedToReaderSql()}`,
    [experienceId],
  );
  if (expResult.rows.length === 0) throw notFound('Experience not found');

  // Upsert visited record
  const result = await pool.query<Pick<UserVisitedExperiencesRow, 'id' | 'visited_at' | 'notes' | 'rating'>>(`
    INSERT INTO user_visited_experiences (user_id, experience_id, notes, rating, visited_at)
    VALUES ($1, $2, $3, $4, NOW())
    ON CONFLICT (user_id, experience_id) DO UPDATE SET
      notes = COALESCE($3, user_visited_experiences.notes),
      rating = COALESCE($4, user_visited_experiences.rating),
      visited_at = NOW()
    RETURNING id, visited_at, notes, rating
  `, [userId, experienceId, notes, rating]);

  const visit = result.rows[0];
  return {
    success: true,
    experienceId,
    experienceName: expResult.rows[0].name,
    id: visit.id,
    visited_at: visit.visited_at?.toISOString() ?? null,
    notes: visit.notes,
    rating: visit.rating,
  };
}

/**
 * Unmark experience as visited
 * DELETE /api/users/me/visited-experiences/:experienceId
 */
export async function unmarkVisited(
  { params: { experienceId }, caller }: { params: ExperienceParams; caller: Express.User },
): Promise<ExperienceVisitUnmarked> {
  const result = await pool.query(
    'DELETE FROM user_visited_experiences WHERE user_id = $1 AND experience_id = $2 RETURNING id',
    [caller.id, experienceId]
  );

  if (result.rowCount === 0) throw notFound('Visit record not found');

  return { success: true, experienceId };
}

/**
 * Get visited experience IDs for quick lookup
 * GET /api/users/me/visited-experiences/ids
 */
export async function getVisitedIds(
  { query: { kindId }, caller }: { query: z.output<typeof visitedIdsQuerySchema>; caller: Express.User },
): Promise<VisitedExperienceIds> {
  const userId = caller.id;

  let query = `
    SELECT uve.experience_id
    FROM user_visited_experiences uve
  `;

  const params: number[] = [userId];

  if (kindId) {
    query += `
      JOIN experiences e ON uve.experience_id = e.id
      ${rowKindJoinSql('e')}
      WHERE uve.user_id = $1 AND m.kind_id = $2
    `;
    params.push(kindId);
  } else {
    query += ' WHERE uve.user_id = $1';
  }

  const result = await pool.query<Pick<UserVisitedExperiencesRow, 'experience_id'>>(query, params);

  return {
    visitedIds: result.rows.map(r => r.experience_id),
    total: result.rows.length,
  };
}
