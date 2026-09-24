/**
 * Helper functions for World View controllers
 */

import { pool } from '../../db/index.js';
import type { PoolClient } from 'pg';

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
 * Move every member row of one region to another, each row as it is (#384).
 *
 * A row is what a curator made it: a whole division, or a cut part with its
 * `custom_geom` and `custom_name` — the west of Russia, the Keys of Monroe
 * County. Moving the row itself keeps that part, and keeps two parts of one
 * division as two rows; every row the target already holds stays. The one
 * row that cannot move is a whole division the target already holds whole,
 * which `idx_region_members_unique_no_custom` refuses a second time; it adds
 * nothing to the target's coverage, so it is dropped.
 *
 * `db` is the pool or the caller's transaction client. Answers how many rows
 * moved.
 */
export async function moveMembersToRegion(
  db: Pick<PoolClient, 'query'>,
  fromRegionId: number,
  toRegionId: number,
): Promise<number> {
  await db.query(
    `DELETE FROM region_members m
     WHERE m.region_id = $1 AND m.custom_geom IS NULL
       AND EXISTS (
         SELECT 1 FROM region_members t
         WHERE t.region_id = $2 AND t.division_id = m.division_id AND t.custom_geom IS NULL
       )`,
    [fromRegionId, toRegionId],
  );
  const moved = await db.query(
    'UPDATE region_members SET region_id = $2 WHERE region_id = $1',
    [fromRegionId, toRegionId],
  );
  return moved.rowCount ?? 0;
}

/**
 * Clear a region's own cached geometry, so the next world-view run recomputes
 * it — for a *structural* change, the one kind the database cannot see.
 *
 * A member edit needs no call: a write to region_members clears the regions
 * whose union it changed, in the same statement (ADR-0068). A region changing
 * parents, or a branch deleted, writes neither a member nor a geometry while
 * changing what a parent's union holds — one loses a child, another gains it —
 * so the writer names those parents itself: updateRegion and deleteRegion here,
 * and the import review's reparent, merge, remove, dismiss, prune and smart
 * flatten. A parent's union holds a hand-drawn child too, since it collects
 * every child that has geometry, so relying on the moved region's own row to
 * reach its parent would fail for a drawn one.
 *
 * The walk upward is not here. Nulling geom is itself a write to regions.geom,
 * so trg_regions_geom_invalidates_parent carries it to the derived ancestors,
 * inside this statement (ADR-0035).
 *
 * Skips a hand-drawn boundary (is_custom_boundary): its shape is drawn, not
 * derived, and resetRegionToGADM is the explicit way to drop it (#283).
 *
 * `db` is the caller's transaction client where it has one, so the clearing
 * commits or rolls back with the change it answers for (#1026). There a lock
 * or deadlock is not swallowed: it has aborted the transaction, and the
 * operation fails whole. On the pool — a writer with no transaction — it is
 * swallowed, the tolerance carried from #283: what races an edit is usually
 * another edit clearing the same rows, and if not, Catalogue Checks reports
 * the stale outline (`parent-short-of-its-children`).
 */
export async function invalidateRegionGeometry(
  regionId: number,
  db: Pick<PoolClient, 'query'> = pool,
): Promise<void> {
  try {
    await db.query(`
      UPDATE regions
      SET geom = NULL,
          geom_3857 = NULL,
          geom_simplified_low = NULL,
          geom_simplified_medium = NULL
      WHERE id = $1
        AND is_custom_boundary IS NOT TRUE
    `, [regionId]);
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    const isLockError = errorMessage.includes('could not obtain lock') || errorMessage.includes('deadlock');
    if (isLockError && db === pool) {
      console.log(`[invalidateRegionGeometry] Skipping region ${regionId} - already being updated by another operation`);
      return;
    }
    throw err;
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
 * No-op for non-imported regions (no row in region_import_state).
 */
export async function syncImportMatchStatus(regionId: number): Promise<void> {
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
 * Recompute geometry for a single region from its members and children.
 *
 * Recomputes exactly one region -- it does not walk down to descendants that
 * have none -- but it does mark the tree above the region stale once it has
 * written, the way every other writer of `regions.geom` does (#667). A caller
 * reaching for this expecting a purely local effect will find the branch above
 * the target blank until the next world-view run recomputes it bottom-up.
 *
 * Skips regions with is_custom_boundary = true.
 * Also updates 3857 projections and simplified versions for vector tiles.
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

