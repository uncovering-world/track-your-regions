/**
 * The one line a curator reads after answering a selection (#852).
 *
 * `curationGateNotice.ts`'s shape, for the same reason it has one: every
 * clause is a claim about what happened, assembled from separate builders so
 * each can be tested on its own. What became visible first, then what stopped
 * being shown, then everything that did not happen — refusals grouped by
 * reason and capped, what was out of scope, what could not be re-placed. A
 * batch that stopped on a transport error says which objects may already be
 * answered, since each was its own transaction.
 */

import type { ReviewAnswer, ReviewAnswerResult } from '../../../api/experiences';
import { plural } from '../../../utils/plural';
import { outOfScopeClause, refusalClauses, stalePlacementClause } from '../../../utils/noticeClauses';
import type { AnswerStopped } from './answerRows';

type Kind = ReviewAnswerResult['answered'][number]['kind'];

/**
 * What one kind's answer did, in one clause: the act the card's own words
 * name, counted. An accepted waiting row is "published" only where the
 * object became visible — a held change or unread contents under a visible
 * object is "applied" or "released" instead — so the count is split by what
 * the report says was done, not by the row's kind.
 */
function actClause(answer: ReviewAnswer, kind: Kind, rows: ReviewAnswerResult['answered']): string | null {
  if (rows.length === 0) return null;
  return ACT[kind](answer, rows);
}

type Rows = ReviewAnswerResult['answered'];

/** Clauses named only where their count is non-zero, joined. */
function clauses(...parts: Array<[number, string]>): string {
  return parts.filter(([n]) => n > 0).map(([, clause]) => clause).join(', ');
}

/**
 * A `waiting` row is an arrival, a held change, unread contents under a
 * visible object — or a held change *and* unread contents, since both answers
 * reach every sub-kind the row holds — and the report tells them apart by
 * what the writer counted, a row landing in two buckets where it held two
 * things: an arrival is `published` (1 accepted, 0 kept out) and nothing
 * else; a held change carries `fields` (applied or refused); contents are the
 * points and works a visible object released or turned down.
 */
function waitingAct(answer: ReviewAnswer, rows: Rows): string {
  const held = rows.filter(r => r.did.fields !== undefined).length;
  const contents = rows.filter(r => (r.did.published ?? 0) === 0
    && (r.did.locations ?? 0) + (r.did.treasureLinks ?? 0) + (r.did.treasures ?? 0) > 0).length;
  const arrivals = rows.filter(r => answer === 'reject'
    ? r.did.fields === undefined && r.did.locations === undefined
    : (r.did.published ?? 0) > 0).length;
  if (answer === 'reject') {
    return clauses(
      [arrivals, `${plural(arrivals, 'arrival')} kept out`],
      [held, `${plural(held, 'held change')} refused`],
      [contents, `unread contents of ${plural(contents, 'object')} turned down`],
    );
  }
  return clauses(
    [arrivals, `${plural(arrivals, 'object')} published`],
    [held, `${plural(held, 'held change')} applied`],
    [contents, `unread contents of ${plural(contents, 'object')} released`],
  );
}

function verdictAct(noun: string, lostWord: string, formerWord: string, presentWord: string) {
  return (answer: ReviewAnswer, n: number): string => {
    if (answer === 'lost') return `${plural(n, noun)} ${lostWord}`;
    return `${plural(n, noun)} ${answer === 'accept' ? formerWord : presentWord}`;
  };
}

const missingAct = verdictAct('object', 'recorded as no longer existing', 'recorded as delisted', 'cleared as a false alarm');
const withdrawnAct = verdictAct('place', 'recorded as no longer existing', 'recorded as dropped by the source', 'put back');

const ACT: Record<Kind, (answer: ReviewAnswer, rows: Rows) => string> = {
  waiting: waitingAct,
  conflict: (answer, rows) => (answer === 'accept'
    ? `the source’s value taken on ${plural(rows.length, 'object')}`
    : `ours kept on ${plural(rows.length, 'object')}`),
  refused: (answer, rows) => `${plural(rows.length, 'refusal')} ${answer === 'accept' ? 'put back' : 'kept out'}`,
  missing: (answer, rows) => missingAct(answer, rows.length),
  // A withdrawn row is answered point by point, and a point that moved under
  // the batch refuses on its own while the row still counts as answered — so
  // the ones left standing are named, or a partial answer reads as a whole one.
  withdrawn: (answer, rows) => {
    const points = rows.reduce((sum, r) => sum + (r.did.points ?? 0), 0);
    const left = rows.reduce((sum, r) => sum + (r.did.pointsRefused ?? 0), 0);
    const act = withdrawnAct(answer, points);
    if (left === 0) return act;
    const stands = left === 1 ? 'it stands' : 'they stand';
    return `${act}, ${plural(left, 'place')} left as ${stands} (someone else answered first)`;
  },
};

function openingClauses(result: ReviewAnswerResult): string[] {
  const byKind = new Map<Kind, ReviewAnswerResult['answered']>();
  for (const row of result.answered) byKind.set(row.kind, [...(byKind.get(row.kind) ?? []), row]);
  const acts = [...byKind].map(([kind, rows]) => actClause(result.answer, kind, rows)).filter(Boolean);
  if (acts.length === 0) {
    const nothingThere = result.refused.length === 0 && result.outOfScope === 0;
    return [nothingThere ? 'Nothing was answered.' : 'Nothing was changed.'];
  }
  const line = acts.join('; ');
  return [`${line.charAt(0).toUpperCase()}${line.slice(1)}.`];
}

/** What became visible, in the terms a reader would notice it in — the gate notice's line. */
function releasedClause(answered: ReviewAnswerResult['answered']): string[] {
  const points = answered.reduce((n, r) => n + (r.did.locations ?? 0), 0);
  const works = answered.reduce(
    (n, r) => n + Math.max(r.did.treasureLinks ?? 0, r.did.treasures ?? 0), 0);
  // Only where the answer released something: a rejected contents row counts
  // its refused parts under the same keys, and those became nothing.
  const releasing = answered.some(r => r.answer === 'accept');
  if (!releasing) return [];
  const released: string[] = [];
  if (points > 0) released.push(plural(points, 'point'));
  if (works > 0) released.push(plural(works, 'work'));
  return released.length === 0 ? [] : [`${released.join(' and ')} now visible.`];
}

function withdrawalClause(answered: ReviewAnswerResult['answered']): string[] {
  const total = answered.reduce((n, r) => n + (r.did.withdrawalsReleased ?? 0), 0);
  return total === 0 ? [] : [`${plural(total, 'replaced point')} no longer shown.`];
}

/** The one line, in the order the gate notice keeps. */
export function answerNoticeFor(result: ReviewAnswerResult): string {
  return [
    ...openingClauses(result),
    ...releasedClause(result.answered),
    ...withdrawalClause(result.answered),
    ...refusalClauses(result.refused),
    ...outOfScopeClause(result.outOfScope),
    ...stalePlacementClause(result.placementFailed, 'answered'),
  ].join(' ');
}

/**
 * The line for a batch that stopped part-way: what landed, and the honest
 * status of what did not. Each object is its own transaction on the server,
 * so the request that failed may have answered some or all of its rows.
 */
export function stoppedNoticeFor(stopped: AnswerStopped): string {
  // Anything the report holds is reported — refusals and out-of-scope rows
  // included, since a page every row of which someone else answered first is
  // a page whose reasons the curator still needs.
  const { answered, refused, outOfScope } = stopped.partial;
  const reported = answered.length + refused.length + outOfScope > 0;
  const lead = reported
    ? `${answerNoticeFor(stopped.partial)} Then the batch stopped`
    : 'The batch stopped before anything was reported';
  // Between requests nothing was in flight — a queue re-read failed — so
  // nothing is in doubt; mid-request, the rows it carried may be answered.
  const doubt = stopped.inFlight > 0
    ? `The ${plural(stopped.inFlight, 'row')} it was sending may already be answered — reload to see what is still waiting.`
    : 'Nothing was in flight; reload to see what is still waiting.';
  return `${lead}: ${stopped.message}. ${doubt}`;
}
