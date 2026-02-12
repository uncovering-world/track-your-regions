/**
 * Experience Visit Controller
 *
 * Authenticated endpoints for tracking user visited experiences.
 */

import { Response } from 'express';
import { pool } from '../../db/index.js';
import type { AuthenticatedRequest } from '../../middleware/auth.js';

/**
 * Get current user's visited experiences
 * GET /api/users/me/visited-experiences
 */
export async function getVisitedExperiences(req: AuthenticatedRequest, res: Response): Promise<void> {
  const userId = req.user?.id;
  if (!userId) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  const categoryId = req.query.categoryId ? parseInt(String(req.query.categoryId)) : null;
  const limit = Math.min(parseInt(String(req.query.limit)) || 100, 500);
  const offset = parseInt(String(req.query.offset)) || 0;

  let query = `
    SELECT
      uve.id as visit_id,
      uve.visited_at,
      uve.notes,
      uve.rating,
      e.id,
      e.name,
      e.short_description,
      e.category,
      e.country_names,
      e.image_url,
      ST_X(e.location) as longitude,
      ST_Y(e.location) as latitude,
      s.name as category_name
    FROM user_visited_experiences uve
    JOIN experiences e ON uve.experience_id = e.id
    JOIN experience_categories s ON e.category_id = s.id
    WHERE uve.user_id = $1
  `;

  const params: (number | string)[] = [userId];
  let paramIndex = 2;

  if (categoryId) {
    query += ` AND e.category_id = $${paramIndex++}`;
    params.push(categoryId);
  }

  query += ` ORDER BY uve.visited_at DESC LIMIT $${paramIndex++} OFFSET $${paramIndex}`;
  params.push(limit, offset);

  const result = await pool.query(query, params);

  // Get total count
  let countQuery = 'SELECT COUNT(*) FROM user_visited_experiences uve JOIN experiences e ON uve.experience_id = e.id WHERE uve.user_id = $1';
  const countParams: number[] = [userId];
  if (categoryId) {
    countQuery += ' AND e.category_id = $2';
    countParams.push(categoryId);
  }
  const countResult = await pool.query(countQuery, countParams);

  res.json({
    visited: result.rows,
    total: parseInt(countResult.rows[0].count),
    limit,
    offset,
  });
}

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

  // Verify experience exists
  const expResult = await pool.query('SELECT id, name FROM experiences WHERE id = $1', [experienceId]);
  if (expResult.rows.length === 0) {
    res.status(404).json({ error: 'Experience not found' });
    return;
  }

  // Upsert visited record
  const result = await pool.query(`
    INSERT INTO user_visited_experiences (user_id, experience_id, notes, rating, visited_at)
    VALUES ($1, $2, $3, $4, NOW())
    ON CONFLICT (user_id, experience_id) DO UPDATE SET
      notes = COALESCE($3, user_visited_experiences.notes),
      rating = COALESCE($4, user_visited_experiences.rating),
      visited_at = NOW()
    RETURNING id, visited_at, notes, rating
  `, [userId, experienceId, notes, rating]);

  res.json({
    success: true,
    experienceId,
    experienceName: expResult.rows[0].name,
    ...result.rows[0],
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

  res.json({ success: true, experienceId });
}

/**
 * Update visit notes/rating
 * PATCH /api/users/me/visited-experiences/:experienceId
 */
export async function updateVisit(req: AuthenticatedRequest, res: Response): Promise<void> {
  const userId = req.user?.id;
  if (!userId) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  const experienceId = parseInt(String(req.params.experienceId));
  const notes = req.body.notes !== undefined ? (req.body.notes ? String(req.body.notes) : null) : undefined;
  const rating = req.body.rating !== undefined ? (req.body.rating ? parseInt(String(req.body.rating)) : null) : undefined;

  // Validate rating if provided
  if (rating !== undefined && rating !== null && (rating < 1 || rating > 5)) {
    res.status(400).json({ error: 'Rating must be between 1 and 5' });
    return;
  }

  // Build update query
  const updates: string[] = [];
  const params: (number | string | null)[] = [userId, experienceId];
  let paramIndex = 3;

  if (notes !== undefined) {
    updates.push(`notes = $${paramIndex++}`);
    params.push(notes);
  }
  if (rating !== undefined) {
    updates.push(`rating = $${paramIndex++}`);
    params.push(rating);
  }

  if (updates.length === 0) {
    res.status(400).json({ error: 'No updates provided' });
    return;
  }

  const result = await pool.query(`
    UPDATE user_visited_experiences
    SET ${updates.join(', ')}
    WHERE user_id = $1 AND experience_id = $2
    RETURNING id, visited_at, notes, rating
  `, params);

  if (result.rowCount === 0) {
    res.status(404).json({ error: 'Visit record not found' });
    return;
  }

  res.json({
    success: true,
    experienceId,
    ...result.rows[0],
  });
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

  const categoryId = req.query.categoryId ? parseInt(String(req.query.categoryId)) : null;

  let query = `
    SELECT uve.experience_id
    FROM user_visited_experiences uve
  `;

  const params: number[] = [userId];

  if (categoryId) {
    query += `
      JOIN experiences e ON uve.experience_id = e.id
      WHERE uve.user_id = $1 AND e.category_id = $2
    `;
    params.push(categoryId);
  } else {
    query += ' WHERE uve.user_id = $1';
  }

  const result = await pool.query(query, params);

  res.json({
    visitedIds: result.rows.map(r => r.experience_id),
    total: result.rows.length,
  });
}
