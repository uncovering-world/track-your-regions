/**
 * A curator's word on where a place belongs: refusing it from a region or taking
 * the refusal back, and assigning it to a region by hand or taking that back.
 * Each takes its region from the request and checks the curator's scope on it.
 * Each writes its change and the curation-log row that records it in one
 * transaction (`inTransaction`), so an act is never done and left unlogged.
 */

import type { z } from 'zod/v4';
import type { RegionMembershipResult } from '../../api/responses/curation.js';
import { inTransaction, pool } from '../../db/index.js';
import { createError, notFound } from '../../middleware/errorHandler.js';
import type {
  assignExperienceBodySchema, idAndRegionIdParamSchema, idParamSchema, rejectExperienceBodySchema, unrejectExperienceBodySchema,
} from '../../types/index.js';
import { checkCuratorScope } from '../../middleware/auth.js';

type IdParams = z.output<typeof idParamSchema>;
type IdAndRegionParams = z.output<typeof idAndRegionIdParamSchema>;

/**
 * Reject an experience from a region
 * POST /api/experiences/:id/reject
 * Body: { regionId, reason? }
 */

export async function rejectExperience(
  { params: { id: experienceId }, body: { regionId, reason }, caller }: {
    params: IdParams; body: z.output<typeof rejectExperienceBodySchema>; caller: Express.User;
  },
): Promise<RegionMembershipResult> {
  const userId = caller.id;
  const userRole = caller.role;

  // The experience must exist; its scope is the place's (checkCuratorScope)
  const expResult = await pool.query('SELECT id FROM experiences WHERE id = $1', [experienceId]);
  if (expResult.rows.length === 0) {
    throw notFound('Experience not found');
  }

  // Check curator scope
  const hasScope = await checkCuratorScope(userId, userRole, regionId, experienceId);
  if (!hasScope) {
    throw createError('You do not have curator permissions for this region', 403);
  }

  await inTransaction(async client => {
    await client.query(`
      INSERT INTO experience_rejections (experience_id, region_id, rejected_by, reason)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (experience_id, region_id)
      DO UPDATE SET rejected_by = $3, reason = $4, created_at = NOW()
    `, [experienceId, regionId, userId, reason || null]);

    await client.query(`
      INSERT INTO experience_curation_log (experience_id, curator_id, action, region_id, details)
      VALUES ($1, $2, 'rejected', $3, $4)
    `, [experienceId, userId, regionId, reason ? JSON.stringify({ reason }) : null]);
  });

  return { success: true, experienceId, regionId };
}

/**
 * Unreject an experience from a region
 * POST /api/experiences/:id/unreject
 * Body: { regionId }
 */
export async function unrejectExperience(
  { params: { id: experienceId }, body: { regionId }, caller }: {
    params: IdParams; body: z.output<typeof unrejectExperienceBodySchema>; caller: Express.User;
  },
): Promise<RegionMembershipResult> {
  const userId = caller.id;
  const userRole = caller.role;

  // The experience must exist; its scope is the place's (checkCuratorScope)
  const expResult = await pool.query('SELECT id FROM experiences WHERE id = $1', [experienceId]);
  if (expResult.rows.length === 0) {
    throw notFound('Experience not found');
  }

  // Check curator scope
  const hasScope = await checkCuratorScope(userId, userRole, regionId, experienceId);
  if (!hasScope) {
    throw createError('You do not have curator permissions for this region', 403);
  }

  await inTransaction(async client => {
    const result = await client.query(
      'DELETE FROM experience_rejections WHERE experience_id = $1 AND region_id = $2 RETURNING id',
      [experienceId, regionId],
    );
    if (result.rowCount === 0) {
      throw notFound('No rejection found for this experience in this region');
    }

    await client.query(`
      INSERT INTO experience_curation_log (experience_id, curator_id, action, region_id)
      VALUES ($1, $2, 'unrejected', $3)
    `, [experienceId, userId, regionId]);
  });

  return { success: true, experienceId, regionId };
}

/**
 * Manually assign an experience to a region
 * POST /api/experiences/:id/assign
 * Body: { regionId }
 */
export async function assignExperienceToRegion(
  { params: { id: experienceId }, body: { regionId }, caller }: {
    params: IdParams; body: z.output<typeof assignExperienceBodySchema>; caller: Express.User;
  },
): Promise<RegionMembershipResult> {
  const userId = caller.id;
  const userRole = caller.role;

  // Verify experience exists
  const expResult = await pool.query('SELECT id FROM experiences WHERE id = $1', [experienceId]);
  if (expResult.rows.length === 0) {
    throw notFound('Experience not found');
  }

  // Check curator scope
  const hasScope = await checkCuratorScope(userId, userRole, regionId, experienceId);
  if (!hasScope) {
    throw createError('You do not have curator permissions for this region', 403);
  }

  // Verify region exists
  const regionResult = await pool.query('SELECT id FROM regions WHERE id = $1', [regionId]);
  if (regionResult.rows.length === 0) {
    throw notFound('Region not found');
  }

  await inTransaction(async client => {
    // Insert manual assignment (or update to manual if auto already exists).
    // A curator's row is one readers find (ADR-0197), whatever the automatic
    // row it replaces said.
    await client.query(`
      INSERT INTO experience_regions (experience_id, region_id, assignment_type, assigned_by, listing)
      VALUES ($1, $2, 'manual', $3, 'offered')
      ON CONFLICT (experience_id, region_id)
      DO UPDATE SET assignment_type = 'manual', assigned_by = $3, listing = 'offered'
    `, [experienceId, regionId, userId]);

    // Clear any rejection for this experience-region pair
    await client.query(
      'DELETE FROM experience_rejections WHERE experience_id = $1 AND region_id = $2',
      [experienceId, regionId],
    );

    // Log the action
    await client.query(`
      INSERT INTO experience_curation_log (experience_id, curator_id, action, region_id)
      VALUES ($1, $2, 'added_to_region', $3)
    `, [experienceId, userId, regionId]);
  });

  return { success: true, experienceId, regionId };
}

/**
 * Unassign an experience from a region (manual assignments only)
 * DELETE /api/experiences/:id/assign/:regionId
 */
export async function unassignExperienceFromRegion(
  { params: { id: experienceId, regionId }, caller }: { params: IdAndRegionParams; caller: Express.User },
): Promise<RegionMembershipResult> {
  const userId = caller.id;
  const userRole = caller.role;

  // The experience must exist; its scope is the place's (checkCuratorScope)
  const expResult = await pool.query('SELECT id FROM experiences WHERE id = $1', [experienceId]);
  if (expResult.rows.length === 0) {
    throw notFound('Experience not found');
  }

  // Check curator scope
  const hasScope = await checkCuratorScope(userId, userRole, regionId, experienceId);
  if (!hasScope) {
    throw createError('You do not have curator permissions for this region', 403);
  }

  // The withdrawal, the rows it gives back and the audit row stand or fall
  // together: a refresh that failed after a committed delete would leave the
  // curator's row gone and its removal unlogged.
  await inTransaction(async client => {
    // The place's keys before its row (ADR-0197, db/locks.ts): the refresh
    // below needs them, and a refresh already holding them may be waiting
    // for the row this delete would hold.
    await client.query('SELECT lock_place_regions(ARRAY[$1::int])', [experienceId]);

    // Only remove manual assignments (never remove auto-computed spatial assignments)
    const result = await client.query(
      `DELETE FROM experience_regions
       WHERE experience_id = $1 AND region_id = $2 AND assignment_type = 'manual'
       RETURNING id`,
      [experienceId, regionId],
    );

    if (result.rowCount === 0) {
      throw notFound('No manual assignment found for this experience in this region');
    }

    // A curator's row stood where the place's own points may put it too: the
    // automatic row those points give comes back now, not at the next
    // placement (ADR-0197).
    await client.query('SELECT refresh_place_regions(ARRAY[$1::int])', [experienceId]);

    // Log the action
    await client.query(`
      INSERT INTO experience_curation_log (experience_id, curator_id, action, region_id)
      VALUES ($1, $2, 'removed_from_region', $3)
    `, [experienceId, userId, regionId]);
  });

  return { success: true, experienceId, regionId };
}

/**
 * Remove an experience from a region entirely (any assignment type).
 * DELETE /api/experiences/:id/remove-from-region/:regionId
 *
 * Unlike unassign (which only removes manual assignments), this removes
 * the experience_regions row regardless of assignment_type. The rejection
 * row is kept as a guard — if a future spatial recompute re-adds the
 * experience, it will automatically be hidden again.
 */
export async function removeExperienceFromRegion(
  { params: { id: experienceId, regionId }, caller }: { params: IdAndRegionParams; caller: Express.User },
): Promise<RegionMembershipResult> {
  const userId = caller.id;
  const userRole = caller.role;

  // The experience must exist; its scope is the place's (checkCuratorScope)
  const expResult = await pool.query('SELECT id FROM experiences WHERE id = $1', [experienceId]);
  if (expResult.rows.length === 0) {
    throw notFound('Experience not found');
  }

  // Check curator scope
  const hasScope = await checkCuratorScope(userId, userRole, regionId, experienceId);
  if (!hasScope) {
    throw createError('You do not have curator permissions for this region', 403);
  }

  // The removal and its log row stand or fall together (#2465).
  await inTransaction(async client => {
    // Remove the region assignment (any type: auto or manual)
    const result = await client.query(
      'DELETE FROM experience_regions WHERE experience_id = $1 AND region_id = $2 RETURNING id',
      [experienceId, regionId],
    );
    if (result.rowCount === 0) {
      throw notFound('Experience is not assigned to this region');
    }

    // Keep rejection row — it acts as a guard if spatial recompute re-adds the experience.

    await client.query(`
      INSERT INTO experience_curation_log (experience_id, curator_id, action, region_id)
      VALUES ($1, $2, 'removed_from_region', $3)
    `, [experienceId, userId, regionId]);
  });

  return { success: true, experienceId, regionId };
}
