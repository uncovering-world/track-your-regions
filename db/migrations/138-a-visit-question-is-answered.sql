-- 138-a-visit-question-is-answered.sql
--
-- A curator answers a run's question about an offered place with nothing to
-- see (#1770): keep it, or refuse it from the kind, the refusal Jev's reading
-- suggests. That is one act of the curation log, visit_question_answered,
-- with the answer and what was asked in its details, which the action check
-- did not allow.
--
-- Order-independent with 01-schema.sql, which declares the same constraint.
-- Re-runnable: the constraint is dropped before it is added.

\set ON_ERROR_STOP on

BEGIN;

ALTER TABLE experience_curation_log DROP CONSTRAINT IF EXISTS experience_curation_log_action_check;
ALTER TABLE experience_curation_log ADD CONSTRAINT experience_curation_log_action_check
    CHECK (action IN ('created', 'rejected', 'unrejected', 'edited', 'added_to_region', 'removed_from_region', 'marked_former', 'marked_lost', 'state_restored', 'accepted_source', 'declined_source', 'declined_held', 'missing_dismissed', 'admission_confirmed', 'admission_overridden', 'published', 'location_marked_former', 'location_marked_lost', 'location_state_restored', 'location_missing_dismissed', 'location_edited', 'work_edited', 'arrival_refused', 'contents_refused', 'contents_unrefused', 'merged', 'merge_undone', 'views_chosen', 'component_items_answered', 'component_item_taken_back', 'admission_pin_released', 'admission_pin_kept', 'admission_pin_handed_back', 'merge_proposal_answered', 'visit_question_answered'));

COMMIT;
