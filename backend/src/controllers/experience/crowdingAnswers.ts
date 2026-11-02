/**
 * A curator's answers to a crowded city, applied together (ADR-0180, #2282).
 *
 * POST /api/experiences/review/crowding/answers
 *   { answers: [{ membershipId, answer: 'list' | 'shadow' | 'refuse' | 'clear' }], note? }
 *
 * The window (`crowdingWindow.ts`) shows every place of a type around a place,
 * and the curator gives each row one answer, applied with one click:
 *
 * | answer | a place a reader is shown, or in the tail | a new arrival |
 * |---|---|---|
 * | list | pinned in the list | published, pinned in the list |
 * | shadow | pinned in the shadow | published, pinned in the shadow |
 * | refuse | taken out of the kind (`keepOutUnderLock`) | refused (`refuseArrivalUnderLock`) |
 * | clear | handed back to the rule | handed back to the rule, still unread |
 *
 * Its shape is the batch answer's (`reviewAnswerController.ts`): **each place
 * is its own act**, with its own scope check, lock, transaction, log rows and
 * outcome, so one row refused neither abandons the rest nor disappears. An
 * answer that publishes or refuses goes through the writer the arrival's card
 * calls, and the pin is written in that writer's transaction
 * (`alsoUnderLock`), so a published arrival never lands without the pin it
 * was published for. A pin's change recounts the crowding around its place as
 * it commits (`crowding_follows_membership_change`), as a refusal does.
 *
 * A place holding a work a reader is shown is always shown (ADR-0173), and a
 * type its kind exempts is never counted (ADR-0179): neither takes a pin, and
 * the answer is refused by name with a 409. A refusal is a refusal whatever
 * the place holds.
 */

import type { Pool, PoolClient } from 'pg';
import type { z } from 'zod/v4';
import type { CrowdingAnswered } from '../../api/responses/crowding.js';
import { pool, rollbackQuietly } from '../../db/index.js';
import { lockExperience, type LockedExperience, type UnderLock } from '../../db/experienceWriter.js';
import { FAME, KINDS, MEMBERSHIPS, membershipAdmittedSql, membershipOfferedSql } from '../../db/membership.js';
import { Refusal } from '../../middleware/errorHandler.js';
import { drainPairing } from '../../services/sync/mergeProposalFinder.js';
import type { crowdingAnswersBodySchema } from '../../types/index.js';
import { refuseArrivalUnderLock } from './curatorRefusalController.js';
import { resolveExperienceScope } from './experienceScope.js';
import { keepOutUnderLock } from './keepOutController.js';
import type { AnswerRefusal } from './lifecycleController.js';
import { setCrowdingPin, type CrowdingPin } from './membershipWriter.js';
import { publishUnderLock } from './publishController.js';

type Body = z.output<typeof crowdingAnswersBodySchema>;
type CrowdingAnswer = Body['answers'][number]['answer'];

/** What one answer did, as the report names it. */
type Answered = CrowdingAnswered['answered'][number];
type Outcome = { answered: Answered; placement?: CrowdingAnswered['placementFailed'][number] } | { refusal: AnswerRefusal };

/** The pin each answer leaves; a refusal leaves none, since a refused place is no candidate. */
const PIN_OF: Record<CrowdingAnswer, CrowdingPin | null> = { list: 'list', shadow: 'shadow', refuse: null, clear: null };

/**
 * Apply a curator's answers to a crowded city, one place at a time.
 * A membership named twice is answered once, by its first answer.
 */
export async function answerCrowding(
  { body: { answers, note }, caller }: { body: Body; caller: Express.User },
): Promise<CrowdingAnswered> {
  const seen = new Set<number>();
  const distinct = answers.filter(({ membershipId }) => !seen.has(membershipId) && seen.add(membershipId));
  const found = await pool.query<{ id: number; experience_id: number; source_id: number; name: string }>(
    `SELECT m.id, m.experience_id, m.source_id, e.name
       FROM ${MEMBERSHIPS} m JOIN experiences e ON e.id = m.experience_id
      WHERE m.id = ANY($1::int[])`,
    [distinct.map(a => a.membershipId)],
  );
  const memberships = new Map(found.rows.map(row => [row.id, row]));

  const result: CrowdingAnswered = { answered: [], refused: [], outOfScope: 0, placementFailed: [] };
  let published = false;
  for (const { membershipId, answer } of distinct) {
    const membership = memberships.get(membershipId);
    if (!membership) {
      result.refused.push({ membershipId, experienceId: null, name: null, status: 404, error: 'Membership not found' });
      continue;
    }
    const named = { membershipId, experienceId: membership.experience_id, name: membership.name };
    try {
      // The membership's source decides the scope, as every answer about one kind does (#1264).
      const { permitted, logRegionId } = await resolveExperienceScope(
        caller.id, caller.role, membership.experience_id, membership.source_id);
      if (!permitted) {
        result.outOfScope += 1;
        continue;
      }
      const outcome = await answerOne(
        { ...named, userId: caller.id, logRegionId, note: note ?? null }, answer);
      if ('refusal' in outcome) {
        result.refused.push({ ...named, status: outcome.refusal.status, error: outcome.refusal.error });
        continue;
      }
      result.answered.push(outcome.answered);
      published ||= outcome.answered.published;
      if (outcome.placement) result.placementFailed.push(outcome.placement);
    } catch (error) {
      console.error('[crowding-answer] membership %d failed:', membershipId, error);
      result.refused.push({ ...named, status: 500, error: 'The answer failed on the server — reload and try this one again' });
    }
  }
  // What the publishes changed, paired again with near places once after the loop (#1950).
  if (published) await drainPairing();
  return result;
}

interface Answerer {
  membershipId: number;
  experienceId: number;
  name: string;
  userId: number;
  logRegionId: number | null;
  note: string | null;
}

/** The membership as the answer reads it under the place's lock. */
interface Standing {
  kind_name: string;
  type: string | null;
  admission: string;
  curation_state: string;
  offered: boolean;
  missing: boolean;
  rule: boolean;
  exempt: boolean;
  holds_works: boolean;
  outranked_by: number | null;
  rule_crowded: boolean;
}

/** Which writer answers, read before the lock and read again under it. */
async function answerOne(who: Answerer, answer: CrowdingAnswer): Promise<Outcome> {
  const before = await readStanding(pool, who);
  if (!before) return refused(409, 'This place no longer holds that kind — reload');
  const arrival = before.curation_state === 'pending';
  if (answer === 'refuse') return refuseOne(who, arrival, before);
  if (answer === 'clear' || !arrival) return pinOne(who, answer);
  // An arrival a curator keeps, in the list or in the shadow, is published with its pin.
  const ruling = pinRefusal(before, answer);
  if (ruling) return { refusal: ruling };
  if (before.missing) return refused(409, 'Its source no longer lists this place, so it is not published — answer it on its card');
  try {
    const outcome = await publishUnderLock(who.experienceId, who.userId, who.logRegionId,
      { membershipId: who.membershipId }, pinUnder(who, answer));
    if (outcome.refusal) return refused(outcome.refusal.status, outcome.refusal.error);
    const r = outcome.result!;
    return {
      answered: { ...answered(who, answer), published: true },
      placement: r.placementFailed
        ? { membershipId: who.membershipId, name: who.name, worldViews: r.placementFailedWorldViews ?? [] }
        : undefined,
    };
  } catch (error) {
    if (error instanceof Refusal) return refused(error.statusCode, error.body.error);
    throw error;
  }
}

/** The answer's report row, before what it published or refused. */
function answered(who: Answerer, answer: CrowdingAnswer): Answered {
  return {
    membershipId: who.membershipId, experienceId: who.experienceId, name: who.name,
    answer, pin: PIN_OF[answer], published: false, refused: false,
  };
}

function refused(status: number, error: string): Outcome {
  return { refusal: { status, error } };
}

/**
 * Why the membership takes no pin, or null where it may take this one:
 * nothing to answer in a kind with no rule, nothing to keep in a list or a
 * shadow for a refused place, a place holding works or an exempt type.
 */
function pinRefusal(standing: Standing, answer: CrowdingAnswer): AnswerRefusal | null {
  if (!standing.rule) {
    return { status: 409, error: `${standing.kind_name} shows every place it admits: there is no list or shadow to keep it in` };
  }
  if (answer === 'clear') return null;
  if (standing.admission === 'refused') {
    return { status: 409, error: `${standing.kind_name} refuses this place: put it back before keeping it in the list or the shadow` };
  }
  if (standing.holds_works) {
    return { status: 409, error: 'This place holds a work a reader is shown, so it is always shown and takes no pin (ADR-0173)' };
  }
  if (standing.exempt) {
    return {
      status: 409,
      error: `${standing.kind_name} never hides a place of the type ${standing.type ?? 'none'}, so it takes no pin (ADR-0179)`,
    };
  }
  return null;
}

/**
 * The pin and its log row, under a lock a writer holds: the standing re-read
 * in the statement after the lock, since what it holds may have changed while
 * the lock was waited for. Throws a `Refusal` the writer rolls back on.
 */
function pinUnder(who: Answerer, answer: CrowdingAnswer): UnderLock {
  return async (client, lock) => {
    const standing = await readStanding(client, who);
    if (!standing) throw new Refusal(409, { error: 'This place no longer holds that kind — reload' });
    const ruling = pinRefusal(standing, answer);
    if (ruling && answer !== 'refuse') throw new Refusal(ruling.status, { error: ruling.error });
    await writePin(client, lock, who, answer, standing);
  };
}

/** The pin on the membership and the act in the curation log, where the pin changes. */
async function writePin(
  client: PoolClient,
  lock: LockedExperience,
  who: Answerer,
  answer: CrowdingAnswer,
  standing: Standing,
): Promise<void> {
  const pin = PIN_OF[answer];
  const { before } = await setCrowdingPin(client, lock, who.membershipId, pin);
  if (before === pin) return;
  // What the rule said when the curator answered, so the answer can be read
  // against it later (#863): the count and where it put the place.
  await client.query(`
    INSERT INTO experience_curation_log (experience_id, curator_id, action, region_id, details)
    VALUES ($1, $2, 'crowding_answered', $3, $4)
  `, [who.experienceId, who.userId, who.logRegionId, JSON.stringify({
    membershipId: who.membershipId, kind: standing.kind_name, type: standing.type,
    answer, pin, before,
    outrankedBy: standing.outranked_by, ruleCrowded: standing.rule_crowded,
    note: who.note,
  })]);
}

/** A pin written, or handed back, on a place no publish or refusal answers: its own transaction. */
async function pinOne(who: Answerer, answer: CrowdingAnswer): Promise<Outcome> {
  const client = await pool.connect();
  let unusable: Error | undefined;
  try {
    await client.query('BEGIN');
    const refuse = async (status: number, error: string): Promise<Outcome> => {
      unusable = await rollbackQuietly(client);
      return refused(status, error);
    };
    const locked = await lockExperience(client, who.experienceId);
    if (!locked) return await refuse(404, 'Experience not found');
    const standing = await readStanding(client, who);
    if (!standing) return await refuse(409, 'This place no longer holds that kind — reload');
    const ruling = pinRefusal(standing, answer);
    if (ruling) return await refuse(ruling.status, ruling.error);
    // An arrival is published by its keeping answer, read before the lock; one
    // that arrived since (a run cannot unpublish) is not answered on stale terms.
    if (answer !== 'clear' && standing.curation_state === 'pending') {
      return await refuse(409, 'This place is a new arrival now — reload to publish it with its answer');
    }
    await writePin(client, locked.lock, who, answer, standing);
    await client.query('COMMIT');
    return { answered: answered(who, answer) };
  } catch (error) {
    unusable = await rollbackQuietly(client);
    throw error;
  } finally {
    client.release(unusable);
  }
}

/**
 * "Don't take": a refusal as any curator's refusal, through the writer the
 * place's card calls, with a pin it held cleared in the same transaction.
 */
async function refuseOne(who: Answerer, arrival: boolean, standing: Standing): Promise<Outcome> {
  if (standing.admission === 'refused') return refused(409, `${standing.kind_name} already refuses this place`);
  const note = who.note ?? undefined;
  const clear = pinUnder(who, 'refuse');
  if (arrival) {
    const outcome = await refuseArrivalUnderLock(who.experienceId, who.userId, who.logRegionId,
      { membershipId: who.membershipId, note }, clear);
    if (outcome.refusal) return { refusal: outcome.refusal };
  } else {
    if (!standing.offered) return refused(409, 'This kind does not offer the place — answer it on its card');
    const outcome = await keepOutUnderLock(who.experienceId, who.userId, who.logRegionId,
      { membershipId: who.membershipId, note }, clear);
    if (outcome.refusal) return { refusal: outcome.refusal };
  }
  return { answered: { ...answered(who, 'refuse'), refused: true } };
}

/**
 * The membership as an answer reads it: its kind's rule, its gate state, and
 * what the rule counts for it now (`crowding_outranked_by()`). Undefined where
 * the place no longer holds it.
 */
async function readStanding(
  client: Pool | PoolClient, who: Pick<Answerer, 'membershipId' | 'experienceId'>,
): Promise<Standing | undefined> {
  const result = await client.query<Standing>(
    `SELECT k.name AS kind_name, m.type, m.admission, m.curation_state,
            (${membershipOfferedSql('m')}) AS offered,
            e.missing_since IS NOT NULL AS missing,
            k.crowding_limit IS NOT NULL AS rule,
            COALESCE(m.type = ANY(k.crowding_exempt_types), FALSE) AS exempt,
            place_shows_works(e.id) AS holds_works,
            crowding_outranked_by(m.id) AS outranked_by,
            COALESCE(${membershipAdmittedSql('m')} AND f.score IS NOT NULL AND NOT place_shows_works(e.id)
              AND NOT COALESCE(m.type = ANY(k.crowding_exempt_types), FALSE)
              AND crowding_outranked_by(m.id) >= k.crowding_limit, FALSE) AS rule_crowded
       FROM ${MEMBERSHIPS} m
       JOIN experiences e ON e.id = m.experience_id
       JOIN ${KINDS} k ON k.id = m.kind_id
       LEFT JOIN ${FAME} f ON f.membership_id = m.id
      WHERE m.id = $1 AND m.experience_id = $2`,
    [who.membershipId, who.experienceId],
  );
  return result.rows[0];
}
