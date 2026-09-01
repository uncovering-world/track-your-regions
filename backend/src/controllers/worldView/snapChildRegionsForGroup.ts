/**
 * Neighbor-snapping step for the union pipeline, shared by all three writers of
 * `regions.geom`: makes touching/near child region borders share vertices
 * before the union, so the merge has no slivers from mismatched boundary
 * points.
 *
 */

import { PoolClient } from 'pg';

export interface SnapStepOutcome {
  collectedGeom: unknown;
  totalAdded: number;
  snappedPoints: number;
  rowCount: number;
}

export async function snapChildRegionsForGroup(
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
      -- The collected geometry rides on one row. A scalar subquery is computed
      -- once, but its whole value lands in every DataRow the driver buffers,
      -- and this statement returns a row per child -- so a continent's union
      -- would cross the wire once per child, and the regions worth snapping
      -- are exactly the ones with the most (153 under New South Wales).
      CASE WHEN ROW_NUMBER() OVER () = 1 THEN (SELECT geom FROM collected) END as collected_geom,
      (SELECT total_points FROM totals) as total_snapped_points
    FROM with_new_points
    ORDER BY name
  `, [gId]);

  let totalAdded = 0;

  console.log(`[Snap] Snapping ${snapResult.rows.length} regions to neighbors:`);
  for (const row of snapResult.rows) {
    const neighbors = parseInt(row.neighbor_count);
    const added = parseInt(row.added_points);
    totalAdded += added;
    if (neighbors > 0) {
      console.log(`[Snap]   ${row.name}: ${row.original_points} -> ${row.new_points} pts (+${added}), ${neighbors} neighbors`);
    } else {
      console.log(`[Snap]   ${row.name}: ${row.original_points} pts, isolated`);
    }
  }

  // The row carrying the geometry is looked for rather than assumed to be the
  // first: the window that picks it and the ORDER BY that returns the rows are
  // two orderings, and nothing makes two children of one region share a name
  // impossible. A region whose children all lack geometry returns no rows at
  // all, and the geometry it came in with is what the caller unions.
  const carrying = snapResult.rows.find((row) => row.collected_geom !== null);

  return {
    collectedGeom: carrying?.collected_geom ?? initialGeom,
    totalAdded,
    snappedPoints: parseInt(carrying?.total_snapped_points ?? '0'),
    rowCount: snapResult.rows.length,
  };
}
