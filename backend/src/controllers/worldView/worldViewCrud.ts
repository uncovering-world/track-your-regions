/**
 * World Views CRUD operations
 */

import { Request, Response } from 'express';
import { pool } from '../../db/index.js';
import { notFound } from '../../middleware/errorHandler.js';

/**
 * Get all World Views (including default GADM)
 */
export async function getWorldViews(_req: Request, res: Response): Promise<void> {
  const result = await pool.query(`
    SELECT id, name, description, source, is_default as "isDefault"
    FROM world_views
    WHERE is_active = true
    ORDER BY is_default DESC, name
  `);

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
     RETURNING id, name, description, source, is_default as "isDefault"`,
    [name, description || null, source || null]
  );

  res.status(201).json(result.rows[0]);
}

/**
 * Update a World View
 */
export async function updateWorldView(req: Request, res: Response): Promise<void> {
  const worldViewId = parseInt(String(req.params.worldViewId));
  const { name, description, source } = req.body;

  const result = await pool.query(
    `UPDATE world_views
     SET name = COALESCE($1, name),
         description = COALESCE($2, description),
         source = COALESCE($3, source),
         updated_at = NOW()
     WHERE id = $4
     RETURNING id, name, description, source, is_default as "isDefault"`,
    [name || null, description || null, source || null, worldViewId]
  );

  if (result.rows.length === 0) {
    throw notFound(`World View ${worldViewId} not found`);
  }

  res.json(result.rows[0]);
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
