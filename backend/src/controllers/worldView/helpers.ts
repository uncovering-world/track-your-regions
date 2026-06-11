/**
 * Helper functions for World View controllers
 */

import { pool } from '../../db/index.js';
import { touchWorkUnitForRegion } from '../../services/worldViewImport/workUnits.js';

/**
 * Insert into region_members for the (region_id, division_id) pair without a
 * custom geometry, ignoring conflicts with an existing row. Race-safe: relies
 * on the partial unique index `idx_region_members_unique_no_custom`
 * (see db/init/01-schema.sql) so concurrent callers can't double-insert.
 */
export async function ensureRegionMember(regionId: number, divisionId: number): Promise<void> {
  // Explicit arbiter pins the dedupe to the partial unique index. A bare
  // `ON CONFLICT DO NOTHING` works today, but only because the partial index
  // happens to be the only unique constraint on this table; pinning the
  // arbiter prevents a future unique constraint from silently changing what
  // counts as a duplicate.
  await pool.query(
    `INSERT INTO region_members (region_id, division_id) VALUES ($1, $2)
     ON CONFLICT (region_id, division_id) WHERE custom_geom IS NULL DO NOTHING`,
    [regionId, divisionId],
  );
}

/**
 * Clear cached geometry for a region and all its ancestors so the next render
 * recomputes them from members.
 *
 * Skips rows with is_custom_boundary = true: those geometries are user-drawn,
 * not derived from members, so member or structural changes must not silently
 * wipe them. The explicit way to drop a custom boundary is resetRegionToGADM
 * in geometryCompute.ts. (See #283: without this guard, calling addMembers
 * right after createRegion(customGeometry) clobbered the just-created custom
 * shape because the recursive CTE includes the starting region itself.)
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
          geom_simplified_medium = NULL
      WHERE id IN (SELECT id FROM ancestors)
        AND is_custom_boundary IS NOT TRUE
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
 * Sync match_status in region_import_state after member changes.
 *
 * When members are added/removed via the Editor, the match_status
 * must reflect the actual state of region_members:
 * - Has members → 'manual_matched'
 * - No members, has suggestions → 'needs_review'
 * - No members, no suggestions → 'no_candidates'
 *
 * No-op for non-imported regions (no row in region_import_state) for
 * the match-status logic, but the work-unit touch ALWAYS fires first so
 * editor-created subregions without an import-state row still stale the
 * owning unit (member-driven changes that flow through this helper;
 * inline-SQL paths call touchWorkUnitForRegion directly).
 */
export async function syncImportMatchStatus(regionId: number): Promise<void> {
  // Workflow staleness: touch the owning work unit BEFORE the early return so
  // editor-created subregions (no region_import_state row) still stale the unit.
  await touchWorkUnitForRegion(regionId);

  // Check if this is an imported region
  const risResult = await pool.query(
    `SELECT match_status FROM region_import_state WHERE region_id = $1`,
    [regionId]
  );
  if (risResult.rows.length === 0) return;

  const currentStatus = risResult.rows[0].match_status as string;

  const countResult = await pool.query(
    'SELECT COUNT(*) FROM region_members WHERE region_id = $1',
    [regionId]
  );
  const memberCount = parseInt(countResult.rows[0].count as string);

  let newStatus: string;
  if (memberCount > 0) {
    newStatus = 'manual_matched';
  } else {
    const suggestionCount = await pool.query(
      'SELECT COUNT(*) FROM region_match_suggestions WHERE region_id = $1 AND rejected = false',
      [regionId]
    );
    const hasSuggestions = parseInt(suggestionCount.rows[0].count as string) > 0;
    newStatus = hasSuggestions ? 'needs_review' : 'no_candidates';
  }

  if (currentStatus !== newStatus) {
    await pool.query(
      `UPDATE region_import_state SET match_status = $1 WHERE region_id = $2`,
      [newStatus, regionId]
    );
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
    SET geom = validate_multipolygon(m.merged_geom)
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

