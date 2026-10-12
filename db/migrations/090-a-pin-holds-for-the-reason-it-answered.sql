-- 090-a-pin-holds-for-the-reason-it-answered.sql
--
-- A curator's admission pin answered what one run said about a membership: a
-- put-back answered a refusal, a confirmation kept one, a refusal of an arrival
-- answered an admission. Every later run left the row as the curator left it,
-- whatever it now said. From #1367 a pin remembers the run's view it answered,
-- and a run whose view of the row has moved against the curator's answer asks
-- again, on the row, instead of staying silent.
--
-- The pin's view: admission_pin_verdict / admission_pin_reason. The open
-- question: admission_question_verdict / admission_question_reason, the run
-- that asked (admission_question_sync_log_id) and when (admission_questioned_at).
-- A question stands only on a pinned row. Answering it is one act of the
-- curation log, admission_pin_kept, or the existing admission_pin_released.
--
-- The pins already standing are given the view their own record holds: a
-- put-back the reason its latest admission_overridden row overrode (the row
-- naming its membership, else one logged before rows named one), a
-- confirmation the reason kept on the row (no run rewrites a pinned row), and
-- a curator's refusal of an arrival or of a row no longer listed the admission
-- it answered.
--
-- Order-independent with 01-schema.sql, which declares the same columns and
-- constraints. Re-runnable: columns are added if missing, constraints dropped
-- before they are added, and the backfill touches only rows with no view yet.

\set ON_ERROR_STOP on

BEGIN;

ALTER TABLE experience_kind_memberships
    ADD COLUMN IF NOT EXISTS admission_pin_verdict VARCHAR(10),
    ADD COLUMN IF NOT EXISTS admission_pin_reason TEXT,
    ADD COLUMN IF NOT EXISTS admission_question_verdict VARCHAR(10),
    ADD COLUMN IF NOT EXISTS admission_question_reason TEXT,
    ADD COLUMN IF NOT EXISTS admission_questioned_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS admission_question_sync_log_id INTEGER REFERENCES experience_sync_logs(id) ON DELETE SET NULL;

ALTER TABLE experience_kind_memberships DROP CONSTRAINT IF EXISTS experience_kind_memberships_pin_verdict_check;
ALTER TABLE experience_kind_memberships ADD CONSTRAINT experience_kind_memberships_pin_verdict_check
    CHECK (admission_pin_verdict IN ('admitted', 'refused') AND admission_question_verdict IN ('admitted', 'refused'));
ALTER TABLE experience_kind_memberships DROP CONSTRAINT IF EXISTS experience_kind_memberships_question_check;
ALTER TABLE experience_kind_memberships ADD CONSTRAINT experience_kind_memberships_question_check
    CHECK ((admission_questioned_at IS NULL) = (admission_question_verdict IS NULL)
       AND (admission_questioned_at IS NULL OR curated_fields ? 'admission'));

UPDATE experience_kind_memberships m
   SET admission_pin_verdict = 'refused',
       admission_pin_reason = (
         SELECT cl.details->>'reason' FROM experience_curation_log cl
          WHERE cl.experience_id = m.experience_id AND cl.action = 'admission_overridden'
            AND (cl.details->>'membershipId' = m.id::text OR NOT cl.details ? 'membershipId')
          ORDER BY cl.details ? 'membershipId' DESC, cl.created_at DESC, cl.id DESC LIMIT 1)
 WHERE m.curated_fields ? 'admission' AND m.admission = 'admitted' AND m.admission_pin_verdict IS NULL;

UPDATE experience_kind_memberships m
   SET admission_pin_verdict = CASE
         WHEN m.admission_reason IN ('kept out by a curator', 'no longer listed by its source') THEN 'admitted'
         ELSE 'refused' END,
       admission_pin_reason = CASE
         WHEN m.admission_reason IN ('kept out by a curator', 'no longer listed by its source') THEN NULL
         ELSE m.admission_reason END
 WHERE m.curated_fields ? 'admission' AND m.admission = 'refused' AND m.admission_pin_verdict IS NULL;

ALTER TABLE experience_curation_log DROP CONSTRAINT IF EXISTS experience_curation_log_action_check;
ALTER TABLE experience_curation_log ADD CONSTRAINT experience_curation_log_action_check
    CHECK (action IN ('created', 'rejected', 'unrejected', 'edited', 'added_to_region', 'removed_from_region', 'marked_former', 'marked_lost', 'state_restored', 'accepted_source', 'declined_source', 'declined_held', 'missing_dismissed', 'admission_confirmed', 'admission_overridden', 'published', 'location_marked_former', 'location_marked_lost', 'location_state_restored', 'location_missing_dismissed', 'location_edited', 'work_edited', 'arrival_refused', 'contents_refused', 'contents_unrefused', 'merged', 'merge_undone', 'views_chosen', 'component_items_answered', 'component_item_taken_back', 'admission_pin_released', 'admission_pin_kept'));

COMMIT;
