-- 246-a-curator-sets-a-part-of-a-whole.sql
--
-- A curator makes a place a part of a place made of parts, or takes it out,
-- from either place's card (#2118). The word is a record of the Curators
-- source in the whole, beside the sources' records of the pair, and the
-- part-of relation follows it (parts_follow_records, ADR-0198 decision 5): an
-- admitted record puts the place in, a refused one keeps it out, and no run
-- undoes either.
--
-- This file seeds that source (id 11, the curator scheme, no kind, no gate)
-- and widens the curation log with the three acts that record the word:
-- part_added, part_taken_out and part_put_back. Both are what 01-schema.sql
-- declares; a database that holds data gets them here, before the writer that
-- needs them runs.
--
-- Writes one row of experience_sources and replaces one check. Re-runnable:
-- the seed names its arbiter, and the check is replaced.

\set ON_ERROR_STOP on

BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM experience_sources WHERE id = 11 AND name <> 'Curators') THEN
    RAISE EXCEPTION 'experience_sources id 11 is taken by another source';
  END IF;
END
$$;

INSERT INTO experience_sources (id, name, description, api_endpoint, api_config, display_priority, requires_curation, kind_id, id_scheme)
VALUES (
    11,
    'Curators',
    'A curator''s own word that a place is a part of a whole, or is kept out of it, given on the place''s card',
    NULL,
    '{}'::jsonb,
    11,
    false,
    NULL,
    'curator'
)
ON CONFLICT (name) DO NOTHING;
SELECT setval('experience_sources_id_seq', GREATEST((SELECT MAX(id) FROM experience_sources), 1));

ALTER TABLE experience_curation_log DROP CONSTRAINT IF EXISTS experience_curation_log_action_check;
ALTER TABLE experience_curation_log ADD CONSTRAINT experience_curation_log_action_check
    CHECK (action IN ('created', 'rejected', 'unrejected', 'edited', 'added_to_region', 'removed_from_region', 'marked_former', 'marked_lost', 'state_restored', 'accepted_source', 'declined_source', 'declined_held', 'missing_dismissed', 'admission_confirmed', 'admission_overridden', 'published', 'location_marked_former', 'location_marked_lost', 'location_state_restored', 'location_missing_dismissed', 'location_edited', 'work_edited', 'arrival_refused', 'contents_refused', 'contents_unrefused', 'merged', 'merge_undone', 'views_chosen', 'component_items_answered', 'component_item_taken_back', 'admission_pin_released', 'admission_pin_kept', 'admission_pin_handed_back', 'merge_proposal_answered', 'visit_question_answered', 'identifier_settled', 'separated', 'kept_out', 'merge_proposal_taken_back', 'kind_added', 'find_site_answered', 'crowding_answered', 'part_added', 'part_taken_out', 'part_put_back'));

COMMIT;
