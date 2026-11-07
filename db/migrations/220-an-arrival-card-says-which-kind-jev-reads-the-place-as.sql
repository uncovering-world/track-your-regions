-- 220-an-arrival-card-says-which-kind-jev-reads-the-place-as.sql
--
-- Jev's reading of which kind, live or planned, an arriving place belongs to,
-- and a curator's answer about a planned one (#2342, ADR-0087).
--
-- The register of kinds (coverage_kinds, ADR-0081) moves back into `public`,
-- re-tiered serving (ADR-0124 decision 3): an arrival's card offers Jev the
-- catalogue's live kinds and the register's planned ones with the register's
-- definitions, and a table a curator route reads is serving. The rest of the
-- coverage survey stays in `workbench`; its keys into the register
-- (coverage_expectation_kinds, coverage_judgements,
-- coverage_calibration_entries) hold while the two tiers share a database,
-- as the register's own key to experience_kinds did the other way. The
-- coverage loader names the table bare, so nothing else changes. No coverage
-- load may run while this file is applied.
--
-- experience_kind_suggestions holds Jev's readings, one row per call, each for
-- the place and the kinds offered as the question was built from them, so a
-- place renamed or a register reloaded with other kinds is asked again. Never
-- applied: a curator decides. experience_planned_kind_answers holds a
-- curator's answer that a place belongs, or not, to a planned kind, so its
-- candidates can be listed when the kind is built.
--
-- Order-independent with 01-schema.sql, which declares the same objects.
-- Re-runnable: the move is skipped once the table is in `public`, an empty
-- one 01-schema.sql made there beside the real one is dropped first, and
-- every other object is created if absent.

\set ON_ERROR_STOP on

BEGIN;

DO $$
DECLARE
  rows_there BOOLEAN;
BEGIN
  IF to_regclass('workbench.coverage_kinds') IS NOT NULL THEN
    IF to_regclass('public.coverage_kinds') IS NOT NULL THEN
      SELECT EXISTS (SELECT 1 FROM public.coverage_kinds) INTO rows_there;
      IF rows_there THEN
        RAISE EXCEPTION 'workbench.coverage_kinds and public.coverage_kinds both exist and public holds rows; resolve by hand';
      END IF;
      DROP TABLE public.coverage_kinds CASCADE;
    END IF;
    ALTER TABLE workbench.coverage_kinds SET SCHEMA public;
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS experience_kind_suggestions (
    id SERIAL PRIMARY KEY,
    experience_id INTEGER NOT NULL REFERENCES experiences(id) ON DELETE CASCADE,
    asked JSONB NOT NULL,
    article_lead TEXT,
    reading VARCHAR(7) CHECK (reading IN ('live', 'planned', 'none')),
    kind_id INTEGER REFERENCES experience_kinds(id),
    planned_kind VARCHAR(80),
    confidence NUMERIC(4, 3) NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
    probabilities JSONB NOT NULL,
    model VARCHAR(40) NOT NULL,
    input_tokens INTEGER NOT NULL DEFAULT 0,
    asked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT experience_kind_suggestions_names_its_kind CHECK (
        (kind_id IS NOT NULL) = (reading IS NOT DISTINCT FROM 'live')
        AND (planned_kind IS NOT NULL) = (reading IS NOT DISTINCT FROM 'planned'))
);
CREATE INDEX IF NOT EXISTS idx_experience_kind_suggestions_place
    ON experience_kind_suggestions(experience_id, asked_at DESC);
COMMENT ON TABLE experience_kind_suggestions IS 'Jev''s reading of which kind an arriving place belongs to (#2342, ADR-0087): live, a kind of the catalogue (kind_id); planned, a place kind the coverage register proposes (planned_kind, its slug); none, no kind live or planned; null, an answer the client refused. One row per call, each for the place and the kinds offered as recorded in asked, and stale once either changes. Never applied.';
COMMENT ON COLUMN experience_kind_suggestions.asked IS 'The place as the question was built from it, its name, countries, description, the map''s tag and its article, with a digest of the kinds Jev was offered, as askedSql states them.';
COMMENT ON COLUMN experience_kind_suggestions.planned_kind IS 'The register''s slug of a planned kind (coverage_kinds.slug). No key: the register is reloaded from its files, and a planned kind keeps its slug once built.';
COMMENT ON COLUMN experience_kind_suggestions.input_tokens IS 'What the call cost: Jev is priced per input token, output free.';

CREATE TABLE IF NOT EXISTS experience_planned_kind_answers (
    id SERIAL PRIMARY KEY,
    experience_id INTEGER NOT NULL REFERENCES experiences(id) ON DELETE CASCADE,
    planned_kind VARCHAR(80) NOT NULL,
    belongs BOOLEAN NOT NULL,
    curator_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    answered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (experience_id, planned_kind)
);
CREATE INDEX IF NOT EXISTS idx_experience_planned_kind_answers_kind
    ON experience_planned_kind_answers(planned_kind) WHERE belongs;
COMMENT ON TABLE experience_planned_kind_answers IS 'A curator''s answer to Jev''s reading that a place belongs to a kind the coverage register plans (#2342): belongs, the place is a candidate of that kind for when it is built; not, it is not. One row per place and planned kind, the latest answer.';
COMMENT ON COLUMN experience_planned_kind_answers.planned_kind IS 'The register''s slug of the planned kind (coverage_kinds.slug). No key: the register is reloaded from its files, and a kind keeps its slug once built, which is when its candidates are listed.';

COMMIT;
