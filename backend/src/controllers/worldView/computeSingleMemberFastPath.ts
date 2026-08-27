/**
 * Fast path for computing a region's geometry when it is exactly one division.
 */

import { PoolClient } from 'pg';

/**
 * Fast path for a region that is exactly one division: with no children and no
 * hand-drawn boundary, the region's member geometry already *is* the region's
 * answer, so this path stores it as-is, deliberately — it is not a cheaper
 * reproduction of what the normal union path would produce.
 *
 * The normal path always runs small-hole/sliver removal and
 * `ST_SimplifyPreserveTopology(geom, 0.0001)` before saving, and — when
 * `shouldSimplify` (`totalPoints > 300000`) trips — pre-simplifies at 0.005
 * before the union on top of that. `shouldSimplify` does not govern this
 * branch at all: running the one member through either simplification step
 * would only degrade a geometry that is already correct, so this path skips
 * both rather than reproducing them. This is the shape of every matched leaf
 * in a base-layer mirror as well as a large share of any 1:1 import match.
 *
 * `childRowCount` must be a structural count — ALL rows in `regions` with
 * `parent_region_id = regionId`, with no `geom IS NOT NULL` filter. It is not
 * the geometry-bearing child count the caller also computes for its point
 * totals and snapping step: a child that exists but whose geometry hasn't
 * been computed yet still makes this region ineligible for the fast path,
 * even though it contributes nothing to that geometry-bearing count. Passing
 * the geometry-bearing count here would let the fast path fire for a region
 * that structurally has children, silently dropping them from the result.
 *
 * Returns null when the region isn't eligible (has children, has several
 * members, or has a hand-drawn boundary) or when there is nothing to copy
 * (member geometry is NULL), so the caller falls through to the normal union
 * path.
 */
export async function computeSingleMemberFastPath(
  client: PoolClient,
  regionId: number,
  memberCount: number,
  childRowCount: number,
  isCustomBoundary: boolean,
  log: (msg: string) => void,
): Promise<{ computed: true; points: number } | null> {
  if (memberCount !== 1 || childRowCount !== 0 || isCustomBoundary === true) {
    return null;
  }

  const copied = await client.query(`
    UPDATE regions r
    -- Unconditionally, exactly as the normal path's two write sites do
    -- (geometryComputeSingle.ts, geometryComputeSSE.ts). Branching on
    -- ST_IsValid first would skip validate_multipolygon's empty-geometry rule
    -- (empty -> NULL) for a geometry that is valid but empty, making this path
    -- disagree with the normal one on that input. It buys nothing either way:
    -- the CASE pays for the validity check that ST_MakeValid performs anyway.
    SET geom = validate_multipolygon(COALESCE(rm.custom_geom, ad.geom))
    FROM region_members rm
    JOIN administrative_divisions ad ON ad.id = rm.division_id
    WHERE rm.region_id = r.id
      AND r.id = $1
      AND COALESCE(rm.custom_geom, ad.geom) IS NOT NULL
    RETURNING ST_NPoints(r.geom) AS points
  `, [regionId]);

  if (!copied.rowCount) {
    // Nothing copied (member geometry is NULL) — fall through to the normal path.
    return null;
  }

  await client.query('RESET statement_timeout');

  const points = Number(copied.rows[0].points);
  log(`Single-member fast path: copied ${points} points`);
  return { computed: true, points };
}
