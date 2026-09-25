/**
 * Experience Visit Controller
 *
 * Authenticated endpoints for tracking user visited experiences.
 */

import { Response } from 'express';
import { respond } from '../../api/respond.js';
import { ExperienceVisitMarked, ExperienceVisitUnmarked, VisitedExperienceIds } from '../../api/responses/visited.js';
import { pool } from '../../db/index.js';
import type { ExperiencesRow, UserVisitedExperiencesRow } from '../../db/schema.generated.js';
import { experienceOfferedToReaderSql } from './experienceLifecycle.js';
import { rowKindJoinSql } from '../../db/membership.js';
import type { AuthenticatedRequest } from '../../middleware/auth.js';

/**
 * Mark experience as visited
 * POST /api/users/me/visited-experiences/:experienceId
 */
export async function markVisited(req: AuthenticatedRequest, res: Response): Promise<void> {
  const userId = req.user?.id;
  if (!userId) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  const experienceId = parseInt(String(req.params.experienceId));
  const notes = req.body.notes ? String(req.body.notes) : null;
  const rating = req.body.rating ? parseInt(String(req.body.rating)) : null;

  // Validate rating if provided
  if (rating !== null && (rating < 1 || rating > 5)) {
    res.status(400).json({ error: 'Rating must be between 1 and 5' });
    return;
  }

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
  if (expResult.rows.length === 0) {
    res.status(404).json({ error: 'Experience not found' });
    return;
  }

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
  respond(res, ExperienceVisitMarked, {
    success: true,
    experienceId,
    experienceName: expResult.rows[0].name,
    id: visit.id,
    visited_at: visit.visited_at?.toISOString() ?? null,
    notes: visit.notes,
    rating: visit.rating,
  });
}

/**
 * Unmark experience as visited
 * DELETE /api/users/me/visited-experiences/:experienceId
 */
export async function unmarkVisited(req: AuthenticatedRequest, res: Response): Promise<void> {
  const userId = req.user?.id;
  if (!userId) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  const experienceId = parseInt(String(req.params.experienceId));

  const result = await pool.query(
    'DELETE FROM user_visited_experiences WHERE user_id = $1 AND experience_id = $2 RETURNING id',
    [userId, experienceId]
  );

  if (result.rowCount === 0) {
    res.status(404).json({ error: 'Visit record not found' });
    return;
  }

  respond(res, ExperienceVisitUnmarked, { success: true, experienceId });
}

/**
 * Get visited experience IDs for quick lookup
 * GET /api/users/me/visited-experiences/ids
 */
export async function getVisitedIds(req: AuthenticatedRequest, res: Response): Promise<void> {
  const userId = req.user?.id;
  if (!userId) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  const kindId = req.query.kindId ? parseInt(String(req.query.kindId)) : null;

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

  respond(res, VisitedExperienceIds, {
    visitedIds: result.rows.map(r => r.experience_id),
    total: result.rows.length,
  });
}
