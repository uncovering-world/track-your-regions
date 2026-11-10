-- 223-a-region-names-its-country-by-code.sql
--
-- A surveyed region names its country by its ISO 3166-1 code (#2406), so
-- the coverage report can leave out of a region's reach a place that stands
-- only in other countries: Seoul's 60 km circle takes in Kaesong, 58 km
-- away in North Korea across the closed border, which no guide of Seoul can
-- name. The code is a field of db/catalogue-coverage/regions.jsonl, and the
-- column is NOT NULL like every other field of a region.
--
-- The coverage tables are a copy of the files that
-- scripts/catalogue-coverage.sh load replaces whole, and nothing else writes
-- them. So where the column is new, the regions are emptied (their
-- expectations and judgements go with them, by cascade) and the column is
-- added NOT NULL. The load must follow this migration: until it runs, the
-- report says the lists have not been loaded.
--
-- Re-runnable: a database that has the column keeps its rows.

\set ON_ERROR_STOP on

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'workbench' AND table_name = 'coverage_regions' AND column_name = 'country_code'
  ) THEN
    DELETE FROM workbench.coverage_regions;
    ALTER TABLE workbench.coverage_regions
      ADD COLUMN country_code CHAR(2) NOT NULL CHECK (country_code ~ '^[A-Z]{2}$');
  END IF;
END $$;

COMMENT ON COLUMN workbench.coverage_regions.country_code IS 'The ISO 3166-1 alpha-2 code of the region''s country (#2406): a place none of whose countries is this one lies outside the region''s reach in the coverage report.';

COMMIT;
