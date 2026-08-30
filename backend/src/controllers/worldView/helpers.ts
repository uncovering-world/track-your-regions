/**
 * Helper functions for World View controllers
 */

import { pool } from '../../db/index.js';

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
 * Clear a region's own cached geometry, so the next world-view run recomputes
 * it from its members.
 *
 * What a member or structure edit calls: nothing wrote a geometry, but what
 * this region's outline is derived from changed, so its own is stale. Anything
 * that has just *written* a geometry calls nothing at all -- the region it
 * wrote is the one that must keep what it was given.
 *
 * The walk upward is not here. Nulling geom is itself a write to regions.geom,
 * so trg_regions_geom_invalidates_parent fires and marks the derived ancestors
 * stale, one level per firing, up to the root -- inside this statement, where
 * no writer can forget it and where it cannot fail on its own (ADR-0035).
 * Until #680 this function walked a recursive CTE and every writer of geom
 * called a second one by hand; the review of #679 found seven writers that had
 * been missed, one round at a time, and each miss was permanent -- the parent
 * kept a stale outline with nothing NULL beneath it and fell outside every
 * later run's closure, while the run reported Complete (#667).
 *
 * Skips rows with is_custom_boundary = true: those geometries are user-drawn,
 * not derived from members, so member or structural changes must not silently
 * wipe them. The explicit way to drop a custom boundary is resetRegionToGADM
 * in geometryCompute.ts. (See #283: without this guard, calling addMembers
 * right after createRegion(customGeometry) clobbered the just-created custom
 * shape.) For a *member* edit nothing above one moves either, since no row is
 * written and the trigger therefore never fires -- the same stop
 * loadGroupsToCompute makes on both arms of its closure, and the truth on the
 * ground: editing what a drawn region contains does not move the line somebody
 * drew, so the union above it is unchanged.
 *
 * **A structural move is the exception, and has to name its rows itself.** A
 * region changing parents writes no geometry while changing two unions -- one
 * parent loses a child, the other gains it -- and a parent's union does hold a
 * hand-drawn child, since it collects every child that has geometry and filters
 * none out. So updateRegion calls this for the moved region *and* both parents,
 * and deleteRegion calls it for the departed region's parent, a DELETE firing
 * no trigger on geom either. Relying on the moved region's own call to reach
 * the new parent works only while that call writes a row, which for a drawn
 * region it does not.
 *
 * The World View Editor's two are not the whole set. The import-review tree
 * operations move and delete regions too, and called nothing at all until #496:
 * reparentRegion, mergeChildIntoParent, removeRegionFromImport, dismissChildren,
 * pruneToLeaves and smartFlatten, the last of which the issue's own list did not
 * have. Each now names the rows whose union it changed and no others -- the
 * ancestors above them are the trigger's. Their undo paths name nothing, and
 * are right not to: every region they recreate arrives with geom NULL, which is
 * what seeds the run's closure, so the tree above it is recomputed without
 * anybody asking.
 *
 * What is still open there is the *member* half, #718: a dozen import-review
 * routes rewrite region_members *without* moving or deleting a region --
 * accepting a match, clearing members, resolving an overlap, collapsing a
 * parent -- and not one of them calls this, leaving a region drawing divisions
 * it no longer holds. The three handlers above that move members as part of a
 * structural change are covered by the call they already make. Same permanence,
 * and the same "harmless until Compute Geometries runs" that made #496 easy to
 * miss.
 *
 * A lock or deadlock is swallowed, on the reasoning that what races a member
 * edit is another edit nulling the same rows. That is a tolerance carried over
 * from #283 rather than a guarantee: if it is wrong the region keeps a stale
 * outline and Catalogue Checks is what reports it
 * (`parent-short-of-its-children`). The statement addresses one row by primary
 * key, but it is not one row's worth of locking: the trigger cascade takes each
 * derived ancestor in turn inside the same statement, so a lock swallowed here
 * may be one of theirs.
 */
export async function invalidateRegionGeometry(regionId: number): Promise<void> {
  try {
    await pool.query(`
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
    if (isLockError) {
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

