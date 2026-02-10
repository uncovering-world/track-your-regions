-- =============================================================================
-- Migration: Fix trigger to handle GeometryCollection inputs
-- =============================================================================
-- The update_regions_geom_3857 trigger was failing when the input geometry
-- was a GeometryCollection (e.g., after merging complex regions).
--
-- This migration updates the trigger to use ST_CollectionExtract to ensure
-- only polygons are stored in the MultiPolygon columns.
-- =============================================================================

-- Drop and recreate the trigger function with the fix
CREATE OR REPLACE FUNCTION update_regions_geom_3857()
RETURNS TRIGGER AS $$
DECLARE
    effective_geom geometry;
    geom_changed boolean;
    ts_hull_changed boolean;
    display_changed boolean;
BEGIN
    -- For INSERT, OLD is NULL, so we need to check if NEW has values
    -- For UPDATE, compare with OLD values
    geom_changed := (TG_OP = 'INSERT' AND NEW.geom IS NOT NULL)
                    OR (TG_OP = 'UPDATE' AND NEW.geom IS DISTINCT FROM OLD.geom);
    ts_hull_changed := (TG_OP = 'INSERT' AND NEW.ts_hull_geom IS NOT NULL)
                       OR (TG_OP = 'UPDATE' AND NEW.ts_hull_geom IS DISTINCT FROM OLD.ts_hull_geom);
    display_changed := (TG_OP = 'INSERT' AND NEW.display_geom IS NOT NULL)
                       OR (TG_OP = 'UPDATE' AND NEW.display_geom IS DISTINCT FROM OLD.display_geom);

    -- Transform changed geometries to 3857
    -- Use ST_CollectionExtract to ensure we only get polygons (handles GeometryCollection input)
    IF geom_changed AND NEW.geom IS NOT NULL THEN
        NEW.geom_3857 := ST_Multi(ST_CollectionExtract(ST_MakeValid(ST_Transform(NEW.geom, 3857)), 3));
    END IF;
    IF ts_hull_changed AND NEW.ts_hull_geom IS NOT NULL THEN
        NEW.ts_hull_geom_3857 := ST_Multi(ST_CollectionExtract(ST_MakeValid(ST_Transform(NEW.ts_hull_geom, 3857)), 3));
    END IF;
    IF display_changed AND NEW.display_geom IS NOT NULL THEN
        NEW.display_geom_3857 := ST_Multi(ST_CollectionExtract(ST_MakeValid(ST_Transform(NEW.display_geom, 3857)), 3));
    END IF;

    -- Update simplified geometries when any source geometry changes
    IF geom_changed OR ts_hull_changed OR display_changed THEN
        -- Use the best available geometry for simplification
        -- Priority: ts_hull > display > geom (ts_hull is usually cleanest for complex regions)
        effective_geom := COALESCE(NEW.ts_hull_geom_3857, COALESCE(NEW.display_geom_3857, NEW.geom_3857));
        IF effective_geom IS NOT NULL THEN
            -- Use ST_MakeValid to fix any self-intersections from simplification
            -- Use ST_CollectionExtract(geom, 3) to extract only polygons (type 3)
            -- This handles cases where ST_MakeValid returns a GeometryCollection
            NEW.geom_simplified_low := ST_Multi(ST_CollectionExtract(
                ST_MakeValid(ST_SimplifyPreserveTopology(effective_geom, 10000)), 3));
            NEW.geom_simplified_medium := ST_Multi(ST_CollectionExtract(
                ST_MakeValid(ST_SimplifyPreserveTopology(effective_geom, 1000)), 3));
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- The trigger itself doesn't need to be recreated - it just calls the function
-- But let's make sure it exists
DROP TRIGGER IF EXISTS regions_geom_3857_trigger ON regions;
CREATE TRIGGER regions_geom_3857_trigger
    BEFORE INSERT OR UPDATE ON regions
    FOR EACH ROW
    EXECUTE FUNCTION update_regions_geom_3857();

-- Add a comment to track the migration
COMMENT ON FUNCTION update_regions_geom_3857() IS 'Trigger to auto-update 3857 columns. Fixed 2026-02-01 to handle GeometryCollection inputs.';
