-- 078-jev-suggests-a-source-view.sql
--
-- Jev's suggested answer to the review card that asks which of two sources'
-- views a place shows (#1260, ADR-0087), recording the views it was asked
-- about, so a source that sends something different makes the suggestion
-- stale, and the option it picked with its confidence. Never applied: a
-- curator decides. One row per call, so the input tokens added up are what the
-- calls cost.
--
-- Order-independent with 01-schema.sql, which declares the same objects.
-- Re-runnable: every object is created if absent.

\set ON_ERROR_STOP on

BEGIN;

CREATE TABLE IF NOT EXISTS experience_view_suggestions (
    id SERIAL PRIMARY KEY,
    experience_id INTEGER NOT NULL REFERENCES experiences(id) ON DELETE CASCADE,
    field VARCHAR(20) NOT NULL CHECK (field IN ('name', 'description', 'imageUrl', 'location')),
    views JSONB NOT NULL,
    suggested_membership_id INTEGER REFERENCES experience_kind_memberships(id) ON DELETE SET NULL,
    confidence NUMERIC(4, 3) NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
    probabilities JSONB NOT NULL,
    model VARCHAR(40) NOT NULL,
    input_tokens INTEGER NOT NULL DEFAULT 0,
    asked_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- One row per call, never replaced: the rows are also what the calls cost.
CREATE INDEX IF NOT EXISTS idx_experience_view_suggestions_place ON experience_view_suggestions(experience_id, field, asked_at DESC);

COMMIT;
