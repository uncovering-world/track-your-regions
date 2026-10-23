/**
 * A curator's answer to a run that asked again about their admission pin
 * (#1367): keep the answer, which then answers what the run now says, or let
 * the rule decide, which writes the run's verdict in the pin's place.
 *
 * POST /api/experiences/:id/admission-pin
 * Body: { decision: 'keep' | 'release', membershipId, asked: { verdict, reason }, note? }
 *
 * The question is re-read under the place's lock and must still be the one the
 * card showed (`asked`): a run that asked something else since, or another
 * curator who answered first, is a 409 with nothing written.
 */

import type { z } from 'zod/v4';
import type { PinQuestionAnswered } from '../../api/responses/curation.js';
import { pool, rollbackQuietly } from '../../db/index.js';
import { lockExperience } from '../../db/experienceWriter.js';
import { KINDS, MEMBERSHIPS } from '../../db/membership.js';
import { createError, notFound, Refusal } from '../../middleware/errorHandler.js';
import type { idParamSchema, pinQuestionAnswerBodySchema } from '../../types/index.js';
import { answeredSourceId, resolveExperienceScope } from './experienceScope.js';
import type { AnswerRefusal } from './lifecycleController.js';
import { keepAdmissionPin, releaseAdmissionPin } from './membershipWriter.js';
import { pinQuestionOpenSql } from './reviewQueuePredicates.js';

type PinAnswer = z.output<typeof pinQuestionAnswerBodySchema>;

export async function answerPinQuestion(
  { params: { id: experienceId }, body, caller }: {
    params: z.output<typeof idParamSchema>; body: PinAnswer; caller: Express.User;
  },
): Promise<PinQuestionAnswered> {
  // The answered membership's source decides the scope, as every answer about one kind does (#1264).
  const sourceId = await answeredSourceId(experienceId, body.membershipId, 'named');
  if (sourceId === null) throw notFound('Experience not found');
  const { permitted, logRegionId } = await resolveExperienceScope(caller.id, caller.role, experienceId, sourceId);
  if (!permitted) throw createError('You do not have curator permissions for this experience', 403);

  const outcome = await answerPinQuestionUnderLock(experienceId, caller.id, logRegionId, body);
  if (outcome.refusal) {
    const { status, ...refusal } = outcome.refusal;
    throw new Refusal(status, refusal);
  }
  return outcome.result!;
}

/**
 * The answer under the place's lock: the question re-read and compared with
 * the one the card showed, the membership writer's keep or release, and one
 * row of the curation log.
 */
export async function answerPinQuestionUnderLock(
  experienceId: number,
  userId: number,
  logRegionId: number | null,
  { decision, membershipId, asked, note }: PinAnswer,
): Promise<{ result?: PinQuestionAnswered; refusal?: AnswerRefusal }> {
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
    // In a statement after the lock's, so the row read is the one the lock holds (`db/locks.ts`).
    const read = await client.query<{
      admission: 'admitted' | 'refused'; verdict: 'admitted' | 'refused'; reason: string | null; kind: string;
    }>(
      `SELECT m.admission, m.admission_question_verdict AS verdict, m.admission_question_reason AS reason,
              kd.name AS kind
         FROM ${MEMBERSHIPS} m JOIN ${KINDS} kd ON kd.id = m.kind_id
        WHERE m.id = $1 AND m.experience_id = $2 AND ${pinQuestionOpenSql('m')}`,
      [membershipId, experienceId],
    );
    const question = read.rows[0];
    const stale = question?.verdict !== asked.verdict || (question?.reason ?? null) !== asked.reason;
    if (!question || stale) {
      return await refuse({
        status: 409,
        error: question
          ? 'A run has asked something else since — reload to read the question as it stands'
          : 'Someone else answered this first — reload to see where it stands',
      });
    }

    const admitted = decision === 'keep' ? question.admission === 'admitted' : question.verdict === 'admitted';
    if (decision === 'keep') {
      await keepAdmissionPin(client, locked.lock, membershipId);
    } else {
      await releaseAdmissionPin(client, locked.lock, membershipId, {
        admitted: question.verdict === 'admitted', reason: question.reason,
      });
    }
    await client.query(`
      INSERT INTO experience_curation_log (experience_id, curator_id, action, region_id, details)
      VALUES ($1, $2, $3, $4, $5)
    `, [experienceId, userId, decision === 'keep' ? 'admission_pin_kept' : 'admission_pin_released', logRegionId,
      JSON.stringify({
        membershipId, kind: question.kind, answer: question.admission,
        verdict: question.verdict, reason: question.reason, note: note ?? null,
      })]);
    await client.query('COMMIT');
    return { result: { experienceId, membershipId, admission: admitted ? 'admitted' : 'refused', pinned: decision === 'keep' } };
  } catch (error) {
    unusable = await rollbackQuietly(client);
    throw error;
  } finally {
    client.release(unusable);
  }
}
