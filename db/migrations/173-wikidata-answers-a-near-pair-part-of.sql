-- 173-wikidata-answers-a-near-pair-part-of.sql
--
-- A near pair whose Wikidata items state that one is part of the other is
-- answered "part of" by the pairing pass itself, with the part Wikidata names
-- and the statement that gave it (#1991, ADR-0150): one place's item states
-- P361 "part of" toward the other's, or the other's states P527 "has part"
-- toward it. The answer names no curator, as the catalogue's other answers do
-- (ADR-0086, ADR-0141), so the history's curator check admits the action
-- without one.
--
-- A curator takes such an answer back from the place's history, which opens
-- the pair again and marks it, so the pass never answers it a second time; the
-- curation log gains the merge_proposal_taken_back action that records it.
--
-- The open pairs are answered by the first drain after the deploy, not here:
-- the pairing rule's version moves with this change, and that drain pairs the
-- whole catalogue again, reading the local Wikidata subset.
--
-- Re-runnable: the columns are added if missing, the constraints dropped and
-- added again.

\set ON_ERROR_STOP on

BEGIN;

ALTER TABLE experience_merge_proposals
    ADD COLUMN IF NOT EXISTS answered_by_catalogue BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS answer_statement JSONB,
    ADD COLUMN IF NOT EXISTS taken_back_at TIMESTAMPTZ;
COMMENT ON COLUMN experience_merge_proposals.answered_by_catalogue IS 'Whether the pairing pass answered this pair from Wikidata rather than a curator (#1991, ADR-0150): part_of, from the statement in answer_statement. answered_by is null then, as it is for a curator since deleted.';
COMMENT ON COLUMN experience_merge_proposals.answer_statement IS 'The Wikidata statement a catalogue answer rests on: {property, subject, value}, P361 "part of" stated by the part''s item toward the whole''s, or P527 "has part" stated by the whole''s toward the part''s.';
COMMENT ON COLUMN experience_merge_proposals.taken_back_at IS 'When a curator last took this pair''s answer back (#1991): open again, and never answered by the pass again, only by a curator.';

ALTER TABLE experience_merge_proposals DROP CONSTRAINT IF EXISTS experience_merge_proposals_catalogue_check;
ALTER TABLE experience_merge_proposals ADD CONSTRAINT experience_merge_proposals_catalogue_check
    CHECK (NOT answered_by_catalogue OR (answer = 'part_of' AND answered_by IS NULL AND answer_statement IS NOT NULL));
ALTER TABLE experience_merge_proposals DROP CONSTRAINT IF EXISTS experience_merge_proposals_statement_check;
ALTER TABLE experience_merge_proposals ADD CONSTRAINT experience_merge_proposals_statement_check
    CHECK (answer_statement IS NULL OR answered_by_catalogue);

ALTER TABLE experience_curation_log DROP CONSTRAINT IF EXISTS experience_curation_log_action_check;
ALTER TABLE experience_curation_log ADD CONSTRAINT experience_curation_log_action_check
    CHECK (action IN ('created', 'rejected', 'unrejected', 'edited', 'added_to_region', 'removed_from_region', 'marked_former', 'marked_lost', 'state_restored', 'accepted_source', 'declined_source', 'declined_held', 'missing_dismissed', 'admission_confirmed', 'admission_overridden', 'published', 'location_marked_former', 'location_marked_lost', 'location_state_restored', 'location_missing_dismissed', 'location_edited', 'work_edited', 'arrival_refused', 'contents_refused', 'contents_unrefused', 'merged', 'merge_undone', 'views_chosen', 'component_items_answered', 'component_item_taken_back', 'admission_pin_released', 'admission_pin_kept', 'admission_pin_handed_back', 'merge_proposal_answered', 'visit_question_answered', 'identifier_settled', 'separated', 'kept_out', 'merge_proposal_taken_back'));

ALTER TABLE experience_curation_log DROP CONSTRAINT IF EXISTS experience_curation_log_curator_check;
ALTER TABLE experience_curation_log ADD CONSTRAINT experience_curation_log_curator_check
    CHECK (curator_id IS NOT NULL OR action IN ('merged', 'component_items_answered', 'merge_proposal_answered'));

COMMIT;
