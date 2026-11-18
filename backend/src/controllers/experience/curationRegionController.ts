/**
 * A curator's word on where a place belongs: refusing it from a region or taking
 * the refusal back, and assigning it to a region by hand or taking that back.
 * Each takes its region from the request and checks the curator's scope on it.
 * Each writes its change and the curation-log row that records it in one
 * transaction (`inTransaction`), so an act is never done and left unlogged.
 *
 * Each row records where the place stood in the region before the act
 * (`before`: how it was assigned there, if at all, and whether it was
 * rejected there), so a placement a curator corrects can be read against the
 * placement it corrected (#863). The region an act names is the log entry's
 * region too: a curator rejecting a place from Lazio was working in Lazio.
 * Each says why, but taking a rejection back, which returns the place to
 * where its own points put it and so agrees with the placement rule.
 */

import type { PoolClient } from 'pg';
import type { z } from 'zod/v4';
import { CURATION_REASON_WORDS } from '@tyr/shared/curationLog';
import type { RegionMembershipResult } from '../../api/responses/curation.js';
import { inTransaction, pool } from '../../db/index.js';
import { logCurationAct } from '../../db/curationLogWriter.js';
import { lockExperience } from '../../db/experienceWriter.js';
import { createError, notFound } from '../../middleware/errorHandler.js';
import type {
  assignExperienceBodySchema, idAndRegionIdParamSchema, idParamSchema, rejectExperienceBodySchema,
  removeFromRegionQuerySchema, unassignQuerySchema, unrejectExperienceBodySchema,
} from '../../types/index.js';
import { checkCuratorScope } from '../../middleware/auth.js';

type IdParams = z.output<typeof idParamSchema>;
type IdAndRegionParams = z.output<typeof idAndRegionIdParamSchema>;
type RejectBody = z.output<typeof rejectExperienceBodySchema>;

/**
 * What a rejection keeps as its reason, which the region's list shows beside
 * the rejected place: the curator's words, else the reason they picked in its
 * screen words. "Other" alone says nothing a reader of the list could use.
 */
function rejectionReason({ reason, reasonCode }: Pick<RejectBody, 'reason' | 'reasonCode'>): string | null {
  const words = reason?.trim();
  if (words) return words;
  return reasonCode === 'other' ? null : CURATION_REASON_WORDS[reasonCode];
}

/** Where a place stood in one region: how it was assigned there (`auto`, `manual` or none), and whether it was rejected. */
interface RegionStanding {
  assignment: string | null;
  rejected: boolean;
}

/**
 * The place's standing in the region, read in the act's transaction before it
 * writes, in the order `db/locks.ts` states: the place's object lock, then its
 * region keys (ADR-0197), each in a statement of its own, then the read. The
 * object lock serialises two curators' acts on one place, and the keys a run's
 * placement (`refresh_place_regions()`), so the read sees what either
 * committed and the `before` a row records is the standing its write replaced.
 */
async function standingIn(client: PoolClient, experienceId: number, regionId: number): Promise<RegionStanding> {
  if (!await lockExperience(client, experienceId)) throw notFound('Experience not found');
  await client.query('SELECT lock_place_regions(ARRAY[$1::int])', [experienceId]);
  const read = await client.query<RegionStanding>(
    `SELECT (SELECT er.assignment_type FROM experience_regions er
              WHERE er.experience_id = $1 AND er.region_id = $2) AS assignment,
            EXISTS (SELECT 1 FROM experience_rejections rj
                     WHERE rj.experience_id = $1 AND rj.region_id = $2) AS rejected`,
    [experienceId, regionId],
  );
  return read.rows[0];
}

/**
 * Reject an experience from a region
 * POST /api/experiences/:id/reject
 * Body: { regionId, reasonCode, reason? }
 */

export async function rejectExperience(
  { params: { id: experienceId }, body: { regionId, reason, reasonCode }, caller }: {
    params: IdParams; body: RejectBody; caller: Express.User;
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
    const before = await standingIn(client, experienceId, regionId);
    await client.query(`
      INSERT INTO experience_rejections (experience_id, region_id, rejected_by, reason)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (experience_id, region_id)
      DO UPDATE SET rejected_by = $3, reason = $4, created_at = NOW()
    `, [experienceId, regionId, userId, rejectionReason({ reason, reasonCode })]);

    // The log keeps the code and the curator's own words apart, so a query groups by the one and reads the other.
    await logCurationAct(client, {
      experienceId, curatorId: userId, action: 'rejected', regionId, reasonCode,
      details: { ...(reason?.trim() ? { reason: reason.trim() } : {}), before },
    });
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
    const before = await standingIn(client, experienceId, regionId);
    const result = await client.query<{ reason: string | null; rejected_by: number; created_at: Date | null }>(
      `DELETE FROM experience_rejections WHERE experience_id = $1 AND region_id = $2
       RETURNING reason, rejected_by, created_at`,
      [experienceId, regionId],
    );
    if (result.rowCount === 0) {
      throw notFound('No rejection found for this experience in this region');
    }

    // The rejection taken back, as it stood: who made it, when and why.
    const [rejection] = result.rows;
    await logCurationAct(client, {
      experienceId, curatorId: userId, action: 'unrejected', regionId,
      details: {
        before,
        rejection: { reason: rejection.reason, rejectedBy: rejection.rejected_by, rejectedAt: rejection.created_at },
      },
    });
  });

  return { success: true, experienceId, regionId };
}

/**
 * Manually assign an experience to a region
 * POST /api/experiences/:id/assign
 * Body: { regionId, reasonCode, note? }
 */
export async function assignExperienceToRegion(
  { params: { id: experienceId }, body: { regionId, reasonCode, note }, caller }: {
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
    const before = await standingIn(client, experienceId, regionId);
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

    await logCurationAct(client, {
      experienceId, curatorId: userId, action: 'added_to_region', regionId, reasonCode,
      details: { before, ...(note ? { note } : {}) },
    });
  });

  return { success: true, experienceId, regionId };
}

/**
 * Unassign an experience from a region (manual assignments only)
 * DELETE /api/experiences/:id/assign/:regionId
 */
export async function unassignExperienceFromRegion(
  { params: { id: experienceId, regionId }, query: { reasonCode }, caller }: {
    params: IdAndRegionParams; query: z.output<typeof unassignQuerySchema>; caller: Express.User;
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

  // The withdrawal, the rows it gives back and the audit row stand or fall
  // together: a refresh that failed after a committed delete would leave the
  // curator's row gone and its removal unlogged.
  await inTransaction(async client => {
    // `standingIn` takes the object, then the region keys the refresh below
    // needs, before this delete holds the row (db/locks.ts).
    const before = await standingIn(client, experienceId, regionId);

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

    // Where the place stands after: an automatic row its own points gave back, or none.
    const after = await standingIn(client, experienceId, regionId);
    await logCurationAct(client, {
      experienceId, curatorId: userId, action: 'removed_from_region', regionId, reasonCode,
      details: { before, after },
    });
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
  { params: { id: experienceId, regionId }, query: { reasonCode, note }, caller }: {
    params: IdAndRegionParams; query: z.output<typeof removeFromRegionQuerySchema>; caller: Express.User;
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

  // The removal and its log row stand or fall together (#2465).
  await inTransaction(async client => {
    const before = await standingIn(client, experienceId, regionId);
    // Remove the region assignment (any type: auto or manual)
    const result = await client.query(
      'DELETE FROM experience_regions WHERE experience_id = $1 AND region_id = $2 RETURNING id',
      [experienceId, regionId],
    );
    if (result.rowCount === 0) {
      throw notFound('Experience is not assigned to this region');
    }

    // Keep rejection row — it acts as a guard if spatial recompute re-adds the experience.

    await logCurationAct(client, {
      experienceId, curatorId: userId, action: 'removed_from_region', regionId, reasonCode,
      details: { before, ...(note ? { note } : {}) },
    });
  });

  return { success: true, experienceId, regionId };
}
