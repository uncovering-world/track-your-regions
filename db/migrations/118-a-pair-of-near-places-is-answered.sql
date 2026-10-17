-- 118-a-pair-of-near-places-is-answered.sql
--
-- A curator answers two near places with similar names (#1249, ADR-0046
-- decisions 2 to 4): one place, which runs the merge; two places, which keeps
-- the pair from being proposed again; or one part of the other, recorded for
-- #823 and never merged. That is one act of the curation log,
-- merge_proposal_answered, written on the place that stays beside the merged
-- row the merge itself writes, which the action check did not allow.
--
-- Order-independent with 01-schema.sql, which declares the same constraint.
-- Re-runnable: the constraint is dropped before it is added.

\set ON_ERROR_STOP on

BEGIN;

ALTER TABLE experience_curation_log DROP CONSTRAINT IF EXISTS experience_curation_log_action_check;
ALTER TABLE experience_curation_log ADD CONSTRAINT experience_curation_log_action_check
    CHECK (action IN ('created', 'rejected', 'unrejected', 'edited', 'added_to_region', 'removed_from_region', 'marked_former', 'marked_lost', 'state_restored', 'accepted_source', 'declined_source', 'declined_held', 'missing_dismissed', 'admission_confirmed', 'admission_overridden', 'published', 'location_marked_former', 'location_marked_lost', 'location_state_restored', 'location_missing_dismissed', 'location_edited', 'work_edited', 'arrival_refused', 'contents_refused', 'contents_unrefused', 'merged', 'merge_undone', 'views_chosen', 'component_items_answered', 'component_item_taken_back', 'admission_pin_released', 'admission_pin_kept', 'admission_pin_handed_back', 'merge_proposal_answered'));

COMMIT;
