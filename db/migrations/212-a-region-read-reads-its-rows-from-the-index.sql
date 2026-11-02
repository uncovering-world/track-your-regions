-- 212-a-region-read-reads-its-rows-from-the-index.sql
--
-- A read that starts from a region reads its rows of experience_regions and
-- experience_location_regions by region_id (#2283). Placement writes them for
-- the places waiting for a curator too (ADR-0025 decision 5), so Europe holds
-- 23 238 place rows and 32 013 point rows, and the reads fetched each from the
-- table for the one or two columns beside the region. The region's indexes
-- now carry those columns: the place and its assignment type, and the point.
-- Each replaces the plain index on region_id, whose lookups it serves.
--
-- What a reader sees is unchanged.
--
-- Re-runnable: each new index is created if missing, each old one dropped if
-- present.

\set ON_ERROR_STOP on

BEGIN;

-- The drop holds its table's exclusive lock until the transaction ends: a
-- long transaction on the other table must not stall the region reads behind it.
SET LOCAL lock_timeout = '10s';

CREATE INDEX IF NOT EXISTS idx_experience_regions_region_rows
    ON experience_regions(region_id) INCLUDE (experience_id, assignment_type);
DROP INDEX IF EXISTS idx_experience_regions_region;

CREATE INDEX IF NOT EXISTS idx_experience_location_regions_region_rows
    ON experience_location_regions(region_id) INCLUDE (location_id);
DROP INDEX IF EXISTS idx_experience_location_regions_region;

COMMIT;
