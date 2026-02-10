-- =============================================================================
-- Compute Parent Geometries for All GADM Levels
-- =============================================================================
-- After loading GADM data, only leaf divisions have geometry.
-- This script computes geometry for parent divisions by unioning their children.
-- Works bottom-up: districts → states → countries → continents
--
-- The trigger on administrative_divisions automatically computes:
--   - geom_simplified_low (0.1° tolerance for world view)
--   - geom_simplified_medium (0.01° tolerance for country view)
-- =============================================================================

DO $$
DECLARE
    updated_count INTEGER;
    total_updated INTEGER := 0;
    iteration INTEGER := 0;
    max_iterations INTEGER := 10;  -- Safety limit (GADM has ~6 levels max)
BEGIN
    RAISE NOTICE 'Computing parent geometries for all GADM levels...';
    RAISE NOTICE 'This may take several minutes for large datasets.';

    -- Iterate until no more parents need geometry
    LOOP
        iteration := iteration + 1;

        IF iteration > max_iterations THEN
            RAISE NOTICE 'Reached maximum iterations (%), stopping.', max_iterations;
            EXIT;
        END IF;

        RAISE NOTICE 'Pass %: Finding parents with children that have geometry...', iteration;

        -- Update parents whose children ALL have geometry
        -- This ensures we work bottom-up
        WITH parents_to_update AS (
            SELECT
                parent.id,
                ST_Multi(ST_Union(child.geom)) AS merged_geom
            FROM administrative_divisions parent
            JOIN administrative_divisions child ON child.parent_id = parent.id
            WHERE parent.geom IS NULL                    -- Parent has no geometry yet
              AND parent.has_children = true             -- Is a parent
              AND child.geom IS NOT NULL                 -- Children have geometry
            GROUP BY parent.id
            -- Only include if ALL children have geometry
            HAVING COUNT(*) = COUNT(child.geom)
        )
        UPDATE administrative_divisions ad
        SET geom = pu.merged_geom
        FROM parents_to_update pu
        WHERE ad.id = pu.id;

        GET DIAGNOSTICS updated_count = ROW_COUNT;
        total_updated := total_updated + updated_count;

        RAISE NOTICE 'Pass %: Updated % parent divisions', iteration, updated_count;

        -- Exit if no more updates
        IF updated_count = 0 THEN
            EXIT;
        END IF;
    END LOOP;

    RAISE NOTICE '';
    RAISE NOTICE 'Completed! Total parent divisions updated: %', total_updated;

    -- Show statistics
    RAISE NOTICE '';
    RAISE NOTICE 'Geometry coverage:';
END $$;

-- Show final statistics
SELECT
    CASE
        WHEN parent_id IS NULL THEN 'Root (continents)'
        WHEN NOT has_children THEN 'Leaf (lowest level)'
        ELSE 'Intermediate'
    END AS level_type,
    COUNT(*) AS total,
    COUNT(geom) AS with_geometry,
    ROUND(100.0 * COUNT(geom) / COUNT(*), 1) AS coverage_pct
FROM administrative_divisions
GROUP BY
    CASE
        WHEN parent_id IS NULL THEN 'Root (continents)'
        WHEN NOT has_children THEN 'Leaf (lowest level)'
        ELSE 'Intermediate'
    END
ORDER BY coverage_pct DESC;
