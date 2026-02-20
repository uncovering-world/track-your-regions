/**
 * Geometry compute operations for single regions — computation orchestration
 *
 * Contains computeSingleRegionGeometry (HTTP handler) and computeRegionGeometryCore (callable).
 * These share a similar 5-step algorithm but differ in connection management (client vs pool),
 * error handling, logging, and option flags. Kept separate intentionally.
 */

import { Request, Response } from 'express';
import { pool } from '../../db/index.js';
import { generateSingleHull } from '../../services/hull/index.js';

/**
 * Compute geometry for a single region (merge members and child regions)
 * Recursively computes child regions first (bottom-up) if they don't have geometry
 * Skips regions with custom boundaries
 */
export async function computeSingleRegionGeometry(req: Request, res: Response): Promise<void> {
  // Support both new (regionId) and legacy (groupId) param names
  const regionId = parseInt(String(req.params.regionId || req.params.groupId));
  // Force recalculation of all geometries (extent box, hull) even if they already exist
  const force = req.query.force === 'true';

  console.log(`[ComputeSingle] Computing region ${regionId}, force=${force}`);

  // Check if region exists and get its current state
  const regionCheck = await pool.query(
    'SELECT is_custom_boundary, name, uses_hull as "usesHull", geom IS NOT NULL as has_geom FROM regions WHERE id = $1',
    [regionId]
  );

  if (regionCheck.rows.length === 0) {
    res.status(404).json({ error: 'Region not found' });
    return;
  }

  // If region has custom boundary, check if any members have custom_geom
  // If no members have custom_geom, we should keep the existing geometry
  // UNLESS force=true (manual recalculate), in which case clear custom boundary and recompute
  if (regionCheck.rows[0].is_custom_boundary) {
    if (force) {
      // Force mode: clear custom boundary flag and recompute from members
      console.log(`[ComputeSingle] Region ${regionId} has custom boundary but force=true - clearing and recomputing`);
      await pool.query(
        'UPDATE regions SET is_custom_boundary = false WHERE id = $1',
        [regionId]
      );
    } else {
      const membersWithCustomGeom = await pool.query(
        'SELECT COUNT(*) as count FROM region_members WHERE region_id = $1 AND custom_geom IS NOT NULL',
        [regionId]
      );

      if (parseInt(membersWithCustomGeom.rows[0].count) === 0) {
        // No members have custom geometry - the custom boundary is in regions.geom
        // Keep it as is and just return success
        console.log(`[ComputeSingle] Region ${regionId} has custom boundary with no custom member geometries - keeping existing geometry`);
        res.json({
          computed: true,
          regionId,
          name: regionCheck.rows[0].name,
          usesHull: regionCheck.rows[0].usesHull ?? false,
          message: 'Region has custom boundary - geometry preserved',
        });
        return;
      }

      // Members have custom_geom, so we can recompute from them
      console.log(`[ComputeSingle] Region ${regionId} has custom boundary with ${membersWithCustomGeom.rows[0].count} custom member geometries - will recompute`);
      await pool.query(
        'UPDATE regions SET is_custom_boundary = false WHERE id = $1',
        [regionId]
      );
    }
  }

  // Query timeout for large geometry operations (5 minutes)
  const GEOMETRY_QUERY_TIMEOUT_MS = 300000;

  // Use a dedicated client so SET statement_timeout applies to our queries
  // (pool.query() checks out a random connection each time)
  const computeClient = await pool.connect();

  // Helper function to compute a single group's geometry
  // Uses a step-by-step approach with progress logging
  const computeGroupGeom = async (gId: number): Promise<{ computed: boolean; points?: number; error?: string }> => {
    const startTime = Date.now();

    // First check complexity
    const complexityCheck = await computeClient.query(`
      SELECT
        COALESCE(SUM(ST_NPoints(COALESCE(rm.custom_geom, ad.geom))), 0) as member_points,
        COALESCE((SELECT SUM(ST_NPoints(geom)) FROM regions WHERE parent_region_id = $1 AND geom IS NOT NULL), 0) as child_points,
        (SELECT COUNT(*) FROM regions WHERE parent_region_id = $1 AND geom IS NOT NULL) as child_count,
        (SELECT COUNT(*) FROM region_members WHERE region_id = $1) as member_count
      FROM region_members rm
      LEFT JOIN administrative_divisions ad ON rm.division_id = ad.id
      WHERE rm.region_id = $1
    `, [gId]);

    const memberPoints = parseInt(complexityCheck.rows[0]?.member_points || '0');
    const childPoints = parseInt(complexityCheck.rows[0]?.child_points || '0');
    const childCount = parseInt(complexityCheck.rows[0]?.child_count || '0');
    const memberCount = parseInt(complexityCheck.rows[0]?.member_count || '0');
    const totalPoints = memberPoints + childPoints;

    console.log(`[ComputeSingle] Region ${gId}: ${memberPoints} member pts (${memberCount} members) + ${childPoints} child pts (${childCount} children) = ${totalPoints} total`);

    // For very large regions (>300k points), simplify before merging
    const shouldSimplify = totalPoints > 300000;
    if (shouldSimplify) {
      console.log(`[ComputeSingle] Region ${gId}: Will simplify geometries before merging`);
    }

    const logStep = (step: string) => {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(`[ComputeSingle] Region ${gId}: ${step} (${elapsed}s)`);
    };

    try {
      // Set statement timeout for this query
      await computeClient.query(`SET statement_timeout = '${GEOMETRY_QUERY_TIMEOUT_MS}'`);

      // Step 1: Collect all geometries
      logStep('Step 1/5: Collecting geometries...');
      const collectResult = await computeClient.query(`
        WITH direct_member_geoms AS (
          SELECT
            CASE WHEN $2 THEN
              ST_SimplifyPreserveTopology(ST_MakeValid(COALESCE(rm.custom_geom, ad.geom)), 0.005)
            ELSE
              ST_MakeValid(COALESCE(rm.custom_geom, ad.geom))
            END as geom
          FROM region_members rm
          JOIN administrative_divisions ad ON rm.division_id = ad.id
          WHERE rm.region_id = $1 AND (rm.custom_geom IS NOT NULL OR ad.geom IS NOT NULL)
        ),
        child_group_geoms AS (
          SELECT
            CASE WHEN $2 THEN
              ST_SimplifyPreserveTopology(ST_MakeValid(geom), 0.005)
            ELSE
              ST_MakeValid(geom)
            END as geom
          FROM regions
          WHERE parent_region_id = $1 AND geom IS NOT NULL
        )
        SELECT ST_Collect(geom) as collected_geom, COUNT(*) as geom_count
        FROM (
          SELECT geom FROM direct_member_geoms WHERE geom IS NOT NULL
          UNION ALL
          SELECT geom FROM child_group_geoms WHERE geom IS NOT NULL
        ) all_geoms
      `, [gId, shouldSimplify]);

      let collectedGeom = collectResult.rows[0]?.collected_geom;
      const geomCount = parseInt(collectResult.rows[0]?.geom_count || '0');

      if (!collectedGeom) {
        logStep('No geometries to merge');
        await computeClient.query('RESET statement_timeout');
        return { computed: false, error: 'No geometries to merge' };
      }
      logStep(`Step 1/6: Collected ${geomCount} geometries`);

      // Step 2: Analyze gaps and snap to grid
      // First, let's see how many separate polygons and holes we have before processing
      logStep('Step 2/6: Analyzing input geometry...');
      const analyzeResult = await computeClient.query(`
        WITH dumped AS (
          SELECT (ST_Dump($1::geometry)).geom as geom
        ),
        stats AS (
          SELECT
            COUNT(*) as num_geoms,
            SUM(ST_NRings(geom)) as total_rings,
            SUM(ST_NRings(geom) - 1) as total_holes,
            SUM(ST_NPoints(geom)) as total_points
          FROM dumped
          WHERE GeometryType(geom) IN ('POLYGON', 'MULTIPOLYGON')
        )
        SELECT * FROM stats
      `, [collectedGeom]);
      const inputGeoms = parseInt(analyzeResult.rows[0]?.num_geoms || '0');
      const inputHoles = parseInt(analyzeResult.rows[0]?.total_holes || '0');
      const inputPoints = parseInt(analyzeResult.rows[0]?.total_points || '0');
      logStep(`Step 2/6: Input has ${inputGeoms} polygons, ${inputHoles} holes, ${inputPoints} pts`);

      // Step 3: Snap each child region to its neighbors
      // The problem: borders like a---b vs a---c---b have mismatched vertices.
      // Solution: ST_Snap adds vertices from neighbors to each region's boundary
      const hasChildRegions = childCount > 0;

      if (hasChildRegions) {
        logStep(`Step 3/6: Snapping ${childCount} child regions to their neighbors...`);

        // Process each child region: snap it to all its neighbors
        const snapResult = await computeClient.query(`
          WITH child_regions AS (
            SELECT id, name, ST_MakeValid(geom) as geom
            FROM regions
            WHERE parent_region_id = $1 AND geom IS NOT NULL
          ),
          with_neighbors AS (
            SELECT
              a.id,
              a.name,
              a.geom,
              ST_Collect(b.geom) as neighbor_geom,
              COUNT(b.id) as neighbor_count
            FROM child_regions a
            LEFT JOIN child_regions b ON a.id != b.id
              AND (ST_Touches(a.geom, b.geom) OR ST_DWithin(a.geom, b.geom, 0.0001))
            GROUP BY a.id, a.name, a.geom
          ),
          snapped AS (
            SELECT
              w.id,
              w.name,
              w.neighbor_count,
              ST_NPoints(w.geom) as original_points,
              CASE
                WHEN w.neighbor_count > 0 AND w.neighbor_geom IS NOT NULL THEN
                  ST_MakeValid(ST_Snap(w.geom, w.neighbor_geom, 0.001))
                ELSE
                  w.geom
              END as geom
            FROM with_neighbors w
          ),
          with_new_points AS (
            SELECT *, ST_NPoints(geom) as new_points FROM snapped
          ),
          -- Also collect the snapped geometries in the same query
          collected AS (
            SELECT ST_Collect(geom) as geom FROM with_new_points WHERE geom IS NOT NULL
          ),
          totals AS (
            SELECT SUM(new_points) as total_points FROM with_new_points
          )
          SELECT
            id, name, neighbor_count, original_points, new_points,
            new_points - original_points as added_points,
            (SELECT geom FROM collected) as collected_geom,
            (SELECT total_points FROM totals) as total_snapped_points
          FROM with_new_points
          ORDER BY name
        `, [gId]);

        // Log each region's snap result and get the collected geometry from first row
        let totalAdded = 0;
        let snappedGeom = null;
        let snappedPoints = 0;

        console.log(`[Snap] Snapping ${snapResult.rows.length} regions to neighbors:`);
        for (const row of snapResult.rows) {
          // Get collected geom from first row
          if (snappedGeom === null) {
            snappedGeom = row.collected_geom;
            snappedPoints = parseInt(row.total_snapped_points || '0');
          }

          const neighbors = parseInt(row.neighbor_count);
          const added = parseInt(row.added_points);
          totalAdded += added;
          if (neighbors > 0) {
            console.log(`[Snap]   ${row.name}: ${row.original_points} -> ${row.new_points} pts (+${added}), ${neighbors} neighbors`);
          } else {
            console.log(`[Snap]   ${row.name}: ${row.original_points} pts, isolated`);
          }
        }

        logStep(`Step 3/6: Snapped ${totalPoints} -> ${snappedPoints} pts (+${totalAdded} added)`);

        // Use snapped geometry for union
        collectedGeom = snappedGeom || collectedGeom;
      } else {
        logStep('Step 3/6: No child regions to snap (using direct members)');
      }

      // Step 4: Union the geometries (now with aligned boundaries)
      logStep('Step 4/6: Unioning geometries...');
      const unionResult = await computeClient.query(`
        SELECT ST_UnaryUnion($1::geometry) as union_geom
      `, [collectedGeom]);
      const unionGeom = unionResult.rows[0]?.union_geom;
      logStep('Step 4/6: Union complete');

      // Step 5: Clean up - fill small holes, simplify
      logStep('Step 5/6: Cleaning, removing small holes & slivers, simplifying...');
      const cleanedResult = await computeClient.query(`
        WITH extracted AS (
          SELECT ST_Multi(ST_CollectionExtract(ST_MakeValid($1::geometry), 3)) as geom
        ),
        -- Dump to individual polygons
        polygons AS (
          SELECT (ST_Dump(geom)).geom as poly FROM extracted
        ),
        -- For each polygon, remove holes smaller than 1 km²
        holes_filtered AS (
          SELECT
            CASE
              WHEN ST_NumInteriorRings(poly) = 0 THEN poly
              ELSE (
                SELECT ST_MakePolygon(
                    ST_ExteriorRing(poly),
                    ARRAY(
                      SELECT ST_InteriorRingN(poly, n)
                      FROM generate_series(1, ST_NumInteriorRings(poly)) n
                      WHERE
                        -- Keep holes larger than 10 km²
                        ST_Area(ST_MakePolygon(ST_InteriorRingN(poly, n))::geography) > 10000000
                        -- AND not a sliver (thinness ratio = perimeter / sqrt(area) < 25)
                        AND (
                          ST_Perimeter(ST_MakePolygon(ST_InteriorRingN(poly, n))::geography) /
                          NULLIF(SQRT(ST_Area(ST_MakePolygon(ST_InteriorRingN(poly, n))::geography)), 0)
                        ) < 25
                    )
                  )
                )
              END as poly
            FROM polygons
          ),
        -- Collect back
        collected AS (
          SELECT ST_Multi(ST_Collect(poly)) as geom FROM holes_filtered WHERE poly IS NOT NULL
        ),
        -- Count holes before filtering (use the already-dumped polygons)
        before_stats AS (
          SELECT SUM(ST_NumInteriorRings(poly)) as num_holes FROM polygons
        ),
        -- Simplify
        simplified AS (
          SELECT ST_SimplifyPreserveTopology(geom, 0.0001) as geom FROM collected
        ),
        final_stats AS (
          SELECT
            ST_NumGeometries(geom) as num_polygons,
            ST_NRings(geom) as num_rings,
            ST_NPoints(geom) as num_points
          FROM simplified
        )
        SELECT
          (SELECT geom FROM simplified) as cleaned_geom,
          (SELECT num_holes FROM before_stats) as holes_before,
          (SELECT num_polygons FROM final_stats) as num_polygons,
          (SELECT num_rings FROM final_stats) as num_rings,
          (SELECT num_points FROM final_stats) as num_points
      `, [unionGeom]);

      const cleanedGeom = cleanedResult.rows[0]?.cleaned_geom;
      const holesBefore = parseInt(cleanedResult.rows[0]?.holes_before || '0');
      const numPolygons = parseInt(cleanedResult.rows[0]?.num_polygons || '0');
      const numRings = parseInt(cleanedResult.rows[0]?.num_rings || '0');
      const numPoints = parseInt(cleanedResult.rows[0]?.num_points || '0');
      const numHoles = numRings - numPolygons;
      const holesRemoved = holesBefore - numHoles;
      logStep(`Step 5/6: Complete (${holesBefore} holes -> ${numHoles}, removed ${holesRemoved}), ${numPolygons} polygons, ${numPoints} pts`);

      // Step 6: Update the region
      logStep('Step 6/6: Updating region...');
      const updateResult = await computeClient.query(`
        UPDATE regions
        SET geom = validate_multipolygon($2)
        WHERE id = $1
        RETURNING ST_NPoints(geom) as points
      `, [gId, cleanedGeom]);

      const points = updateResult.rows[0]?.points;
      logStep(`Step 6/6: Complete! ${points} points`);

      // Reset statement timeout
      await computeClient.query('RESET statement_timeout');

      return {
        computed: updateResult.rows.length > 0,
        points,
      };
    } catch (err) {
      // Reset statement timeout even on error
      try {
        await computeClient.query('RESET statement_timeout');
      } catch {
        // Ignore reset errors
      }

      const errorMessage = err instanceof Error ? err.message : String(err);

      // Check if it was a timeout
      if (errorMessage.includes('statement timeout') || errorMessage.includes('canceling statement')) {
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        console.error(`[ComputeSingle] Query timeout for region ${gId} after ${elapsed}s (${totalPoints} points). Consider using a hull for this region.`);
        return {
          computed: false,
          error: `Query timeout after ${elapsed}s: region is too large (${totalPoints} points). Consider using a hull instead.`,
        };
      }

      console.error(`[ComputeSingle] Error computing geometry for region ${gId}:`, errorMessage);
      throw err;
    }
  };

  // Recursive function to compute geometry bottom-up
  // Only recurses into children that don't have geometry yet
  const computeBottomUp = async (gId: number): Promise<{ groupsComputed: number }> => {
    let groupsComputed = 0;

    // Get all child groups that need computation (no geometry yet)
    const children = await pool.query(
      `SELECT id, is_custom_boundary, geom IS NOT NULL as has_geom
       FROM regions
       WHERE parent_region_id = $1`,
      [gId]
    );

    // Only process children that don't have geometry yet
    for (const child of children.rows) {
      // Skip custom boundary groups - they already have their geometry
      if (child.is_custom_boundary) {
        continue;
      }

      // Skip children that already have geometry - no need to recurse
      if (child.has_geom) {
        continue;
      }

      // First, recursively compute this child's children (since this child needs geometry)
      const childResult = await computeBottomUp(child.id);
      groupsComputed += childResult.groupsComputed;

      // Now compute this child
      const computed = await computeGroupGeom(child.id);
      if (computed.computed) {
        groupsComputed++;
        console.log(`[ComputeSingle] Computed child group ${child.id}`);
      }
    }

    return { groupsComputed };
  };

  try {
    console.log(`[ComputeSingle] Starting bottom-up computation for region ${regionId}: ${regionCheck.rows[0].name}`);

    // First, recursively compute all children that need it
    const childrenResult = await computeBottomUp(regionId);
    console.log(`[ComputeSingle] Computed ${childrenResult.groupsComputed} child regions`);

    // Now compute this region
    const result = await computeGroupGeom(regionId);

    if (!result.computed) {
      res.status(200).json({
        computed: false,
        message: result.error || 'No geometries to merge',
        childrenComputed: childrenResult.groupsComputed,
      });
      return;
    }

    console.log(`[ComputeSingle] Completed region ${regionId} with ${result.points} points`);

    // Check what was generated by the trigger
    const checkResult = await pool.query(`
      SELECT
        id, name,
        uses_hull as "usesHull",
        geom IS NOT NULL as "hasGeom",
        hull_geom IS NOT NULL as "hasHull",
        ST_NPoints(geom) as "geomPoints",
        ST_NPoints(hull_geom) as "hullPoints"
      FROM regions WHERE id = $1
    `, [regionId]);

    const regionStatus = checkResult.rows[0];
    console.log(`[ComputeSingle] Region ${regionId} status after compute:`, {
      name: regionStatus?.name,
      usesHull: regionStatus?.usesHull,
      hasGeom: regionStatus?.hasGeom,
      hasHull: regionStatus?.hasHull,
      geomPoints: regionStatus?.geomPoints,
      hullPoints: regionStatus?.hullPoints,
    });

    // Generate hull for hull regions (always regenerate or only if missing based on force)
    // OR clear hull data if region does NOT use hull
    let hullResult = null;
    if (regionStatus?.usesHull) {
      // Check if hull already exists
      const hullCheck = await pool.query(
        'SELECT hull_geom IS NOT NULL as has_hull FROM regions WHERE id = $1',
        [regionId]
      );
      const hasHull = hullCheck.rows[0]?.has_hull;

      if (force || !hasHull) {
        console.log(`[ComputeSingle] Region ${regionId} uses hull, generating hull (force=${force}, hasHull=${hasHull})...`);
        // Don't pass explicit params - generateSingleHull will use saved params if available
        hullResult = await generateSingleHull(regionId);
        console.log(`[ComputeSingle] Hull result:`, hullResult);
      } else {
        console.log(`[ComputeSingle] Region ${regionId} already has hull, skipping (use force=true to regenerate)`);
      }
    } else {
      // Does not use hull - clear any stale hull data
      const clearResult = await pool.query(`
        UPDATE regions
        SET hull_geom = NULL,
            hull_geom_3857 = NULL,
            hull_params = NULL
        WHERE id = $1
          AND hull_geom IS NOT NULL
        RETURNING id
      `, [regionId]);

      if (clearResult.rowCount && clearResult.rowCount > 0) {
        console.log(`[ComputeSingle] Region ${regionId} does not use hull, cleared stale hull data`);
      }
    }

    // Coverage-simplify children for gap-free borders between siblings
    if (childrenResult.groupsComputed >= 2) {
      await pool.query('SELECT simplify_coverage_regions($1::integer)', [regionId]);
      console.log(`[ComputeSingle] Coverage simplification applied to children of ${regionId}`);
    }

    // Coverage-simplify this region's siblings for gap-free borders
    const parentResult = await pool.query(
      'SELECT parent_region_id FROM regions WHERE id = $1',
      [regionId]
    );
    const parentRegionId = parentResult.rows[0]?.parent_region_id;
    if (parentRegionId) {
      const coverageResult = await pool.query('SELECT simplify_coverage_regions($1::integer)', [parentRegionId]);
      const coverageCount = coverageResult.rows[0]?.simplify_coverage_regions ?? 0;
      if (coverageCount > 0) {
        console.log(`[ComputeSingle] Coverage simplification applied to ${coverageCount} siblings under ${parentRegionId}`);
      }
    }

    // Bump tile_version for cache busting (matches SSE and batch paths)
    const worldViewResult = await pool.query(
      'SELECT world_view_id FROM regions WHERE id = $1',
      [regionId]
    );
    const worldViewId = worldViewResult.rows[0]?.world_view_id;
    let tileVersion: number | undefined;
    if (worldViewId) {
      const tvResult = await pool.query(
        'UPDATE world_views SET tile_version = COALESCE(tile_version, 0) + 1 WHERE id = $1 RETURNING tile_version',
        [worldViewId]
      );
      tileVersion = tvResult.rows[0]?.tile_version;
    }

    res.json({
      computed: true,
      points: result.points,
      childrenComputed: childrenResult.groupsComputed,
      usesHull: regionStatus?.usesHull,
      hullGenerated: hullResult?.generated,
      crossesDateline: hullResult?.crossesDateline,
      tileVersion,
    });
  } catch (e) {
    console.error('Error computing single group geometry:', e);
    res.status(500).json({ error: 'Failed to compute geometry' });
  } finally {
    computeClient.release();
  }
}

/**
 * Compute geometry for a single region (callable from batch computation)
 * Uses the same algorithm as the SSE endpoint
 */
export async function computeRegionGeometryCore(
  regionId: number,
  options: {
    skipSnapping?: boolean;
    logPrefix?: string;
  } = {}
): Promise<{ computed: boolean; points?: number; error?: string }> {
  const { skipSnapping = true, logPrefix = '[Compute]' } = options;
  const startTime = Date.now();
  const GEOMETRY_QUERY_TIMEOUT_MS = 300000;

  const log = (msg: string) => {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`${logPrefix} Region ${regionId}: ${msg} (${elapsed}s)`);
  };

  // Use a dedicated client so SET statement_timeout applies to our queries
  const client = await pool.connect();

  try {
    // Check if region exists and get info
    const regionCheck = await client.query(
      'SELECT is_custom_boundary, name, geom IS NOT NULL as has_geom FROM regions WHERE id = $1',
      [regionId]
    );

    if (regionCheck.rows.length === 0) {
      return { computed: false, error: 'Region not found' };
    }

    const regionName = regionCheck.rows[0].name;
    log(`Starting computation for: ${regionName}`);

    // Set statement timeout
    await client.query(`SET statement_timeout = '${GEOMETRY_QUERY_TIMEOUT_MS}'`);

    // Get complexity info
    const complexityCheck = await client.query(`
      SELECT
        COALESCE(SUM(ST_NPoints(COALESCE(rm.custom_geom, ad.geom))), 0) as member_points,
        COALESCE((SELECT SUM(ST_NPoints(geom)) FROM regions WHERE parent_region_id = $1 AND geom IS NOT NULL), 0) as child_points,
        (SELECT COUNT(*) FROM regions WHERE parent_region_id = $1 AND geom IS NOT NULL) as child_count,
        (SELECT COUNT(*) FROM region_members WHERE region_id = $1) as member_count
      FROM region_members rm
      LEFT JOIN administrative_divisions ad ON rm.division_id = ad.id
      WHERE rm.region_id = $1
    `, [regionId]);

    const memberPoints = parseInt(complexityCheck.rows[0]?.member_points || '0');
    const childPoints = parseInt(complexityCheck.rows[0]?.child_points || '0');
    const childCount = parseInt(complexityCheck.rows[0]?.child_count || '0');
    const memberCount = parseInt(complexityCheck.rows[0]?.member_count || '0');
    const totalPoints = memberPoints + childPoints;

    if (totalPoints === 0 && memberCount === 0 && childCount === 0) {
      await client.query('RESET statement_timeout');
      return { computed: false, error: 'No geometries to merge' };
    }

    const shouldSimplify = totalPoints > 300000;

    // Step 1: Collect all geometries
    log('Step 1: Collecting geometries...');
    const collectResult = await client.query(`
      WITH direct_member_geoms AS (
        SELECT
          CASE WHEN $2 THEN
            ST_SimplifyPreserveTopology(ST_MakeValid(COALESCE(rm.custom_geom, ad.geom)), 0.005)
          ELSE
            ST_MakeValid(COALESCE(rm.custom_geom, ad.geom))
          END as geom
        FROM region_members rm
        JOIN administrative_divisions ad ON rm.division_id = ad.id
        WHERE rm.region_id = $1 AND (rm.custom_geom IS NOT NULL OR ad.geom IS NOT NULL)
      ),
      child_group_geoms AS (
        SELECT
          CASE WHEN $2 THEN
            ST_SimplifyPreserveTopology(ST_MakeValid(geom), 0.005)
          ELSE
            ST_MakeValid(geom)
          END as geom
        FROM regions
        WHERE parent_region_id = $1 AND geom IS NOT NULL
      )
      SELECT ST_Collect(geom) as collected_geom, COUNT(*) as geom_count
      FROM (
        SELECT geom FROM direct_member_geoms WHERE geom IS NOT NULL
        UNION ALL
        SELECT geom FROM child_group_geoms WHERE geom IS NOT NULL
      ) all_geoms
    `, [regionId, shouldSimplify]);

    let collectedGeom = collectResult.rows[0]?.collected_geom;
    const geomCount = parseInt(collectResult.rows[0]?.geom_count || '0');

    if (!collectedGeom) {
      await client.query('RESET statement_timeout');
      return { computed: false, error: 'No geometries to merge' };
    }
    log(`Step 1: Collected ${geomCount} geometries`);

    // Step 2: Snap to neighbors (if not skipSnapping and has child regions)
    const hasChildRegions = childCount > 0;

    if (!skipSnapping && hasChildRegions) {
      log(`Step 2: Snapping ${childCount} child regions to neighbors...`);
      const snapResult = await client.query(`
        WITH child_regions AS (
          SELECT id, name, ST_MakeValid(geom) as geom
          FROM regions
          WHERE parent_region_id = $1 AND geom IS NOT NULL
        ),
        with_neighbors AS (
          SELECT
            a.id, a.geom,
            ST_Collect(b.geom) as neighbor_geom,
            COUNT(b.id) as neighbor_count
          FROM child_regions a
          LEFT JOIN child_regions b ON a.id != b.id
            AND (ST_Touches(a.geom, b.geom) OR ST_DWithin(a.geom, b.geom, 0.0001))
          GROUP BY a.id, a.geom
        ),
        snapped AS (
          SELECT
            CASE
              WHEN w.neighbor_count > 0 AND w.neighbor_geom IS NOT NULL THEN
                ST_MakeValid(ST_Snap(w.geom, w.neighbor_geom, 0.001))
              ELSE w.geom
            END as geom
          FROM with_neighbors w
        )
        SELECT ST_Collect(geom) as snapped_geom FROM snapped WHERE geom IS NOT NULL
      `, [regionId]);

      if (snapResult.rows[0]?.snapped_geom) {
        collectedGeom = snapResult.rows[0].snapped_geom;
      }
      log('Step 2: Snapping complete');
    } else {
      log('Step 2: Skipped (fast mode)');
    }

    // Step 3: Union
    log('Step 3: Unioning geometries...');
    const unionResult = await client.query(`
      SELECT ST_UnaryUnion(ST_MakeValid($1::geometry)) as union_geom
    `, [collectedGeom]);
    const unionGeom = unionResult.rows[0]?.union_geom;
    log('Step 3: Union complete');

    // Step 4: Clean up - remove small holes and slivers
    log('Step 4: Removing holes & slivers...');
    const cleanedResult = await client.query(`
      WITH extracted AS (
        SELECT ST_Multi(ST_CollectionExtract(ST_MakeValid($1::geometry), 3)) as geom
      ),
      polygons AS (
        SELECT (ST_Dump(geom)).geom as poly FROM extracted
      ),
      holes_filtered AS (
        SELECT
          CASE
            WHEN ST_NumInteriorRings(poly) = 0 THEN poly
            ELSE (
              SELECT ST_MakePolygon(
                ST_ExteriorRing(poly),
                ARRAY(
                  SELECT ST_InteriorRingN(poly, n)
                  FROM generate_series(1, ST_NumInteriorRings(poly)) n
                  WHERE
                    ST_Area(ST_MakePolygon(ST_InteriorRingN(poly, n))::geography) > 10000000
                    AND (
                      ST_Perimeter(ST_MakePolygon(ST_InteriorRingN(poly, n))::geography) /
                      NULLIF(SQRT(ST_Area(ST_MakePolygon(ST_InteriorRingN(poly, n))::geography)), 0)
                    ) < 25
                )
              )
            )
          END as poly
        FROM polygons
      ),
      collected AS (
        SELECT ST_Multi(ST_Collect(poly)) as geom FROM holes_filtered WHERE poly IS NOT NULL
      ),
      simplified AS (
        SELECT ST_SimplifyPreserveTopology(geom, 0.0001) as geom FROM collected
      )
      SELECT geom as cleaned_geom, ST_NPoints(geom) as num_points FROM simplified
    `, [unionGeom]);

    const cleanedGeom = cleanedResult.rows[0]?.cleaned_geom;
    const numPoints = parseInt(cleanedResult.rows[0]?.num_points || '0');
    log(`Step 4: Cleaning complete (${numPoints} points)`);

    // Step 5: Save to database
    log('Step 5: Saving to database...');
    const updateResult = await client.query(`
      UPDATE regions
      SET geom = validate_multipolygon($2)
      WHERE id = $1
      RETURNING ST_NPoints(geom) as points
    `, [regionId, cleanedGeom]);

    await client.query('RESET statement_timeout');

    const points = updateResult.rows[0]?.points;
    log(`Complete! ${points} points`);

    return { computed: true, points };
  } catch (err) {
    try {
      await client.query('RESET statement_timeout');
    } catch { /* ignore */ }

    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error(`${logPrefix} Error computing region ${regionId}:`, errorMessage);
    return { computed: false, error: errorMessage };
  } finally {
    client.release();
  }
}
