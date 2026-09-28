/**
 * Review queue API client
 *
 * The curator's review queue (ADR-0051): the page of open questions and the
 * shapes of its rows, a run's batch set aside and brought back, and a page of
 * rows answered at once (#852) — every endpoint under
 * `/api/experiences/review/`.
 */

import type {
  ReviewAnswer, ReviewAnswerResult, ReviewQueue, RunSetAside,
} from './client.generated';
import {
  deleteExperiencesReviewSetAsideBySyncLogId, getExperiencesReviewQueue, postExperiencesReviewAnswer,
  putExperiencesReviewSetAsideBySyncLogId,
  type ReviewAnswerBodyRowsItem,
} from './client.generated';
import type { ReviewAddress } from '../utils/appUrl';

// What every call here answers is declared once, as a backend schema (ADR-0066),
// and generated into `client.generated.ts`. Passed on from here, so a component
// imports a call's answer from the module of the call.
export type {
  AnsweredPoint, ChangedField, CountedWork, EarlierAnswer, FieldClaim, HeldPart, PendingPoint, PendingWork,
  ProposedField, QueueFacets, QueueKind, QueueOrderEntry, RefusedPoint, RefusedWork, ReviewAnswer,
  ReviewAnswerDid, ReviewAnswerResult, ReviewQueue, ReviewQueueItem, RunSetAside, WaitingSub, WithdrawnPoint,
} from './client.generated';

/**
 * The three answered lists that still page by their own offset, outside the
 * cursor order: `keptOut`, `answeredWithdrawals` and `refusedParts` are not
 * open questions and only ever grow, so `fetchReviewQueue`'s `keptOutOffset` /
 * `answeredWithdrawalsOffset` / `refusedPartsOffset` name them by this word.
 */
export type ReviewQueueKind = 'keptOut' | 'answeredWithdrawals' | 'refusedParts';

/**
 * What needs a curator's judgement, within their scope — a filtered,
 * ordered, cursor-paged page (ADR-0051). `params` is the review page's
 * address (`ReviewAddress`) plus the cursor and the three offsets the answered
 * lists still page by; `row` names the selected card for a deep link and is
 * not a request parameter, so it is not sent here.
 */
export async function fetchReviewQueue(params: ReviewAddress & {
  cursor?: string;
  limit?: number;
  keptOutOffset?: number;
  answeredWithdrawalsOffset?: number;
  refusedPartsOffset?: number;
}): Promise<ReviewQueue> {
  // The generated call writes the entries in this order and skips an
  // undefined one, so an empty address sends no query at all.
  return getExperiencesReviewQueue({
    sort: params.sort === 'question' ? 'question' : undefined,
    q: params.q || undefined,
    source: params.sourceIds.length > 0 ? params.sourceIds.join(',') : undefined,
    kind: params.kinds.length > 0 ? params.kinds.join(',') : undefined,
    region: params.regionId ?? undefined,
    run: params.runId ?? undefined,
    aside: params.showAside ? 'show' : undefined,
    cursor: params.cursor || undefined,
    limit: params.limit,
    keptOutOffset: params.keptOutOffset || undefined,
    answeredWithdrawalsOffset: params.answeredWithdrawalsOffset || undefined,
    refusedPartsOffset: params.refusedPartsOffset || undefined,
  });
}

/**
 * A curator's "not now" on a whole run's batch of open questions (ADR-0051
 * decision 4). `bringRunBack` is the way back. Both echo the run id and the
 * state the caller asked for — a second click on either is the same 200 as
 * the first (`reviewQueueSetAside.ts`).
 */
export async function setRunAside(syncLogId: number): Promise<RunSetAside> {
  return putExperiencesReviewSetAsideBySyncLogId(syncLogId);
}

/** Undoes `setRunAside`: brings a set-aside run's batch back into view. */
export async function bringRunBack(syncLogId: number): Promise<RunSetAside> {
  return deleteExperiencesReviewSetAsideBySyncLogId(syncLogId);
}

/** A row as the batch names it: the server's kind word, the object, the run it was asked by. */
export type ReviewAnswerRow = ReviewAnswerBodyRowsItem;

/** The most rows one request answers — the queue's own page maximum. */
export const REVIEW_ANSWER_ROWS_MAX = 100;

/**
 * Answer a page of review rows with one answer (#852). Each object is its own act
 * on the server, so the report names what refused rather than failing the batch.
 */
export async function answerReviewRows(
  rows: ReviewAnswerRow[],
  answer: ReviewAnswer,
): Promise<ReviewAnswerResult> {
  return postExperiencesReviewAnswer({ rows, answer });
}
