/**
 * The review queue's card for an offered place with nothing to see (#1770):
 * one card per place, one question per membership a run asked about — the
 * witnesses that vouched for the place when it was asked (ADR-0128 decision
 * 1), Jev's reading of what a visitor finds there and how sure it was, and
 * when and by which run it was asked. The suggested answer is to refuse the
 * place from the kind; nothing is refused until a curator says so.
 *
 * Which questions are asked is `visitQuestionOpenSql`
 * (`reviewQueuePredicates.ts`), the rule the keys phase and the answer
 * (`visitQuestionController.ts`) read too; a question is about one
 * membership, so the card is scoped by each membership's source as the
 * refusal card is.
 */

import type { QueryResult } from 'pg';
import { pool } from '../../db/index.js';
import { CURATOR_SCOPED_REGIONS_CTE } from '../../middleware/auth.js';
import { KINDS, MEMBERSHIPS } from '../../db/membership.js';
import { lifecycleSelectSql } from '../../db/readerPredicates.js';
import { objectContextSelectSql } from './reviewQueueContext.js';
import { visitQuestionOpenSql } from './reviewQueuePredicates.js';

/** The filters every card statement of the page carries, and the parameters they bind. */
export interface VisitQuestionContext {
  params: unknown[];
  membershipSourceFilter: string;
  membershipScopeFilter: string;
}

export async function queryVisitQuestions(ids: number[], ctx: VisitQuestionContext): Promise<QueryResult> {
  return pool.query(`${CURATOR_SCOPED_REGIONS_CTE}
    SELECT e.id, m.external_id, e.name, e.source_id, m.id AS membership_id, m.kind_id, kd.name AS kind_name,
           ${lifecycleSelectSql()}, ${objectContextSelectSql()},
           'visit-question' AS kind, NULL::jsonb AS proposed,
           q.sync_log_id,
           jsonb_build_object(
             'witnesses', to_jsonb(q.witnesses),
             'reading', q.reading,
             'confidence', q.confidence::float8,
             'askedAt', q.asked_at
           ) AS visit_question
    FROM experiences e
    JOIN ${MEMBERSHIPS} m ON m.experience_id = e.id
    JOIN ${KINDS} kd ON kd.id = m.kind_id
    JOIN experience_visit_questions q ON q.membership_id = m.id
    WHERE ${visitQuestionOpenSql('q', 'm', 'e')}
      ${ctx.membershipSourceFilter}
      AND ${ctx.membershipScopeFilter}
      AND e.id = ANY($${ctx.params.length + 1}::int[])
    ORDER BY e.id, kd.display_priority
  `, [...ctx.params, ids]);
}
