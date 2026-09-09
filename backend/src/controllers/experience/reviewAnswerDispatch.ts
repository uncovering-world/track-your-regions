/**
 * One review row, one answer: which writer that is, and what it is told
 * (#852).
 *
 * Every row in the review feed is a change the source proposes, and a
 * proposal has two answers — accept it or reject it — whatever the row's
 * kind. This module is the table that says what each answer *does* for each
 * kind, and it does none of it itself: every arm calls the `*UnderLock`
 * function the single-row card already calls, so one row and a hundred are
 * decided by the same statements, under the same lock, with the same
 * refusals. The batch controller loops; this dispatches.
 *
 * | kind | accept | reject | lost |
 * |---|---|---|---|
 * | waiting, arrival | publish the object and what arrived with it | keep it out (a curator's refusal) | — |
 * | waiting, held | publish every open held field and part, and the unread contents | refuse every open held row, and the unread contents | — |
 * | waiting, contents only | release the unread points and works | refuse them | — |
 * | conflict | take the source's value for every open field | keep ours for every open field | — |
 * | refused | put it back (override, which publishes an arrival) | keep it out (confirm) | — |
 * | missing | former: delisted, still there | the object stays: false alarm | no longer exists |
 * | withdrawn | every open point: former | every open point: stays | every open point: lost |
 *
 * **What is asked is re-asked under the lock, never trusted from the row.** A
 * `waiting` row's sub-kinds are read here from the membership, not from the
 * client; the held and conflict writers compare `runId` with the pointer and
 * refuse a replaced proposal; the two verdict writers take the `expected`
 * block an open row means and refuse a row that moved. What the client sends
 * is which row and which answer — the same two things a click sends.
 */

import { pool } from '../../db/index.js';
import { MEMBERSHIPS, membershipToAnswerSql } from '../../db/membership.js';
import { acceptSourceUnderLock } from './acceptSourceController.js';
import { refuseArrivalUnderLock, refuseContentsUnderLock } from './curatorRefusalController.js';
import { declineSourceUnderLock } from './declineSourceController.js';
import { refuseUnderLock } from './declineHeldController.js';
import {
  answerAdmissionUnderLock, answerStateUnderLock, type AnswerRefusal,
} from './lifecycleController.js';
import { answerLocationStateUnderLock } from './locationStateController.js';
import { publishUnderLock } from './publishController.js';
import {
  missingOpenSql, refusedOpenSql, withdrawnContainerOpenSql, withdrawnPointOpenSql,
} from './reviewQueuePredicates.js';
import { arrivalWaitingSql, contentsWaitingSql, heldWaitingSql } from './waitingCounts.js';

export type AnswerKind = 'conflict' | 'waiting' | 'withdrawn' | 'refused' | 'missing';
export type Answer = 'accept' | 'reject' | 'lost';

export interface AnswerRow {
  kind: AnswerKind;
  id: number;
  /** The run the curator saw the question asked by — the key's own `runId`. */
  runId: number | null;
}

/** What one answer did, counted; the notice sums these per kind and answer. */
export interface Did {
  /** 1 where this answer made the object visible to readers. */
  published?: number;
  locations?: number;
  treasureLinks?: number;
  treasures?: number;
  withdrawalsReleased?: number;
  /** Held or claimed fields this answer applied, released or refused — the parts' rows counted with the object's. */
  fields?: number;
  /** Points answered, for a withdrawn row. */
  points?: number;
  /** Points on the same row that refused the answer, for a withdrawn row. */
  pointsRefused?: number;
}

export interface Placement {
  worldViews: Array<{ id: number | null; name: string | null }>;
}

export type Outcome =
  | { did: Did; placement?: Placement }
  | { refusal: AnswerRefusal };

type Answerer = {
  experienceId: number; userId: number; logRegionId: number | null; runId: number | null;
};

/** Answer one row; the caller has resolved the scope and catches what throws. */
export async function answerRow(
  who: Answerer, kind: AnswerKind, answer: Answer,
): Promise<Outcome> {
  if (answer === 'lost' && kind !== 'missing' && kind !== 'withdrawn') {
    return refused(409, 'Lost is an answer about an object or a point that has left, not about this row');
  }
  switch (kind) {
    case 'waiting': return answerWaiting(who, answer);
    case 'conflict': return answerConflict(who, answer);
    case 'refused': return answerRefused(who, answer);
    case 'missing': return answerMissing(who, answer);
    case 'withdrawn': return answerWithdrawn(who, answer);
  }
}

function refused(status: number, error: string): Outcome {
  return { refusal: { status, error } };
}

/** The writers' own refusal shapes, folded into one: some carry no status. */
function refusedBy(refusal: { status?: number; error: string }): Outcome {
  return { refusal: { ...refusal, status: refusal.status ?? 409 } };
}

function placementOf(result: {
  placementFailed?: true;
  placementFailedWorldViews?: Array<{ id: number | null; name: string | null }>;
}): Placement | undefined {
  return result.placementFailed ? { worldViews: result.placementFailedWorldViews ?? [] } : undefined;
}

const RELOAD_RUN = 'This row names no run — reload to see which run proposed it';

/**
 * The three gated sub-kinds, read from the membership rather than taken from
 * the client: an object is one row in the feed however many it holds
 * (ADR-0051 decision 2), and the answer reaches all of them.
 */
async function answerWaiting(who: Answerer, answer: Answer): Promise<Outcome> {
  const { experienceId, runId } = who;
  const read = await pool.query(
    `SELECT (${arrivalWaitingSql()}) AS arrival,
            (${heldWaitingSql()}) AS held,
            (${contentsWaitingSql()}) AS contents
       FROM experiences e
       JOIN ${MEMBERSHIPS} m ON m.id = ${membershipToAnswerSql('e.id', 'waiting')}
      WHERE e.id = $1`,
    [experienceId],
  );
  const subs = read.rows[0] as WaitingSubs | undefined;
  if (!subs || (!subs.arrival && !subs.held && !subs.contents)) {
    return refused(409, 'Already answered: this object is not waiting on anything');
  }
  if (subs.held && runId === null) return refused(409, RELOAD_RUN);
  return answer === 'accept' ? acceptWaiting(who, subs) : rejectWaiting(who, subs);
}

type WaitingSubs = { arrival: boolean; held: boolean; contents: boolean };

/**
 * The publish body a whole-card answer sends, the three shapes the card's own
 * `publishBodyFor` sends: an arrival's publish takes what arrived with it; a
 * held object's takes every open row of the proposal *and* the unread
 * contents; contents alone is the third.
 */
function publishBodyFor(subs: WaitingSubs, runId: number | null) {
  if (subs.arrival) return {};
  if (subs.held) return { expectedSyncLogId: runId as number };
  return { contentsOnly: true as const };
}

async function acceptWaiting(who: Answerer, subs: WaitingSubs): Promise<Outcome> {
  const { experienceId, userId, logRegionId, runId } = who;
  const outcome = await publishUnderLock(experienceId, userId, logRegionId, publishBodyFor(subs, runId));
  if (outcome.refusal) return refusedBy(outcome.refusal);
  const r = outcome.result!;
  // `fields` only where the row held a proposal: the report tells an arrival,
  // a held change and unread contents apart by which counts are present.
  return {
    did: {
      published: subs.arrival ? 1 : 0,
      ...(subs.held ? { fields: r.appliedFields.length + r.appliedParts.length } : {}),
      locations: r.locationsPublished,
      treasureLinks: r.treasureLinksPublished,
      treasures: r.treasuresPublished,
      withdrawalsReleased: r.withdrawalsReleased,
    },
    placement: placementOf(r),
  };
}

async function rejectWaiting(who: Answerer, subs: WaitingSubs): Promise<Outcome> {
  const { experienceId, userId, logRegionId, runId } = who;
  if (subs.arrival) {
    const outcome = await refuseArrivalUnderLock(experienceId, userId, logRegionId, {});
    return outcome.refusal ? refusedBy(outcome.refusal) : { did: { published: 0 } };
  }
  const did: Did = {};
  if (subs.held) {
    const outcome = await refuseUnderLock(experienceId, userId, logRegionId, null, runId as number);
    if (outcome.refusal) return refusedBy(outcome.refusal);
    // Every held row refused, the object's own fields and the parts' alike —
    // one count, as the accept side counts what it applied.
    did.fields = outcome.result!.declinedFields.length
      + outcome.result!.declinedParts.reduce((n, part) => n + part.fields.length, 0);
  }
  if (subs.contents) {
    const outcome = await refuseContentsUnderLock(experienceId, userId, logRegionId, {});
    // A held refusal that landed is an answer even where the contents moved
    // in between; only a row with nothing else to answer reports the miss.
    if (outcome.refusal && !subs.held) return refusedBy(outcome.refusal);
    did.locations = outcome.result?.locationsRefused ?? 0;
    did.treasureLinks = outcome.result?.treasureLinksRefused ?? 0;
    // The one fact only this answer records: the old pins a refused arrival
    // had been holding on the map, withdrawn now — and the re-placement that
    // follows, where it failed, carried as every accept arm carries it.
    did.withdrawalsReleased = outcome.result?.withdrawalsReleased ?? 0;
    return { did, placement: outcome.result ? placementOf(outcome.result) : undefined };
  }
  return { did };
}

async function answerConflict(who: Answerer, answer: Answer): Promise<Outcome> {
  const { experienceId, userId, logRegionId, runId } = who;
  if (runId === null) return refused(409, RELOAD_RUN);
  if (answer === 'accept') {
    const outcome = await acceptSourceUnderLock(experienceId, userId, logRegionId, 'all', runId);
    if (outcome.refusal) return refusedBy(outcome.refusal);
    const r = outcome.result!;
    return {
      did: { fields: r.applied.length + r.released.length },
      placement: placementOf(r),
    };
  }
  const outcome = await declineSourceUnderLock(experienceId, userId, logRegionId, 'all', runId);
  if (outcome.refusal) return refusedBy(outcome.refusal);
  return { did: { fields: outcome.result!.declined.length } };
}

/**
 * The refusal card's two buttons. The admission writer carries its own
 * "already answered" — the pin — so the open-question read here is only what
 * keeps a batch from confirming a refusal on a row that is not refused at all.
 */
async function answerRefused(who: Answerer, answer: Answer): Promise<Outcome> {
  const { experienceId, userId, logRegionId } = who;
  const open = await pool.query(
    `SELECT 1 FROM ${MEMBERSHIPS} m
      WHERE m.id = ${membershipToAnswerSql('$1::int', 'refused')} AND ${refusedOpenSql('m')}`,
    [experienceId],
  );
  if (open.rows.length === 0) {
    return refused(409, 'Already answered: this row is not waiting on a refusal decision');
  }
  const outcome = await answerAdmissionUnderLock(experienceId, userId, logRegionId, {
    decision: answer === 'accept' ? 'override' : 'confirm',
  });
  if (outcome.refusal) return refusedBy(outcome.refusal);
  const r = outcome.result!;
  return {
    did: {
      published: r.published ? 1 : 0,
      locations: r.locationsPublished,
      treasureLinks: r.treasureLinksPublished,
      treasures: r.treasuresPublished,
      withdrawalsReleased: r.withdrawalsReleased,
    },
    placement: placementOf(r),
  };
}

type Axes = { source_membership: 'present' | 'former'; existence: 'extant' | 'lost'; missing_since: Date | null };

/** The verdict the answer names, on either an object or a point. */
function verdictFor(answer: Answer): { membership?: 'former' | 'present'; existence?: 'lost' } {
  if (answer === 'lost') return { existence: 'lost' };
  return { membership: answer === 'accept' ? 'former' : 'present' };
}

/** The `expected` block an open row means — the row as the queue showed it. */
function expectedOf(row: Axes) {
  return { membership: row.source_membership, existence: row.existence, flagged: row.missing_since != null };
}

async function answerMissing(who: Answerer, answer: Answer): Promise<Outcome> {
  const { experienceId, userId, logRegionId } = who;
  const open = await pool.query(
    `SELECT e.source_membership, e.existence, e.missing_since
       FROM experiences e
      WHERE e.id = $1 AND ${missingOpenSql('e')}`,
    [experienceId],
  );
  const row = open.rows[0] as Axes | undefined;
  if (!row) return refused(409, 'Already answered: this object is not waiting on a decision');
  const outcome = await answerStateUnderLock(experienceId, userId, logRegionId, {
    ...verdictFor(answer), expected: expectedOf(row),
  });
  return outcome.refusal ? refusedBy(outcome.refusal) : { did: {} };
}

/**
 * Every open point of the row, each through the point writer — its own lock,
 * its own audit row, its own placement — so the batch's unit of work is the
 * card's, and a point that moved refuses on its own without taking the
 * others with it.
 */
async function answerWithdrawn(who: Answerer, answer: Answer): Promise<Outcome> {
  const { experienceId, userId, logRegionId } = who;
  const open = await pool.query(
    `SELECT el.id, el.source_membership, el.existence, el.missing_since
       FROM experience_locations el
       JOIN experiences e ON e.id = el.experience_id
      WHERE el.experience_id = $1
        AND ${withdrawnPointOpenSql('el')}
        AND ${withdrawnContainerOpenSql('e')}
      ORDER BY el.id`,
    [experienceId],
  );
  const points = open.rows as Array<Axes & { id: number }>;
  if (points.length === 0) {
    return refused(409, 'Already answered: this object has no point waiting on a decision');
  }
  const did: Did = { points: 0, pointsRefused: 0 };
  const worldViews: Placement['worldViews'] = [];
  let firstRefusal: AnswerRefusal | null = null;
  for (const point of points) {
    const outcome = await answerLocationStateUnderLock(point.id, experienceId, userId, logRegionId, {
      ...verdictFor(answer), expected: expectedOf(point),
    });
    if (outcome.refusal) {
      did.pointsRefused! += 1;
      firstRefusal ??= outcome.refusal;
      continue;
    }
    did.points! += 1;
    // Once per world view, not once per point: every point of the row places
    // on its own, and a broken world view fails each of them with the same
    // entry — a sentence meant for an admin must not name it three times.
    for (const view of placementOf(outcome.result!)?.worldViews ?? []) {
      if (!worldViews.some(seen => seen.id === view.id)) worldViews.push(view);
    }
  }
  if (did.points === 0 && firstRefusal) return { refusal: firstRefusal };
  return { did, ...(worldViews.length === 0 ? {} : { placement: { worldViews } }) };
}
