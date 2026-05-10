/**
 * Geometry compute operations for single regions — computation orchestration
 *
 * Contains computeSingleRegionGeometry (HTTP handler) and computeRegionGeometryCore (callable).
 * These share a similar 5-step algorithm but differ in connection management (client vs pool),
 * error handling, logging, and option flags. Kept separate intentionally.
 */

import { Request, Response } from 'express';
import { PoolClient } from 'pg';
import { pool } from '../../db/index.js';
import { generateSingleHull } from '../../services/hull/index.js';

const GEOMETRY_QUERY_TIMEOUT_MS = 300000;

interface PipelineResult {
  computed: boolean;
  points?: number;
  error?: string;
}

interface SnapStepOutcome {
  collectedGeom: unknown;
  totalAdded: number;
  snappedPoints: number;
  rowCount: number;
}

async function snapChildRegionsForGroup(
  client: PoolClient,
  gId: number,
  initialGeom: unknown,
): Promise<SnapStepOutcome> {
  const snapResult = await client.query(`
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

  let totalAdded = 0;
  let snappedGeom: unknown = null;
  let snappedPoints = 0;

  console.log(`[Snap] Snapping ${snapResult.rows.length} regions to neighbors:`);
  for (const row of snapResult.rows) {
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

  return {
    collectedGeom: snappedGeom ?? initialGeom,
    totalAdded,
    snappedPoints,
    rowCount: snapResult.rows.length,
  };
}

function classifyPipelineError(
  err: unknown,
  startTime: number,
  totalPoints: number,
  gId: number,
): { fatal: boolean; result?: PipelineResult } {
  const errorMessage = err instanceof Error ? err.message : String(err);
  if (errorMessage.includes('statement timeout') || errorMessage.includes('canceling statement')) {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.error(`[ComputeSingle] Query timeout for region ${gId} after ${elapsed}s (${totalPoints} points). Consider using a hull for this region.`);
    return {
      fatal: false,
      result: {
        computed: false,
        error: `Query timeout after ${elapsed}s: region is too large (${totalPoints} points). Consider using a hull instead.`,
      },
    };
  }
  console.error(`[ComputeSingle] Error computing geometry for region ${gId}:`, errorMessage);
  return { fatal: true };
}

async function computeGroupGeom(client: PoolClient, gId: number): Promise<PipelineResult> {
  const startTime = Date.now();

  const complexityCheck = await client.query(`
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

  const shouldSimplify = totalPoints > 300000;
  if (shouldSimplify) {
    console.log(`[ComputeSingle] Region ${gId}: Will simplify geometries before merging`);
  }

  const logStep = (step: string) => {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`[ComputeSingle] Region ${gId}: ${step} (${elapsed}s)`);
  };

  try {
    await client.query(`SET statement_timeout = '${GEOMETRY_QUERY_TIMEOUT_MS}'`);

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
    `, [gId, shouldSimplify]);

    let collectedGeom = collectResult.rows[0]?.collected_geom;
    const geomCount = parseInt(collectResult.rows[0]?.geom_count || '0');

    if (!collectedGeom) {
      logStep('No geometries to merge');
      await client.query('RESET statement_timeout');
      return { computed: false, error: 'No geometries to merge' };
    }
    logStep(`Step 1/6: Collected ${geomCount} geometries`);

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
    logStep(
      `Step 2/6: Input has ${parseInt(analyzeResult.rows[0]?.num_geoms || '0')} polygons, `
      + `${parseInt(analyzeResult.rows[0]?.total_holes || '0')} holes, `
      + `${parseInt(analyzeResult.rows[0]?.total_points || '0')} pts`,
    );

    if (childCount > 0) {
      logStep(`Step 3/6: Snapping ${childCount} child regions to their neighbors...`);
      const snap = await snapChildRegionsForGroup(client, gId, collectedGeom);
      collectedGeom = snap.collectedGeom;
      logStep(`Step 3/6: Snapped ${totalPoints} -> ${snap.snappedPoints} pts (+${snap.totalAdded} added)`);
    } else {
      logStep('Step 3/6: No child regions to snap (using direct members)');
    }

    logStep('Step 4/6: Unioning geometries...');
    const unionResult = await client.query(`
      SELECT ST_UnaryUnion($1::geometry) as union_geom
    `, [collectedGeom]);
    const unionGeom = unionResult.rows[0]?.union_geom;
    logStep('Step 4/6: Union complete');

    logStep('Step 5/6: Cleaning, removing small holes & slivers, simplifying...');
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
      before_stats AS (
        SELECT SUM(ST_NumInteriorRings(poly)) as num_holes FROM polygons
      ),
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
    logStep(`Step 5/6: Complete (${holesBefore} holes -> ${numHoles}, removed ${holesBefore - numHoles}), ${numPolygons} polygons, ${numPoints} pts`);

    logStep('Step 6/6: Updating region...');
    const updateResult = await client.query(`
      UPDATE regions
      SET geom = validate_multipolygon($2)
      WHERE id = $1
      RETURNING ST_NPoints(geom) as points
    `, [gId, cleanedGeom]);

    const points = updateResult.rows[0]?.points;
    logStep(`Step 6/6: Complete! ${points} points`);
    await client.query('RESET statement_timeout');

    return { computed: updateResult.rows.length > 0, points };
  } catch (err) {
    try {
      await client.query('RESET statement_timeout');
    } catch {
      /* ignore reset errors */
    }
    const classified = classifyPipelineError(err, startTime, totalPoints, gId);
    if (classified.result) return classified.result;
    throw err;
  }
}

async function computeBottomUp(
  client: PoolClient,
  gId: number,
): Promise<{ groupsComputed: number }> {
  let groupsComputed = 0;
  const children = await pool.query(
    `SELECT id, is_custom_boundary, geom IS NOT NULL as has_geom
     FROM regions
     WHERE parent_region_id = $1`,
    [gId],
  );

  for (const child of children.rows) {
    if (child.is_custom_boundary || child.has_geom) continue;
    const childResult = await computeBottomUp(client, child.id);
    groupsComputed += childResult.groupsComputed;
    const computed = await computeGroupGeom(client, child.id);
    if (computed.computed) {
      groupsComputed++;
      console.log(`[ComputeSingle] Computed child group ${child.id}`);
    }
  }
  return { groupsComputed };
}

interface CustomBoundaryDecision {
  earlyResponse?: {
    computed: true;
    regionId: number;
    name: string;
    usesHull: boolean;
    message: string;
  };
}

async function handleCustomBoundary(
  regionId: number,
  force: boolean,
  regionRow: { is_custom_boundary: boolean; name: string; usesHull: boolean | null },
): Promise<CustomBoundaryDecision> {
  if (!regionRow.is_custom_boundary) return {};

  if (force) {
    console.log(`[ComputeSingle] Region ${regionId} has custom boundary but force=true - clearing and recomputing`);
    await pool.query('UPDATE regions SET is_custom_boundary = false WHERE id = $1', [regionId]);
    return {};
  }

  const membersWithCustomGeom = await pool.query(
    'SELECT COUNT(*) as count FROM region_members WHERE region_id = $1 AND custom_geom IS NOT NULL',
    [regionId],
  );

  if (parseInt(membersWithCustomGeom.rows[0].count) === 0) {
    console.log(`[ComputeSingle] Region ${regionId} has custom boundary with no custom member geometries - keeping existing geometry`);
    return {
      earlyResponse: {
        computed: true,
        regionId,
        name: regionRow.name,
        usesHull: regionRow.usesHull ?? false,
        message: 'Region has custom boundary - geometry preserved',
      },
    };
  }

  console.log(`[ComputeSingle] Region ${regionId} has custom boundary with ${membersWithCustomGeom.rows[0].count} custom member geometries - will recompute`);
  await pool.query('UPDATE regions SET is_custom_boundary = false WHERE id = $1', [regionId]);
  return {};
}

async function applyHullPostProcessing(
  regionId: number,
  regionStatus: { usesHull?: boolean } | undefined,
  force: boolean,
): Promise<{ generated?: boolean; crossesDateline?: boolean } | null> {
  if (regionStatus?.usesHull) {
    const hullCheck = await pool.query(
      'SELECT hull_geom IS NOT NULL as has_hull FROM regions WHERE id = $1',
      [regionId],
    );
    const hasHull = hullCheck.rows[0]?.has_hull;
    if (force || !hasHull) {
      console.log(`[ComputeSingle] Region ${regionId} uses hull, generating hull (force=${force}, hasHull=${hasHull})...`);
      const result = await generateSingleHull(regionId);
      console.log(`[ComputeSingle] Hull result:`, result);
      return result ?? null;
    }
    console.log(`[ComputeSingle] Region ${regionId} already has hull, skipping (use force=true to regenerate)`);
    return null;
  }

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
  return null;
}

async function applyCoverageAndTileVersion(
  regionId: number,
  childrenComputed: number,
): Promise<number | undefined> {
  if (childrenComputed >= 2) {
    await pool.query('SELECT simplify_coverage_regions($1::integer)', [regionId]);
    console.log(`[ComputeSingle] Coverage simplification applied to children of ${regionId}`);
  }

  const parentResult = await pool.query(
    'SELECT parent_region_id FROM regions WHERE id = $1',
    [regionId],
  );
  const parentRegionId = parentResult.rows[0]?.parent_region_id;
  if (parentRegionId) {
    const coverageResult = await pool.query(
      'SELECT simplify_coverage_regions($1::integer)',
      [parentRegionId],
    );
    const coverageCount = coverageResult.rows[0]?.simplify_coverage_regions ?? 0;
    if (coverageCount > 0) {
      console.log(`[ComputeSingle] Coverage simplification applied to ${coverageCount} siblings under ${parentRegionId}`);
    }
  }

  const worldViewResult = await pool.query(
    'SELECT world_view_id FROM regions WHERE id = $1',
    [regionId],
  );
  const worldViewId = worldViewResult.rows[0]?.world_view_id;
  if (!worldViewId) return undefined;

  const tvResult = await pool.query(
    'UPDATE world_views SET tile_version = COALESCE(tile_version, 0) + 1 WHERE id = $1 RETURNING tile_version',
    [worldViewId],
  );
  return tvResult.rows[0]?.tile_version;
}

/**
 * Compute geometry for a single region (merge members and child regions)
 * Recursively computes child regions first (bottom-up) if they don't have geometry
 * Skips regions with custom boundaries
 */
export async function computeSingleRegionGeometry(req: Request, res: Response): Promise<void> {
  const regionId = parseInt(String(req.params.regionId));
  const force = req.query.force === 'true';

  console.log(`[ComputeSingle] Computing region ${regionId}, force=${force}`);

  const regionCheck = await pool.query(
    'SELECT is_custom_boundary, name, uses_hull as "usesHull", geom IS NOT NULL as has_geom FROM regions WHERE id = $1',
    [regionId],
  );
  if (regionCheck.rows.length === 0) {
    res.status(404).json({ error: 'Region not found' });
    return;
  }

  const customBoundary = await handleCustomBoundary(regionId, force, regionCheck.rows[0]);
  if (customBoundary.earlyResponse) {
    res.json(customBoundary.earlyResponse);
    return;
  }

  // Use a dedicated client so SET statement_timeout applies to our queries
  // (pool.query() checks out a random connection each time).
  const computeClient = await pool.connect();
  try {
    console.log(`[ComputeSingle] Starting bottom-up computation for region ${regionId}: ${regionCheck.rows[0].name}`);
    const childrenResult = await computeBottomUp(computeClient, regionId);
    console.log(`[ComputeSingle] Computed ${childrenResult.groupsComputed} child regions`);

    const result = await computeGroupGeom(computeClient, regionId);
    if (!result.computed) {
      res.status(200).json({
        computed: false,
        message: result.error || 'No geometries to merge',
        childrenComputed: childrenResult.groupsComputed,
      });
      return;
    }
    console.log(`[ComputeSingle] Completed region ${regionId} with ${result.points} points`);

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

    const hullResult = await applyHullPostProcessing(regionId, regionStatus, force);
    const tileVersion = await applyCoverageAndTileVersion(regionId, childrenResult.groupsComputed);

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
