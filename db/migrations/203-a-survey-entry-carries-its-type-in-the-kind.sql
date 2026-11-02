-- 203-a-survey-entry-carries-its-type-in-the-kind.sql
--
-- A crowded city shows the ten best-known places of a kind and type within
-- 10 km (ADR-0172), and the coverage report now asks of a survey what the map
-- shows: an entry of a region, kind and type is demanded unless the kind's
-- crowding_limit entries of the same type within crowding_radius_km of it are
-- named by more sources, and the rest are the list's tail (#2246). So a filing of an entry under a kind carries the type
-- the kind's own rule gives the entry's item: a church, a mosque, a bridge.
--
-- The column arrives null on every row. The tables are a copy of the files:
-- the next scripts/catalogue-coverage.sh load computes every type from the
-- local Wikidata subset and replaces every row.
--
-- Order-independent with 01-schema.sql, which declares the same column.
-- Re-runnable: the column is added if absent.

\set ON_ERROR_STOP on

BEGIN;

ALTER TABLE workbench.coverage_expectation_kinds ADD COLUMN IF NOT EXISTS type TEXT;

COMMENT ON COLUMN workbench.coverage_expectation_kinds.type IS 'The type the entry''s item takes in the kind''s own vocabulary (church, mosque, bridge, square...), computed by the kind''s rule from the item''s classes in the local Wikidata subset at every load (#2246). Null under a kind with no types, and where the entry has no item or the subset does not say what it is. The report demands an entry unless crowding_limit entries of its region, kind and type within crowding_radius_km of it are named by more sources, as the map shows a city (ADR-0172).';

COMMIT;
