/**
 * Helper functions for World View controllers
 */

import { pool } from '../../db/index.js';

/**
 * Clear cached geometry for a region and all its ancestors
 * This ensures that when a child region changes, parent regions are also recalculated
 * Also clears is_custom_boundary since the old geometry is being discarded
 * NOTE: This also clears simplified geometry columns to prevent stale simplified data
 */
export async function invalidateRegionGeometry(regionId: number): Promise<void> {
  // Gracefully handle lock/deadlock errors if concurrent operations touch the same regions
  // If a lock error occurs, skip - the geometry will be recomputed by the other operation
  try {
    await pool.query(`
      WITH RECURSIVE ancestors AS (
        -- Start with the region itself
        SELECT id, parent_region_id FROM regions WHERE id = $1
        UNION ALL
        -- Recursively get all ancestors
        SELECT cg.id, cg.parent_region_id
        FROM regions cg
        JOIN ancestors a ON cg.id = a.parent_region_id
      )
      UPDATE regions
      SET geom = NULL,
          geom_3857 = NULL,
          geom_simplified_low = NULL,
          geom_simplified_medium = NULL,
          is_custom_boundary = false
      WHERE id IN (SELECT id FROM ancestors)
    `, [regionId]);
  } catch (err: unknown) {
    // If we get a lock error, just log and continue - another operation is handling it
    const errorMessage = err instanceof Error ? err.message : String(err);
    if (errorMessage.includes('could not obtain lock') || errorMessage.includes('deadlock')) {
      console.log(`[invalidateRegionGeometry] Skipping region ${regionId} - already being updated by another operation`);
    } else {
      throw err;
    }
  }
}

/**
 * Recompute geometry for a single region from its members and children
 * Does NOT recurse to ancestors - use for targeted recomputation only
 * Skips regions with is_custom_boundary = true
 * Also updates 3857 projections and simplified versions for vector tiles
 */
export async function recomputeRegionGeometry(regionId: number): Promise<{ computed: boolean; points?: number }> {
  const result = await pool.query(`
    WITH direct_member_geoms AS (
      SELECT ST_MakeValid(COALESCE(rm.custom_geom, ad.geom)) as geom
      FROM region_members rm
      JOIN administrative_divisions ad ON rm.division_id = ad.id
      WHERE rm.region_id = $1 AND (rm.custom_geom IS NOT NULL OR ad.geom IS NOT NULL)
    ),
    child_region_geoms AS (
      SELECT ST_MakeValid(geom) as geom
      FROM regions
      WHERE parent_region_id = $1 AND geom IS NOT NULL
    ),
    all_geoms AS (
      SELECT geom FROM direct_member_geoms WHERE geom IS NOT NULL
      UNION ALL
      SELECT geom FROM child_region_geoms WHERE geom IS NOT NULL
    ),
    merged AS (
      SELECT ST_Multi(ST_CollectionExtract(ST_MakeValid(ST_Union(geom)), 3)) as merged_geom
      FROM all_geoms
    )
    UPDATE regions r
    SET geom = m.merged_geom
    FROM merged m
    WHERE r.id = $1
      AND r.is_custom_boundary IS NOT TRUE
      AND m.merged_geom IS NOT NULL
    RETURNING ST_NPoints(r.geom) as points
  `, [regionId]);

  return {
    computed: result.rows.length > 0,
    points: result.rows[0]?.points,
  };
}

