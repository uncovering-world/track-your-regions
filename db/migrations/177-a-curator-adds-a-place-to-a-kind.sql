-- 177-a-curator-adds-a-place-to-a-kind.sql
--
-- A curator puts a place into a kind no run offers it in, from the place's own
-- card (#2035): the East Side Gallery is a street-art place that Wikidata types
-- an art museum, so no run of Public art can find it. The membership is
-- written admitted, published and pinned, so every later run of the kind's
-- source leaves it there; the curation log gains the kind_added action that
-- records it, with the kind, the type and the curator's words (#863).
--
-- Re-runnable: the check is replaced.

\set ON_ERROR_STOP on

BEGIN;

ALTER TABLE experience_curation_log DROP CONSTRAINT IF EXISTS experience_curation_log_action_check;
ALTER TABLE experience_curation_log ADD CONSTRAINT experience_curation_log_action_check
    CHECK (action IN ('created', 'rejected', 'unrejected', 'edited', 'added_to_region', 'removed_from_region', 'marked_former', 'marked_lost', 'state_restored', 'accepted_source', 'declined_source', 'declined_held', 'missing_dismissed', 'admission_confirmed', 'admission_overridden', 'published', 'location_marked_former', 'location_marked_lost', 'location_state_restored', 'location_missing_dismissed', 'location_edited', 'work_edited', 'arrival_refused', 'contents_refused', 'contents_unrefused', 'merged', 'merge_undone', 'views_chosen', 'component_items_answered', 'component_item_taken_back', 'admission_pin_released', 'admission_pin_kept', 'admission_pin_handed_back', 'merge_proposal_answered', 'visit_question_answered', 'identifier_settled', 'separated', 'kept_out', 'merge_proposal_taken_back', 'kind_added'));

COMMIT;
