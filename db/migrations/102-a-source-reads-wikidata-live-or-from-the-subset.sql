-- 102-a-source-reads-wikidata-live-or-from-the-subset.sql
--
-- Which Wikidata a source's runs read (#1459, #1439): the live query service,
-- or the local subset built from the entities dump (ADR-0105). The admin sets
-- it on the source's card once every question the source asks has a twin in
-- the subset.
--
-- 01-schema.sql declares the same column for a fresh database.
-- Re-runnable: the column is added where missing.

\set ON_ERROR_STOP on

BEGIN;

ALTER TABLE experience_sources ADD COLUMN IF NOT EXISTS wikidata_reader VARCHAR(10) NOT NULL DEFAULT 'live'
  CHECK (wikidata_reader IN ('live', 'subset'));
COMMENT ON COLUMN experience_sources.wikidata_reader IS 'Which Wikidata the source''s runs read (#1459): the live query service, or the local subset built from the entities dump (ADR-0105).';

COMMIT;
