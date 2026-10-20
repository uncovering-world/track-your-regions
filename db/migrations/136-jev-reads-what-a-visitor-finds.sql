-- 136-jev-reads-what-a-visitor-finds.sql
--
-- Jev's reading of what a visitor finds at a place a curator is asked about
-- (#1768, ADR-0087, ADR-0128): something to see or enter, a part of a larger
-- place, an object kept elsewhere, little or nothing, not one place at all, or
-- a place visited for something its kinds do not offer. Recorded for the place
-- as the question was built from it -- its name, countries and kinds,
-- the map's tag and its article -- so a place renamed or moved into another
-- kind is asked about again, and with the article lead Jev read. Never
-- applied: a curator decides. One row per call, so the rows added up are what
-- Jev cost.
--
-- Order-independent with 01-schema.sql, which declares the same objects.
-- Re-runnable: every object is created if absent.

\set ON_ERROR_STOP on

BEGIN;

CREATE TABLE IF NOT EXISTS experience_visit_suggestions (
    id SERIAL PRIMARY KEY,
    experience_id INTEGER NOT NULL REFERENCES experiences(id) ON DELETE CASCADE,
    asked JSONB NOT NULL,
    article_lead TEXT,
    reading VARCHAR(12) CHECK (reading IN ('visit', 'part', 'object', 'nothing', 'not-a-place', 'other-kind')),
    confidence NUMERIC(4, 3) NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
    probabilities JSONB NOT NULL,
    model VARCHAR(40) NOT NULL,
    input_tokens INTEGER NOT NULL DEFAULT 0,
    asked_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_experience_visit_suggestions_place
    ON experience_visit_suggestions(experience_id, asked_at DESC);

COMMENT ON TABLE experience_visit_suggestions IS 'Jev''s reading of what a visitor finds at a place (#1768, ADR-0087): visit, something to see or enter; part, a part of a larger place; object, a thing kept elsewhere; nothing, little or nothing visible; not-a-place, a culture, a kingdom or a group; other-kind, a place visited for something its kinds do not offer; null, an answer the client refused. One row per call, each for the place as recorded in asked and stale once it changes. Never applied.';
COMMENT ON COLUMN experience_visit_suggestions.asked IS 'The place as the question was built from it: its name, countries and kinds, the map''s tag and its article, as askedSql states them.';
COMMENT ON COLUMN experience_visit_suggestions.article_lead IS 'The lead of the place''s Wikipedia article Jev read, as it was when asked; null where none could be read.';
COMMENT ON COLUMN experience_visit_suggestions.input_tokens IS 'What the call cost: Jev is priced per input token, output free.';

COMMIT;
