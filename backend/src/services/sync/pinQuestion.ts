/**
 * Whether a run asks a curator about their admission pin again (#1367).
 *
 * A pin is a curator's answer to what one run said about a membership: a
 * put-back answers a refusal ("site, not a venue: villa"), a confirmation keeps
 * one, a refusal of an arrival answers an admission. The pin remembers that
 * view (`admission_pin_verdict`, `admission_pin_reason`) beside the curator's
 * own answer, which is the membership's `admission`. Each later run that
 * judges the membership compares its own view with the one the pin answered:
 *
 * - the same verdict for the same reason: the pin holds, as it always has;
 * - the curator's own verdict: the rule has come round to the answer (the
 *   Isabella Stewart Gardner Museum put back and since admitted on its own,
 *   an arrival a curator refused that the rule now refuses too), and there is
 *   nothing to ask;
 * - a refusal of a confirmed refusal, for whatever reason: the row stays out
 *   either way, so a reworded refusal asks nothing;
 * - anything else asks: a put-back refused for another reason, a confirmed
 *   refusal the rule would now admit.
 *
 * Reasons are compared with their numbers folded. A reason carries the
 * measurements it was decided on — "17 sitelinks: below the world tier's line
 * (22 to enter, 18 to stay)", "painting-share: 3 painting(s) vs 9 sculptural
 * work(s)" — and a count that ticks is not a new reason.
 */

import type { Admission } from '@tyr/shared/lifecycle';
import { pool } from '../../db/index.js';
import { MEMBERSHIPS, admissionPinnedSql, sourcePlacesSql } from '../../db/membership.js';

/** What a run said about a membership: its verdict, and the reason for a refusal. */
export interface RunView {
  verdict: Admission;
  reason: string | null;
}

/** A pinned membership as the run reads it. */
export interface PinnedView {
  /** The curator's answer: the membership's `admission`. */
  answer: Admission;
  /** The run's view the pin answered; null on a pin nobody recorded it for. */
  answered: RunView | null;
}

/** A reason with every run of digits folded to one mark. */
export function foldedReason(reason: string | null): string | null {
  return reason === null ? null : reason.replace(/\d+/g, '#').trim();
}

/** Whether a run's view of a pinned membership is a question for the curator. */
export function asksAgain(pin: PinnedView, now: RunView): boolean {
  // The rule agrees with the curator, or keeps out what the curator kept out.
  if (pin.answered === null || now.verdict === pin.answer) return false;
  // The run disagrees with the curator: asked unless it says what was answered.
  if (now.verdict !== pin.answered.verdict) return true;
  return now.verdict === 'refused' && foldedReason(now.reason) !== foldedReason(pin.answered.reason);
}

/** A pinned membership of the source, as a run compares it with its own view (#1367). */
export interface PinnedRow {
  /** The place. */
  id: number;
  externalId: string;
  name: string;
  membershipId: number;
  answer: Admission;
  answeredVerdict: Admission | null;
  answeredReason: string | null;
  /** The question standing on the pin, waiting for a curator; null where none does. */
  question: RunView | null;
}

/**
 * Whether the run still says the question standing on a pin (#1370): the
 * same verdict, the same reason with its counts folded. Such a question stays
 * even where `asksAgain` would not raise it — one a run started to ask again
 * put in the words the curator answered — while one the run has moved off
 * closes as before.
 */
export function stillAsks(question: RunView | null, now: RunView): boolean {
  return question !== null && question.verdict === now.verdict
    && foldedReason(question.reason) === foldedReason(now.reason);
}

/**
 * The memberships of the source a curator pinned on `admission`, with the view
 * each pin answered. A curator's own row is left out for the reason
 * `UNPROTECTED` (`admission.ts`) gives: no run speaks about it.
 */
export async function pinnedRows(sourceId: number): Promise<PinnedRow[]> {
  const result = await pool.query<{
    id: number; external_id: string; name: string; membership_id: number; admission: Admission;
    admission_pin_verdict: Admission | null; admission_pin_reason: string | null;
    admission_question_verdict: Admission | null; admission_question_reason: string | null;
  }>(
    `SELECT e.id, m.external_id, e.name, m.id AS membership_id, m.admission, m.admission_pin_verdict, m.admission_pin_reason,
            m.admission_question_verdict, m.admission_question_reason
       FROM ${sourcePlacesSql('e', 'm')}
      WHERE m.source_id = $1 AND e.is_manual = FALSE AND ${admissionPinnedSql('m')}`,
    [sourceId],
  );
  return result.rows.map((row) => ({
    id: row.id, externalId: row.external_id, name: row.name, membershipId: row.membership_id,
    answer: row.admission, answeredVerdict: row.admission_pin_verdict, answeredReason: row.admission_pin_reason,
    question: row.admission_question_verdict === null
      ? null : { verdict: row.admission_question_verdict, reason: row.admission_question_reason },
  }));
}

/** A run's question about a pin: the membership, the pin as the run read it, and what the run now says of it. */
export interface PinQuestion {
  membershipId: number;
  verdict: Admission;
  reason: string | null;
  read: Pick<PinnedRow, 'answer' | 'answeredVerdict' | 'answeredReason'>;
}

/** `reason` with its numbers folded, as `foldedReason` folds one, in SQL. */
export function foldedReasonSql(reason: string): string {
  return `btrim(regexp_replace(${reason}, '\\d+', '#', 'g'))`;
}

/**
 * Ask about the pins this run disagrees with, and close the questions on the
 * pins it no longer disagrees with (#1367). The row's admission is left as the
 * curator left it; what the run says is written beside it, for the review
 * queue. A question the run asks again keeps the date it was first asked, its
 * reason compared as `asksAgain` compares one, numbers folded. A question is
 * written only where the pin is still the one the run read — the curator's
 * answer and the view it answered — so a pin released or answered while the
 * run ran is not asked about with a question computed against the old one.
 *
 * A preview writes nothing.
 */
export async function writePinQuestions(
  asked: PinQuestion[],
  settled: number[],
  syncLogId: number,
  dryRun: boolean,
): Promise<void> {
  if (dryRun) return;
  if (asked.length > 0) {
    await pool.query(
      `UPDATE ${MEMBERSHIPS} m
          SET admission_questioned_at = CASE
                WHEN m.admission_question_verdict IS NOT DISTINCT FROM v.verdict
                 AND ${foldedReasonSql('m.admission_question_reason')} IS NOT DISTINCT FROM ${foldedReasonSql('v.reason')}
                THEN m.admission_questioned_at ELSE NOW() END,
              admission_question_verdict = v.verdict,
              admission_question_reason = v.reason,
              admission_question_sync_log_id = $4,
              updated_at = NOW()
         FROM (SELECT UNNEST($1::int[]) AS id, UNNEST($2::text[]) AS verdict, UNNEST($3::text[]) AS reason,
                      UNNEST($5::text[]) AS answer, UNNEST($6::text[]) AS pin_verdict, UNNEST($7::text[]) AS pin_reason) v
        WHERE m.id = v.id AND ${admissionPinnedSql('m')}
          AND m.admission = v.answer
          AND m.admission_pin_verdict IS NOT DISTINCT FROM v.pin_verdict
          AND m.admission_pin_reason IS NOT DISTINCT FROM v.pin_reason`,
      [
        asked.map((q) => q.membershipId), asked.map((q) => q.verdict), asked.map((q) => q.reason), syncLogId,
        asked.map((q) => q.read.answer), asked.map((q) => q.read.answeredVerdict), asked.map((q) => q.read.answeredReason),
      ],
    );
  }
  if (settled.length > 0) {
    await pool.query(
      `UPDATE ${MEMBERSHIPS} m
          SET admission_question_verdict = NULL, admission_question_reason = NULL,
              admission_questioned_at = NULL, admission_question_sync_log_id = NULL,
              updated_at = NOW()
        WHERE m.id = ANY($1::int[]) AND m.admission_questioned_at IS NOT NULL`,
      [settled],
    );
  }
}
