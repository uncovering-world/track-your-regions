-- Migration 005: Restore WorldView Import geoshape + hierarchy-review schema
--
-- The geoshape-precision matching and AI "Review Children" features ship TS code
-- that depends on a `wikidata_geoshapes` table and three `region_import_state`
-- columns (geo_available, hierarchy_reviewed, hierarchy_warnings). Those objects
-- were only ever applied as ad-hoc DDL to dev databases and were never committed
-- to db/init/01-schema.sql or a migration. After a `git reset --hard` the TS code
-- was recovered but the DDL was not, so freshly-initialized databases lack them
-- and the import-review endpoints fail with:
--   - relation "wikidata_geoshapes" does not exist (42P01)
--   - column ris.hierarchy_warnings does not exist (42703)
--
-- This migration adds the missing objects to existing dev databases. The same
-- definitions now live in db/init/01-schema.sql so fresh databases are correct.
--
-- Idempotent: IF NOT EXISTS guards and the constraint DO-block make re-running a no-op.

ALTER TABLE region_import_state
    ADD COLUMN IF NOT EXISTS geo_available      BOOLEAN,
    ADD COLUMN IF NOT EXISTS hierarchy_reviewed BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS hierarchy_warnings TEXT[];

COMMENT ON COLUMN region_import_state.geo_available IS 'Whether a Wikidata geoshape is available for this region (NULL until checked)';
COMMENT ON COLUMN region_import_state.hierarchy_reviewed IS 'True once an admin has run AI Review Children on this region';
COMMENT ON COLUMN region_import_state.hierarchy_warnings IS 'AI-flagged issues with the current child set (empty/NULL = none)';

CREATE TABLE IF NOT EXISTS wikidata_geoshapes (
    wikidata_id TEXT PRIMARY KEY,
    geom geometry(MultiPolygon, 4326),
    not_available BOOLEAN NOT NULL DEFAULT FALSE,
    CONSTRAINT wikidata_geoshapes_geom_presence CHECK (not_available OR geom IS NOT NULL)
);

-- Add the negative-cache invariant to databases where the table predates it
-- (the CREATE TABLE above is a no-op when the table already exists).
-- NOT VALID: enforce the constraint for every new/updated row without an
-- immediate full-table scan under an Access Exclusive lock, and without failing
-- the migration if a legacy row already violates it. Run
-- `ALTER TABLE wikidata_geoshapes VALIDATE CONSTRAINT wikidata_geoshapes_geom_presence`
-- after cleaning up any such rows to mark it fully validated.
DO $$ BEGIN
    ALTER TABLE wikidata_geoshapes
        ADD CONSTRAINT wikidata_geoshapes_geom_presence CHECK (not_available OR geom IS NOT NULL) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_wikidata_geoshapes_geom ON wikidata_geoshapes USING GIST (geom);

COMMENT ON TABLE wikidata_geoshapes IS 'Cache of Wikidata/Commons geoshapes (and composite unions) for WorldView Import geoshape matching';
COMMENT ON COLUMN wikidata_geoshapes.not_available IS 'Negative cache: TRUE means a geoshape lookup confirmed none exists';
