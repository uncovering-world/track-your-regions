/**
 * Sending a selection to the batch route, a page at a time (#852).
 *
 * The route takes at most one page of rows (`REVIEW_ANSWER_ROWS_MAX`), and
 * never a filter. Two shapes of selection reach it from here:
 *
 * - **The rows on screen**, sent in chunks of that size, so progress can be
 *   said as "answered 250 of 1 078" between chunks rather than after a
 *   request that took a minute.
 * - **Every row the filters match**, which the client does not hold. Those
 *   are walked through the queue's own filtered read with the page maximum
 *   as the limit: an answered row leaves the list, so the first page is the
 *   next unanswered rows. What does not leave — a row the server refused, or
 *   one out of scope — is remembered and skipped; a page holding nothing
 *   untried is not the end but a page to read *past*, by the queue's own
 *   cursor, until a page with untried rows turns up or the cursor runs out.
 *   Every turn of the walk either answers a row or advances the cursor, and
 *   both are finite, which is what keeps a page of stubborn rows from ending
 *   the walk with matching rows still behind it.
 *
 * One merged report either way, in the route's own shape, so the notice reads
 * one thing. A transport error part-way through is rethrown with the report
 * so far attached: the objects already answered are answered, and the chunk
 * that failed may be too — the notice has to say so rather than "nothing".
 */

import {
  answerReviewRows, fetchReviewQueue, REVIEW_ANSWER_ROWS_MAX,
  type ReviewAnswer, type ReviewAnswerResult, type ReviewAnswerRow,
} from '../../../api/experiences';
import type { ReviewAddress } from '../../../utils/appUrl';
import { queueRows, type QueueRow } from '../queueRows';

/** The report so far, and how far "so far" is. */
export interface AnswerProgress {
  answered: number;
  refused: number;
  /** Rows a region-scoped curator's batch left alone — processed, not answered. */
  outOfScope: number;
  /** Rows the walk set out to answer — the selection's size, or the filtered total. */
  of: number;
}

/** A transport failure that carries what had already been answered. */
export class AnswerStopped extends Error {
  constructor(
    message: string,
    public readonly partial: ReviewAnswerResult,
    /** How many rows the failed request carried — each may already be answered. */
    public readonly inFlight: number,
  ) {
    super(message);
    this.name = 'AnswerStopped';
  }
}

/** The server's kind word for a row: the row's own, except the one the row renames. */
export function toAnswerRow(row: QueueRow): ReviewAnswerRow {
  return {
    kind: row.kind === 'conflicts' ? 'conflict' : row.kind,
    id: row.id,
    runId: row.runId,
  };
}

function empty(answer: ReviewAnswer): ReviewAnswerResult {
  return { answer, answered: [], refused: [], outOfScope: 0, placementFailed: [] };
}

function merge(into: ReviewAnswerResult, from: ReviewAnswerResult): ReviewAnswerResult {
  return {
    answer: into.answer,
    answered: [...into.answered, ...from.answered],
    refused: [...into.refused, ...from.refused],
    outOfScope: into.outOfScope + from.outOfScope,
    placementFailed: [...into.placementFailed, ...from.placementFailed],
  };
}

function progressOf(report: ReviewAnswerResult, of: number): AnswerProgress {
  return {
    answered: report.answered.length, refused: report.refused.length, outOfScope: report.outOfScope, of,
  };
}

function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function stopped(error: unknown, report: ReviewAnswerResult, inFlight: number): AnswerStopped {
  return new AnswerStopped(error instanceof Error ? error.message : String(error), report, inFlight);
}

/** Answer the given rows, a page at a time, reporting progress between pages. */
export async function answerRows(
  rows: QueueRow[],
  answer: ReviewAnswer,
  onProgress: (p: AnswerProgress) => void,
): Promise<ReviewAnswerResult> {
  let report = empty(answer);
  for (const chunk of chunks(rows, REVIEW_ANSWER_ROWS_MAX)) {
    let page: ReviewAnswerResult;
    try {
      page = await answerReviewRows(chunk.map(toAnswerRow), answer);
    } catch (error) {
      throw stopped(error, report, chunk.length);
    }
    report = merge(report, page);
    onProgress(progressOf(report, rows.length));
  }
  return report;
}

/**
 * Answer every row the filters match, walking the filtered read page by page.
 *
 * `total` is what the page said the filters matched when the curator chose
 * this, and is what progress is reported against; the walk itself trusts
 * only what each page returns.
 */
export async function answerAllMatching(
  address: ReviewAddress,
  total: number,
  answer: ReviewAnswer,
  onProgress: (p: AnswerProgress) => void,
): Promise<ReviewAnswerResult> {
  let report = empty(answer);
  const tried = new Set<string>();
  // Where the read continues from: the first page after every answer, since
  // answered rows leave the list; the next page only past one holding nothing
  // untried.
  let cursor: string | undefined;
  for (;;) {
    // The re-read is the likelier failure of the two — one per page — and it
    // fails between requests, with nothing in flight: what landed is still
    // what the report holds, and the notice has to say so rather than "nothing".
    let page;
    try {
      page = await fetchReviewQueue({ ...address, row: null, cursor, limit: REVIEW_ANSWER_ROWS_MAX });
    } catch (error) {
      throw stopped(error, report, 0);
    }
    const rows = queueRows(page).filter(row => !tried.has(row.key));
    if (rows.length === 0) {
      const next = page.paging?.nextCursor ?? undefined;
      if (next === undefined) return report;
      cursor = next;
      continue;
    }
    for (const row of rows) tried.add(row.key);
    let result: ReviewAnswerResult;
    try {
      result = await answerReviewRows(rows.map(toAnswerRow), answer);
    } catch (error) {
      throw stopped(error, report, rows.length);
    }
    report = merge(report, result);
    onProgress(progressOf(report, total));
    cursor = undefined;
  }
}
