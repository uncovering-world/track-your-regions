/**
 * Where a region's union is made: a temporary table of the client's session,
 * one row per region in hand, that every step of the union pipeline reads and
 * rewrites in the database (#459). No geometry crosses to Node between steps.
 *
 * At full resolution a continent's inputs are millions of points, and a step
 * that handed its geometry back to Node, to be bound into the next statement,
 * received it as hex text: North America's collected inputs passed V8's
 * longest string (0x1fffffe8 characters) on 2026-10-18, inside the driver's
 * protocol parser, where nothing can catch it, and the dump worker died with
 * every build it ran. The steps now keep the geometry where it is computed,
 * and answer only counts.
 *
 * The collect step fills the row (`collectUnionInputs`), the neighbour snap
 * rewrites it (`snapChildRegionsForGroup`), the union and the cleaning below
 * rewrite it in turn, and each writer stores it into `regions.geom` with its
 * own statement, as the writers' lint requires, then drops the table
 * (`clearUnionWork`). A temporary table is never vacuumed, so a table kept on
 * a pooled connection would hold every dead version of every continent it
 * rewrote; dropping it frees them. A client a stop closes takes its table with
 * it, and a row some other failure leaves is overwritten by the next collect.
 */

import type { PoolClient } from 'pg';

/** The table, made once per connection: the region, its union's input or result, its members alone, and how many shapes it was collected from. */
export const UNION_WORK_TABLE = `CREATE TEMP TABLE IF NOT EXISTS union_work (
  region_id integer PRIMARY KEY,
  collected geometry,
  members geometry,
  geom_count integer NOT NULL DEFAULT 0
)`;

/** The row's geometry, as a statement on the region (`$1`) reads it. */
export const WORKED = '(SELECT collected FROM union_work WHERE region_id = $1)';

/** Union the collected inputs, in place. */
export async function unionCollected(client: PoolClient, regionId: number): Promise<void> {
  await client.query(
    'UPDATE union_work SET collected = ST_UnaryUnion(ST_MakeValid(collected)) WHERE region_id = $1',
    [regionId],
  );
}

/** What the inputs are made of, before the union: the shapes, their holes and their points. */
export async function analyzeUnionInputs(
  client: PoolClient, regionId: number,
): Promise<{ inputGeoms: number; inputHoles: number; inputPoints: number }> {
  const result = await client.query(`
    WITH dumped AS (
      SELECT (ST_Dump(${WORKED})).geom as geom
    )
    SELECT
      COUNT(*) as num_geoms,
      SUM(ST_NRings(geom) - 1) as total_holes,
      SUM(ST_NPoints(geom)) as total_points
    FROM dumped
    WHERE GeometryType(geom) IN ('POLYGON', 'MULTIPOLYGON')
  `, [regionId]);
  return {
    inputGeoms: parseInt(result.rows[0]?.num_geoms || '0'),
    inputHoles: parseInt(result.rows[0]?.total_holes || '0'),
    inputPoints: parseInt(result.rows[0]?.total_points || '0'),
  };
}

export interface CleanedUnionStats {
  holesBefore: number;
  numPolygons: number;
  numHoles: number;
  numPoints: number;
}

/**
 * Remove the union's small holes and slivers, in place, and nothing else: no
 * tolerance, since `regions.geom` is the source every derived column is made
 * from (rule 1 of `docs/tech/geometry-columns.md`, #443). A hole stays when it
 * is over 10 km² and compact (perimeter under 25 times the square root of its
 * area): a lake or an enclave, never a gap between two divisions.
 */
export async function cleanUnion(client: PoolClient, regionId: number): Promise<CleanedUnionStats> {
  const result = await client.query(`
    WITH extracted AS (
      SELECT ST_Multi(ST_CollectionExtract(ST_MakeValid(${WORKED}), 3)) as geom
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
    kept AS (
      UPDATE union_work SET collected = (SELECT geom FROM collected) WHERE region_id = $1 RETURNING 1
    )
    SELECT
      (SELECT SUM(ST_NumInteriorRings(poly)) FROM polygons) as holes_before,
      ST_NumGeometries(geom) as num_polygons,
      ST_NRings(geom) as num_rings,
      ST_NPoints(geom) as num_points,
      (SELECT COUNT(*) FROM kept) as kept
    FROM collected
  `, [regionId]);
  const row = result.rows[0];
  const numPolygons = parseInt(row?.num_polygons || '0');
  return {
    holesBefore: parseInt(row?.holes_before || '0'),
    numPolygons,
    numHoles: parseInt(row?.num_rings || '0') - numPolygons,
    numPoints: parseInt(row?.num_points || '0'),
  };
}

/** Drop the table and the dead versions its rewrites left, whatever the run's outcome. */
export async function clearUnionWork(client: PoolClient): Promise<void> {
  await client.query('DROP TABLE IF EXISTS pg_temp.union_work');
}
