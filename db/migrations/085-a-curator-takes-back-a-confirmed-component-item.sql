-- 085-a-curator-takes-back-a-confirmed-component-item.sql
--
-- A curator takes back the Wikidata item confirmed for a World Heritage
-- component (#1317): the item and the claim on it come off the point, with
-- what the confirmation wrote - the item's picture, credit and description -
-- where the point still holds it and no curator has claimed the field since;
-- the candidate stays turned down, so the finder never proposes it again. One
-- act of the curation log, component_item_taken_back, naming the point, the
-- item and what came off.
--
-- Order-independent with 01-schema.sql, which declares the same constraint.
-- Re-runnable: the constraint is dropped before it is added.

\set ON_ERROR_STOP on

BEGIN;

ALTER TABLE experience_curation_log DROP CONSTRAINT IF EXISTS experience_curation_log_action_check;
ALTER TABLE experience_curation_log ADD CONSTRAINT experience_curation_log_action_check
    CHECK (action IN ('created', 'rejected', 'unrejected', 'edited', 'added_to_region', 'removed_from_region', 'marked_former', 'marked_lost', 'state_restored', 'accepted_source', 'declined_source', 'declined_held', 'missing_dismissed', 'admission_confirmed', 'admission_overridden', 'published', 'location_marked_former', 'location_marked_lost', 'location_state_restored', 'location_missing_dismissed', 'location_edited', 'work_edited', 'arrival_refused', 'contents_refused', 'contents_unrefused', 'merged', 'merge_undone', 'views_chosen', 'component_items_answered', 'component_item_taken_back'));

COMMIT;
