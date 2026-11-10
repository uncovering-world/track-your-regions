-- 226-a-run-names-the-copies-it-read.sql
--
-- A sync run's log row names the dump date of every copy built from a dump
-- that was in place when it started (#2415): the Wikidata subset, English
-- Wikipedia's structure, readership and the others. Two runs compared main
-- against a branch can then be seen to stand on the same inputs, and a
-- comparison across a swap shows as one. The row is written holding the
-- lock a swap takes (services/dumps/swapGuard.ts), so no copy changes between
-- the dates read and the run's start. NULL is a run from before.
--
-- Order-independent with 01-schema.sql, which declares the same column.
-- Re-runnable: the column is added if absent.

\set ON_ERROR_STOP on

BEGIN;

ALTER TABLE experience_sync_logs ADD COLUMN IF NOT EXISTS copies_read JSONB;
COMMENT ON COLUMN experience_sync_logs.copies_read IS 'The dump date of each copy built from a dump that was in place when the run started, by the dump it is built from: {"wikidata-entities": "2026-10-26", "pageviews-user": "2026-09-01", ...} (#2415). A copy not built then is left out. NULL is a run from before migration 226.';

COMMIT;
