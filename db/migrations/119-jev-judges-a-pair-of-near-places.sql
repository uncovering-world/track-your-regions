-- 119-jev-judges-a-pair-of-near-places.sql
--
-- Jev's judgement of two near places with similar names (#1249, ADR-0087):
-- one place, two places, or one part of the other, with its confidence, for
-- the pair as the question was built from it; null, an answer the client
-- refused. One row per question, each carrying its share of its call's input
-- tokens, so the rows added up are what the calls cost. Never applied: the
-- card shows it beside the pair and a curator decides.
--
-- Keyed on the two places, not on the proposal: a pass deletes an open pair
-- it no longer finds, and a judgement Jev was paid for outlives that — the
-- proposal pointer is cleared, the row stays, the cost stays counted, and a
-- pair proposed again with the same measures finds its judgement.
--
-- Order-independent with 01-schema.sql, which declares the same objects.
-- Re-runnable: every object is created if absent.

\set ON_ERROR_STOP on

BEGIN;

CREATE TABLE IF NOT EXISTS experience_merge_suggestions (
    id SERIAL PRIMARY KEY,
    place_a INTEGER NOT NULL REFERENCES experiences(id) ON DELETE CASCADE,
    place_b INTEGER NOT NULL REFERENCES experiences(id) ON DELETE CASCADE,
    proposal_id INTEGER REFERENCES experience_merge_proposals(id) ON DELETE SET NULL,
    asked JSONB NOT NULL,
    judgement VARCHAR(10) CHECK (judgement IN ('one', 'two', 'part_of')),
    confidence NUMERIC(4, 3) NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
    probabilities JSONB NOT NULL,
    model VARCHAR(40) NOT NULL,
    input_tokens INTEGER NOT NULL DEFAULT 0,
    asked_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_experience_merge_suggestions_pair
    ON experience_merge_suggestions(place_a, place_b, asked_at DESC);
COMMENT ON TABLE experience_merge_suggestions IS 'Jev''s judgement of two near places with similar names (#1249, ADR-0087): one, the two are one place; two, two places; part_of, one lies within the other; null, an answer the client refused. One row per question, keyed on the two places and kept when a pass drops the proposal, each for the pair as recorded in asked and stale once the pass or a rename changes it. Never applied.';
COMMENT ON COLUMN experience_merge_suggestions.proposal_id IS 'The proposal the question was asked for; null once a pass dropped it. The judgement and its cost stay, on the two places.';
COMMENT ON COLUMN experience_merge_suggestions.asked IS 'The pair as the question was built from it: both names, the distance, the similarity and whether exact; a judgement answers for that pair only.';
COMMENT ON COLUMN experience_merge_suggestions.input_tokens IS 'This question''s share of its call''s input tokens, so the rows added up are what the calls cost.';

COMMIT;
