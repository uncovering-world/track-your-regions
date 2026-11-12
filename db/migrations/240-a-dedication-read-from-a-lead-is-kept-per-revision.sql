-- 240-a-dedication-read-from-a-lead-is-kept-per-revision.sql
--
-- The commemorates reading's seventh step (#2472, ADR-0201) asks two language
-- models which linked article the lead of a monument's English Wikipedia
-- article names as its dedication. Two runs of one model differ on about a
-- tenth of the places, so each model's answer is kept with the revision of
-- the lead it read, and a model is asked again only once the lead has
-- changed: a reading does not flip from one pass to the next. A workbench
-- table (ADR-0124): a run's cache, read by the run, never by a reader.
--
-- Re-runnable: created if absent; the comment is replaced.

\set ON_ERROR_STOP on

BEGIN;

CREATE TABLE IF NOT EXISTS workbench.lead_dedication_readings (
    wiki TEXT NOT NULL,
    title TEXT NOT NULL,
    model TEXT NOT NULL,
    revid BIGINT NOT NULL,
    answer TEXT,
    read_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (wiki, title, model)
);
COMMENT ON TABLE workbench.lead_dedication_readings IS 'What one language model read from the lead of one article as the dedication of the place it describes (#2472, ADR-0201): the wiki (enwiki), the article''s title as the run asked it, the model, the revision of the lead it read, and the linked article it named (null for none). The commemorates reading (places/leadDedication.ts) asks a model again only where the lead''s current revision is not the one kept, and replaces the row; a failed call keeps none. Read by the run alone, never by a reader route.';

COMMIT;
