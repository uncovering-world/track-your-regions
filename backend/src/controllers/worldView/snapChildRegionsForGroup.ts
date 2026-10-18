/**
 * Neighbor-snapping step for the union pipeline, shared by the writers of
 * `regions.geom`: makes touching/near child region borders share vertices
 * before the union, so the merge has no slivers from mismatched boundary
 * points.
 *
 * What it snaps is the children, and only the children — that is the whole of
 * its job. What it *returns* is the union's input, which is a different thing:
 * the collect step gathered the region's direct members too, and a snap that
 * handed back the children alone dropped their territory, since every caller
 * assigns the result over the collected geometry. Andorra stored 439.3 km² of
 * its member division's 451.1 that way, and North America's member held
 * 9,843,418 km² — Canada — that no child of it held, because Canada's own
 * region row had no geometry yet (#736). So the members are collected back out
 * with the snapped children, untouched: snapping aligns borders, it does not
 * decide which inputs the union is made of.
 *
 * The members are read from the region's `union_work` row rather than from
 * `region_members` here, so the union is made of the very shapes the collect
 * step gathered (`collectUnionInputs`), read once; and the result is written
 * back into that row, never handed to Node (`unionWork.ts`).
 */

import type { PoolClient } from 'pg';

export interface SnapStepOutcome {
  totalAdded: number;
  snappedPoints: number;
  rowCount: number;
}

export async function snapChildRegionsForGroup(
  client: PoolClient,
  gId: number,
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
    -- The region's direct members join the snapped children here, so what the
    -- caller unions is everything the collect step gathered. They are added
    -- as one more row of the same aggregate rather than collected onto the
    -- result, which keeps the shape identical to the collect step's own.
    members AS (
      SELECT members AS geom FROM union_work WHERE region_id = $1
    ),
    collected AS (
      SELECT ST_Collect(geom) as geom
      FROM (
        SELECT geom FROM with_new_points
        UNION ALL
        SELECT geom FROM members
      ) union_inputs
      WHERE geom IS NOT NULL
    ),
    totals AS (
      SELECT SUM(new_points) + COALESCE((SELECT ST_NPoints(geom) FROM members), 0) as total_points
      FROM with_new_points
    ),
    -- The snapped children and the members replace the union's input in the
    -- region's row. A region whose children all lack geometry snaps nothing,
    -- and its row keeps what the collect step gathered.
    kept AS (
      UPDATE union_work SET collected = (SELECT geom FROM collected)
       WHERE region_id = $1 AND EXISTS (SELECT 1 FROM with_new_points)
      RETURNING 1
    )
    SELECT
      id, name, neighbor_count, original_points, new_points,
      new_points - original_points as added_points,
      (SELECT total_points FROM totals) as total_snapped_points,
      (SELECT COUNT(*) FROM kept) as kept
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

  return {
    totalAdded,
    snappedPoints: parseInt(snapResult.rows[0]?.total_snapped_points ?? '0'),
    rowCount: snapResult.rows.length,
  };
}
