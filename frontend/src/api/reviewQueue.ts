/**
 * Review queue API client
 *
 * The curator's review queue (ADR-0051): the page of open questions and the
 * shapes of its rows, a run's batch set aside and brought back, and a page of
 * rows answered at once (#852) — every endpoint under
 * `/api/experiences/review/`.
 */

import type {
  QueueKind, ReviewAnswer, ReviewAnswerResult, ReviewQueue, RunSetAside,
} from '@tyr/shared/api';
import { API_URL, authFetchJson } from './fetchUtils';
import type { ReviewAddress } from '../utils/appUrl';

// What every call here answers is declared once, as a backend schema (ADR-0066),
// and generated into `@tyr/shared/api`. Passed on from here, so a component
// imports a call's answer from the module of the call.
export type {
  AnsweredPoint, ChangedField, CountedWork, EarlierAnswer, FieldClaim, HeldPart, PendingPoint, PendingWork,
  ProposedField, QueueFacets, QueueKind, QueueOrderEntry, RefusedPoint, RefusedWork, ReviewAnswer,
  ReviewAnswerDid, ReviewAnswerResult, ReviewQueue, ReviewQueueItem, RunSetAside, WaitingSub, WithdrawnPoint,
} from '@tyr/shared/api';

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
  const search = new URLSearchParams();
  if (params.sort === 'question') search.set('sort', params.sort);
  if (params.q) search.set('q', params.q);
  if (params.sourceIds.length > 0) search.set('source', params.sourceIds.join(','));
  if (params.kinds.length > 0) search.set('kind', params.kinds.join(','));
  if (params.regionId !== null) search.set('region', String(params.regionId));
  if (params.runId !== null) search.set('run', String(params.runId));
  if (params.showAside) search.set('aside', 'show');
  if (params.cursor) search.set('cursor', params.cursor);
  if (params.limit !== undefined) search.set('limit', String(params.limit));
  if (params.keptOutOffset) search.set('keptOutOffset', String(params.keptOutOffset));
  if (params.answeredWithdrawalsOffset) {
    search.set('answeredWithdrawalsOffset', String(params.answeredWithdrawalsOffset));
  }
  if (params.refusedPartsOffset) {
    search.set('refusedPartsOffset', String(params.refusedPartsOffset));
  }
  return authFetchJson<ReviewQueue>(`${API_URL}/api/experiences/review/queue?${search}`);
}

/**
 * A curator's "not now" on a whole run's batch of open questions (ADR-0051
 * decision 4). `bringRunBack` is the way back. Both echo the run id and the
 * state the caller asked for — a second click on either is the same 200 as
 * the first (`reviewQueueSetAside.ts`).
 */
export async function setRunAside(syncLogId: number): Promise<RunSetAside> {
  return authFetchJson(`${API_URL}/api/experiences/review/set-aside/${syncLogId}`, {
    method: 'PUT',
  });
}

/** Undoes `setRunAside`: brings a set-aside run's batch back into view. */
export async function bringRunBack(syncLogId: number): Promise<RunSetAside> {
  return authFetchJson(`${API_URL}/api/experiences/review/set-aside/${syncLogId}`, {
    method: 'DELETE',
  });
}

/** A row as the batch names it: the server's kind word, the object, the run it was asked by. */
export interface ReviewAnswerRow {
  kind: QueueKind;
  id: number;
  runId: number | null;
}

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
  return authFetchJson(`${API_URL}/api/experiences/review/answer`, {
    method: 'POST',
    body: JSON.stringify({ rows, answer }),
  });
}
