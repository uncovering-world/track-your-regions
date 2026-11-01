/**
 * An arrival answered with the kind it belongs in instead (#2213).
 *
 * POST /api/experiences/:id/arrival-kind   { membershipId?, kindId, type?, stays, note? }
 *
 * An arrival card asked one question, whether the place belongs in the kind
 * that brought it, and a place that belongs in another kind could only be
 * refused there and then found and added by hand from its own card. The
 * Monument to Peter I before St Michael's Castle in Saint Petersburg arrived
 * in Public art as a `sculpture`; a traveller looks for it under Monuments &
 * memorials, which never read it. One act now: the place is put into the
 * chosen kind with a type from its vocabulary, as a curator's add does
 * (`addKindWithin`, #2035) — admitted, published and pinned, so that kind's
 * run leaves it there — and the arrival is answered in the same act: refused
 * and pinned (`refuseOnMembership`, as a curator's no to an arrival is), so the
 * arriving kind does not bring it back; or, where the curator says it belongs
 * in both, published.
 *
 * The refusal and the add are one transaction under the place's lock. The
 * publish, where the place stays, is the arrival's own (`publishUnderLock`),
 * after it: the add stands whatever the publish answers, and a publish that
 * is refused is reported beside it, the arrival still waiting on its card.
 *
 * The answer is recorded the way each half always is — `kind_added` for the
 * kind, `arrival_refused` for the refusal — so every reader of those rows (the
 * pins, the kept-out list) reads it as it reads any other; each names the other
 * kind (`fromArrival`, `movedTo`), which is what lets the rule review (#2069,
 * #2177) list which places curators moved and from where, a pair of kinds per
 * answer.
 */

import type { z } from 'zod/v4';
import type { ArrivalAnsweredWithKind } from '../../api/responses/curation.js';
import { pool, rollbackQuietly } from '../../db/index.js';
import { lockExperience, recordDecisionOnExperience } from '../../db/experienceWriter.js';
import { KINDS, MEMBERSHIPS, membershipToAnswerSql } from '../../db/membership.js';
import { badRequest, createError, notFound, Refusal } from '../../middleware/errorHandler.js';
import type { arrivalKindBodySchema, idParamSchema } from '../../types/index.js';
import { CURATOR_REFUSAL_REASON } from './curatorRefusalController.js';
import { answeredSourceId, resolveExperienceScope } from './experienceScope.js';
import { addKindWithin, INSCRIBED_KIND_ID, kindSourceSql } from './kindAddController.js';
import type { AnswerRefusal } from './lifecycleController.js';
import { refuseOnMembership } from './membershipWriter.js';
import { publishUnderLock } from './publishController.js';

type ArrivalKindBody = z.output<typeof arrivalKindBodySchema>;

export async function answerArrivalWithKind(
  { params: { id: experienceId }, body, caller }: {
    params: z.output<typeof idParamSchema>; body: ArrivalKindBody; caller: Express.User;
  },
): Promise<ArrivalAnsweredWithKind> {
  if (body.kindId === INSCRIBED_KIND_ID) {
    throw badRequest('A place is a World Heritage Site only by UNESCO\'s inscription');
  }
  const target = await pool.query<{ source_id: number | null }>(`SELECT ${kindSourceSql('$1')} AS source_id`, [body.kindId]);
  const targetSourceId = target.rows[0]?.source_id ?? null;
  if (targetSourceId === null) throw badRequest('No such kind');
  const arrivalSourceId = await answeredSourceId(experienceId, body.membershipId, 'waiting');
  if (arrivalSourceId === null) throw notFound('Experience not found');
  if (arrivalSourceId === 'place') {
    throw new Refusal(409, { error: 'Already answered: this object is not an arrival waiting on a decision' });
  }
  // Both kinds' sources decide: the arrival's answer is the arriving kind's
  // (#1264), the add the chosen kind's (#2035), and a curator answers only
  // where their scope reaches both.
  const arrivalScope = await resolveExperienceScope(caller.id, caller.role, experienceId, arrivalSourceId);
  const targetScope = await resolveExperienceScope(caller.id, caller.role, experienceId, targetSourceId);
  if (!arrivalScope.permitted || !targetScope.permitted) {
    throw createError('You do not have curator permissions for this experience', 403);
  }

  const outcome = await moveArrivalUnderLock(experienceId, caller.id, arrivalScope.logRegionId, targetSourceId, body);
  if (outcome.refusal) {
    const { status, ...refusal } = outcome.refusal;
    throw new Refusal(status, refusal);
  }
  const moved = outcome.result!;
  if (!body.stays) return { ...moved, stays: false, arrivalPublished: false, arrivalWaits: null };

  const published = await publishUnderLock(experienceId, caller.id, arrivalScope.logRegionId, {
    membershipId: moved.arrivalMembershipId,
  });
  return {
    ...moved,
    stays: true,
    arrivalPublished: published.result !== undefined,
    arrivalWaits: published.refusal ? published.refusal.error : null,
  };
}

type Moved = Omit<ArrivalAnsweredWithKind, 'stays' | 'arrivalPublished' | 'arrivalWaits'>;

/**
 * The add, and the arrival's refusal where the place leaves its kind, in one
 * transaction under the place's lock. Open arrivals only, read under the lock
 * by the terms the arrival's own refusal reads (`refuseArrivalUnderLock`).
 */
export async function moveArrivalUnderLock(
  experienceId: number,
  userId: number,
  logRegionId: number | null,
  targetSourceId: number,
  { membershipId: namedMembershipId, kindId, type, stays, note }: ArrivalKindBody,
): Promise<{ result?: Moved; refusal?: AnswerRefusal }> {
  const client = await pool.connect();
  let unusable: Error | undefined;
  try {
    await client.query('BEGIN');
    const refuse = async (refusal: AnswerRefusal): Promise<{ refusal: AnswerRefusal }> => {
      unusable = await rollbackQuietly(client);
      return { refusal };
    };

    const locked = await lockExperience<{ missing_since: Date | null }>(client, experienceId, 'missing_since');
    if (!locked) return await refuse({ status: 404, error: 'Experience not found' });
    const read = await client.query(
      `SELECT m.id AS membership_id, m.admission, m.curation_state, m.curated_fields, m.kind_id, kd.name AS kind
         FROM experiences e
         LEFT JOIN ${MEMBERSHIPS} m ON m.id = ${membershipToAnswerSql('e.id', 'waiting', '$2::int')}
         LEFT JOIN ${KINDS} kd ON kd.id = m.kind_id
        WHERE e.id = $1`,
      [experienceId, namedMembershipId ?? null],
    );
    const arrival = read.rows[0] ?? {};
    const arrivalMembershipId = (arrival.membership_id as number | null) ?? null;
    if (arrivalMembershipId === null || arrival.admission !== 'admitted'
      || arrival.curation_state !== 'pending' || locked.row.missing_since != null) {
      return await refuse({ status: 409, error: 'Already answered: this object is not an arrival waiting on a decision' });
    }
    if (arrival.kind_id === kindId) {
      return await refuse({ status: 400, error: `The place arrived in ${arrival.kind as string}; choose another kind` });
    }

    const added = await addKindWithin(client, locked.lock, kindId, targetSourceId, type ?? null);
    if ('refusal' in added) return await refuse(added.refusal);
    const fromKind = arrival.kind as string;

    if (!stays) {
      // The arrival's no, as a curator's no to an arrival is written: the
      // verdict, its reason and the pin, so the arriving kind's later runs
      // leave it out; who decided and the note on the place.
      const curated = [...new Set([...((arrival.curated_fields as string[]) ?? []), 'admission'])];
      await refuseOnMembership(client, locked.lock, arrivalMembershipId, CURATOR_REFUSAL_REASON, curated);
      await recordDecisionOnExperience(client, locked.lock, userId, note ?? null);
      await client.query(`
        INSERT INTO experience_curation_log (experience_id, curator_id, action, region_id, details)
        VALUES ($1, $2, 'arrival_refused', $3, $4)
      `, [experienceId, userId, logRegionId, JSON.stringify({
        membershipId: arrivalMembershipId, reason: CURATOR_REFUSAL_REASON, note: note ?? null,
        movedTo: { membershipId: added.membershipId, kindId, kind: added.kind, type: type ?? null },
      })]);
    }
    await client.query(`
      INSERT INTO experience_curation_log (experience_id, curator_id, action, region_id, details)
      VALUES ($1, $2, 'kind_added', $3, $4)
    `, [experienceId, userId, logRegionId, JSON.stringify({
      membershipId: added.membershipId, kindId, kind: added.kind, type: type ?? null, note: note ?? null,
      fromArrival: { membershipId: arrivalMembershipId, kindId: arrival.kind_id as number, kind: fromKind, stays },
    })]);

    await client.query('COMMIT');
    return {
      result: {
        experienceId, membershipId: added.membershipId, kindId, kind: added.kind,
        arrivalMembershipId, fromKind,
      },
    };
  } catch (error) {
    // A client whose ROLLBACK also failed must be destroyed, not pooled.
    unusable = await rollbackQuietly(client);
    throw error;
  } finally {
    client.release(unusable);
  }
}
