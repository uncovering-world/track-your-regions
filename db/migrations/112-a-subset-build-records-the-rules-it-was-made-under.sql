-- 112-a-subset-build-records-the-rules-it-was-made-under.sql
--
-- Each build of the local Wikidata subset records the versions of the rules
-- it was made under (#1583): what the first pass keeps, how the second
-- writes a line, and how the derived tables are made. The admin panel
-- compares them with the code's to say whether the copy in place needs a
-- re-derive or a full build. A row from before this is left without them,
-- and is read as current.
--
-- 01-schema.sql declares the same column for a fresh database.
-- Re-runnable: the column is added where it is missing.

\set ON_ERROR_STOP on

BEGIN;

ALTER TABLE wikidata_subset_builds ADD COLUMN IF NOT EXISTS rules JSONB;

COMMENT ON COLUMN wikidata_subset_builds.rules IS 'The versions of the rules the build was made under (#1583): scope (the first pass''s version and rules), write (how a line is written), derive (how the derived tables are made). Null on a build from before they were recorded, read as current.';

COMMIT;
