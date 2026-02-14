/**
 * SSE-based geometry computation with progress streaming
 */

import { Request, Response } from 'express';
import { pool } from '../../db/index.js';
import { generateSingleHull } from '../../services/hull/index.js';
import { recomputeRegionGeometry } from './helpers.js';

interface ProgressEvent {
  type: 'progress' | 'complete' | 'error';
  step?: string;
  elapsed?: number;
  data?: Record<string, unknown>;
  message?: string;
}

/**
 * Compute geometry for a single region with SSE progress streaming
 * GET /api/world-views/regions/:regionId/geometry/compute-stream
 */
export async function computeSingleRegionGeometrySSE(req: Request, res: Response): Promise<void> {
  const regionId = parseInt(String(req.params.regionId || req.params.groupId));
  const _force = req.query.force === 'true'; // Reserved for future use
  const skipSnapping = req.query.skipSnapping === 'true';

  // Set up SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.flushHeaders();

  const sendEvent = (event: ProgressEvent) => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  };

  const startTime = Date.now();
  const logStep = (step: string, data?: Record<string, unknown>) => {
    const elapsed = (Date.now() - startTime) / 1000;
    const dataStr = data ? ` ${JSON.stringify(data)}` : '';
    console.log(`[ComputeSingle] Region ${regionId}: ${step}${dataStr} (${elapsed.toFixed(1)}s)`);
    sendEvent({ type: 'progress', step, elapsed, data });
  };

  try {
    // Check if region exists
    const regionCheck = await pool.query(
      'SELECT is_custom_boundary, name, geom IS NOT NULL as has_geom FROM regions WHERE id = $1',
      [regionId]
    );

    if (regionCheck.rows.length === 0) {
      sendEvent({ type: 'error', message: 'Region not found' });
      res.end();
      return;
    }

    const regionName = regionCheck.rows[0].name;
    logStep(`Starting computation for: ${regionName}`);

    // Check custom boundary
    if (regionCheck.rows[0].is_custom_boundary) {
      const membersWithCustomGeom = await pool.query(
        'SELECT COUNT(*) as count FROM region_members WHERE region_id = $1 AND custom_geom IS NOT NULL',
        [regionId]
      );

      if (parseInt(membersWithCustomGeom.rows[0].count) === 0) {
        sendEvent({
          type: 'complete',
          message: 'Region has custom boundary - geometry preserved',
          data: { computed: true, preserved: true },
        });
        res.end();
        return;
      }

      logStep('Has custom boundary with custom members - will recompute');
      await pool.query('UPDATE regions SET is_custom_boundary = false WHERE id = $1', [regionId]);
    }

    // Pre-step: Recursively compute children that have no geometry yet
    // (e.g., Alabama re-added as subregion with geom=NULL)
    const childrenWithoutGeom = await pool.query(
      `SELECT id, name, is_custom_boundary
       FROM regions
       WHERE parent_region_id = $1 AND geom IS NULL AND is_custom_boundary IS NOT TRUE`,
      [regionId]
    );

    if (childrenWithoutGeom.rows.length > 0) {
      logStep(`Computing ${childrenWithoutGeom.rows.length} child region(s) without geometry...`);
      let childrenComputed = 0;
      for (const child of childrenWithoutGeom.rows) {
        const childResult = await recomputeRegionGeometry(child.id);
        if (childResult.computed) {
          childrenComputed++;
          logStep(`Computed child: ${child.name} (${childResult.points} pts)`);
        } else {
          logStep(`Could not compute child: ${child.name} (no members/children?)`);
        }
      }
      logStep(`Pre-step complete: ${childrenComputed}/${childrenWithoutGeom.rows.length} children computed`);
    }

    // Query timeout (5 minutes)
    const GEOMETRY_QUERY_TIMEOUT_MS = 300000;

    // Use a dedicated client so SET statement_timeout applies to our queries
    // (pool.query() checks out a random connection each time)
    const client = await pool.connect();

    try {

    // Check complexity
    logStep('Checking complexity...');
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

    logStep('Complexity check complete', {
      memberPoints,
      childPoints,
      memberCount,
      childCount,
      totalPoints,
    });

    const shouldSimplify = totalPoints > 300000;
    if (shouldSimplify) {
      logStep('Will simplify geometries before merging (>300k points)');
    }

    await client.query(`SET statement_timeout = '${GEOMETRY_QUERY_TIMEOUT_MS}'`);

    // Step 1: Collect geometries
    logStep('Step 1/6: Collecting geometries...');
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
      client.release();
      sendEvent({ type: 'error', message: 'No geometries to merge' });
      res.end();
      return;
    }
    logStep('Step 1/6: Complete', { geomCount });

    // Step 2: Analyze input
    logStep('Step 2/6: Analyzing input geometry...');
    const analyzeResult = await client.query(`
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
    logStep('Step 2/6: Complete', { inputGeoms, inputHoles, inputPoints });

    // Step 3: Snap each child region to its neighbors (unless skipSnapping is true)
    // The problem: borders like a---b vs a---c---b have mismatched vertices.
    // Solution: ST_Snap adds vertices from neighbors to each region's boundary
    const hasChildRegions = childCount > 0;

    if (skipSnapping) {
      logStep('Step 3/6: Skipped (fast mode - no snapping)');
    } else if (hasChildRegions) {
      logStep(`Step 3/6: Snapping ${childCount} child regions to their neighbors...`);

      // Process each child region: snap it to all its neighbors
      // This adds matching vertices where neighbors have them
      const snapResult = await client.query(`
        WITH child_regions AS (
          SELECT id, name, ST_MakeValid(geom) as geom
          FROM regions 
          WHERE parent_region_id = $1 AND geom IS NOT NULL
        ),
        -- For each region, collect all touching/near neighbors
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
        -- Snap each region to its neighbors with 100m tolerance
        -- This adds vertices from neighbors onto this region's boundary
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
      `, [regionId]);

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

      logStep(`Step 3/6: Complete`, {
        originalPoints: inputPoints,
        snappedPoints,
        addedPoints: totalAdded,
        increase: `${((snappedPoints / inputPoints - 1) * 100).toFixed(0)}%`
      });

      if (snappedGeom) {
        collectedGeom = snappedGeom;
      }
    } else if (!skipSnapping) {
      logStep('Step 3/6: No child regions (using direct members)');
    }

    // Step 4: Union - this handles overlaps automatically
    logStep('Step 4/6: Unioning geometries...');
    const unionResult = await client.query(`
      SELECT ST_UnaryUnion(ST_MakeValid($1::geometry)) as union_geom
    `, [collectedGeom]);
    const unionGeom = unionResult.rows[0]?.union_geom;
    logStep('Step 4/6: Complete');

    // Step 5: Clean up - fill small holes, simplify
    logStep('Step 5/6: Cleaning, removing small holes & slivers, simplifying...');
    const cleanedResult = await client.query(`
      WITH extracted AS (
        SELECT ST_Multi(ST_CollectionExtract(ST_MakeValid($1::geometry), 3)) as geom
      ),
      -- Dump to individual polygons
      polygons AS (
        SELECT (ST_Dump(geom)).geom as poly FROM extracted
      ),
      -- For each polygon, remove holes smaller than 1 km² (0.0001 sq degrees ≈ 1 km²)
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
    logStep('Step 5/6: Complete', {
      numPolygons,
      holesBefore,
      holesAfter: numHoles,
      holesRemoved,
      numPoints
    });

    // Step 6: Update
    logStep('Step 6/6: Saving to database...');
    const updateResult = await client.query(`
      UPDATE regions
      SET geom = $2
      WHERE id = $1
      RETURNING ST_NPoints(geom) as points, is_archipelago
    `, [regionId, cleanedGeom]);

    await client.query('RESET statement_timeout');

    const finalPoints = updateResult.rows[0]?.points;
    const isArchipelago = updateResult.rows[0]?.is_archipelago;
    logStep('Step 6/6: Complete', { finalPoints });

    // Generate hull for archipelagos OR clear stale hull data for non-archipelagos
    let tsHullResult = null;
    if (isArchipelago) {
      logStep('Generating TS Hull for archipelago...');
      tsHullResult = await generateSingleHull(regionId);
      logStep('TS Hull complete', { generated: tsHullResult.generated });
    } else {
      // Not an archipelago - clear any stale hull data
      const clearResult = await client.query(`
        UPDATE regions
        SET ts_hull_geom = NULL,
            ts_hull_geom_3857 = NULL,
            ts_hull_params = NULL
        WHERE id = $1
          AND ts_hull_geom IS NOT NULL
        RETURNING id
      `, [regionId]);

      if (clearResult.rowCount && clearResult.rowCount > 0) {
        logStep('Cleared stale hull data (not an archipelago)');
      }
    }

    sendEvent({
      type: 'complete',
      elapsed: (Date.now() - startTime) / 1000,
      data: {
        computed: true,
        points: finalPoints,
        isArchipelago,
        tsHullGenerated: tsHullResult?.generated,
        numPolygons,
        numHoles,
      },
    });

    } finally {
      // Always release the dedicated client back to the pool
      try {
        await client.query('RESET statement_timeout');
      } catch { /* ignore */ }
      client.release();
    }

  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error(`[ComputeSingle SSE] Error for region ${regionId}:`, errorMessage);

    if (errorMessage.includes('statement timeout') || errorMessage.includes('canceling statement')) {
      sendEvent({
        type: 'error',
        message: 'Query timeout - region is too large. Consider using a hull instead.',
        elapsed: (Date.now() - startTime) / 1000,
      });
    } else {
      sendEvent({
        type: 'error',
        message: errorMessage,
        elapsed: (Date.now() - startTime) / 1000,
      });
    }
  }

  res.end();
}
