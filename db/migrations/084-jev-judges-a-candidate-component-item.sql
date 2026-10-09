-- 084-jev-judges-a-candidate-component-item.sql
--
-- Jev's judgement of a candidate Wikidata item for a World Heritage component
-- (#1272, ADR-0087): whether the item is the component itself or another
-- place, with its confidence, recorded for the candidate as it was asked
-- about -- the item's label, the distance, the name similarity and the rule
-- that found it -- so a candidate the finder proposes again with other
-- measures is asked about again. Never applied: a curator decides. One row per
-- question; a card's candidates are asked in one call, whose input tokens are
-- shared out over its questions, so the rows added up are what Jev cost.
--
-- Order-independent with 01-schema.sql, which declares the same objects.
-- Re-runnable: every object is created if absent.

\set ON_ERROR_STOP on

BEGIN;

CREATE TABLE IF NOT EXISTS experience_component_item_suggestions (
    id SERIAL PRIMARY KEY,
    location_id INTEGER NOT NULL REFERENCES experience_locations(id) ON DELETE CASCADE,
    wikidata_item VARCHAR(20) NOT NULL,
    asked JSONB NOT NULL,
    judgement VARCHAR(10) CHECK (judgement IN ('same', 'other')),
    confidence NUMERIC(4, 3) NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
    probabilities JSONB NOT NULL,
    model VARCHAR(40) NOT NULL,
    input_tokens INTEGER NOT NULL DEFAULT 0,
    asked_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_experience_component_item_suggestions_candidate
    ON experience_component_item_suggestions(location_id, wikidata_item, asked_at DESC);

COMMENT ON TABLE experience_component_item_suggestions IS 'Jev''s judgement of a candidate Wikidata item for a World Heritage component (#1272): same, the item is the component; other, another place; null, an answer the client refused. One row per question, each for the candidate as recorded in asked and stale once the finder proposes it with other measures. Never applied.';
COMMENT ON COLUMN experience_component_item_suggestions.asked IS 'The candidate as the question was built: the item''s label, the distance, the name similarity and the rule that found it, as askedSql states them.';
COMMENT ON COLUMN experience_component_item_suggestions.input_tokens IS 'This question''s share of what its call cost: Jev is priced per input token, output free, and a card''s candidates are asked in one call.';

COMMIT;
