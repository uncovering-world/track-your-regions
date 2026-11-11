-- 229-a-run-names-the-fold-of-the-readership-it-read.sql
--
-- A run's copies_read names, beside readership's dump date, which redirects
-- builds folded its twelve months (#2415). Readership's dump date stays the
-- same through a refold after the redirects move, so a run before the refold
-- and one after it would otherwise record the same copies. The value is the
-- dump date, then a #, then build@date×months for each build
-- (services/dumps/runInputs.ts). This restates the column's comment, which
-- 226 wrote when every value was a date.
--
-- Order-independent with 01-schema.sql, which states the same comment.
-- Re-runnable: a comment is set again.

\set ON_ERROR_STOP on

BEGIN;

COMMENT ON COLUMN experience_sync_logs.copies_read IS 'The dump date of each copy built from a dump that was in place when the run started, by the dump it is built from: {"wikidata-entities": "2026-10-26", "pageviews-user": "2026-09-01#59@2026-10-01×12", ...} (#2415). After a #, what tells two states of a copy apart beyond its dump date: for readership, which redirects builds folded its twelve months, as build@date×months. A copy not built then is left out. NULL is a run from before migration 226.';

COMMIT;
