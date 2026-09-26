/**
 * Curator Assignment Controller (Admin)
 *
 * CRUD operations for managing curator assignments.
 * All routes require admin authentication.
 */

import type { z } from 'zod/v4';
import type {
  CuratorActivity,
  CuratorAssignmentCreated,
  CuratorAssignmentRevoked,
  Curators,
  CuratorActivityEntry,
  CuratorInfo,
} from '../../api/responses/admin.js';
import type { CuratorScope } from '../../api/responses/auth.js';
import { pool, rollbackQuietly } from '../../db/index.js';
import type {
  ExperienceCurationLogRow, ExperiencesRow, RegionsRow, UsersRow,
} from '../../db/schema.generated.js';
import { createError, notFound } from '../../middleware/errorHandler.js';
import type {
  assignmentIdParamSchema, createCuratorAssignmentBodySchema, curatorActivityQuerySchema, userIdParamSchema,
} from '../../types/index.js';
import { CURATOR_SCOPES_SQL, curatorScopeOf, type CuratorScopeOfUserRow } from './curatorScopeRows.js';

/**
 * List all curators with their scopes
 * GET /api/admin/curators
 */
export async function listCurators(): Promise<Curators> {
  const users = await pool.query<Pick<UsersRow, 'id' | 'display_name' | 'email' | 'role' | 'avatar_url'>>(`
    SELECT u.id, u.display_name, u.email, u.role, u.avatar_url
    FROM users u
    WHERE u.role = 'admin'
       OR (u.role = 'curator' AND EXISTS (SELECT 1 FROM curator_assignments ca WHERE ca.user_id = u.id))
    ORDER BY u.display_name
  `);
  const scopes = await pool.query<CuratorScopeOfUserRow>(CURATOR_SCOPES_SQL, [users.rows.map(u => u.id)]);

  const scopesByUser = new Map<number, CuratorScope[]>();
  for (const row of scopes.rows) {
    const list = scopesByUser.get(row.user_id) ?? [];
    list.push(curatorScopeOf(row));
    scopesByUser.set(row.user_id, list);
  }

  return users.rows.map((u): CuratorInfo => ({
    user_id: u.id,
    display_name: u.display_name,
    email: u.email,
    role: u.role,
    avatar_url: u.avatar_url,
    scopes: scopesByUser.get(u.id) ?? [],
  }));
}

/** The body `createCuratorAssignmentBodySchema` passed: a user, a scope type from its vocabulary. */
type AssignmentInput = z.output<typeof createCuratorAssignmentBodySchema>;

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

/** What the schema cannot say: which id a scope type needs. */
function validateAssignmentInput(body: AssignmentInput): ValidationError | null {
  const { scopeType, regionId, sourceId } = body;
  if (scopeType === 'region' && !regionId) {
    return { status: 400, error: 'regionId is required for region scope' };
  }
  if (scopeType === 'source' && !sourceId) {
    return { status: 400, error: 'sourceId is required for source scope' };
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

  if (body.scopeType === 'source') {
    const catResult = await pool.query(
      'SELECT id FROM experience_sources WHERE id = $1',
      [body.sourceId],
    );
    if (catResult.rows.length === 0) {
      return { status: 404, error: 'Source not found' };
    }
  }

  return null;
}

async function insertAssignmentAndPromote(
  body: AssignmentInput,
  assignedBy: number,
): Promise<{ id: number; assignedAt: Date | null; rolePromoted: boolean }> {
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
      INSERT INTO curator_assignments (user_id, scope_type, region_id, source_id, assigned_by, notes)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id, assigned_at
    `,
      [body.userId, body.scopeType, body.regionId || null, body.sourceId || null, assignedBy, body.notes || null],
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
export async function createCuratorAssignment(
  { body, caller }: { body: z.output<typeof createCuratorAssignmentBodySchema>; caller: Express.User },
): Promise<CuratorAssignmentCreated> {
  const assignedBy = caller.id;

  const inputError = validateAssignmentInput(body);
  if (inputError) throw createError(inputError.error, inputError.status);

  const refError = await verifyAssignmentReferences(body);
  if (refError) throw createError(refError.error, refError.status);

  let inserted: Awaited<ReturnType<typeof insertAssignmentAndPromote>>;
  try {
    inserted = await insertAssignmentAndPromote(body, assignedBy);
  } catch (error: unknown) {
    if (error instanceof Error && 'code' in error && (error as { code: string }).code === '23505') {
      throw createError('This curator assignment already exists', 409);
    }
    throw error;
  }
  return {
    id: inserted.id,
    userId: body.userId,
    scopeType: body.scopeType,
    regionId: body.regionId || null,
    sourceId: body.sourceId || null,
    assignedAt: inserted.assignedAt === null ? null : inserted.assignedAt.toISOString(),
    rolePromoted: inserted.rolePromoted,
  };
}

/**
 * Revoke a curator assignment
 * DELETE /api/admin/curators/:assignmentId
 */
export async function revokeCuratorAssignment(
  { params: { assignmentId } }: { params: z.output<typeof assignmentIdParamSchema> },
): Promise<CuratorAssignmentRevoked> {

  // Get assignment details before deletion
  const assignmentResult = await pool.query(
    'SELECT id, user_id FROM curator_assignments WHERE id = $1',
    [assignmentId],
  );

  if (assignmentResult.rows.length === 0) throw notFound('Assignment not found');

  const userId = assignmentResult.rows[0].user_id;

  // Delete assignment and check if role should revert, atomically — on one
  // pinned client, as `insertAssignmentAndPromote` above. The count that
  // decides the demotion is read here, so a statement landing outside the
  // transaction would count assignments a concurrent revoke has not committed.
  const client = await pool.connect();
  let unusable: Error | undefined;
  let remaining = 0;
  let roleReverted = false;
  // Found gone inside the transaction: answered once it is rolled back and the
  // client released, so the catch below never rolls it back a second time.
  let revokedMeanwhile = false;
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
      revokedMeanwhile = true;
    } else {
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
    }
  } catch (error) {
    // A client whose ROLLBACK also failed must be destroyed, not pooled: it
    // would otherwise carry an open transaction into the next request.
    unusable = await rollbackQuietly(client);
    throw error;
  } finally {
    client.release(unusable);
  }

  if (revokedMeanwhile) throw notFound('Assignment not found');

  return {
    success: true,
    assignmentId,
    userId,
    remainingAssignments: remaining,
    roleReverted,
  };
}

/** One act of the log as the activity read selects it. */
type ActivityRow = Pick<ExperienceCurationLogRow, 'id' | 'details' | 'created_at' | 'region_id'> & {
  action: CuratorActivityEntry['action'];
  experience_id: ExperiencesRow['id'];
  experience_name: ExperiencesRow['name'];
  region_name: RegionsRow['name'] | null;
};

/** Key by key, the timestamp as the wire carries it and `details` as the object its action wrote. */
function activityEntryOf(row: ActivityRow): CuratorActivityEntry {
  return {
    id: row.id,
    action: row.action,
    created_at: row.created_at === null ? null : row.created_at.toISOString(),
    details: row.details as CuratorActivityEntry['details'],
    experience_id: row.experience_id,
    experience_name: row.experience_name,
    region_id: row.region_id,
    region_name: row.region_name,
  };
}

/**
 * Get curator activity log
 * GET /api/admin/curators/:userId/activity
 * Query: limit, offset
 */
export async function getCuratorActivity(
  { params: { userId }, query: { limit, offset } }: {
    params: z.output<typeof userIdParamSchema>; query: z.output<typeof curatorActivityQuerySchema>;
  },
): Promise<CuratorActivity> {

  const result = await pool.query<ActivityRow>(`
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

  return {
    activity: result.rows.map(activityEntryOf),
    total: parseInt(countResult.rows[0].count),
    limit,
    offset,
  };
}
