/**
 * SSE-based geometry computation with progress streaming
 */

import { Request, Response } from 'express';
import { PoolClient } from 'pg';
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

const GEOMETRY_QUERY_TIMEOUT_MS = 300000;

type LogStep = (step: string, data?: Record<string, unknown>) => void;
type SendEvent = (event: ProgressEvent) => void;

interface SSEContext {
  sendEvent: SendEvent;
  logStep: LogStep;
  startTime: number;
  elapsed: () => number;
}

function startSSEStream(res: Response, regionId: number): SSEContext {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  // CORS is handled globally by the cors() middleware (origin: FRONTEND_ORIGIN,
  // credentials: true). Setting Access-Control-Allow-Origin: * here would both
  // widen the policy AND break credentialed SSE (browsers reject '*' with
  // credentials).
  res.flushHeaders();

  const startTime = Date.now();
  const sendEvent: SendEvent = (event) => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  };
  const logStep: LogStep = (step, data) => {
    const elapsed = (Date.now() - startTime) / 1000;
    const dataStr = data ? ` ${JSON.stringify(data)}` : '';
    console.log(`[ComputeSingle] Region ${regionId}: ${step}${dataStr} (${elapsed.toFixed(1)}s)`);
    sendEvent({ type: 'progress', step, elapsed, data });
  };
  return { sendEvent, logStep, startTime, elapsed: () => (Date.now() - startTime) / 1000 };
}

interface RegionRow {
  is_custom_boundary: boolean;
  name: string;
  has_geom: boolean;
}

/**
 * Handles the custom-boundary fast path. Returns true if the SSE flow should
 * short-circuit (helper has already emitted the 'complete' event), false to
 * continue with the normal pipeline.
 */
async function shortCircuitForCustomBoundary(
  regionId: number,
  regionRow: RegionRow,
  sendEvent: SendEvent,
  logStep: LogStep,
): Promise<boolean> {
  if (!regionRow.is_custom_boundary) return false;

  const membersWithCustomGeom = await pool.query(
    'SELECT COUNT(*) as count FROM region_members WHERE region_id = $1 AND custom_geom IS NOT NULL',
    [regionId],
  );
  if (parseInt(membersWithCustomGeom.rows[0].count) === 0) {
    sendEvent({
      type: 'complete',
      message: 'Region has custom boundary - geometry preserved',
      data: { computed: true, preserved: true },
    });
    return true;
  }

  await pool.query('UPDATE regions SET is_custom_boundary = false WHERE id = $1', [regionId]);
  logStep('Has custom boundary with custom members - will recompute');
  return false;
}

async function precomputeMissingChildren(regionId: number, logStep: LogStep): Promise<void> {
  const childrenWithoutGeom = await pool.query(
    `SELECT id, name, is_custom_boundary
     FROM regions
     WHERE parent_region_id = $1 AND geom IS NULL AND is_custom_boundary IS NOT TRUE`,
    [regionId],
  );
  if (childrenWithoutGeom.rows.length === 0) return;

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

  if (childrenComputed >= 2) {
    await pool.query('SELECT simplify_coverage_regions($1::integer)', [regionId]);
    logStep('Coverage simplification applied to children');
  }
}

interface ComplexityStats {
  memberPoints: number;
  childPoints: number;
  childCount: number;
  memberCount: number;
  totalPoints: number;
}

async function fetchComplexityStats(client: PoolClient, regionId: number): Promise<ComplexityStats> {
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
  return {
    memberPoints,
    childPoints,
    childCount: parseInt(complexityCheck.rows[0]?.child_count || '0'),
    memberCount: parseInt(complexityCheck.rows[0]?.member_count || '0'),
    totalPoints: memberPoints + childPoints,
  };
}

async function collectGeometriesStep(
  client: PoolClient,
  regionId: number,
  shouldSimplify: boolean,
): Promise<{ collectedGeom: unknown; geomCount: number }> {
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
  return {
    collectedGeom: collectResult.rows[0]?.collected_geom,
    geomCount: parseInt(collectResult.rows[0]?.geom_count || '0'),
  };
}

async function analyzeInputGeometryStep(
  client: PoolClient,
  collectedGeom: unknown,
): Promise<{ inputGeoms: number; inputHoles: number; inputPoints: number }> {
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
  return {
    inputGeoms: parseInt(analyzeResult.rows[0]?.num_geoms || '0'),
    inputHoles: parseInt(analyzeResult.rows[0]?.total_holes || '0'),
    inputPoints: parseInt(analyzeResult.rows[0]?.total_points || '0'),
  };
}

interface CleanedGeometryStats {
  cleanedGeom: unknown;
  holesBefore: number;
  numPolygons: number;
  numHoles: number;
  numPoints: number;
}

async function cleanupAndSimplifyStep(
  client: PoolClient,
  unionGeom: unknown,
): Promise<CleanedGeometryStats> {
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
  const numPolygons = parseInt(cleanedResult.rows[0]?.num_polygons || '0');
  const numRings = parseInt(cleanedResult.rows[0]?.num_rings || '0');
  return {
    cleanedGeom: cleanedResult.rows[0]?.cleaned_geom,
    holesBefore: parseInt(cleanedResult.rows[0]?.holes_before || '0'),
    numPolygons,
    numHoles: numRings - numPolygons,
    numPoints: parseInt(cleanedResult.rows[0]?.num_points || '0'),
  };
}

async function snapChildRegionsSSE(
  client: PoolClient,
  regionId: number,
  inputPoints: number,
  logStep: LogStep,
): Promise<unknown> {
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
  `, [regionId]);

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

  logStep(`Step 3/6: Complete`, {
    originalPoints: inputPoints,
    snappedPoints,
    addedPoints: totalAdded,
    increase: `${((snappedPoints / inputPoints - 1) * 100).toFixed(0)}%`,
  });
  return snappedGeom;
}

async function applyHullPostStep(
  client: PoolClient,
  regionId: number,
  usesHull: boolean,
  logStep: LogStep,
): Promise<{ generated?: boolean; crossesDateline?: boolean } | null> {
  if (usesHull) {
    logStep('Generating hull...');
    const hullResult = await generateSingleHull(regionId);
    logStep('Hull complete', { generated: hullResult.generated });
    return hullResult ?? null;
  }
  const clearResult = await client.query(`
    UPDATE regions
    SET hull_geom = NULL,
        hull_geom_3857 = NULL,
        hull_params = NULL
    WHERE id = $1
      AND hull_geom IS NOT NULL
    RETURNING id
  `, [regionId]);
  if (clearResult.rowCount && clearResult.rowCount > 0) {
    logStep('Cleared stale hull data (does not use hull)');
  }
  return null;
}

async function applyCoverageAndFetchFocus(
  regionId: number,
  logStep: LogStep,
): Promise<{ focusBbox: unknown; anchorPoint: [number, number] | null; tileVersion: number }> {
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
      logStep('Coverage simplification applied to siblings', { siblings: coverageCount });
    }
  }

  const focusResult = await pool.query(`
    SELECT
      focus_bbox,
      CASE WHEN anchor_point IS NOT NULL
        THEN json_build_array(ST_X(anchor_point), ST_Y(anchor_point))
        ELSE NULL
      END as anchor_point,
      world_view_id
    FROM regions WHERE id = $1
  `, [regionId]);

  const focusBbox = focusResult.rows[0]?.focus_bbox ?? null;
  const anchorPoint = focusResult.rows[0]?.anchor_point ?? null;

  let tileVersion = 0;
  const worldViewId = focusResult.rows[0]?.world_view_id;
  if (worldViewId) {
    const tvResult = await pool.query(
      'UPDATE world_views SET tile_version = COALESCE(tile_version, 0) + 1 WHERE id = $1 RETURNING tile_version',
      [worldViewId],
    );
    tileVersion = tvResult.rows[0]?.tile_version ?? 0;
  }
  return { focusBbox, anchorPoint, tileVersion };
}

/**
 * Compute geometry for a single region with SSE progress streaming
 * GET /api/world-views/regions/:regionId/geometry/compute-stream
 */
export async function computeSingleRegionGeometrySSE(req: Request, res: Response): Promise<void> {
  const regionId = parseInt(String(req.params.regionId));
  const skipSnapping = req.query.skipSnapping === 'true';

  const { sendEvent, logStep, elapsed } = startSSEStream(res, regionId);

  try {
    const regionCheck = await pool.query(
      'SELECT is_custom_boundary, name, geom IS NOT NULL as has_geom FROM regions WHERE id = $1',
      [regionId],
    );
    if (regionCheck.rows.length === 0) {
      sendEvent({ type: 'error', message: 'Region not found' });
      res.end();
      return;
    }

    const regionRow = regionCheck.rows[0] as RegionRow;
    logStep(`Starting computation for: ${regionRow.name}`);

    if (await shortCircuitForCustomBoundary(regionId, regionRow, sendEvent, logStep)) {
      res.end();
      return;
    }

    await precomputeMissingChildren(regionId, logStep);

    // Use a dedicated client so SET statement_timeout applies to our queries
    // (pool.query() checks out a random connection each time).
    const client = await pool.connect();

    try {

    logStep('Checking complexity...');
    const stats = await fetchComplexityStats(client, regionId);
    logStep('Complexity check complete', {
      memberPoints: stats.memberPoints,
      childPoints: stats.childPoints,
      memberCount: stats.memberCount,
      childCount: stats.childCount,
      totalPoints: stats.totalPoints,
    });

    const shouldSimplify = stats.totalPoints > 300000;
    if (shouldSimplify) logStep('Will simplify geometries before merging (>300k points)');

    await client.query(`SET statement_timeout = '${GEOMETRY_QUERY_TIMEOUT_MS}'`);

    logStep('Step 1/6: Collecting geometries...');
    const collected = await collectGeometriesStep(client, regionId, shouldSimplify);
    let collectedGeom = collected.collectedGeom;
    if (!collectedGeom) {
      // Don't reset/release here — the outer `finally` already does both.
      // Releasing twice on the same client throws and propagates out of
      // `finally`, ending up in the outer catch that then tries to `res.write`
      // on an already-ended SSE stream ("headers already sent").
      sendEvent({ type: 'error', message: 'No geometries to merge' });
      res.end();
      return;
    }
    logStep('Step 1/6: Complete', { geomCount: collected.geomCount });

    logStep('Step 2/6: Analyzing input geometry...');
    const inputStats = await analyzeInputGeometryStep(client, collectedGeom);
    logStep('Step 2/6: Complete', inputStats);

    // Step 3: Snap each child region to its neighbors (unless skipSnapping is true).
    // Borders like a---b vs a---c---b have mismatched vertices — ST_Snap adds
    // vertices from neighbors to each region's boundary so the union has no slivers.
    if (skipSnapping) {
      logStep('Step 3/6: Skipped (fast mode - no snapping)');
    } else if (stats.childCount > 0) {
      logStep(`Step 3/6: Snapping ${stats.childCount} child regions to their neighbors...`);
      const snappedGeom = await snapChildRegionsSSE(client, regionId, inputStats.inputPoints, logStep);
      if (snappedGeom) collectedGeom = snappedGeom;
    } else {
      logStep('Step 3/6: No child regions (using direct members)');
    }

    logStep('Step 4/6: Unioning geometries...');
    const unionResult = await client.query(
      `SELECT ST_UnaryUnion(ST_MakeValid($1::geometry)) as union_geom`,
      [collectedGeom],
    );
    const unionGeom = unionResult.rows[0]?.union_geom;
    logStep('Step 4/6: Complete');

    logStep('Step 5/6: Cleaning, removing small holes & slivers, simplifying...');
    const { cleanedGeom, holesBefore, numPolygons, numHoles, numPoints } =
      await cleanupAndSimplifyStep(client, unionGeom);
    logStep('Step 5/6: Complete', {
      numPolygons,
      holesBefore,
      holesAfter: numHoles,
      holesRemoved: holesBefore - numHoles,
      numPoints,
    });

    // Step 6: Update
    logStep('Step 6/6: Saving to database...');
    const updateResult = await client.query(`
      UPDATE regions
      SET geom = validate_multipolygon($2)
      WHERE id = $1
      RETURNING ST_NPoints(geom) as points, uses_hull
    `, [regionId, cleanedGeom]);

    await client.query('RESET statement_timeout');

    const finalPoints = updateResult.rows[0]?.points;
    const usesHull = updateResult.rows[0]?.uses_hull;
    logStep('Step 6/6: Complete', { finalPoints });

    const hullResult = await applyHullPostStep(client, regionId, !!usesHull, logStep);
    const focusData = await applyCoverageAndFetchFocus(regionId, logStep);

    sendEvent({
      type: 'complete',
      elapsed: elapsed(),
      data: {
        computed: true,
        points: finalPoints,
        usesHull,
        hullGenerated: hullResult?.generated,
        numPolygons,
        numHoles,
        focusBbox: focusData.focusBbox,
        anchorPoint: focusData.anchorPoint,
        tileVersion: focusData.tileVersion,
      },
    });

    } finally {
      try {
        await client.query('RESET statement_timeout');
      } catch { /* ignore */ }
      client.release();
    }

  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error(`[ComputeSingle SSE] Error for region ${regionId}:`, errorMessage);

    const isTimeout = errorMessage.includes('statement timeout') || errorMessage.includes('canceling statement');
    sendEvent({
      type: 'error',
      message: isTimeout
        ? 'Query timeout - region is too large. Consider using a hull instead.'
        : errorMessage,
      elapsed: elapsed(),
    });
  }

  res.end();
}
