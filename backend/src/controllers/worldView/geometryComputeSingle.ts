/**
 * Geometry compute operations for single regions — computation orchestration
 *
 * Contains computeRegionGeometryCore, the single-region computation the world-view run calls.
 * The editor computes one region through the stream (geometryComputeSSE.ts).
 */

import { pool } from '../../db/index.js';
import { computeSingleMemberFastPath } from './computeSingleMemberFastPath.js';
import { collectUnionInputs } from './collectUnionInputs.js';
import { snapChildRegionsForGroup } from './snapChildRegionsForGroup.js';

interface PipelineResult {
  computed: boolean;
  points?: number;
  error?: string;
}

/**
 * What a throw inside computeRegionGeometryCore means for the run.
 *
 * A failed pipeline wrote nothing, so the region stays NULL and the next run
 * takes it: a soft result is right, and computeOneGroup tallying it as skipped
 * while the run reports Complete is right with it.
 *
 * There is no second kind of failure to tell it apart from. Marking the
 * ancestors stale runs inside the UPDATE itself, as a trigger, so it fails
 * only by failing the write (#680, ADR-0035); a statement of its own after
 * the commit could be lost on its own, leaving the region fine and the tree
 * above it silently wrong for good, and would have to be rethrown rather
 * than softened.
 */
function coreFailure(err: unknown, regionId: number, logPrefix: string): PipelineResult {
  const errorMessage = err instanceof Error ? err.message : String(err);
  // nosemgrep: javascript.lang.security.audit.unsafe-formatstring.unsafe-formatstring -- regionId is a number, and logPrefix is either the '[Compute]' default or computationProgress.ts's `[Geometry <n>/<m>]` built from two numbers; neither can hold a specifier
  console.error(`${logPrefix} Error computing region ${regionId}:`, errorMessage);
  return { computed: false, error: errorMessage };
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
  // `false` — snap — because that is what the endpoints' schemas default
  // to, and a callable whose absent option meant the opposite would be the one
  // place the rule is decided twice (#736). Today's only production caller
  // passes a value either way.
  const { skipSnapping = false, logPrefix = '[Compute]' } = options;
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

    // A hand-drawn boundary is the region's geometry: nothing computed from
    // its members may be written over it, whichever caller asks (#439).
    if (regionCheck.rows[0].is_custom_boundary) {
      log('Hand-drawn boundary - kept, nothing computed');
      return { computed: false, error: 'Region has a hand-drawn boundary, which is kept' };
    }

    log(`Starting computation for: ${regionName}`);

    // Set statement timeout
    await client.query(`SET statement_timeout = '${GEOMETRY_QUERY_TIMEOUT_MS}'`);

    // Get complexity info
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
    const childCount = parseInt(complexityCheck.rows[0]?.child_count || '0');
    const childRowCount = parseInt(complexityCheck.rows[0]?.child_row_count || '0');
    const memberCount = parseInt(complexityCheck.rows[0]?.member_count || '0');
    const totalPoints = memberPoints + childPoints;

    if (totalPoints === 0 && memberCount === 0 && childCount === 0) {
      await client.query('RESET statement_timeout');
      return { computed: false, error: 'No geometries to merge' };
    }

    const shouldSimplify = totalPoints > 300000;

    // computeSingleMemberFastPath docstring: eligibility rules, and why childRowCount (structural) not childCount (geometry-bearing).
    const fastResult = await computeSingleMemberFastPath(
      client, regionId, memberCount, childRowCount, log,
    );
    // The fast path marks the ancestors stale itself, since both callers
    // reach it and this one returns straight out of it (#667).
    if (fastResult) return fastResult;

    // Step 1: Collect all geometries
    log('Step 1: Collecting geometries...');
    const collected = await collectUnionInputs(client, regionId, shouldSimplify);

    let collectedGeom = collected.collectedGeom;
    const geomCount = collected.geomCount;

    if (!collectedGeom) {
      await client.query('RESET statement_timeout');
      return { computed: false, error: 'No geometries to merge' };
    }
    log(`Step 1: Collected ${geomCount} geometries`);

    // Step 2: Snap to neighbors (if not skipSnapping and has child regions)
    const hasChildRegions = childCount > 0;

    if (!skipSnapping && hasChildRegions) {
      log(`Step 2: Snapping ${childCount} child regions to neighbors...`);
      const snap = await snapChildRegionsForGroup(client, regionId, collectedGeom, collected.memberGeom);
      collectedGeom = snap.collectedGeom;
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

    // Step 4: Clean up - remove small holes and slivers, and nothing else:
    // regions.geom carries no tolerance of its own (rule 1, #443).
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
      )
      SELECT geom as cleaned_geom, ST_NPoints(geom) as num_points FROM collected
    `, [unionGeom]);

    const cleanedGeom = cleanedResult.rows[0]?.cleaned_geom;
    const numPoints = parseInt(cleanedResult.rows[0]?.num_points || '0');
    log(`Step 4: Cleaning complete (${numPoints} points)`);

    // Step 5: Save to database
    log('Step 5: Saving to database...');
    // The flag again at the write, for a boundary drawn while this ran (#439).
    const updateResult = await client.query(`
      UPDATE regions
      SET geom = validate_multipolygon($2)
      WHERE id = $1 AND is_custom_boundary IS NOT TRUE
      RETURNING ST_NPoints(geom) as points
    `, [regionId, cleanedGeom]);

    await client.query('RESET statement_timeout');
    if (updateResult.rows.length === 0) {
      log('Not saved - drawn by hand meanwhile');
      return { computed: false, error: 'Region was drawn by hand while it was computed; the drawing is kept' };
    }

    const points = updateResult.rows[0].points;
    log(`Complete! ${points} points`);

    return { computed: true, points };
  } catch (err) {
    try {
      await client.query('RESET statement_timeout');
    } catch { /* ignore */ }

    return coreFailure(err, regionId, logPrefix);
  } finally {
    client.release();
  }
}
