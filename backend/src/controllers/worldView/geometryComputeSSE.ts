/**
 * SSE-based geometry computation with progress streaming
 */

import { Request, Response } from 'express';
import { PoolClient } from 'pg';
import { pool } from '../../db/index.js';
import { generateSingleHull } from '../../services/hull/index.js';
import { recomputeRegionGeometry } from './helpers.js';
import { computeSingleMemberFastPath } from './computeSingleMemberFastPath.js';
import { collectUnionInputs, CollectedUnionInputs } from './collectUnionInputs.js';
import { snapChildRegionsForGroup } from './snapChildRegionsForGroup.js';
import { markStreamBody } from '../../middleware/cacheHeaders.js';

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
  markStreamBody(res);
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
  uses_hull: boolean;
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
  childRowCount: number;
  memberCount: number;
  totalPoints: number;
}

async function fetchComplexityStats(client: PoolClient, regionId: number): Promise<ComplexityStats> {
  const complexityCheck = await client.query(`
    SELECT
      COALESCE(SUM(ST_NPoints(COALESCE(rm.custom_geom, ad.geom))), 0) as member_points,
      COALESCE((SELECT SUM(ST_NPoints(geom)) FROM regions WHERE parent_region_id = $1 AND geom IS NOT NULL), 0) as child_points,
      (SELECT COUNT(*) FROM regions WHERE parent_region_id = $1 AND geom IS NOT NULL) as child_count,
      (SELECT COUNT(*) FROM regions WHERE parent_region_id = $1) as child_row_count,
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
    childRowCount: parseInt(complexityCheck.rows[0]?.child_row_count || '0'),
    memberCount: parseInt(complexityCheck.rows[0]?.member_count || '0'),
    totalPoints: memberPoints + childPoints,
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

/**
 * Removes small holes and slivers from the union, and writes nothing else into
 * the shape. It deliberately does not simplify: `regions.geom` is the
 * authoritative geometry every derived column is made from (rule 1 of
 * `docs/tech/geometry-columns.md`), so a tolerance applied here is an error no
 * downstream rung can recover. Simplification belongs to the derived columns,
 * which run at 5 km and 1 km — not to a 0.0001° pass on the source (#443).
 */
async function cleanupStep(
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
    final_stats AS (
      SELECT
        ST_NumGeometries(geom) as num_polygons,
        ST_NRings(geom) as num_rings,
        ST_NPoints(geom) as num_points
      FROM collected
    )
    SELECT
      (SELECT geom FROM collected) as cleaned_geom,
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

/**
 * The shared snap step, with the progress line this writer's stream carries.
 * The statement itself lives in snapChildRegionsForGroup, held by all three
 * writers.
 */
async function snapChildRegionsSSE(
  client: PoolClient,
  regionId: number,
  inputPoints: number,
  collected: CollectedUnionInputs,
  logStep: LogStep,
): Promise<unknown> {
  const snap = await snapChildRegionsForGroup(client, regionId, collected.collectedGeom);

  logStep(`Step 3/6: Complete`, {
    originalPoints: inputPoints,
    snappedPoints: snap.snappedPoints,
    addedPoints: snap.totalAdded,
    increase: `${((snap.snappedPoints / inputPoints - 1) * 100).toFixed(0)}%`,
  });
  // A region with no geometry-bearing child leaves the step with the geometry
  // it came in with, so the caller's assignment is a no-op rather than a case
  // to spell out.
  return snap.collectedGeom;
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
    // No ancestor invalidation here, and none needed: the geometry writes this
    // follows carried it from inside their own statements
    // (trg_regions_geom_invalidates_parent, ADR-0035), and
    // simplify_coverage_regions above touches only the render columns
    // (geom_simplified_low/medium, geom_overview) -- never geom, which is the
    // only thing a parent's union reads, and the only thing the trigger watches
    // (#667).
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

interface UnionPipelineResult {
  finalPoints?: number;
  usesHull: boolean;
  numPolygons?: number;
  numHoles?: number;
}

/**
 * Runs the full 6-step union pipeline (collect, analyze, snap, union, clean,
 * save) for a region that didn't qualify for computeSingleMemberFastPath.
 * Returns null when there is nothing to merge — the caller owns the SSE
 * stream, so it sends the error event and ends the response itself.
 */
async function runUnionPipelineSteps(
  client: PoolClient,
  regionId: number,
  stats: ComplexityStats,
  shouldSimplify: boolean,
  skipSnapping: boolean,
  logStep: LogStep,
): Promise<UnionPipelineResult | null> {
  logStep('Step 1/6: Collecting geometries...');
  const collected = await collectUnionInputs(client, regionId, shouldSimplify);
  let collectedGeom = collected.collectedGeom;
  if (!collectedGeom) return null;
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
    const snappedGeom = await snapChildRegionsSSE(
      client, regionId, inputStats.inputPoints, collected, logStep,
    );
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

  logStep('Step 5/6: Cleaning, removing small holes & slivers...');
  const cleaned = await cleanupStep(client, unionGeom);
  logStep('Step 5/6: Complete', {
    numPolygons: cleaned.numPolygons,
    holesBefore: cleaned.holesBefore,
    holesAfter: cleaned.numHoles,
    holesRemoved: cleaned.holesBefore - cleaned.numHoles,
    numPoints: cleaned.numPoints,
  });

  logStep('Step 6/6: Saving to database...');
  const updateResult = await client.query(`
    UPDATE regions
    SET geom = validate_multipolygon($2)
    WHERE id = $1
    RETURNING ST_NPoints(geom) as points, uses_hull
  `, [regionId, cleaned.cleanedGeom]);

  const finalPoints = updateResult.rows[0]?.points;
  const usesHull = !!updateResult.rows[0]?.uses_hull;
  logStep('Step 6/6: Complete', { finalPoints });

  return { finalPoints, usesHull, numPolygons: cleaned.numPolygons, numHoles: cleaned.numHoles };
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
      'SELECT is_custom_boundary, name, geom IS NOT NULL as has_geom, uses_hull FROM regions WHERE id = $1',
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

    // shortCircuitForCustomBoundary above already guarantees is_custom_boundary=false;
    // see computeSingleMemberFastPath's docstring for the rest of the eligibility rules.
    const fastResult = await computeSingleMemberFastPath(
      client, regionId, stats.memberCount, stats.childRowCount, false, (msg) => logStep(msg),
    );

    const pipelineResult: UnionPipelineResult | null = fastResult
      ? { finalPoints: fastResult.points, usesHull: regionRow.uses_hull }
      : await runUnionPipelineSteps(client, regionId, stats, shouldSimplify, skipSnapping, logStep);

    if (!pipelineResult) {
      // Don't reset/release here — the outer `finally` already does both.
      // Releasing twice on the same client throws and propagates out of
      // `finally`, ending up in the outer catch that then tries to `res.write`
      // on an already-ended SSE stream ("headers already sent").
      sendEvent({ type: 'error', message: 'No geometries to merge' });
      res.end();
      return;
    }

    await client.query('RESET statement_timeout');

    const { finalPoints, usesHull, numPolygons, numHoles } = pipelineResult;
    const hullResult = await applyHullPostStep(client, regionId, usesHull, logStep);
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
    // nosemgrep: javascript.lang.security.audit.unsafe-formatstring.unsafe-formatstring -- regionId is a number
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
