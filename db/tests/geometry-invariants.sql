-- Geometry Invariants Tests
-- Run these tests against the database to validate display geometry correctness

-- =============================================================================
-- Test 1: All display geometries should be valid
-- =============================================================================
DO $$
DECLARE
  invalid_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO invalid_count
  FROM regions
  WHERE display_geom IS NOT NULL
    AND NOT ST_IsValid(display_geom);

  IF invalid_count > 0 THEN
    RAISE EXCEPTION 'TEST FAILED: % regions have invalid display geometries', invalid_count;
  ELSE
    RAISE NOTICE 'TEST PASSED: All display geometries are valid';
  END IF;
END $$;

-- =============================================================================
-- Test 2: All anchor points should be valid points
-- =============================================================================
DO $$
DECLARE
  invalid_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO invalid_count
  FROM regions
  WHERE anchor_point IS NOT NULL
    AND (NOT ST_IsValid(anchor_point) OR ST_GeometryType(anchor_point) != 'ST_Point');

  IF invalid_count > 0 THEN
    RAISE EXCEPTION 'TEST FAILED: % regions have invalid anchor points', invalid_count;
  ELSE
    RAISE NOTICE 'TEST PASSED: All anchor points are valid points';
  END IF;
END $$;

-- =============================================================================
-- Test 3: Display geometry should not be empty
-- =============================================================================
DO $$
DECLARE
  empty_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO empty_count
  FROM regions
  WHERE display_geom IS NOT NULL
    AND ST_IsEmpty(display_geom);

  IF empty_count > 0 THEN
    RAISE EXCEPTION 'TEST FAILED: % regions have empty display geometries', empty_count;
  ELSE
    RAISE NOTICE 'TEST PASSED: No empty display geometries';
  END IF;
END $$;

-- =============================================================================
-- Test 4: Display geometry should be within reasonable bounds of real geometry
-- (centroid distance should be less than 10 degrees)
-- =============================================================================
DO $$
DECLARE
  outlier_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO outlier_count
  FROM regions
  WHERE geom IS NOT NULL
    AND display_geom IS NOT NULL
    AND ST_Distance(ST_Centroid(geom), ST_Centroid(display_geom)) > 10;

  IF outlier_count > 0 THEN
    RAISE WARNING 'WARNING: % regions have display geometry centroids far from real geometry (>10 degrees)', outlier_count;
  ELSE
    RAISE NOTICE 'TEST PASSED: All display geometry centroids are within 10 degrees of real geometry';
  END IF;
END $$;

-- =============================================================================
-- Test 5: Archipelago detection should flag regions with many sparse parts
-- =============================================================================
DO $$
DECLARE
  archipelago_count INTEGER;
  multi_part_not_flagged INTEGER;
BEGIN
  SELECT COUNT(*) INTO archipelago_count
  FROM regions
  WHERE is_archipelago = true;

  -- Check for regions with many parts (>10) that aren't flagged as archipelagos
  SELECT COUNT(*) INTO multi_part_not_flagged
  FROM regions
  WHERE geom IS NOT NULL
    AND ST_NumGeometries(geom) > 10
    AND is_archipelago = false;

  RAISE NOTICE 'INFO: % regions flagged as archipelagos', archipelago_count;

  IF multi_part_not_flagged > 0 THEN
    RAISE NOTICE 'INFO: % regions have >10 parts but not flagged as archipelagos (may be dense, not sparse)', multi_part_not_flagged;
  END IF;
END $$;

-- =============================================================================
-- Test 6: No sibling regions should have overlapping display geometries
-- (after Voronoi clipping is applied)
-- =============================================================================
DO $$
DECLARE
  overlap_count INTEGER;
  overlap_rec RECORD;
BEGIN
  SELECT COUNT(*) INTO overlap_count
  FROM regions r1
  JOIN regions r2 ON r1.world_view_id = r2.world_view_id
    AND COALESCE(r1.parent_region_id, 0) = COALESCE(r2.parent_region_id, 0)
    AND r1.id < r2.id
  WHERE r1.display_geom IS NOT NULL
    AND r2.display_geom IS NOT NULL
    AND ST_Intersects(r1.display_geom, r2.display_geom)
    AND NOT ST_Touches(r1.display_geom, r2.display_geom);

  IF overlap_count > 0 THEN
    RAISE WARNING 'WARNING: % sibling region pairs have overlapping display geometries. Run regenerate_display_geometries with Voronoi clipping.', overlap_count;

    -- Show first few overlaps
    FOR overlap_rec IN
      SELECT r1.id as id1, r1.name as name1, r2.id as id2, r2.name as name2
      FROM regions r1
      JOIN regions r2 ON r1.world_view_id = r2.world_view_id
        AND COALESCE(r1.parent_region_id, 0) = COALESCE(r2.parent_region_id, 0)
        AND r1.id < r2.id
      WHERE r1.display_geom IS NOT NULL
        AND r2.display_geom IS NOT NULL
        AND ST_Intersects(r1.display_geom, r2.display_geom)
        AND NOT ST_Touches(r1.display_geom, r2.display_geom)
      LIMIT 5
    LOOP
      RAISE NOTICE '  Overlap: % (id=%) <-> % (id=%)', overlap_rec.name1, overlap_rec.id1, overlap_rec.name2, overlap_rec.id2;
    END LOOP;
  ELSE
    RAISE NOTICE 'TEST PASSED: No sibling regions have overlapping display geometries';
  END IF;
END $$;

-- =============================================================================
-- Test 7: Vertex budget check - display geometries should be simplified
-- (less than 10000 vertices for most regions)
-- =============================================================================
DO $$
DECLARE
  large_vertex_count INTEGER;
  max_vertices INTEGER;
BEGIN
  SELECT COUNT(*), MAX(ST_NPoints(display_geom))
  INTO large_vertex_count, max_vertices
  FROM regions
  WHERE display_geom IS NOT NULL
    AND ST_NPoints(display_geom) > 10000;

  IF large_vertex_count > 0 THEN
    RAISE WARNING 'WARNING: % regions have display geometries with >10000 vertices (max: %)', large_vertex_count, max_vertices;
  ELSE
    RAISE NOTICE 'TEST PASSED: All display geometries have <=10000 vertices';
  END IF;
END $$;

-- =============================================================================
-- Test 8: Area sanity check - display geometry area should be >= real geometry area
-- (since we buffer archipelagos)
-- =============================================================================
DO $$
DECLARE
  smaller_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO smaller_count
  FROM regions
  WHERE geom IS NOT NULL
    AND display_geom IS NOT NULL
    AND ST_Area(display_geom::geography) < ST_Area(geom::geography) * 0.5;  -- Allow up to 50% smaller due to simplification

  IF smaller_count > 0 THEN
    RAISE WARNING 'WARNING: % regions have display geometries significantly smaller than real geometries', smaller_count;
  ELSE
    RAISE NOTICE 'TEST PASSED: Display geometry areas are reasonable';
  END IF;
END $$;

-- =============================================================================
-- Summary
-- =============================================================================
DO $$
DECLARE
  total_regions INTEGER;
  with_geom INTEGER;
  with_display INTEGER;
  with_anchor INTEGER;
  archipelagos INTEGER;
BEGIN
  SELECT
    COUNT(*),
    COUNT(CASE WHEN geom IS NOT NULL THEN 1 END),
    COUNT(CASE WHEN display_geom IS NOT NULL THEN 1 END),
    COUNT(CASE WHEN anchor_point IS NOT NULL THEN 1 END),
    COUNT(CASE WHEN is_archipelago = true THEN 1 END)
  INTO total_regions, with_geom, with_display, with_anchor, archipelagos
  FROM regions;

  RAISE NOTICE '';
  RAISE NOTICE '=== GEOMETRY INVARIANTS TEST SUMMARY ===';
  RAISE NOTICE 'Total regions: %', total_regions;
  RAISE NOTICE 'With geometry: %', with_geom;
  RAISE NOTICE 'With display geometry: %', with_display;
  RAISE NOTICE 'With anchor point: %', with_anchor;
  RAISE NOTICE 'Archipelagos detected: %', archipelagos;
  RAISE NOTICE '=========================================';
END $$;
