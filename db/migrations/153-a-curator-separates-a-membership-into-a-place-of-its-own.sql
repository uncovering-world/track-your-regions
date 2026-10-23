-- 153-a-curator-separates-a-membership-into-a-place-of-its-own.sql
--
-- A curator separates one kind's membership of a place into a place of its
-- own (#1885, ADR-0142): the way back from an equal-item merge, and from a run
-- joining a place on arrival (#1801), when the item turns out to name another
-- thing. The separation is a record, as a merge is (ADR-0086): what moved, and
-- the item the curator set the two places apart on, so the catalogue's
-- equal-item pass leaves them apart. A traveller who marked the original place
-- visited is asked which of the two they visited (#1887): one question per
-- visit, the visit staying where it was until they answer.

\set ON_ERROR_STOP on

BEGIN;

CREATE TABLE IF NOT EXISTS experience_separations (
    id SERIAL PRIMARY KEY,
    original_id INTEGER NOT NULL REFERENCES experiences(id),
    separated_id INTEGER NOT NULL REFERENCES experiences(id),
    membership_id INTEGER REFERENCES experience_kind_memberships(id) ON DELETE SET NULL,
    wikidata_item VARCHAR(20),
    separated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    moved JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- Undone by merging the two again (ADR-0142 decision 4): the merge that did it.
    undone_at TIMESTAMPTZ,
    undone_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    merge_id INTEGER REFERENCES experience_merges(id),
    CHECK (original_id <> separated_id),
    CHECK ((undone_at IS NULL) = (merge_id IS NULL))
);
CREATE INDEX IF NOT EXISTS idx_experience_separations_original ON experience_separations(original_id);
CREATE INDEX IF NOT EXISTS idx_experience_separations_separated ON experience_separations(separated_id);
COMMENT ON TABLE experience_separations IS 'A curator''s separation of one kind''s membership of a place into a place of its own (ADR-0142): what moved, and the Wikidata item the two places were set apart on, which the equal-item pass and the near-places pass then leave apart until a curator undoes it by merging the two again.';

CREATE TABLE IF NOT EXISTS separated_visit_questions (
    id SERIAL PRIMARY KEY,
    separation_id INTEGER NOT NULL REFERENCES experience_separations(id) ON DELETE CASCADE,
    visit_id INTEGER NOT NULL REFERENCES user_visited_experiences(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    asked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    answer VARCHAR(10) CHECK (answer IN ('original', 'separated', 'both')),
    answered_at TIMESTAMPTZ,
    CHECK ((answer IS NULL) = (answered_at IS NULL)),
    UNIQUE (separation_id, visit_id)
);
CREATE INDEX IF NOT EXISTS idx_separated_visit_questions_user ON separated_visit_questions(user_id) WHERE answer IS NULL;
COMMENT ON TABLE separated_visit_questions IS 'A traveller''s question which of two places they visited, raised when a curator separated the place they marked (ADR-0142, #1887): the visit stays on the original place until they answer.';

ALTER TABLE experience_curation_log DROP CONSTRAINT IF EXISTS experience_curation_log_action_check;
ALTER TABLE experience_curation_log ADD CONSTRAINT experience_curation_log_action_check
    CHECK (action IN ('created', 'rejected', 'unrejected', 'edited', 'added_to_region', 'removed_from_region', 'marked_former', 'marked_lost', 'state_restored', 'accepted_source', 'declined_source', 'declined_held', 'missing_dismissed', 'admission_confirmed', 'admission_overridden', 'published', 'location_marked_former', 'location_marked_lost', 'location_state_restored', 'location_missing_dismissed', 'location_edited', 'work_edited', 'arrival_refused', 'contents_refused', 'contents_unrefused', 'merged', 'merge_undone', 'views_chosen', 'component_items_answered', 'component_item_taken_back', 'admission_pin_released', 'admission_pin_kept', 'admission_pin_handed_back', 'merge_proposal_answered', 'visit_question_answered', 'separated'));

COMMIT;
