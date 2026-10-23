/**
 * A curator separating one kind's membership of a place into a place of its
 * own (ADR-0142). POST /api/experiences/:id/kinds/:kindId/separate
 *
 * In the scope of the place and of the membership's source: the separation
 * takes that source's membership off the place, so it is answered by a curator
 * who may answer for it, as an answer about one membership is (#1264). The
 * audit rows name the region the authority came from.
 */

import type { z } from 'zod/v4';
import type { MembershipSeparated, SeparationUndone } from '../../api/responses/curation.js';
import { pool } from '../../db/index.js';
import { MEMBERSHIPS } from '../../db/membership.js';
import { createError, notFound, Refusal } from '../../middleware/errorHandler.js';
import type { kindOfPlaceParamSchema, separationIdParamSchema } from '../../types/index.js';
import { resolveExperienceScope } from './experienceScope.js';
import { separateMembership, undoSeparation } from './membershipSeparation.js';

export async function separatePlaceMembership(
  { params: { id, kindId }, caller }: { params: z.output<typeof kindOfPlaceParamSchema>; caller: Express.User },
): Promise<MembershipSeparated> {
  // One membership per kind on a place (ADR-0086 decision 4): the kind names it.
  const found = await pool.query<{ id: number; source_id: number }>(
    `SELECT id, source_id FROM ${MEMBERSHIPS} WHERE kind_id = $1 AND experience_id = $2`,
    [kindId, id],
  );
  const membership = found.rows[0];
  if (!membership) throw notFound('This place is not of that kind');
  const scope = await resolveExperienceScope(caller.id, caller.role, id, membership.source_id);
  if (!scope.permitted) throw createError('You do not have curator permissions for this experience', 403);
  const outcome = await separateMembership({ placeId: id, membershipId: membership.id, separatedBy: caller.id, regionId: scope.logRegionId });
  if (outcome.refusal) {
    const { status, ...body } = outcome.refusal;
    throw new Refusal(status, body);
  }
  return outcome.result!;
}

/**
 * A curator undoing a separation: POST /api/experiences/separations/:separationId/undo.
 * In the scope of the original place and of the separated membership's source,
 * as the separation was.
 */
export async function undoPlaceSeparation(
  { params: { separationId }, caller }: { params: z.output<typeof separationIdParamSchema>; caller: Express.User },
): Promise<SeparationUndone> {
  const found = await pool.query<{ original_id: number; source_id: number | null }>(
    `SELECT sep.original_id, m.source_id FROM experience_separations sep
       LEFT JOIN ${MEMBERSHIPS} m ON m.id = sep.membership_id
      WHERE sep.id = $1`,
    [separationId],
  );
  const separation = found.rows[0];
  if (!separation) throw notFound('Separation not found');
  if (separation.source_id !== null) {
    const scope = await resolveExperienceScope(caller.id, caller.role, separation.original_id, separation.source_id);
    if (!scope.permitted) throw createError('You do not have curator permissions for this experience', 403);
  } else if (caller.role !== 'admin') {
    throw createError('You do not have curator permissions for this experience', 403);
  }
  const outcome = await undoSeparation(separationId, caller.id);
  if (outcome.refusal) {
    const { status, ...body } = outcome.refusal;
    throw new Refusal(status, body);
  }
  return outcome.result!;
}
