-- Script to update is_archipelago flags with improved detection logic
-- This script first updates the detection function, then updates all regions

-- Ensure notices are displayed
SET client_min_messages = NOTICE;

-- Step 1: Update the is_archipelago_geometry function to handle antimeridian-crossing regions
-- OPTIMIZED and CONSERVATIVE: Avoids false positives for continental regions with complex coastlines
CREATE OR REPLACE FUNCTION is_archipelago_geometry(p_geom GEOMETRY)
RETURNS BOOLEAN AS $$
DECLARE
    num_parts INTEGER;
    lng_span DOUBLE PRECISION;
    lat_span DOUBLE PRECISION;
    bbox_area_approx DOUBLE PRECISION;
    geom_area_approx DOUBLE PRECISION;
    sparsity DOUBLE PRECISION;
    area_per_part DOUBLE PRECISION;
BEGIN
    IF p_geom IS NULL THEN
        RETURN false;
    END IF;

    num_parts := ST_NumGeometries(p_geom);

    -- Low part count - definitely not an archipelago
    -- Must have at least 10 separate parts (islands)
    IF num_parts < 10 THEN
        RETURN false;
    END IF;

    -- Check if geometry crosses antimeridian (bbox spans nearly full longitude)
    lng_span := ST_XMax(p_geom) - ST_XMin(p_geom);
    lat_span := ST_YMax(p_geom) - ST_YMin(p_geom);

    -- Calculate areas
    bbox_area_approx := lng_span * lat_span;
    geom_area_approx := ST_Area(p_geom);
    IF geom_area_approx < 0.0001 THEN
        geom_area_approx := 0.0001;
    END IF;

    sparsity := bbox_area_approx / geom_area_approx;
    area_per_part := geom_area_approx / num_parts;

    -- Exclude large continental regions: if average area per part is large (> 0.5 sq degrees),
    -- it's likely a continent with coastal islands, not an archipelago
    IF area_per_part > 0.5 THEN
        RETURN false;
    END IF;

    -- For antimeridian-crossing geometries (bbox spans nearly 360 degrees),
    -- must be very sparse with many small islands
    IF lng_span > 350 THEN
        RETURN num_parts >= 100 AND area_per_part < 0.1;
    END IF;

    -- Archipelago criteria:
    -- 1. At least 10 separate parts
    -- 2. Small average area per part (< 0.5 sq degrees)
    -- 3. Very sparse: bbox is at least 200x larger than actual geometry area
    -- OR: At least 100 parts with sparsity > 100 and small parts
    IF num_parts >= 100 AND sparsity > 100 AND area_per_part < 0.2 THEN
        RETURN true;
    END IF;

    RETURN num_parts >= 10 AND sparsity > 200 AND area_per_part < 0.5;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Step 2: Update archipelago flags with progress per region
DO $$
DECLARE
    total_count INTEGER;
    processed INTEGER := 0;
    rec RECORD;
    new_val BOOLEAN;
    start_time TIMESTAMP;
    region_start TIMESTAMP;
    elapsed_ms INTEGER;
BEGIN
    start_time := clock_timestamp();
    SELECT COUNT(*) INTO total_count FROM regions WHERE geom IS NOT NULL;
    RAISE NOTICE '[%] Starting update of % regions...', start_time::time, total_count;

    FOR rec IN
        SELECT id, name, ST_NPoints(geom) as pts, is_archipelago as old_val
        FROM regions
        WHERE geom IS NOT NULL
        ORDER BY ST_NPoints(geom) ASC  -- Process smallest first
    LOOP
        processed := processed + 1;
        region_start := clock_timestamp();

        new_val := is_archipelago_geometry((SELECT geom FROM regions WHERE id = rec.id));

        elapsed_ms := EXTRACT(MILLISECONDS FROM clock_timestamp() - region_start)::INTEGER;

        IF new_val IS DISTINCT FROM rec.old_val THEN
            UPDATE regions SET is_archipelago = new_val WHERE id = rec.id;
            RAISE NOTICE '[%] [%/%] % (% pts) -> % in %ms  ** CHANGED from %',
                clock_timestamp()::time, processed, total_count, rec.name, rec.pts, new_val, elapsed_ms, rec.old_val;
        ELSE
            RAISE NOTICE '[%] [%/%] % (% pts) -> % in %ms',
                clock_timestamp()::time, processed, total_count, rec.name, rec.pts, new_val, elapsed_ms;
        END IF;
    END LOOP;

    RAISE NOTICE '[%] Update complete! Total time: %',
        clock_timestamp()::time, clock_timestamp() - start_time;
END $$;

-- Show how many were updated
DO $$
DECLARE
    arch_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO arch_count FROM regions WHERE is_archipelago = true;
    RAISE NOTICE 'Update complete. Total archipelagos: %', arch_count;
END $$;

-- Show final counts
SELECT
    COUNT(*) as total_with_geom,
    SUM(CASE WHEN is_archipelago THEN 1 ELSE 0 END) as archipelagos,
    SUM(CASE WHEN NOT is_archipelago THEN 1 ELSE 0 END) as non_archipelagos
FROM regions
WHERE geom IS NOT NULL;

-- Show all archipelagos
SELECT id, name, ST_NumGeometries(geom) as parts
FROM regions
WHERE is_archipelago = true
ORDER BY name;
