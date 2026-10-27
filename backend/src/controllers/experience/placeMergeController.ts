/**
 * A curator undoing a merge of two places (ADR-0046 decision 5, ADR-0086).
 * POST /api/experiences/merges/:mergeId/undo
 *
 * In the scope of the place that stayed and of every source whose membership
 * the merge moved: an undo hands those memberships back to the folded place, so
 * it is answered by a curator who may answer for each of them, as an answer
 * about one membership is (#1264). The audit rows name the region the
 * authority came from.
 */

import type { z } from 'zod/v4';
import type { MergeUndone } from '../../api/responses/curation.js';
import { pool } from '../../db/index.js';
import { createError, notFound, Refusal } from '../../middleware/errorHandler.js';
import type { mergeIdParamSchema } from '../../types/index.js';
import { resolveExperienceScope } from './experienceScope.js';
import { realKindSql } from '../../db/membership.js';
import { undoMerge } from './placeMerge.js';

export async function undoPlaceMerge(
  { params: { mergeId }, caller }: { params: z.output<typeof mergeIdParamSchema>; caller: Express.User },
): Promise<MergeUndone> {
  const found = await pool.query<{ survivor_id: number; source_ids: number[] }>(
    `SELECT m.survivor_id,
            array(SELECT DISTINCT km.source_id FROM experience_kind_memberships km
                   WHERE km.id IN (SELECT jsonb_array_elements_text(m.moved->'memberships')::int)
                     AND ${realKindSql('km')}) AS source_ids
       FROM experience_merges m
      WHERE m.id = $1`,
    [mergeId],
  );
  const merge = found.rows[0];
  if (!merge) throw notFound('Merge not found');
  // The undo takes the moved memberships back and splits the place: the
  // curator answers for the place as a whole and for every source it moves.
  let logRegionId: number | null = null;
  for (const sourceId of ['place' as const, ...merge.source_ids]) {
    const scope = await resolveExperienceScope(caller.id, caller.role, merge.survivor_id, sourceId);
    if (!scope.permitted) throw createError('You do not have curator permissions for this experience', 403);
    logRegionId ??= scope.logRegionId;
  }
  const outcome = await undoMerge(mergeId, caller.id, logRegionId);
  if (outcome.refusal) {
    const { status, ...body } = outcome.refusal;
    throw new Refusal(status, body);
  }
  return { mergeId, ...outcome.result! };
}
