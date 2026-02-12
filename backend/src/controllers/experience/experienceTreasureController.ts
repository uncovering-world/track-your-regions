/**
 * Experience Treasure Controller
 *
 * Treasure (artwork) browsing and viewed-treasure tracking.
 */

import { Request, Response } from 'express';
import { pool } from '../../db/index.js';
import type { AuthenticatedRequest } from '../../middleware/auth.js';

/**
 * Get contents (treasures) for an experience
 * GET /api/experiences/:id/treasures
 */
export async function getExperienceTreasures(req: Request, res: Response): Promise<void> {
  const experienceId = parseInt(String(req.params.id));

  const result = await pool.query(`
    SELECT
      t.id, t.external_id, t.name, t.treasure_type, t.artist, t.year,
      t.image_url, t.sitelinks_count, t.is_iconic
    FROM treasures t
    JOIN experience_treasures et ON t.id = et.treasure_id
    WHERE et.experience_id = $1
    ORDER BY t.sitelinks_count DESC
  `, [experienceId]);

  res.json({
    experienceId,
    treasures: result.rows,
    total: result.rows.length,
  });
}

/**
 * Get viewed treasure IDs for current user
 * GET /api/users/me/viewed-treasures/ids
 */
export async function getViewedTreasureIds(req: AuthenticatedRequest, res: Response): Promise<void> {
  const userId = req.user?.id;
  if (!userId) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  const experienceId = req.query.experienceId ? parseInt(String(req.query.experienceId)) : null;

  let query = `
    SELECT uvt.treasure_id
    FROM user_viewed_treasures uvt
  `;

  const params: number[] = [userId];

  if (experienceId) {
    query += `
      JOIN experience_treasures et ON uvt.treasure_id = et.treasure_id
      WHERE uvt.user_id = $1 AND et.experience_id = $2
    `;
    params.push(experienceId);
  } else {
    query += ' WHERE uvt.user_id = $1';
  }

  const result = await pool.query(query, params);

  res.json({
    viewedTreasureIds: result.rows.map(r => r.treasure_id),
  });
}

/**
 * Mark a treasure as viewed
 * POST /api/users/me/viewed-treasures/:treasureId
 * Body: { experienceId } — needed to auto-mark the venue as visited (treasure can be in multiple venues).
 * Also auto-marks the parent experience as visited.
 */
export async function markTreasureViewed(req: AuthenticatedRequest, res: Response): Promise<void> {
  const userId = req.user?.id;
  if (!userId) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  const treasureId = parseInt(String(req.params.treasureId));

  // Verify treasure exists
  const treasureResult = await pool.query(
    'SELECT id, name FROM treasures WHERE id = $1',
    [treasureId],
  );

  if (treasureResult.rows.length === 0) {
    res.status(404).json({ error: 'Treasure not found' });
    return;
  }

  const treasure = treasureResult.rows[0];

  // Insert viewed record
  await pool.query(`
    INSERT INTO user_viewed_treasures (user_id, treasure_id, viewed_at)
    VALUES ($1, $2, NOW())
    ON CONFLICT (user_id, treasure_id) DO NOTHING
  `, [userId, treasureId]);

  // If experienceId provided, auto-mark that venue as visited
  const experienceId = req.body.experienceId ? parseInt(String(req.body.experienceId)) : null;
  let experienceName: string | null = null;

  if (experienceId) {
    // Verify the treasure is linked to this experience
    const linkResult = await pool.query(
      'SELECT 1 FROM experience_treasures WHERE experience_id = $1 AND treasure_id = $2',
      [experienceId, treasureId],
    );
    if (linkResult.rows.length > 0) {
      await pool.query(`
        INSERT INTO user_visited_experiences (user_id, experience_id, visited_at)
        VALUES ($1, $2, NOW())
        ON CONFLICT (user_id, experience_id) DO NOTHING
      `, [userId, experienceId]);

      // Auto-mark all locations of the experience as visited
      await pool.query(`
        INSERT INTO user_visited_locations (user_id, location_id, visited_at)
        SELECT $1, el.id, NOW()
        FROM experience_locations el
        WHERE el.experience_id = $2
        ON CONFLICT (user_id, location_id) DO NOTHING
      `, [userId, experienceId]);

      const expResult = await pool.query('SELECT name FROM experiences WHERE id = $1', [experienceId]);
      experienceName = expResult.rows[0]?.name || null;
    }
  }

  res.json({
    success: true,
    treasureId,
    treasureName: treasure.name,
    experienceId,
    experienceName,
  });
}

/**
 * Unmark a treasure as viewed
 * DELETE /api/users/me/viewed-treasures/:treasureId
 * Does NOT unvisit the parent experience.
 */
export async function unmarkTreasureViewed(req: AuthenticatedRequest, res: Response): Promise<void> {
  const userId = req.user?.id;
  if (!userId) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  const treasureId = parseInt(String(req.params.treasureId));

  const result = await pool.query(
    'DELETE FROM user_viewed_treasures WHERE user_id = $1 AND treasure_id = $2 RETURNING id',
    [userId, treasureId]
  );

  if (result.rowCount === 0) {
    res.status(404).json({ error: 'Viewed record not found' });
    return;
  }

  res.json({ success: true, treasureId });
}
