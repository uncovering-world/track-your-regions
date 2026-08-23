/**
 * Curator Assignment Controller (Admin)
 *
 * CRUD operations for managing curator assignments.
 * All routes require admin authentication.
 */

import { Response } from 'express';
import { pool, rollbackQuietly } from '../../db/index.js';
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

/**
 * How a writer of somebody's curator standing locks their user row.
 *
 * Granting a scope and taking one back both decide the role from a count of
 * what is left, so they have to serialise on the user or two admins acting at
 * once leave the two halves disagreeing: an assignment whose owner is back to
 * `user` and locked out of every curation screen, or a `curator` with nothing
 * scoped. `FOR NO KEY UPDATE` for the reason `db/locks.ts` gives for the same
 * mode — it self-conflicts, so the two serialise, while staying compatible with
 * the `FOR KEY SHARE` that `curator_assignments`' foreign key takes on this
 * very row. A constant of its own rather than `OBJECT_LOCK`, which names the
 * order and mode for an experience and its contents.
 */
const USER_ROLE_LOCK = 'FOR NO KEY UPDATE';

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

/**
 * Do the three things the body names exist? Answers the error to send, or null.
 *
 * Existence only: the role the promotion turns on is read inside the
 * transaction, under the lock, because a read out here is stale the moment a
 * concurrent revoke commits.
 */
async function verifyAssignmentReferences(body: AssignmentInput): Promise<ValidationError | null> {
  const userResult = await pool.query('SELECT id FROM users WHERE id = $1', [body.userId]);
  if (userResult.rows.length === 0) {
    return { status: 404, error: 'User not found' };
  }

  if (body.scopeType === 'region') {
    const regionResult = await pool.query('SELECT id FROM regions WHERE id = $1', [body.regionId]);
    if (regionResult.rows.length === 0) {
      return { status: 404, error: 'Region not found' };
    }
  }

  if (body.scopeType === 'category') {
    const catResult = await pool.query(
      'SELECT id FROM experience_categories WHERE id = $1',
      [body.categoryId],
    );
    if (catResult.rows.length === 0) {
      return { status: 404, error: 'Category not found' };
    }
  }

  return null;
}

async function insertAssignmentAndPromote(
  body: AssignmentInput,
  assignedBy: number,
): Promise<{ id: number; assignedAt: Date; rolePromoted: boolean }> {
  // One client, not pool.query('BEGIN') — see the note in curationController:
  // pg.Pool hands out an arbitrary idle client per call, so a transaction has
  // to be pinned or its statements land on different connections. The scope row
  // and the promotion that answers for it are the pair this holds together: a
  // curator row without the role reaches no curation screen, and the role
  // without the row grants powers nothing scoped.
  const client = await pool.connect();
  let unusable: Error | undefined;
  try {
    await client.query('BEGIN');

    // The role is re-read here, under the lock that revoking takes too, and not
    // taken from the reference check above: that read is outside any
    // transaction, so a revoke committing between the two decides this
    // promotion on a role that no longer holds. `FOR NO KEY UPDATE` for the
    // reason `db/locks.ts` gives — it self-conflicts, so a grant and a revoke
    // of the same user serialise, while staying compatible with the KEY SHARE
    // the INSERT's foreign key takes on this very row.
    const locked = await client.query(
      `SELECT role FROM users WHERE id = $1 ${USER_ROLE_LOCK}`,
      [body.userId],
    );

    const insertResult = await client.query(
      `
      INSERT INTO curator_assignments (user_id, scope_type, region_id, category_id, assigned_by, notes)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id, assigned_at
    `,
      [body.userId, body.scopeType, body.regionId || null, body.categoryId || null, assignedBy, body.notes || null],
    );

    // No row means the user was deleted since the reference check; the INSERT
    // above has already failed on its foreign key by then, so this value never
    // reaches anybody.
    const rolePromoted = locked.rows[0]?.role === 'user';
    if (rolePromoted) {
      await client.query("UPDATE users SET role = 'curator' WHERE id = $1", [body.userId]);
    }

    await client.query('COMMIT');
    return {
      id: insertResult.rows[0].id,
      assignedAt: insertResult.rows[0].assigned_at,
      rolePromoted,
    };
  } catch (error) {
    // A client whose ROLLBACK also failed must be destroyed, not pooled: it
    // would otherwise carry an open transaction into the next request.
    unusable = await rollbackQuietly(client);
    throw error;
  } finally {
    client.release(unusable);
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

  const refError = await verifyAssignmentReferences(body);
  if (refError) {
    res.status(refError.status).json({ error: refError.error });
    return;
  }

  try {
    const inserted = await insertAssignmentAndPromote(body, assignedBy);
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

  // Delete assignment and check if role should revert, atomically — on one
  // pinned client, as `insertAssignmentAndPromote` above. The count that
  // decides the demotion is read here, so a statement landing outside the
  // transaction would count assignments a concurrent revoke has not committed.
  const client = await pool.connect();
  let unusable: Error | undefined;
  let remaining: number;
  let roleReverted = false;
  try {
    await client.query('BEGIN');

    // The user row first, in the mode granting takes, so the two serialise —
    // see `USER_ROLE_LOCK`. Two revokes running side by side would otherwise
    // each see the other's assignment still standing, and neither would demote.
    const locked = await client.query(
      `SELECT role FROM users WHERE id = $1 ${USER_ROLE_LOCK}`,
      [userId],
    );

    // The read above this transaction is what found the assignment, and by now
    // another admin may have revoked it. Deleting nothing and then reporting a
    // successful revoke is the part that misleads: it would also demote on a
    // count taken for somebody else's decision.
    const deleted = await client.query(
      'DELETE FROM curator_assignments WHERE id = $1 RETURNING user_id',
      [assignmentId],
    );
    if (deleted.rowCount === 0) {
      unusable = await rollbackQuietly(client);
      res.status(404).json({ error: 'Assignment not found' });
      return;
    }

    // Check if user has any remaining assignments
    const remainingResult = await client.query(
      'SELECT COUNT(*) as count FROM curator_assignments WHERE user_id = $1',
      [userId],
    );

    remaining = parseInt(remainingResult.rows[0].count);

    // Revert role to 'user' if no remaining assignments (and not admin)
    if (remaining === 0 && locked.rows[0]?.role === 'curator') {
      await client.query("UPDATE users SET role = 'user' WHERE id = $1", [userId]);
      roleReverted = true;
    }

    await client.query('COMMIT');
  } catch (error) {
    // A client whose ROLLBACK also failed must be destroyed, not pooled: it
    // would otherwise carry an open transaction into the next request.
    unusable = await rollbackQuietly(client);
    throw error;
  } finally {
    client.release(unusable);
  }

  res.json({
    success: true,
    assignmentId,
    userId,
    remainingAssignments: remaining,
    roleReverted,
  });
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
