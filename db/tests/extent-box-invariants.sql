-- Integration tests for extent box geometry
-- Run with: psql -f extent-box-invariants.sql

-- =============================================================================
-- Test 1: All extent boxes are valid polygons
-- =============================================================================
DO $$
DECLARE
    invalid_count INTEGER;
    invalid_names TEXT;
BEGIN
    SELECT COUNT(*), STRING_AGG(name, ', ')
    INTO invalid_count, invalid_names
    FROM regions
    WHERE extent_box_geom IS NOT NULL
      AND NOT ST_IsValid(extent_box_geom);

    IF invalid_count > 0 THEN
        RAISE EXCEPTION 'FAIL: % extent boxes are invalid: %', invalid_count, invalid_names;
    END IF;
    RAISE NOTICE 'PASS: All extent boxes are valid polygons';
END $$;

-- =============================================================================
-- Test 2: All extent boxes are rectangles (5 vertices for closed polygon)
-- =============================================================================
DO $$
DECLARE
    non_rect_count INTEGER;
    sample_region TEXT;
    sample_npoints INTEGER;
BEGIN
    SELECT COUNT(*), MIN(name), MIN(ST_NPoints(extent_box_geom))
    INTO non_rect_count, sample_region, sample_npoints
    FROM regions
    WHERE extent_box_geom IS NOT NULL
      AND ST_NPoints(extent_box_geom) != 5;

    IF non_rect_count > 0 THEN
        RAISE WARNING 'WARNING: % extent boxes are not rectangles (sample: % with % points)',
            non_rect_count, sample_region, sample_npoints;
    ELSE
        RAISE NOTICE 'PASS: All extent boxes are rectangles (5 vertices)';
    END IF;
END $$;

-- =============================================================================
-- Test 3: All extent boxes contain their anchor points
-- =============================================================================
DO $$
DECLARE
    outside_count INTEGER;
    outside_names TEXT;
BEGIN
    SELECT COUNT(*), STRING_AGG(name, ', ')
    INTO outside_count, outside_names
    FROM regions
    WHERE extent_box_geom IS NOT NULL
      AND anchor_point IS NOT NULL
      AND NOT ST_Contains(extent_box_geom, anchor_point);

    IF outside_count > 0 THEN
        -- This might be expected if boxes were pushed during overlap resolution
        RAISE WARNING 'WARNING: % extent boxes do not contain their anchor points: %',
            outside_count, SUBSTRING(outside_names, 1, 200);
    ELSE
        RAISE NOTICE 'PASS: All extent boxes contain their anchor points';
    END IF;
END $$;

-- =============================================================================
-- Test 4: No sibling extent boxes overlap (within same parent)
-- =============================================================================
DO $$
DECLARE
    overlap_count INTEGER;
    overlap_details TEXT;
BEGIN
    WITH overlapping_pairs AS (
        SELECT
            r1.id as id1,
            r1.name as name1,
            r2.id as id2,
            r2.name as name2,
            r1.world_view_id,
            COALESCE(r1.parent_region_id, 0) as parent_id
        FROM regions r1
        JOIN regions r2
            ON r1.world_view_id = r2.world_view_id
            AND COALESCE(r1.parent_region_id, 0) = COALESCE(r2.parent_region_id, 0)
            AND r1.id < r2.id
        WHERE r1.extent_box_geom IS NOT NULL
          AND r2.extent_box_geom IS NOT NULL
          AND ST_Intersects(r1.extent_box_geom, r2.extent_box_geom)
          AND NOT ST_Touches(r1.extent_box_geom, r2.extent_box_geom)
    )
    SELECT COUNT(*), STRING_AGG(name1 || ' <-> ' || name2, '; ')
    INTO overlap_count, overlap_details
    FROM overlapping_pairs;

    IF overlap_count > 0 THEN
        RAISE WARNING 'WARNING: % sibling pairs have overlapping extent boxes: %',
            overlap_count, SUBSTRING(overlap_details, 1, 500);
    ELSE
        RAISE NOTICE 'PASS: No sibling extent boxes overlap';
    END IF;
END $$;

-- =============================================================================
-- Test 5: No extent box spans more than 180 degrees longitude (dateline check)
-- =============================================================================
DO $$
DECLARE
    globe_spanning_count INTEGER;
    globe_spanning_names TEXT;
BEGIN
    SELECT COUNT(*), STRING_AGG(name || ' (' || ROUND((ST_XMax(extent_box_geom) - ST_XMin(extent_box_geom))::numeric, 1) || ' deg)', ', ')
    INTO globe_spanning_count, globe_spanning_names
    FROM regions
    WHERE extent_box_geom IS NOT NULL
      AND (ST_XMax(extent_box_geom) - ST_XMin(extent_box_geom)) > 180;

    IF globe_spanning_count > 0 THEN
        RAISE EXCEPTION 'FAIL: % extent boxes span > 180 degrees (dateline error): %',
            globe_spanning_count, SUBSTRING(globe_spanning_names, 1, 500);
    END IF;
    RAISE NOTICE 'PASS: No extent boxes span > 180 degrees longitude';
END $$;

-- =============================================================================
-- Test 6: Extent boxes are reasonably sized (not tiny, not huge)
-- =============================================================================
DO $$
DECLARE
    tiny_count INTEGER;
    huge_count INTEGER;
    tiny_names TEXT;
    huge_names TEXT;
BEGIN
    -- Tiny boxes (< 10 km on any side) might indicate generation errors
    SELECT COUNT(*), STRING_AGG(name, ', ')
    INTO tiny_count, tiny_names
    FROM regions r,
    LATERAL (
        SELECT
            (ST_XMax(r.extent_box_geom) - ST_XMin(r.extent_box_geom)) * 111 * COS(RADIANS((ST_YMax(r.extent_box_geom) + ST_YMin(r.extent_box_geom))/2)) as width_km,
            (ST_YMax(r.extent_box_geom) - ST_YMin(r.extent_box_geom)) * 111 as height_km
    ) dims
    WHERE r.extent_box_geom IS NOT NULL
      AND (dims.width_km < 10 OR dims.height_km < 10);

    -- Huge boxes (> 5000 km on any side) might indicate dateline errors
    SELECT COUNT(*), STRING_AGG(name, ', ')
    INTO huge_count, huge_names
    FROM regions r,
    LATERAL (
        SELECT
            (ST_XMax(r.extent_box_geom) - ST_XMin(r.extent_box_geom)) * 111 * COS(RADIANS((ST_YMax(r.extent_box_geom) + ST_YMin(r.extent_box_geom))/2)) as width_km,
            (ST_YMax(r.extent_box_geom) - ST_YMin(r.extent_box_geom)) * 111 as height_km
    ) dims
    WHERE r.extent_box_geom IS NOT NULL
      AND (dims.width_km > 5000 OR dims.height_km > 5000);

    IF tiny_count > 0 THEN
        RAISE WARNING 'WARNING: % extent boxes are very small (< 10 km): %',
            tiny_count, SUBSTRING(tiny_names, 1, 200);
    END IF;

    IF huge_count > 0 THEN
        RAISE WARNING 'WARNING: % extent boxes are very large (> 5000 km): %',
            huge_count, SUBSTRING(huge_names, 1, 200);
    END IF;

    IF tiny_count = 0 AND huge_count = 0 THEN
        RAISE NOTICE 'PASS: All extent boxes are reasonably sized (10-5000 km)';
    END IF;
END $$;

-- =============================================================================
-- Summary statistics
-- =============================================================================
DO $$
DECLARE
    total_regions INTEGER;
    archipelago_count INTEGER;
    with_extent_box INTEGER;
    avg_width_km DOUBLE PRECISION;
    avg_height_km DOUBLE PRECISION;
BEGIN
    SELECT COUNT(*) INTO total_regions FROM regions;

    SELECT COUNT(*) INTO archipelago_count
    FROM regions WHERE is_archipelago = true;

    SELECT COUNT(*) INTO with_extent_box
    FROM regions WHERE extent_box_geom IS NOT NULL;

    SELECT
        AVG((ST_XMax(extent_box_geom) - ST_XMin(extent_box_geom)) * 111 * COS(RADIANS((ST_YMax(extent_box_geom) + ST_YMin(extent_box_geom))/2))),
        AVG((ST_YMax(extent_box_geom) - ST_YMin(extent_box_geom)) * 111)
    INTO avg_width_km, avg_height_km
    FROM regions
    WHERE extent_box_geom IS NOT NULL;

    RAISE NOTICE '';
    RAISE NOTICE '=== Extent Box Statistics ===';
    RAISE NOTICE 'Total regions: %', total_regions;
    RAISE NOTICE 'Archipelago regions: %', archipelago_count;
    RAISE NOTICE 'Regions with extent boxes: %', with_extent_box;
    IF avg_width_km IS NOT NULL THEN
        RAISE NOTICE 'Average box size: % x % km', ROUND(avg_width_km::numeric, 0), ROUND(avg_height_km::numeric, 0);
    END IF;
END $$;

-- =============================================================================
-- List all extent boxes with their dimensions
-- =============================================================================
SELECT
    r.id,
    r.name,
    r.world_view_id,
    COALESCE(p.name, '(root)') as parent_name,
    ROUND(((ST_XMax(r.extent_box_geom) - ST_XMin(r.extent_box_geom)) * 111 *
           COS(RADIANS((ST_YMax(r.extent_box_geom) + ST_YMin(r.extent_box_geom))/2)))::numeric, 0) as width_km,
    ROUND(((ST_YMax(r.extent_box_geom) - ST_YMin(r.extent_box_geom)) * 111)::numeric, 0) as height_km,
    r.extent_box_params->>'algo_version' as algo_version
FROM regions r
LEFT JOIN regions p ON r.parent_region_id = p.id
WHERE r.extent_box_geom IS NOT NULL
ORDER BY r.world_view_id, r.parent_region_id NULLS FIRST, r.name;
