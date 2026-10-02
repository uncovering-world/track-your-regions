-- 069-coverage-kinds-in-venue.sql
--
-- coverage_kinds says which kinds exist only inside a place (#1215): a work
-- shown in a venue, the climb of a dome. The register's records carry the flag
-- (db/catalogue-coverage/kinds.jsonl, in_venue) and the load copies it, so the
-- report can tell a kind a traveller browses a region by from one found on a
-- place's own card.
--
-- The column arrives false on every row. The tables are a copy of the files:
-- the next scripts/catalogue-coverage.sh load replaces every row with what the
-- register says.
--
-- Order-independent with 01-schema.sql, which carries the same column;
-- re-running this file finds it already there and does nothing.

\set ON_ERROR_STOP on

BEGIN;

ALTER TABLE coverage_kinds ADD COLUMN IF NOT EXISTS in_venue BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN coverage_kinds.in_venue IS 'True when a member exists only inside a place: a work shown there, something done there. An expectation filed under such a kind names its venue.';

COMMIT;
