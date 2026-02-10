/**
 * Curator Assignment Controller (Admin)
 *
 * CRUD operations for managing curator assignments.
 * All routes require admin authentication.
 */

import { Response } from 'express';
import { pool } from '../../db/index.js';
import type { AuthenticatedRequest } from '../../middleware/auth.js';

/**
 * List all curators with their scopes
 * GET /api/admin/curators
 */
export async function listCurators(_req: AuthenticatedRequest, res: Response): Promise<void> {
  const result = await pool.query(`
    SELECT
      u.id as user_id,
      u.display_name,
      u.email,
      u.role,
      u.avatar_url,
      json_agg(json_build_object(
        'id', ca.id,
        'scopeType', ca.scope_type,
        'regionId', ca.region_id,
        'regionName', r.name,
        'sourceId', ca.source_id,
        'sourceName', es.name,
        'assignedAt', ca.assigned_at,
        'notes', ca.notes
      ) ORDER BY ca.assigned_at DESC) as scopes
    FROM users u
    JOIN curator_assignments ca ON u.id = ca.user_id
    LEFT JOIN regions r ON ca.region_id = r.id
    LEFT JOIN experience_sources es ON ca.source_id = es.id
    WHERE u.role IN ('curator', 'admin')
    GROUP BY u.id, u.display_name, u.email, u.role, u.avatar_url
    ORDER BY u.display_name
  `);

  res.json(result.rows);
}

/**
 * Create a curator assignment
 * POST /api/admin/curators
 * Body: { userId, scopeType, regionId?, sourceId?, notes? }
 */
export async function createCuratorAssignment(req: AuthenticatedRequest, res: Response): Promise<void> {
  const { userId, scopeType, regionId, sourceId, notes } = req.body;
  const assignedBy = req.user!.id;

  if (!userId || !scopeType) {
    res.status(400).json({ error: 'userId and scopeType are required' });
    return;
  }

  if (!['region', 'source', 'global'].includes(scopeType)) {
    res.status(400).json({ error: 'scopeType must be region, source, or global' });
    return;
  }

  if (scopeType === 'region' && !regionId) {
    res.status(400).json({ error: 'regionId is required for region scope' });
    return;
  }

  if (scopeType === 'source' && !sourceId) {
    res.status(400).json({ error: 'sourceId is required for source scope' });
    return;
  }

  // Verify user exists
  const userResult = await pool.query('SELECT id, role FROM users WHERE id = $1', [userId]);
  if (userResult.rows.length === 0) {
    res.status(404).json({ error: 'User not found' });
    return;
  }

  // Verify region exists if scope is region
  if (scopeType === 'region') {
    const regionResult = await pool.query('SELECT id FROM regions WHERE id = $1', [regionId]);
    if (regionResult.rows.length === 0) {
      res.status(404).json({ error: 'Region not found' });
      return;
    }
  }

  // Verify source exists if scope is source
  if (scopeType === 'source') {
    const sourceResult = await pool.query('SELECT id FROM experience_sources WHERE id = $1', [sourceId]);
    if (sourceResult.rows.length === 0) {
      res.status(404).json({ error: 'Source not found' });
      return;
    }
  }

  // Insert assignment and promote role in a transaction
  await pool.query('BEGIN');
  try {
    const insertResult = await pool.query(`
      INSERT INTO curator_assignments (user_id, scope_type, region_id, source_id, assigned_by, notes)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id, assigned_at
    `, [userId, scopeType, regionId || null, sourceId || null, assignedBy, notes || null]);

    // Promote user to curator if currently 'user'
    const currentRole = userResult.rows[0].role;
    if (currentRole === 'user') {
      await pool.query("UPDATE users SET role = 'curator' WHERE id = $1", [userId]);
    }

    await pool.query('COMMIT');

    res.status(201).json({
      id: insertResult.rows[0].id,
      userId,
      scopeType,
      regionId: regionId || null,
      sourceId: sourceId || null,
      assignedAt: insertResult.rows[0].assigned_at,
      rolePromoted: currentRole === 'user',
    });
  } catch (error: unknown) {
    await pool.query('ROLLBACK');
    // Handle duplicate assignment
    if (error instanceof Error && 'code' in error && (error as { code: string }).code === '23505') {
      res.status(409).json({ error: 'This curator assignment already exists' });
      return;
    }
    throw error;
  }
}

/**
 * Revoke a curator assignment
 * DELETE /api/admin/curators/:assignmentId
 */
export async function revokeCuratorAssignment(req: AuthenticatedRequest, res: Response): Promise<void> {
  const assignmentId = parseInt(String(req.params.assignmentId));

  // Get assignment details before deletion
  const assignmentResult = await pool.query(
    'SELECT id, user_id FROM curator_assignments WHERE id = $1',
    [assignmentId],
  );

  if (assignmentResult.rows.length === 0) {
    res.status(404).json({ error: 'Assignment not found' });
    return;
  }

  const userId = assignmentResult.rows[0].user_id;

  // Delete assignment and check if role should revert, atomically
  await pool.query('BEGIN');
  try {
    await pool.query('DELETE FROM curator_assignments WHERE id = $1', [assignmentId]);

    // Check if user has any remaining assignments
    const remainingResult = await pool.query(
      'SELECT COUNT(*) as count FROM curator_assignments WHERE user_id = $1',
      [userId],
    );

    const remaining = parseInt(remainingResult.rows[0].count);
    let roleReverted = false;

    // Revert role to 'user' if no remaining assignments (and not admin)
    if (remaining === 0) {
      const userResult = await pool.query('SELECT role FROM users WHERE id = $1', [userId]);
      if (userResult.rows.length > 0 && userResult.rows[0].role === 'curator') {
        await pool.query("UPDATE users SET role = 'user' WHERE id = $1", [userId]);
        roleReverted = true;
      }
    }

    await pool.query('COMMIT');

    res.json({
      success: true,
      assignmentId,
      userId,
      remainingAssignments: remaining,
      roleReverted,
    });
  } catch (error) {
    await pool.query('ROLLBACK');
    throw error;
  }
}

/**
 * Get curator activity log
 * GET /api/admin/curators/:userId/activity
 * Query: limit, offset
 */
export async function getCuratorActivity(req: AuthenticatedRequest, res: Response): Promise<void> {
  const userId = parseInt(String(req.params.userId));
  const limit = Math.min(parseInt(String(req.query.limit)) || 50, 200);
  const offset = parseInt(String(req.query.offset)) || 0;

  const result = await pool.query(`
    SELECT
      cl.id,
      cl.action,
      cl.created_at,
      cl.details,
      e.id as experience_id,
      e.name as experience_name,
      r.id as region_id,
      r.name as region_name
    FROM experience_curation_log cl
    JOIN experiences e ON cl.experience_id = e.id
    LEFT JOIN regions r ON cl.region_id = r.id
    WHERE cl.curator_id = $1
    ORDER BY cl.created_at DESC
    LIMIT $2 OFFSET $3
  `, [userId, limit, offset]);

  const countResult = await pool.query(
    'SELECT COUNT(*) FROM experience_curation_log WHERE curator_id = $1',
    [userId],
  );

  res.json({
    activity: result.rows,
    total: parseInt(countResult.rows[0].count),
    limit,
    offset,
  });
}
