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
        'categoryId', ca.category_id,
        'categoryName', es.name,
        'assignedAt', ca.assigned_at,
        'notes', ca.notes
      ) ORDER BY ca.assigned_at DESC) as scopes
    FROM users u
    JOIN curator_assignments ca ON u.id = ca.user_id
    LEFT JOIN regions r ON ca.region_id = r.id
    LEFT JOIN experience_categories es ON ca.category_id = es.id
    WHERE u.role IN ('curator', 'admin')
    GROUP BY u.id, u.display_name, u.email, u.role, u.avatar_url
    ORDER BY u.display_name
  `);

  res.json(result.rows);
}

interface AssignmentInput {
  userId: number;
  scopeType: 'region' | 'category' | 'global';
  regionId?: number;
  categoryId?: number;
  notes?: string;
}

type ValidationError = { status: number; error: string };

function validateAssignmentInput(body: AssignmentInput): ValidationError | null {
  const { userId, scopeType, regionId, categoryId } = body;
  if (!userId || !scopeType) {
    return { status: 400, error: 'userId and scopeType are required' };
  }
  if (!['region', 'category', 'global'].includes(scopeType)) {
    return { status: 400, error: 'scopeType must be region, category, or global' };
  }
  if (scopeType === 'region' && !regionId) {
    return { status: 400, error: 'regionId is required for region scope' };
  }
  if (scopeType === 'category' && !categoryId) {
    return { status: 400, error: 'categoryId is required for category scope' };
  }
  return null;
}

async function verifyAssignmentReferences(
  body: AssignmentInput,
): Promise<{ error: ValidationError } | { userRole: string }> {
  const userResult = await pool.query('SELECT id, role FROM users WHERE id = $1', [body.userId]);
  if (userResult.rows.length === 0) {
    return { error: { status: 404, error: 'User not found' } };
  }

  if (body.scopeType === 'region') {
    const regionResult = await pool.query('SELECT id FROM regions WHERE id = $1', [body.regionId]);
    if (regionResult.rows.length === 0) {
      return { error: { status: 404, error: 'Region not found' } };
    }
  }

  if (body.scopeType === 'category') {
    const catResult = await pool.query(
      'SELECT id FROM experience_categories WHERE id = $1',
      [body.categoryId],
    );
    if (catResult.rows.length === 0) {
      return { error: { status: 404, error: 'Category not found' } };
    }
  }

  return { userRole: userResult.rows[0].role };
}

async function insertAssignmentAndPromote(
  body: AssignmentInput,
  assignedBy: number,
  currentRole: string,
): Promise<{ id: number; assignedAt: Date; rolePromoted: boolean }> {
  await pool.query('BEGIN');
  try {
    const insertResult = await pool.query(
      `
      INSERT INTO curator_assignments (user_id, scope_type, region_id, category_id, assigned_by, notes)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id, assigned_at
    `,
      [body.userId, body.scopeType, body.regionId || null, body.categoryId || null, assignedBy, body.notes || null],
    );

    const rolePromoted = currentRole === 'user';
    if (rolePromoted) {
      await pool.query("UPDATE users SET role = 'curator' WHERE id = $1", [body.userId]);
    }

    await pool.query('COMMIT');
    return {
      id: insertResult.rows[0].id,
      assignedAt: insertResult.rows[0].assigned_at,
      rolePromoted,
    };
  } catch (error) {
    await pool.query('ROLLBACK');
    throw error;
  }
}

/**
 * Create a curator assignment
 * POST /api/admin/curators
 * Body: { userId, scopeType, regionId?, sourceId?, notes? }
 */
export async function createCuratorAssignment(req: AuthenticatedRequest, res: Response): Promise<void> {
  const body = req.body as AssignmentInput;
  const assignedBy = req.user!.id;

  const inputError = validateAssignmentInput(body);
  if (inputError) {
    res.status(inputError.status).json({ error: inputError.error });
    return;
  }

  const refResult = await verifyAssignmentReferences(body);
  if ('error' in refResult) {
    res.status(refResult.error.status).json({ error: refResult.error.error });
    return;
  }

  try {
    const inserted = await insertAssignmentAndPromote(body, assignedBy, refResult.userRole);
    res.status(201).json({
      id: inserted.id,
      userId: body.userId,
      scopeType: body.scopeType,
      regionId: body.regionId || null,
      categoryId: body.categoryId || null,
      assignedAt: inserted.assignedAt,
      rolePromoted: inserted.rolePromoted,
    });
  } catch (error: unknown) {
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
