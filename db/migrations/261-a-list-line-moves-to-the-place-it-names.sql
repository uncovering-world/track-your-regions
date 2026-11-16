-- 261-a-list-line-moves-to-the-place-it-names.sql
--
-- A curator moves a World Heritage list line from the place that holds it to
-- the place it names, in one act (#2527): Thessaloniki's line "Rotunda", held
-- by the place "Arch of Galerius and Rotunda", moved to the Rotunda. The act
-- is one log row on each of the three places, under a new action,
-- part_replaced; 01-schema.sql declares it, and a database that holds data
-- gets it here, before the writer that needs it runs.
--
-- Replaces one check. Re-runnable: the check is replaced.

\set ON_ERROR_STOP on

BEGIN;

ALTER TABLE experience_curation_log DROP CONSTRAINT IF EXISTS experience_curation_log_action_check;
ALTER TABLE experience_curation_log ADD CONSTRAINT experience_curation_log_action_check
    CHECK (action IN ('created', 'rejected', 'unrejected', 'edited', 'added_to_region', 'removed_from_region', 'marked_former', 'marked_lost', 'state_restored', 'accepted_source', 'declined_source', 'declined_held', 'missing_dismissed', 'admission_confirmed', 'admission_overridden', 'published', 'location_marked_former', 'location_marked_lost', 'location_state_restored', 'location_missing_dismissed', 'location_edited', 'work_edited', 'arrival_refused', 'contents_refused', 'contents_unrefused', 'merged', 'merge_undone', 'views_chosen', 'component_items_answered', 'component_item_taken_back', 'admission_pin_released', 'admission_pin_kept', 'admission_pin_handed_back', 'merge_proposal_answered', 'visit_question_answered', 'identifier_settled', 'separated', 'kept_out', 'merge_proposal_taken_back', 'kind_added', 'find_site_answered', 'crowding_answered', 'part_added', 'part_taken_out', 'part_put_back', 'part_replaced'));

COMMIT;
