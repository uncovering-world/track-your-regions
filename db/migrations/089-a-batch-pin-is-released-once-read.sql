-- 089-a-batch-pin-is-released-once-read.sql
--
-- One batch answer on 2026-09-14 pinned 119 refusals nobody had read card by
-- card (#906). A curator has now read the list (#1365, ADR-0096): the pins kept
-- stay, and each other one is released through the membership writer, with
-- the rule's verdict written in its place. The release is one act of the
-- curation log, admission_pin_released, which the action check did not allow.
--
-- Order-independent with 01-schema.sql, which declares the same constraint.
-- Re-runnable: the constraint is dropped before it is added.

\set ON_ERROR_STOP on

BEGIN;

ALTER TABLE experience_curation_log DROP CONSTRAINT IF EXISTS experience_curation_log_action_check;
ALTER TABLE experience_curation_log ADD CONSTRAINT experience_curation_log_action_check
    CHECK (action IN ('created', 'rejected', 'unrejected', 'edited', 'added_to_region', 'removed_from_region', 'marked_former', 'marked_lost', 'state_restored', 'accepted_source', 'declined_source', 'declined_held', 'missing_dismissed', 'admission_confirmed', 'admission_overridden', 'published', 'location_marked_former', 'location_marked_lost', 'location_state_restored', 'location_missing_dismissed', 'location_edited', 'work_edited', 'arrival_refused', 'contents_refused', 'contents_unrefused', 'merged', 'merge_undone', 'views_chosen', 'component_items_answered', 'component_item_taken_back', 'admission_pin_released'));

COMMIT;
