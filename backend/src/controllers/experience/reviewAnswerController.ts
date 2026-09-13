/**
 * Answering many review rows at once (#852).
 *
 * The review feed (ADR-0051) answers one question at a time, which was right
 * for a queue of a few dozen and is unworkable for what a first run of a gated
 * source produces: the first live run of the Places of worship source put
 * 1 078 arrivals into the feed, every one wanting the same answer. This is
 * the one route a selection is answered through — a page of rows at most,
 * one answer for all of them.
 *
 * Its shape is `publishWaitingController.ts`'s, the batch precedent: **each
 * object is its own act** — its own scope check, its own lock, its own audit
 * row, its own outcome — so one object refusing mid-batch neither abandons
 * the rest nor disappears silently. Nothing here decides what an answer does;
 * `reviewAnswerDispatch.ts` is that table, and every arm of it calls the
 * writer the single-row card calls.
 *
 * Rate-limited (`authenticatedLimiter`) on the criterion `docs/tech/
 * rate-limiting.md` § 5 states: a request is expensive to the system whoever
 * sends it. A hundred publishes, and five of the writers it dispatches to
 * re-place the object after their commit — a publish that released a deferred
 * withdrawal, an overriding admission verdict that released one, an accepted
 * source coordinate, a verdict on a withdrawn point (once per point), and a
 * turned-down point that counts toward no region any more.
 */

import { Response } from 'express';
import { pool } from '../../db/index.js';
import type { AuthenticatedRequest } from '../../middleware/auth.js';
import { resolveExperienceScope } from './experienceScope.js';
import {
  answerRow, type Answer, type AnswerRow, type Did, type Placement,
} from './reviewAnswerDispatch.js';

// The most rows one request answers — the queue's own page maximum, 100 — is
// bound where it is enforced, `reviewAnswerBodySchema` in `types/index.ts`;
// the client's `REVIEW_ANSWER_ROWS_MAX` mirrors it, and `docs/tech/experiences.md`
// names it beside the route.

export interface AnsweredRow {
  kind: AnswerRow['kind'];
  id: number;
  name: string;
  answer: Answer;
  did: Did;
}

export interface RefusedRow {
  kind: AnswerRow['kind'];
  id: number;
  name: string;
  error: string;
}

export interface ReviewAnswerResult {
  answer: Answer;
  answered: AnsweredRow[];
  refused: RefusedRow[];
  outOfScope: number;
  /** Objects whose answer changed what a reader sees and whose re-placement failed. */
  placementFailed: Array<{ id: number; name: string } & Placement>;
}

/**
 * Answer a selection of review rows with one answer.
 * POST /api/experiences/review/answer
 * Body: { rows: [{ kind, id, runId }], answer: 'accept' | 'reject' | 'lost' }
 *
 * A row named twice is answered once. A row whose object is gone is refused
 * by name rather than 404ing the batch: the list the curator selected from
 * was drawn a moment ago, and one deleted object is one line in the report.
 */
export async function answerReviewRows(req: AuthenticatedRequest, res: Response): Promise<void> {
  const userId = req.user!.id;
  const userRole = req.user!.role;
  const { rows, answer } = req.body as { rows: AnswerRow[]; answer: Answer };

  const distinct = dedupe(rows);
  const found = await pool.query(
    `SELECT id, name, source_id FROM experiences WHERE id = ANY($1::int[])`,
    [distinct.map(r => r.id)],
  );
  const objects = new Map<number, { name: string; sourceId: number }>(
    found.rows.map(r => [r.id as number, { name: r.name as string, sourceId: r.source_id as number }]));

  const result: ReviewAnswerResult = {
    answer, answered: [], refused: [], outOfScope: 0, placementFailed: [],
  };

  for (const row of distinct) {
    const object = objects.get(row.id);
    if (!object) {
      result.refused.push({ kind: row.kind, id: row.id, name: `#${row.id}`, error: 'Experience not found' });
      continue;
    }
    // Everything this iteration can fail at is inside the try, the scope read
    // included: `resolveExperienceScope` throwing must land in `refused` and
    // not in a 500 that abandons the rest, exactly as `publishWaiting` reasons.
    try {
      const { permitted, logRegionId } = await resolveExperienceScope(
        userId, userRole, row.id, object.sourceId);
      if (!permitted) {
        result.outOfScope += 1;
        continue;
      }
      const outcome = await answerRow(
        { experienceId: row.id, userId, logRegionId, runId: row.runId }, row.kind, answer);
      if ('refusal' in outcome) {
        result.refused.push({ kind: row.kind, id: row.id, name: object.name, error: outcome.refusal.error });
        continue;
      }
      result.answered.push({ kind: row.kind, id: row.id, name: object.name, answer, did: outcome.did });
      if (outcome.placement) {
        result.placementFailed.push({ id: row.id, name: object.name, ...outcome.placement });
      }
    } catch (error) {
      // A literal format string: a template literal here trips the
      // unsafe-formatstring rule, and the id belongs in the arguments anyway.
      console.error('[review-answer] %s %d failed:', row.kind, row.id, error);
      result.refused.push({
        kind: row.kind, id: row.id, name: object.name,
        error: 'The answer failed on the server — reload and try this one again',
      });
    }
  }

  res.json(result);
}

/** The rows once each, in the order first named — the order the report keeps. */
function dedupe(rows: AnswerRow[]): AnswerRow[] {
  const seen = new Set<string>();
  const distinct: AnswerRow[] = [];
  for (const row of rows) {
    const key = `${row.kind}:${row.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    distinct.push({ ...row, runId: row.runId ?? null });
  }
  return distinct;
}
