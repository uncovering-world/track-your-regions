-- 108-the-division-tile-functions-name-no-provider.sql
--
-- The two tile functions that draw the administrative base layer were named
-- for GADM (tile_gadm_root_divisions, tile_gadm_subdivisions), though the base
-- layer is whichever dataset administrative_divisions holds (ADR-0018). Martin
-- publishes a function under its own name, so the name is the public tile URL:
-- they become tile_root_divisions and tile_division_subdivisions, beside
-- tile_world_view_root_regions and tile_region_subregions (#625).
--
-- A rename keeps the body, the owner and the PUBLIC grant; the comments are
-- restated in the new words. gadm_uid keeps its name on purpose, and its
-- column comment now says why.
--
-- Martin discovers functions when it starts: restart it after this runs, or
-- it keeps serving the old names and 404s the new ones the web asks for.
--
-- Re-runnable, and either file may run first: a function already renamed is
-- left alone, and one the schema file already made replaces the old name.

\set ON_ERROR_STOP on

BEGIN;

-- A database 01-schema.sql was re-applied to before this file already holds
-- the new functions beside the old ones (the schema's CREATE OR REPLACE made
-- them, with their grants), so there the old ones are dropped, not renamed.
DO $$
BEGIN
    IF to_regprocedure('tile_gadm_root_divisions(integer, integer, integer, json)') IS NOT NULL THEN
        IF to_regprocedure('tile_root_divisions(integer, integer, integer, json)') IS NULL THEN
            ALTER FUNCTION tile_gadm_root_divisions(integer, integer, integer, json)
                RENAME TO tile_root_divisions;
        ELSE
            DROP FUNCTION tile_gadm_root_divisions(integer, integer, integer, json);
        END IF;
    END IF;
    IF to_regprocedure('tile_gadm_subdivisions(integer, integer, integer, json)') IS NOT NULL THEN
        IF to_regprocedure('tile_division_subdivisions(integer, integer, integer, json)') IS NULL THEN
            ALTER FUNCTION tile_gadm_subdivisions(integer, integer, integer, json)
                RENAME TO tile_division_subdivisions;
        ELSE
            DROP FUNCTION tile_gadm_subdivisions(integer, integer, integer, json);
        END IF;
    END IF;
END;
$$;

COMMENT ON FUNCTION tile_root_divisions(integer, integer, integer, json) IS
    'MVT tiles for the root divisions of the administrative base layer (continents)';
COMMENT ON FUNCTION tile_division_subdivisions(integer, integer, integer, json) IS
    'MVT tiles for the subdivisions of a parent division. Query params: parent_id (required)';

COMMENT ON COLUMN administrative_divisions.gadm_uid IS 'GADM UID of the single GeoPackage polygon a leaf division was loaded from (db/init-db.py); NULL on a division assembled from its children. Named for GADM on purpose: it is that dataset''s key, not a provider-neutral one.';

COMMIT;
