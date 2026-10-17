-- 117-near-places-with-similar-names-are-proposed.sql
--
-- Two places near each other with similar names are proposed as one place,
-- and a person answers (#1249, ADR-0046 decisions 2 to 4). A proposal is a row
-- of experience_merge_proposals: the two places in id order, how far apart
-- their nearest points stand, how alike their names are, the reach the pair
-- was found under, and the answer once a curator gives one -- one place (the
-- merge it ran), two places, or one part of the other (which place is the
-- part). An answered pair is kept, so a refused pair is never proposed again
-- (ADR-0046 decision 4).
--
-- Order-independent with 01-schema.sql, which declares the same objects.
-- Re-runnable: every object is created if absent.

\set ON_ERROR_STOP on

BEGIN;

CREATE TABLE IF NOT EXISTS experience_merge_proposals (
    id SERIAL PRIMARY KEY,
    place_a INTEGER NOT NULL REFERENCES experiences(id) ON DELETE CASCADE,
    place_b INTEGER NOT NULL REFERENCES experiences(id) ON DELETE CASCADE,
    distance_m INTEGER NOT NULL,
    name_similarity REAL NOT NULL,
    exact BOOLEAN NOT NULL DEFAULT false,
    reach_m INTEGER NOT NULL,
    proposed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    answer VARCHAR(10) CHECK (answer IN ('one', 'two', 'part_of')),
    part_id INTEGER REFERENCES experiences(id),
    answered_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    answered_at TIMESTAMPTZ,
    merge_id INTEGER REFERENCES experience_merges(id) ON DELETE SET NULL,
    UNIQUE (place_a, place_b),
    CHECK (place_a < place_b),
    CHECK ((answer IS NULL) = (answered_at IS NULL)),
    CHECK (answer IS DISTINCT FROM 'part_of' OR part_id = place_a OR part_id = place_b),
    CHECK (answer = 'part_of' OR part_id IS NULL),
    CHECK (merge_id IS NULL OR answer = 'one')
);
CREATE INDEX IF NOT EXISTS idx_experience_merge_proposals_open
  ON experience_merge_proposals(place_a) WHERE answer IS NULL;
CREATE INDEX IF NOT EXISTS idx_experience_merge_proposals_place_b ON experience_merge_proposals(place_b);
COMMENT ON TABLE experience_merge_proposals IS 'Two places near each other with similar names, proposed as one place (ADR-0046 decision 2, #1249): the pair in id order, its distance, similarity and reach, and the curator''s answer -- one place, two places, or one part of the other. An answered pair is kept and never proposed again.';
COMMENT ON COLUMN experience_merge_proposals.exact IS 'The two places carry one and the same folded name within fifty metres: the pairs a batch confirms.';
COMMENT ON COLUMN experience_merge_proposals.reach_m IS 'The distance the pair was found under: 300 m, or the radius of a World Heritage property''s area up to 3 km.';
COMMENT ON COLUMN experience_merge_proposals.part_id IS 'Which of the two is the part, when the answer is part_of; recorded here for #823, never written to experience_parts by this answer.';

COMMIT;
