-- 163-jev-judges-the-hints-of-a-rough-point.sql
--
-- Jev judges each hint of where a component the World Heritage list placed
-- only roughly stands (#1913, ADR-0087), as it judges a component's candidate
-- items (#1272): the hint is where the component stands, or another place.
-- The judgement is shown beside the hint on the Where is it? card and never
-- chosen for the curator.
--
-- An OpenStreetMap hint's tags go on the hint the pass keeps, since the card's
-- route reads no workbench table (ADR-0124) and Jev reads what an object is
-- off its tags: a village, a church, a fort. The next Find component items
-- pass fills them; until then a hint is asked about without them.
--
-- Order-independent with 01-schema.sql, which declares the same objects.
-- Re-runnable: every object is created if absent.

\set ON_ERROR_STOP on

BEGIN;

ALTER TABLE experience_point_hints ADD COLUMN IF NOT EXISTS tags JSONB;
COMMENT ON COLUMN experience_point_hints.tags IS 'An OpenStreetMap hint''s tags as the layer holds them, which Jev reads to judge whether the object is the component (#1913); null on an item.';

-- Jev's judgement of a hint of where a roughly placed component stands (#1913,
-- ADR-0087). See db/migrations/163.
CREATE TABLE IF NOT EXISTS experience_point_hint_suggestions (
    id SERIAL PRIMARY KEY,
    location_id INTEGER NOT NULL REFERENCES experience_locations(id) ON DELETE CASCADE,
    source VARCHAR(10) NOT NULL CHECK (source IN ('item', 'osm-ref', 'osm-name', 'candidate')),
    ref TEXT NOT NULL,
    asked JSONB NOT NULL,
    hint_location geometry(Point, 4326) NOT NULL,
    judgement VARCHAR(10) CHECK (judgement IN ('same', 'other')),
    confidence NUMERIC(4, 3) NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
    probabilities JSONB NOT NULL,
    model VARCHAR(40) NOT NULL,
    input_tokens INTEGER NOT NULL DEFAULT 0,
    asked_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_experience_point_hint_suggestions_hint
    ON experience_point_hint_suggestions(location_id, source, ref, asked_at DESC);
COMMENT ON TABLE experience_point_hint_suggestions IS 'Jev''s judgement of a hint of where a component the World Heritage list placed only roughly stands (#1913): same, the hint is where the component stands; other, another place; null, an answer the client refused. One row per question, each for the hint as recorded in asked, with the hint''s coordinate, which the agreement with the curator''s placement is measured against once the hint itself is gone. Never applied.';
COMMENT ON COLUMN experience_point_hint_suggestions.asked IS 'The hint as the question was built: its label, distance and, for an OpenStreetMap object, its tags, as hintAskedSql states them.';

COMMIT;
