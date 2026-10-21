/**
 * A curator's answer to a run's question about an offered place with nothing
 * to see (#1770): keep the place in its kind, or refuse it from the kind,
 * which is what the card suggests.
 *
 * POST /api/experiences/:id/visit-question
 * Body: { decision: 'keep' | 'refuse', membershipId, note? }
 *
 * **A refusal is written as a curator's refusal of an arrival is.** The
 * membership takes `admission = 'refused'` with a reason that says a person
 * did it, and the admission pin, so the place leaves the kind at once, every
 * later run honours the answer, and the kept-out list's *Put it back* is the
 * way back. Keeping writes nothing on the membership: the rule still decides
 * the place's admission, and the question, answered, is never raised again.
 * Either answer is recorded on the question, by whom and when, so how often a
 * curator agrees with the suggestion can be counted (`jevUsageController.ts`).
 *
 * The question is re-read under the place's lock: one another curator
 * answered first, or that a later refusal, pin or delisting closed, is a 409
 * with nothing written.
 */

import type { z } from 'zod/v4';
import type { VisitQuestionAnswered } from '../../api/responses/curation.js';
import { pool, rollbackQuietly } from '../../db/index.js';
import { lockExperience } from '../../db/experienceWriter.js';
import { KINDS, MEMBERSHIPS } from '../../db/membership.js';
import { createError, notFound, Refusal } from '../../middleware/errorHandler.js';
import type { idParamSchema, visitQuestionAnswerBodySchema } from '../../types/index.js';
import { answeredSourceId, resolveExperienceScope } from './experienceScope.js';
import type { AnswerRefusal } from './lifecycleController.js';
import { refuseOnMembership } from './membershipWriter.js';
import { visitQuestionOpenSql } from './reviewQueuePredicates.js';

type VisitAnswer = z.output<typeof visitQuestionAnswerBodySchema>;

/** The reason a refusal answering the question carries, in the words the kept-out list shows. */
export const VISIT_REFUSAL_REASON = 'kept out by a curator: not a place a visitor goes to';

export async function answerVisitQuestion(
  { params: { id: experienceId }, body, caller }: {
    params: z.output<typeof idParamSchema>; body: VisitAnswer; caller: Express.User;
  },
): Promise<VisitQuestionAnswered> {
  // The answered membership's source decides the scope, as every answer about one kind does (#1264).
  const sourceId = await answeredSourceId(experienceId, body.membershipId);
  if (sourceId === null) throw notFound('Experience not found');
  const { permitted, logRegionId } = await resolveExperienceScope(caller.id, caller.role, experienceId, sourceId);
  if (!permitted) throw createError('You do not have curator permissions for this experience', 403);

  const outcome = await answerVisitQuestionUnderLock(experienceId, caller.id, logRegionId, body);
  if (outcome.refusal) {
    const { status, ...refusal } = outcome.refusal;
    throw new Refusal(status, refusal);
  }
  return outcome.result!;
}

/**
 * The answer under the place's lock: the question re-read with its open rule,
 * the membership writer's refusal for `refuse`, the answer on the question,
 * and one row of the curation log.
 */
export async function answerVisitQuestionUnderLock(
  experienceId: number,
  userId: number,
  logRegionId: number | null,
  { decision, membershipId, note }: VisitAnswer,
): Promise<{ result?: VisitQuestionAnswered; refusal?: AnswerRefusal }> {
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
      kind: string; reading: string; confidence: string; witnesses: string[]; curated_fields: string[] | null;
    }>(
      `SELECT kd.name AS kind, q.reading, q.confidence, q.witnesses, m.curated_fields
         FROM experience_visit_questions q
         JOIN ${MEMBERSHIPS} m ON m.id = q.membership_id
         JOIN experiences e ON e.id = m.experience_id
         JOIN ${KINDS} kd ON kd.id = m.kind_id
        WHERE q.membership_id = $1 AND m.experience_id = $2 AND ${visitQuestionOpenSql('q', 'm', 'e')}`,
      [membershipId, experienceId],
    );
    const question = read.rows[0];
    if (!question) {
      return await refuse({ status: 409, error: 'This question is no longer open — reload to see where it stands' });
    }

    const answer = decision === 'refuse' ? 'refused' : 'kept';
    if (answer === 'refused') {
      // Pinned, so no run puts it back, and in the kept-out list where one click does.
      const curated = [...new Set([...(question.curated_fields ?? []), 'admission'])];
      await refuseOnMembership(client, locked.lock, membershipId, VISIT_REFUSAL_REASON, curated);
    }
    await client.query(
      `UPDATE experience_visit_questions SET answer = $2, answered_by = $3, answered_at = NOW()
        WHERE membership_id = $1 AND answer IS NULL`,
      [membershipId, answer, userId],
    );
    await client.query(`
      INSERT INTO experience_curation_log (experience_id, curator_id, action, region_id, details)
      VALUES ($1, $2, 'visit_question_answered', $3, $4)
    `, [experienceId, userId, logRegionId, JSON.stringify({
      membershipId, kind: question.kind, answer, reading: question.reading,
      confidence: Number(question.confidence), witnesses: question.witnesses, note: note ?? null,
    })]);
    await client.query('COMMIT');
    return {
      result: { experienceId, membershipId, answer, admission: answer === 'refused' ? 'refused' : 'admitted' },
    };
  } catch (error) {
    unusable = await rollbackQuietly(client);
    throw error;
  } finally {
    client.release(unusable);
  }
}
