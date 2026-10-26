/**
 * The review queue's card for a curator's admission pin a run no longer agrees
 * with (#1367): one card per place, one question per pinned membership — the
 * curator's answer, when it was given and the note with it, what the pin
 * answered, and what the run now says.
 *
 * Which pins are asked is `pinQuestionOpenSql` (`reviewQueuePredicates.ts`),
 * the rule the keys phase and the answer (`pinQuestionController.ts`) read
 * too; a question is about one membership, so the card is scoped by each
 * membership's source as the refusal card is.
 */

import type { QueryResult } from 'pg';
import { pool } from '../../db/index.js';
import { CURATOR_SCOPED_REGIONS_CTE } from '../../middleware/auth.js';
import { KINDS, MEMBERSHIPS } from '../../db/membership.js';
import { lifecycleSelectSql } from '../../db/readerPredicates.js';
import { objectContextSelectSql } from './reviewQueueContext.js';
import { pinQuestionOpenSql } from './reviewQueuePredicates.js';
import { foldedReasonSql } from '../../services/sync/pinQuestion.js';

/** The filters every card statement of the page carries, and the parameters they bind. */
export interface PinQuestionContext {
  params: unknown[];
  membershipSourceFilter: string;
  membershipScopeFilter: string;
}

/**
 * The curator's act the pin stands on: the latest answer on the membership the
 * log records — a put-back, a confirmation, a refusal of an arrival, a pin
 * kept, a listing verdict that took the place out of the kind, a place with
 * nothing to see refused, a place added to a kind no run offers it in — and,
 * for an answer logged before memberships were named, the place's.
 * Over the place `e` and the membership `m`, as `pinned_by`: when, the note,
 * who, the act, and the region it was logged under, which decides whether a
 * scoped curator may read the name (`getCurationLog`'s rule).
 */
export const PINNED_BY = `LEFT JOIN LATERAL (
      SELECT cl.created_at AS at, cl.details->>'note' AS note, cl.curator_id, cl.region_id, cl.action
        FROM experience_curation_log cl
       WHERE cl.experience_id = e.id
         AND (cl.action IN ('admission_overridden', 'admission_confirmed', 'arrival_refused', 'admission_pin_kept', 'kept_out',
                            'kind_added')
              -- The listing verdict that took the place out of the kind pins it too.
              OR (cl.action IN ('marked_former', 'missing_dismissed') AND cl.details->>'takenOutOfKind' = 'true')
              -- And a refusal answering a run's question about a place with nothing to see (#1770).
              OR (cl.action = 'visit_question_answered' AND cl.details->>'answer' = 'refused'))
         AND ((cl.details->>'membershipId')::int = m.id OR NOT cl.details ? 'membershipId')
       ORDER BY cl.created_at DESC, cl.id DESC
       LIMIT 1
    ) pinned_by ON TRUE`;

/**
 * The curator's add that put the place into this kind, when one did (#2035):
 * when, the note, who, and the region it was logged under. Read off the add
 * itself, never off the latest act, since a take-out and a put-back later in
 * its history leave it what it was: a membership no run offers.
 */
export const ADDED_BY = `LEFT JOIN LATERAL (
      SELECT cl.created_at AS at, cl.details->>'note' AS note, cl.curator_id, cl.region_id
        FROM experience_curation_log cl
       WHERE cl.experience_id = e.id
         AND cl.action = 'kind_added'
         AND (cl.details->>'membershipId')::int = m.id
       ORDER BY cl.created_at DESC, cl.id DESC
       LIMIT 1
    ) added_by ON TRUE`;

/**
 * Whether the membership `ADDED_BY` read is a curator's add that no run has
 * listed yet. Admitted, it answers no rule, so it is neither listed among the
 * pins against one nor handed back to a run: its way back is *Take out…*. The
 * add is keyed by the place's Wikidata item so that a run which comes to list
 * the place upserts this same membership; from then on its pin is a pin like
 * any other, and handing it back leaves the place to that run.
 */
export const ADDED_BY_CURATOR = 'added_by.at IS NOT NULL AND m.last_seen_at IS NULL';

export async function queryPinQuestions(ids: number[], ctx: PinQuestionContext): Promise<QueryResult> {
  return pool.query(`${CURATOR_SCOPED_REGIONS_CTE}
    SELECT e.id, m.external_id, e.name, m.id AS membership_id, m.kind_id, kd.name AS kind_name,
           ${lifecycleSelectSql()}, ${objectContextSelectSql()},
           'pin-question' AS kind, NULL::jsonb AS proposed,
           m.admission_question_sync_log_id AS sync_log_id,
           jsonb_build_object(
             'answer', m.admission,
             'answeredVerdict', m.admission_pin_verdict,
             'answeredReason', m.admission_pin_reason,
             'askedVerdict', m.admission_question_verdict,
             'askedReason', m.admission_question_reason,
             'askedAt', m.admission_questioned_at,
             -- The run says the answered words again: a question raised by a
             -- run started to ask again about the pins (#1370), not a change.
             'restated', m.admission_question_verdict IS NOT DISTINCT FROM m.admission_pin_verdict
                         AND ${foldedReasonSql('m.admission_question_reason')} IS NOT DISTINCT FROM ${foldedReasonSql('m.admission_pin_reason')},
             'answeredAt', COALESCE(pinned_by.at, e.state_decided_at),
             'note', CASE WHEN pinned_by.at IS NOT NULL THEN pinned_by.note ELSE e.state_note END
           ) AS pin_question
    FROM experiences e
    JOIN ${MEMBERSHIPS} m ON m.experience_id = e.id
    JOIN ${KINDS} kd ON kd.id = m.kind_id
    ${PINNED_BY}
    WHERE ${pinQuestionOpenSql('m')}
      ${ctx.membershipSourceFilter}
      AND ${ctx.membershipScopeFilter}
      AND e.id = ANY($${ctx.params.length + 1}::int[])
    ORDER BY e.id, kd.display_priority
  `, [...ctx.params, ids]);
}
