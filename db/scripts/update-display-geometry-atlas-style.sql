-- Atlas-style display geometry generation for archipelagos
-- Creates clean, readable, non-overlapping zones for island groups

-- Ensure notices are displayed
SET client_min_messages = NOTICE;

-- Print start header
DO $$ BEGIN
    RAISE NOTICE '============================================================';
    RAISE NOTICE 'Atlas-style display geometry generation for archipelagos';
    RAISE NOTICE 'Creates clean, readable, non-overlapping zones for island groups';
    RAISE NOTICE '============================================================';
END $$;

-- =============================================================================
-- STEP 1: Improved display geometry generation for archipelagos
-- =============================================================================

DO $$ BEGIN
    RAISE NOTICE '[%] ============================================', clock_timestamp()::time;
    RAISE NOTICE '[%] STEP 1: Creating/updating display geometry function', clock_timestamp()::time;
    RAISE NOTICE '[%] ============================================', clock_timestamp()::time;
END $$;

-- Function to generate atlas-style display geometry
-- For archipelagos: creates a clean hull + buffer that's readable at medium zoom
-- For regular regions: simplifies the geometry for performance
-- HANDLES: Antimeridian-crossing geometries (spans -180 to 180)
CREATE OR REPLACE FUNCTION generate_display_geometry(
    p_geom GEOMETRY,
    p_buffer_degrees DOUBLE PRECISION DEFAULT 0.5
)
RETURNS GEOMETRY AS $$
DECLARE
    result GEOMETRY;
    area_km2 DOUBLE PRECISION;
    num_parts INTEGER;
    bbox_area DOUBLE PRECISION;
    geom_area DOUBLE PRECISION;
    sparsity DOUBLE PRECISION;
    lng_span DOUBLE PRECISION;
    lat_span DOUBLE PRECISION;
    buffer_amount DOUBLE PRECISION;
    crosses_antimeridian BOOLEAN;
    min_lng DOUBLE PRECISION;
    max_lng DOUBLE PRECISION;
BEGIN
    IF p_geom IS NULL THEN
        RETURN NULL;
    END IF;

    -- Calculate metrics
    num_parts := ST_NumGeometries(p_geom);
    min_lng := ST_XMin(p_geom);
    max_lng := ST_XMax(p_geom);
    lng_span := max_lng - min_lng;
    lat_span := ST_YMax(p_geom) - ST_YMin(p_geom);

    -- Check if crosses antimeridian (geometry spans from near -180 to near +180)
    -- This indicates the geometry wraps around the antimeridian
    crosses_antimeridian := (min_lng < -170 AND max_lng > 170);

    -- For antimeridian-crossing geometries, don't try to create hull/buffer
    -- as PostGIS will create a polygon spanning the entire globe
    -- Instead, just simplify the original geometry
    IF crosses_antimeridian THEN
        -- Just simplify to reduce point count, but keep the original shape
        result := ST_SimplifyPreserveTopology(p_geom, 0.01);

        -- Ensure valid MultiPolygon output
        result := ST_MakeValid(result);
        IF result IS NULL OR ST_IsEmpty(result) THEN
            result := p_geom;
        END IF;

        IF ST_GeometryType(result) = 'ST_Polygon' THEN
            result := ST_Multi(result);
        ELSIF ST_GeometryType(result) NOT IN ('ST_MultiPolygon', 'ST_Polygon') THEN
            result := ST_Multi(ST_CollectionExtract(result, 3));
        END IF;

        RETURN result;
    END IF;

    -- Use planar area for speed (good enough for sparsity calculation)
    bbox_area := lng_span * lat_span;
    geom_area := GREATEST(ST_Area(p_geom), 0.0001);
    sparsity := bbox_area / geom_area;

    -- Approximate area in km2 (rough conversion at mid-latitudes)
    area_km2 := geom_area * 111 * 111 * COS(RADIANS((ST_YMax(p_geom) + ST_YMin(p_geom)) / 2));

    -- Determine buffer size based on region size
    -- Smaller regions need relatively larger buffers to be visible
    IF area_km2 < 100 THEN
        buffer_amount := 0.5;  -- ~55km buffer for tiny islands
    ELSIF area_km2 < 1000 THEN
        buffer_amount := 0.4;  -- ~44km buffer for small islands
    ELSIF area_km2 < 10000 THEN
        buffer_amount := 0.3;  -- ~33km buffer for medium areas
    ELSE
        buffer_amount := 0.2;  -- ~22km buffer for large areas
    END IF;

    -- ARCHIPELAGO DETECTION: Many parts, sparse distribution
    -- For archipelagos, create a concave hull with buffer for better island coverage
    IF num_parts >= 5 AND sparsity > 20 THEN
        -- Use concave hull with target_percent for tighter fit around islands
        -- Lower target_percent = tighter fit (0.7 = 70% of convex hull tightness)
        BEGIN
            result := ST_ConcaveHull(p_geom, 0.7);  -- Tighter concave hull
        EXCEPTION WHEN OTHERS THEN
            -- Fallback to convex hull if concave fails
            result := ST_ConvexHull(p_geom);
        END;

        -- Add buffer in meters for visibility
        result := ST_Buffer(result::geography, buffer_amount * 111000)::geometry;

        -- Simplify slightly for smooth edges, but keep reasonable detail
        result := ST_SimplifyPreserveTopology(result, 0.02);

    -- MODERATELY SPARSE: Few parts, some spreading
    ELSIF num_parts >= 3 AND sparsity > 5 THEN
        BEGIN
            result := ST_ConcaveHull(p_geom, 0.85);
        EXCEPTION WHEN OTHERS THEN
            result := ST_ConvexHull(p_geom);
        END;
        result := ST_Buffer(result::geography, buffer_amount * 80000)::geometry;
        result := ST_SimplifyPreserveTopology(result, 0.01);

    -- COMPACT GEOMETRY: Continental or solid regions
    ELSE
        -- Just simplify based on size
        result := ST_SimplifyPreserveTopology(p_geom,
            CASE
                WHEN area_km2 > 1000000 THEN 0.1   -- Continent-scale
                WHEN area_km2 > 100000 THEN 0.05  -- Large country
                WHEN area_km2 > 10000 THEN 0.02   -- Medium country
                WHEN area_km2 > 1000 THEN 0.01    -- Small country
                ELSE 0.005                         -- Region/state
            END
        );
    END IF;

    -- Ensure valid MultiPolygon output
    result := ST_MakeValid(result);
    IF result IS NULL OR ST_IsEmpty(result) THEN
        -- Fallback to original geometry if processing failed
        result := p_geom;
    END IF;

    IF ST_GeometryType(result) = 'ST_Polygon' THEN
        result := ST_Multi(result);
    ELSIF ST_GeometryType(result) NOT IN ('ST_MultiPolygon', 'ST_Polygon') THEN
        result := ST_Multi(ST_CollectionExtract(result, 3));
    END IF;

    RETURN result;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- =============================================================================
-- STEP 2: Regenerate display geometries for archipelagos (bottom-up)
-- Process deepest regions first, then parents
-- =============================================================================

DO $$
DECLARE
    rec RECORD;
    total_count INTEGER;
    processed INTEGER := 0;
    new_pts INTEGER;
    start_time TIMESTAMP;
    region_start TIMESTAMP;
    elapsed_ms INTEGER;
    eta_seconds INTEGER;
    eta_text TEXT;
BEGIN
    start_time := clock_timestamp();

    RAISE NOTICE '[%] ============================================', to_char(clock_timestamp(), 'HH24:MI:SS.MS');
    RAISE NOTICE '[%] STEP 2: Regenerating display geometries (bottom-up)', to_char(clock_timestamp(), 'HH24:MI:SS.MS');
    RAISE NOTICE '[%] ============================================', to_char(clock_timestamp(), 'HH24:MI:SS.MS');

    -- Count archipelago regions
    SELECT COUNT(*) INTO total_count
    FROM regions
    WHERE geom IS NOT NULL AND is_archipelago = true;

    RAISE NOTICE '[%] Found % archipelago regions to process', to_char(clock_timestamp(), 'HH24:MI:SS.MS'), total_count;

    -- Process archipelagos bottom-up (deepest first)
    FOR rec IN
        WITH RECURSIVE region_depth AS (
            SELECT id, 0 as depth FROM regions WHERE parent_region_id IS NULL
            UNION ALL
            SELECT r.id, rd.depth + 1 FROM regions r JOIN region_depth rd ON r.parent_region_id = rd.id
        )
        SELECT r.id, r.name, ST_NPoints(r.geom) as pts, ST_NumGeometries(r.geom) as parts,
               r.is_archipelago, COALESCE(p.name, 'ROOT') as parent_name, rd.depth
        FROM regions r
        JOIN region_depth rd ON r.id = rd.id
        LEFT JOIN regions p ON r.parent_region_id = p.id
        WHERE r.geom IS NOT NULL AND r.is_archipelago = true
        ORDER BY rd.depth DESC, ST_NPoints(r.geom) ASC  -- Deepest first, then smallest
    LOOP
        processed := processed + 1;
        region_start := clock_timestamp();

        -- Update display geometry
        UPDATE regions
        SET display_geom = generate_display_geometry(geom),
            anchor_point = generate_anchor_point(geom)
        WHERE id = rec.id;

        -- Get new point count
        SELECT ST_NPoints(display_geom) INTO new_pts FROM regions WHERE id = rec.id;

        elapsed_ms := EXTRACT(MILLISECONDS FROM clock_timestamp() - region_start)::INTEGER;

        -- Calculate ETA
        IF processed > 0 THEN
            eta_seconds := ((EXTRACT(EPOCH FROM clock_timestamp() - start_time) / processed) * (total_count - processed))::INTEGER;
            IF eta_seconds < 60 THEN
                eta_text := eta_seconds || 's';
            ELSE
                eta_text := (eta_seconds / 60) || 'm ' || (eta_seconds % 60) || 's';
            END IF;
        ELSE
            eta_text := '?';
        END IF;

        RAISE NOTICE '[%] [%/%] % (depth=%) | % -> % pts | % parts | parent="%" | %ms | ETA: %',
            to_char(clock_timestamp(), 'HH24:MI:SS.MS'),
            processed, total_count,
            rec.name, rec.depth, rec.pts, COALESCE(new_pts, 0), rec.parts,
            rec.parent_name, elapsed_ms, eta_text;
    END LOOP;

    RAISE NOTICE '[%] ============================================', to_char(clock_timestamp(), 'HH24:MI:SS.MS');
    RAISE NOTICE '[%] STEP 2 complete. Processed % regions in %',
        to_char(clock_timestamp(), 'HH24:MI:SS.MS'), processed, clock_timestamp() - start_time;
    RAISE NOTICE '[%] ============================================', to_char(clock_timestamp(), 'HH24:MI:SS.MS');
END $$;


-- =============================================================================
-- STEP 3: Apply Voronoi clipping to prevent overlaps
-- =============================================================================

-- Improved Voronoi clipping that handles edge cases better
-- Including antimeridian-crossing regions
CREATE OR REPLACE FUNCTION clip_display_geometries_voronoi(
    p_world_view_id INTEGER,
    p_parent_region_id INTEGER DEFAULT NULL
)
RETURNS INTEGER AS $$
DECLARE
    region_count INTEGER := 0;
    sibling_count INTEGER;
    min_lng DOUBLE PRECISION;
    max_lng DOUBLE PRECISION;
    crosses_antimeridian BOOLEAN;
    rec RECORD;
BEGIN
    -- Count siblings
    SELECT COUNT(*) INTO sibling_count
    FROM regions
    WHERE world_view_id = p_world_view_id
      AND COALESCE(parent_region_id, -1) = COALESCE(p_parent_region_id, -1)
      AND anchor_point IS NOT NULL
      AND display_geom IS NOT NULL;

    -- Need at least 2 siblings for Voronoi to make sense
    IF sibling_count < 2 THEN
        RETURN 0;
    END IF;

    -- Check if siblings cross antimeridian (some anchors > 90, some < -90)
    SELECT MIN(ST_X(anchor_point)), MAX(ST_X(anchor_point))
    INTO min_lng, max_lng
    FROM regions
    WHERE world_view_id = p_world_view_id
      AND COALESCE(parent_region_id, -1) = COALESCE(p_parent_region_id, -1)
      AND anchor_point IS NOT NULL;

    crosses_antimeridian := (max_lng > 90 AND min_lng < -90);

    -- For antimeridian-crossing regions, skip Voronoi clipping
    -- (it produces invalid results spanning the wrong way around the globe)
    -- Instead, just ensure display_geom stays close to the real geometry
    IF crosses_antimeridian THEN
        -- Process each region one at a time to avoid deadlocks
        FOR rec IN
            SELECT id
            FROM regions
            WHERE world_view_id = p_world_view_id
              AND COALESCE(parent_region_id, -1) = COALESCE(p_parent_region_id, -1)
              AND display_geom IS NOT NULL
              AND geom IS NOT NULL
            FOR UPDATE SKIP LOCKED
        LOOP
            BEGIN
                UPDATE regions r
                SET display_geom = ST_Multi(
                    ST_CollectionExtract(
                        ST_MakeValid(
                            ST_Intersection(
                                ST_MakeValid(r.display_geom),
                                ST_MakeValid(ST_Buffer(ST_MakeValid(r.geom)::geography, 500000)::geometry)
                            )
                        ),
                        3
                    )
                )
                WHERE r.id = rec.id;

                region_count := region_count + 1;
            EXCEPTION WHEN OTHERS THEN
                -- Skip this region if there's an error
                RAISE NOTICE 'Skipping region % due to error: %', rec.id, SQLERRM;
            END;
        END LOOP;

        RETURN region_count;
    END IF;

    -- Standard Voronoi clipping for non-antimeridian regions
    WITH sibling_regions AS (
        SELECT id, anchor_point, display_geom
        FROM regions
        WHERE world_view_id = p_world_view_id
          AND COALESCE(parent_region_id, -1) = COALESCE(p_parent_region_id, -1)
          AND anchor_point IS NOT NULL
          AND display_geom IS NOT NULL
    ),
    -- Calculate a bounding envelope that covers all display geometries with buffer
    envelope AS (
        SELECT ST_Expand(ST_Extent(display_geom), 20) as env
        FROM sibling_regions
    ),
    -- Create Voronoi polygons from anchor points
    voronoi_raw AS (
        SELECT ST_VoronoiPolygons(
            ST_Collect(anchor_point),
            0,  -- tolerance
            (SELECT env FROM envelope)
        ) AS geom
        FROM sibling_regions
    ),
    -- Dump individual cells
    voronoi_cells AS (
        SELECT (ST_Dump(geom)).geom AS cell
        FROM voronoi_raw
        WHERE geom IS NOT NULL
    ),
    -- Match each cell to its region by anchor point containment
    matched AS (
        SELECT DISTINCT ON (r.id)
            r.id,
            v.cell AS voronoi_cell
        FROM sibling_regions r
        CROSS JOIN voronoi_cells v
        WHERE ST_Contains(v.cell, r.anchor_point)
    )
    -- Clip each display geometry to its Voronoi cell
    UPDATE regions r
    SET display_geom = ST_Multi(
        ST_CollectionExtract(
            ST_MakeValid(ST_Intersection(r.display_geom, m.voronoi_cell)),
            3  -- Extract polygons only
        )
    )
    FROM matched m
    WHERE r.id = m.id
      AND r.display_geom IS NOT NULL
      AND m.voronoi_cell IS NOT NULL;

    GET DIAGNOSTICS region_count = ROW_COUNT;

    RETURN region_count;
END;
$$ LANGUAGE plpgsql;

-- Apply Voronoi clipping to each parent group with archipelago children
-- IMPORTANT: Clip ALL siblings (not just archipelagos) when any sibling is an archipelago
-- SKIP: Root level (continents) - they don't need clipping
DO $$
DECLARE
    rec RECORD;
    clipped INTEGER;
    total_clipped INTEGER := 0;
    start_time TIMESTAMP;
    group_start TIMESTAMP;
    elapsed_ms INTEGER;
    group_count INTEGER := 0;
BEGIN
    start_time := clock_timestamp();

    RAISE NOTICE '[%] ============================================', to_char(start_time, 'HH24:MI:SS.MS');
    RAISE NOTICE '[%] STEP 3: Applying Voronoi clipping', to_char(start_time, 'HH24:MI:SS.MS');
    RAISE NOTICE '[%] ============================================', to_char(start_time, 'HH24:MI:SS.MS');

    -- Find all parent regions that have at least one archipelago child
    -- We'll clip ALL children under that parent (not just archipelagos)
    -- SKIP root level (parent_region_id IS NULL) - continents don't need clipping
    FOR rec IN
        SELECT DISTINCT r.world_view_id, r.parent_region_id,
               (SELECT COUNT(*) FROM regions r2
                WHERE COALESCE(r2.parent_region_id, -1) = COALESCE(r.parent_region_id, -1)
                  AND r2.world_view_id = r.world_view_id
                  AND r2.display_geom IS NOT NULL) as child_count,
               (SELECT COUNT(*) FROM regions r2
                WHERE COALESCE(r2.parent_region_id, -1) = COALESCE(r.parent_region_id, -1)
                  AND r2.world_view_id = r.world_view_id
                  AND r2.is_archipelago = true) as archipelago_count,
               COALESCE(p.name, 'ROOT') as parent_name,
               (SELECT string_agg(r2.name, ', ' ORDER BY r2.name)
                FROM regions r2
                WHERE COALESCE(r2.parent_region_id, -1) = COALESCE(r.parent_region_id, -1)
                  AND r2.world_view_id = r.world_view_id
                  AND r2.display_geom IS NOT NULL
                LIMIT 10) as child_names
        FROM regions r
        LEFT JOIN regions p ON r.parent_region_id = p.id
        WHERE r.is_archipelago = true
          AND r.display_geom IS NOT NULL
          AND r.parent_region_id IS NOT NULL  -- SKIP root level
        GROUP BY r.world_view_id, r.parent_region_id, p.name
    LOOP
        IF rec.child_count >= 2 THEN
            group_count := group_count + 1;
            group_start := clock_timestamp();

            RAISE NOTICE '[%] Group %: "%" - % children (% archipelagos)',
                to_char(clock_timestamp(), 'HH24:MI:SS.MS'), group_count, rec.parent_name,
                rec.child_count, rec.archipelago_count;
            RAISE NOTICE '[%]   Children: %', to_char(clock_timestamp(), 'HH24:MI:SS.MS'), rec.child_names;

            clipped := clip_display_geometries_voronoi(rec.world_view_id, rec.parent_region_id);
            total_clipped := total_clipped + clipped;

            elapsed_ms := EXTRACT(MILLISECONDS FROM clock_timestamp() - group_start)::INTEGER;
            RAISE NOTICE '[%]   -> Clipped % regions in %ms', to_char(clock_timestamp(), 'HH24:MI:SS.MS'), clipped, elapsed_ms;

            PERFORM pg_sleep(0);
        END IF;
    END LOOP;

    RAISE NOTICE '[%] ============================================', to_char(clock_timestamp(), 'HH24:MI:SS.MS');
    RAISE NOTICE '[%] STEP 3 complete. Processed % groups, clipped % regions in %',
        to_char(clock_timestamp(), 'HH24:MI:SS.MS'), group_count, total_clipped, clock_timestamp() - start_time;
    RAISE NOTICE '[%] ============================================', to_char(clock_timestamp(), 'HH24:MI:SS.MS');
END $$;

-- =============================================================================
-- STEP 4: Verify results
-- =============================================================================

DO $$ BEGIN
    RAISE NOTICE '[%] ============================================', clock_timestamp()::time;
    RAISE NOTICE '[%] STEP 4: Verifying results - checking for overlaps', clock_timestamp()::time;
    RAISE NOTICE '[%] ============================================', clock_timestamp()::time;
END $$;

-- Check for any overlapping display geometries among siblings (all siblings, not just archipelagos)
SELECT 'Overlap check' as check_type,
       r1.name as region1, r2.name as region2,
       r1.is_archipelago as arch1, r2.is_archipelago as arch2,
       ROUND(ST_Area(ST_Intersection(r1.display_geom, r2.display_geom)::geography)::numeric / 1000000, 2) as overlap_km2
FROM regions r1
JOIN regions r2 ON r1.id < r2.id
  AND COALESCE(r1.parent_region_id, -1) = COALESCE(r2.parent_region_id, -1)
  AND r1.world_view_id = r2.world_view_id
WHERE r1.display_geom IS NOT NULL
  AND r2.display_geom IS NOT NULL
  AND ST_Intersects(r1.display_geom, r2.display_geom)
  AND NOT ST_Touches(r1.display_geom, r2.display_geom)
  -- Only show significant overlaps (> 100 km²)
  AND ST_Area(ST_Intersection(r1.display_geom, r2.display_geom)::geography) > 100000000
ORDER BY overlap_km2 DESC
LIMIT 20;

-- Show summary of display geometry sizes
SELECT
    name,
    is_archipelago,
    ST_NPoints(geom) as geom_pts,
    ST_NPoints(display_geom) as display_pts,
    ROUND((ST_Area(geom::geography) / 1000000)::numeric, 0) as geom_area_km2,
    ROUND((ST_Area(display_geom::geography) / 1000000)::numeric, 0) as display_area_km2
FROM regions
WHERE is_archipelago = true
ORDER BY name
LIMIT 30;
