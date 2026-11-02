-- 209-a-curators-answer-on-a-finds-site-is-logged.sql
--
-- A site's curator says whether a find comes from the site (#2242): the Dendera
-- zodiac, proposed for the Dendera Temple complex from its own coordinate, is
-- confirmed or refused, and a confirmed link can be taken back. The answer
-- changes what the site's card lists, so it is recorded in the place's
-- curation log like every other curator act, with the find and the answer
-- (#863); the log gains the find_site_answered action that records it.
--
-- Re-runnable: the check is replaced.

\set ON_ERROR_STOP on

BEGIN;

ALTER TABLE experience_curation_log DROP CONSTRAINT IF EXISTS experience_curation_log_action_check;
ALTER TABLE experience_curation_log ADD CONSTRAINT experience_curation_log_action_check
    CHECK (action IN ('created', 'rejected', 'unrejected', 'edited', 'added_to_region', 'removed_from_region', 'marked_former', 'marked_lost', 'state_restored', 'accepted_source', 'declined_source', 'declined_held', 'missing_dismissed', 'admission_confirmed', 'admission_overridden', 'published', 'location_marked_former', 'location_marked_lost', 'location_state_restored', 'location_missing_dismissed', 'location_edited', 'work_edited', 'arrival_refused', 'contents_refused', 'contents_unrefused', 'merged', 'merge_undone', 'views_chosen', 'component_items_answered', 'component_item_taken_back', 'admission_pin_released', 'admission_pin_kept', 'admission_pin_handed_back', 'merge_proposal_answered', 'visit_question_answered', 'identifier_settled', 'separated', 'kept_out', 'merge_proposal_taken_back', 'kind_added', 'find_site_answered'));

COMMIT;
