-- 185-an-import-names-the-wikivoyage-copy-it-read.sql
--
-- The Wikivoyage extraction reads English Wikivoyage's copy kept from the
-- monthly dump, never the live wiki (#2089), so two extractions of one copy
-- build the same tree. An import run names the copy it was read from, so the
-- tree a world view was imported as can be told apart from the next month's.
--
-- Null for a run that read no copy: a file upload, or a Wikivoyage import made
-- before this column existed, which read the live wiki.
--
-- Re-runnable.

\set ON_ERROR_STOP on

BEGIN;

ALTER TABLE import_runs
    ADD COLUMN IF NOT EXISTS source_dump_date DATE;

COMMENT ON COLUMN import_runs.source_dump_date IS
    'The monthly dump of English Wikivoyage the extraction read its pages from; null for a run that read no copy';

COMMIT;
