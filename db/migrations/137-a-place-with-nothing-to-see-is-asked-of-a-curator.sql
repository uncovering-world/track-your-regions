-- 137-a-place-with-nothing-to-see-is-asked-of-a-curator.sql
--
-- A curator's question about a place a kind offers where the visit witnesses
-- and Jev's reading both say a visitor finds nothing there (#1770, ADR-0087,
-- ADR-0128 decision 3): fewer than two of the four witnesses vouch for it, and
-- Jev reads it, at confidence 0.7 or more, as nothing to see, not a place or
-- an object -- the Arch of Reunification, Eboracum, the Rondanini Pieta. The
-- kind's run raises it, once per membership; a curator keeps the place or
-- refuses it, and an answered question is never asked again. Nothing is
-- refused by the rule.
--
-- Order-independent with 01-schema.sql, which declares the same objects.
-- Re-runnable: every object is created if absent.

\set ON_ERROR_STOP on

BEGIN;

CREATE TABLE IF NOT EXISTS experience_visit_questions (
    id SERIAL PRIMARY KEY,
    membership_id INTEGER NOT NULL UNIQUE REFERENCES experience_kind_memberships(id) ON DELETE CASCADE,
    witnesses TEXT[] NOT NULL DEFAULT '{}' CHECK (witnesses <@ ARRAY['guide', 'photos', 'formal', 'map']::text[]),
    reading VARCHAR(12) NOT NULL CHECK (reading IN ('nothing', 'not-a-place', 'object')),
    confidence NUMERIC(4, 3) NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
    sync_log_id INTEGER REFERENCES experience_sync_logs(id) ON DELETE SET NULL,
    asked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    answer VARCHAR(10) CHECK (answer IN ('kept', 'refused')),
    answered_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    answered_at TIMESTAMPTZ,
    CHECK ((answer IS NULL) = (answered_at IS NULL))
);
COMMENT ON TABLE experience_visit_questions IS 'A curator''s question about a place a kind offers where fewer than two visit witnesses vouch for it and Jev reads it, at confidence 0.7 or more, as nothing to see, not a place or an object (#1770). Raised by the kind''s run, once per membership (a merge moves the membership, and the question with it): an answered question is never asked again. Never refuses on its own: a curator keeps or refuses the place.';
COMMENT ON COLUMN experience_visit_questions.witnesses IS 'The visit witnesses that vouched for the place when it was asked (ADR-0128): guide, photos, formal, map. Fewer than two.';
COMMENT ON COLUMN experience_visit_questions.reading IS 'Jev''s reading the question was raised on, copied from experience_visit_suggestions so the card shows what was asked.';

COMMIT;
