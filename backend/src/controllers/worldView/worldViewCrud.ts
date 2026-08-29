/**
 * World Views CRUD operations
 */

import { Request, Response } from 'express';
import type { AuthenticatedRequest } from '../../middleware/auth.js';
import { pool } from '../../db/index.js';
import { notFound } from '../../middleware/errorHandler.js';

/**
 * Get all World Views visible to the caller.
 *
 * Non-admins see only published (`is_public`) world views. The filter lives here
 * rather than in the client so a hidden world view is not merely absent from a
 * dropdown — it is absent from the response.
 */
export async function getWorldViews(req: AuthenticatedRequest, res: Response): Promise<void> {
  // The rows depend on who is asking. The headers that keep a shared cache
  // from serving an admin's list to a visitor come from `optionalAuth` on the
  // route, as on every read whose answer is shaped by the caller.
  const isAdmin = req.user?.role === 'admin';
  const result = await pool.query(`
    SELECT id, name, description, source, is_default as "isDefault",
           is_public as "isPublic",
           COALESCE(tile_version, 0) as "tileVersion"
    FROM world_views
    WHERE is_active = true
      AND ($1::boolean OR is_public)
    ORDER BY is_default DESC, name
  `, [isAdmin]);

  res.json(result.rows);
}

/**
 * Create a new World View
 */
export async function createWorldView(req: Request, res: Response): Promise<void> {
  const { name, description, source } = req.body;

  const result = await pool.query(
    `INSERT INTO world_views (name, description, source, is_default, is_active)
     VALUES ($1, $2, $3, false, true)
     RETURNING id, name, description, source, is_default as "isDefault",
               is_public as "isPublic"`,
    [name, description || null, source || null]
  );

  res.status(201).json(result.rows[0]);
}

/**
 * Update a World View
 */
export async function updateWorldView(req: Request, res: Response): Promise<void> {
  const worldViewId = parseInt(String(req.params.worldViewId));
  const { name, description, source, isPublic } = req.body;

  const result = await pool.query(
    `UPDATE world_views
     SET name = COALESCE($1, name),
         description = COALESCE($2, description),
         source = COALESCE($3, source),
         is_public = COALESCE($4, is_public),
         updated_at = NOW()
     WHERE id = $5
     RETURNING id, name, description, source, is_default as "isDefault",
               is_public as "isPublic"`,
    // `?? null`, not `|| null`: false is a meaningful value here.
    [name || null, description || null, source || null, isPublic ?? null, worldViewId]
  );

  if (result.rows.length === 0) {
    throw notFound(`World View ${worldViewId} not found`);
  }

  res.json(result.rows[0]);
}

/**
 * Get a preview of what deleting a World View will destroy.
 * Returns counts of regions, experience-to-region assignments, and user visit
 * records so admins can see the blast radius before confirming deletion.
 */
export async function getDeleteImpact(req: Request, res: Response): Promise<void> {
  const worldViewId = parseInt(String(req.params.worldViewId));

  const check = await pool.query(
    'SELECT is_default FROM world_views WHERE id = $1',
    [worldViewId],
  );
  if (check.rows.length === 0) {
    throw notFound(`World View ${worldViewId} not found`);
  }

  const result = await pool.query(`
    SELECT
      (SELECT COUNT(*) FROM regions WHERE world_view_id = $1)::int AS region_count,
      (SELECT COUNT(*) FROM experience_regions er
       JOIN regions r ON r.id = er.region_id
       WHERE r.world_view_id = $1)::int AS experience_assignment_count,
      (SELECT COUNT(*) FROM user_visited_regions uvr
       JOIN regions r ON r.id = uvr.region_id
       WHERE r.world_view_id = $1)::int AS user_visit_count
  `, [worldViewId]);

  const row = result.rows[0];
  res.json({
    regionCount: row.region_count,
    experienceAssignmentCount: row.experience_assignment_count,
    userVisitCount: row.user_visit_count,
    isDefault: check.rows[0].is_default,
  });
}

/**
 * Delete a World View
 */
export async function deleteWorldView(req: Request, res: Response): Promise<void> {
  const worldViewId = parseInt(String(req.params.worldViewId));

  // Check if it's the default World View
  const check = await pool.query(
    'SELECT is_default FROM world_views WHERE id = $1',
    [worldViewId]
  );

  if (check.rows.length === 0) {
    throw notFound(`World View ${worldViewId} not found`);
  }

  if (check.rows[0].is_default) {
    res.status(400).json({ error: 'Cannot delete the default GADM World View' });
    return;
  }

  await pool.query('DELETE FROM world_views WHERE id = $1', [worldViewId]);

  res.status(204).send();
}
