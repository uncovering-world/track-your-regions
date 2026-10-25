/**
 * A curator's word on one kind of a place, from the place's own card (#2022):
 * where each kind stands, and taking a published place out of one of them.
 *
 * GET  /api/experiences/:id/kinds
 * POST /api/experiences/:id/keep-out   { membershipId, note? }
 *
 * The review queue answers only what a run asked about. The Theatre of Pompey
 * is published under Archaeology and no run raised a question about it, so a
 * curator who judged it not worth a visit had nowhere to say so. **Keeping it
 * out is written as every curator's refusal is**: `refuseOnMembership`, with
 * the admission pin, so the place leaves that kind's lists, counts and map at
 * once, every later run honours the answer, and the place stays in its other
 * kinds. The way back is the put-back every pinned refusal has
 * (`POST /:id/admission { decision: 'override' }`), offered on the same card
 * and on the review page's kept-out list.
 *
 * The membership is re-read under the place's lock: one that another curator
 * took out first, or that is not offered (an arrival, a rule's refusal), is a
 * 409 with nothing written. An arrival has its own no (`refuse-arrival`), and
 * a rule's refusal its own answer (`/:id/admission`).
 */

import type { z } from 'zod/v4';
import type { KeptOutOfKind, PlaceKindStandings } from '../../api/responses/curation.js';
import { pool, rollbackQuietly } from '../../db/index.js';
import { lockExperience } from '../../db/experienceWriter.js';
import {
  KINDS, MEMBERSHIPS, admissionPinnedSql, membershipAdmittedSql, membershipOfferedSql,
} from '../../db/membership.js';
import { CURATOR_SCOPED_REGIONS_CTE, curatorUnrestrictedScopeExists } from '../../middleware/auth.js';
import { createError, notFound, Refusal } from '../../middleware/errorHandler.js';
import type { idParamSchema, keepOutOfKindBodySchema } from '../../types/index.js';
import { CURATOR_REFUSAL_REASON } from './curatorRefusalController.js';
import { answeredSourceId, resolveExperienceScope } from './experienceScope.js';
import type { AnswerRefusal } from './lifecycleController.js';
import { refuseOnMembership } from './membershipWriter.js';
import { queueScopeSql } from './reviewQueueKeys.js';
import { PINNED_BY } from './reviewQueuePinQuestions.js';

type KeepOut = z.output<typeof keepOutOfKindBodySchema>;

export async function keepOutOfKind(
  { params: { id: experienceId }, body, caller }: {
    params: z.output<typeof idParamSchema>; body: KeepOut; caller: Express.User;
  },
): Promise<KeptOutOfKind> {
  // The membership's source decides the scope, as every answer about one kind does (#1264).
  const sourceId = await answeredSourceId(experienceId, body.membershipId, 'named');
  if (sourceId === null) throw notFound('Experience not found');
  const { permitted, logRegionId } = await resolveExperienceScope(caller.id, caller.role, experienceId, sourceId);
  if (!permitted) throw createError('You do not have curator permissions for this experience', 403);

  const outcome = await keepOutUnderLock(experienceId, caller.id, logRegionId, body);
  if (outcome.refusal) {
    const { status, ...refusal } = outcome.refusal;
    throw new Refusal(status, refusal);
  }
  return outcome.result!;
}

/** The refusal under the place's lock, the membership re-read in the statement after it. */
export async function keepOutUnderLock(
  experienceId: number,
  userId: number,
  logRegionId: number | null,
  { membershipId, note }: KeepOut,
): Promise<{ result?: KeptOutOfKind; refusal?: AnswerRefusal }> {
  const client = await pool.connect();
  let unusable: Error | undefined;
  try {
    await client.query('BEGIN');
    const refuse = async (refusal: AnswerRefusal): Promise<{ refusal: AnswerRefusal }> => {
      unusable = await rollbackQuietly(client);
      return { refusal };
    };

    const locked = await lockExperience(client, experienceId);
    if (!locked) return await refuse({ status: 404, error: 'Experience not found' });
    const read = await client.query<{ kind: string; curated_fields: string[] | null }>(
      `SELECT kd.name AS kind, m.curated_fields
         FROM ${MEMBERSHIPS} m
         JOIN ${KINDS} kd ON kd.id = m.kind_id
        WHERE m.id = $1 AND m.experience_id = $2 AND ${membershipOfferedSql('m')}`,
      [membershipId, experienceId],
    );
    const membership = read.rows[0];
    if (!membership) {
      return await refuse({
        status: 409, error: 'This kind no longer offers the place — reload to see where it stands',
      });
    }

    // Pinned, so no run puts it back, and in the kept-out list where one click does.
    const curated = [...new Set([...(membership.curated_fields ?? []), 'admission'])];
    await refuseOnMembership(client, locked.lock, membershipId, CURATOR_REFUSAL_REASON, curated);
    await client.query(`
      INSERT INTO experience_curation_log (experience_id, curator_id, action, region_id, details)
      VALUES ($1, $2, 'kept_out', $3, $4)
    `, [experienceId, userId, logRegionId, JSON.stringify({
      membershipId, kind: membership.kind, reason: CURATOR_REFUSAL_REASON, note: note ?? null,
    })]);
    await client.query('COMMIT');
    return { result: { experienceId, membershipId, admission: 'refused' } };
  } catch (error) {
    // A client whose ROLLBACK also failed must be destroyed, not pooled.
    unusable = await rollbackQuietly(client);
    throw error;
  } finally {
    client.release(unusable);
  }
}

/**
 * Every kind of the place and where it stands, with who kept it out and why
 * where a curator did. Read by a curator whose scope reaches the place, as its
 * identifiers and its history are; a kind of it outside that scope is listed,
 * so the card says the whole truth about the place, and marked as one they
 * cannot answer.
 */
export async function listPlaceKinds(
  { params: { id: experienceId }, caller }: { params: z.output<typeof idParamSchema>; caller: Express.User },
): Promise<PlaceKindStandings> {
  const exists = await pool.query('SELECT 1 FROM experiences WHERE id = $1', [experienceId]);
  if (exists.rows.length === 0) throw notFound('Experience not found');
  const { permitted } = await resolveExperienceScope(caller.id, caller.role, experienceId, 'place');
  if (!permitted) throw createError('You do not have curator permissions for this experience', 403);
  const isAdmin = caller.role === 'admin';
  // The name of who answered follows the curation log's own rule, as the pins list does.
  const nameVisible = isAdmin
    ? 'TRUE'
    : `(${curatorUnrestrictedScopeExists('m.source_id')} OR pinned_by.region_id IS NULL
        OR pinned_by.region_id IN (SELECT id FROM curator_scoped_regions))`;
  const result = await pool.query<{
    membership_id: number; kind_id: number; kind_name: string; type: string | null;
    state: 'offered' | 'waiting' | 'kept-out' | 'refused'; reason: string | null;
    answered_at: Date | null; note: string | null; curator_name: string | null; can_answer: boolean;
  }>(`${CURATOR_SCOPED_REGIONS_CTE}
    SELECT m.id AS membership_id, kd.id AS kind_id, kd.name AS kind_name, m.type,
           CASE WHEN ${membershipOfferedSql('m')} THEN 'offered'
                WHEN ${membershipAdmittedSql('m')} THEN 'waiting'
                WHEN ${admissionPinnedSql('m')} THEN 'kept-out'
                ELSE 'refused' END AS state,
           CASE WHEN m.admission = 'refused' THEN m.admission_reason END AS reason,
           CASE WHEN m.admission = 'refused' AND ${admissionPinnedSql('m')} THEN pinned_by.at END AS answered_at,
           -- The words stay with the scope, as the pins list keeps a pin out of view outside it.
           CASE WHEN m.admission = 'refused' AND ${admissionPinnedSql('m')} AND ${queueScopeSql(isAdmin, 'm.source_id')}
                THEN pinned_by.note END AS note,
           CASE WHEN m.admission = 'refused' AND ${admissionPinnedSql('m')} AND ${nameVisible}
                THEN u.display_name END AS curator_name,
           ${queueScopeSql(isAdmin, 'm.source_id')} AS can_answer
      FROM experiences e
      JOIN ${MEMBERSHIPS} m ON m.experience_id = e.id
      JOIN ${KINDS} kd ON kd.id = m.kind_id
      ${PINNED_BY}
      LEFT JOIN users u ON u.id = pinned_by.curator_id
     WHERE e.id = $2
     ORDER BY kd.display_priority, kd.name, m.id
  `, [caller.id, experienceId]);

  return {
    kinds: result.rows.map(row => ({
      membershipId: row.membership_id,
      kindId: row.kind_id,
      kindName: row.kind_name,
      type: row.type,
      state: row.state,
      reason: row.reason,
      answeredAt: row.answered_at?.toISOString() ?? null,
      note: row.note,
      curatorName: row.curator_name,
      canAnswer: row.can_answer,
    })),
  };
}
