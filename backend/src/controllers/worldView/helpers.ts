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
 * A failed ancestor invalidation, wrapped so a caller can tell it apart from a
 * failure of its own pipeline.
 *
 * The two are opposite states and must not share an outcome. A pipeline that
 * fails wrote nothing, so the region stays NULL and the next run picks it up; an
 * invalidation that fails happens *after* the write committed, so the region is
 * fine and the tree above it is silently wrong for good. A blanket catch that
 * treated both as "skipped" would hand back precisely the state raising exists
 * to prevent -- with the run reporting Complete (#667).
 */
export class AncestorInvalidationFailed extends Error {
  constructor(regionId: number, override readonly cause: unknown) {
    super(`Ancestors of region ${regionId} could not be marked stale`);
    this.name = 'AncestorInvalidationFailed';
  }
}

/**
 * Clear cached geometry up the tree so the next run recomputes it from members:
 * the region's ancestors, and with `includeSelf` the region itself as well. The
 * two exported wrappers below are the two callers, and each says why it wants
 * its arm.
 *
 * Skips rows with is_custom_boundary = true: those geometries are user-drawn,
 * not derived from members, so member or structural changes must not silently
 * wipe them. The explicit way to drop a custom boundary is resetRegionToGADM
 * in geometryCompute.ts. (See #283: without this guard, calling addMembers
 * right after createRegion(customGeometry) clobbered the just-created custom
 * shape because the recursive CTE includes the starting region itself.)
 */
async function nullGeometryOf(
  regionId: number,
  includeSelf: boolean,
  label: string,
  swallowLockErrors: boolean,
): Promise<void> {
  // A code-chosen fragment, never a value: the recursive term walks upwards from
  // the region, so dropping the region itself is one comparison against the same
  // bound parameter.
  const selfClause = includeSelf ? '' : ' WHERE id <> $1';
  try {
    await pool.query(`
      WITH RECURSIVE ancestors AS (
        -- Start with the region itself, unfiltered: when it is itself a
        -- hand-drawn boundary the outer guard below is what protects it (#283),
        -- and the walk must still continue above it, because redrawing a shape
        -- by hand does leave everything over it describing a different world.
        SELECT id, parent_region_id FROM regions WHERE id = $1
        UNION ALL
        -- Recursively get all ancestors, stopping at the first hand-drawn one.
        -- Its outline is drawn rather than unioned from what is under it, so a
        -- descendant that gains geometry cannot have moved it -- and if it did
        -- not move, nothing above it did either. Walking through it would blank
        -- a correct continent until the next run rebuilt the identical shape.
        -- The same stop the run's own closure makes (loadGroupsToCompute).
        SELECT cg.id, cg.parent_region_id
        FROM regions cg
        JOIN ancestors a ON cg.id = a.parent_region_id
        WHERE cg.is_custom_boundary IS NOT TRUE
      )
      UPDATE regions
      SET geom = NULL,
          geom_3857 = NULL,
          geom_simplified_low = NULL,
          geom_simplified_medium = NULL
      WHERE id IN (SELECT id FROM ancestors${selfClause})
        AND is_custom_boundary IS NOT TRUE
    `, [regionId]);
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    const isLockError = errorMessage.includes('could not obtain lock') || errorMessage.includes('deadlock');
    // The split is by what a lost invalidation costs, not by compute versus
    // edit. Every caller of the ancestor arm has just committed a write to this
    // region's geom -- a union, a copied member, a hand-drawn shape, a reset --
    // and nothing on these paths opens a transaction, so that write stands
    // whatever happens here. Losing the invalidation therefore leaves the
    // ancestors stale against a child that has already changed, with nothing
    // NULL beneath them, outside every later run's closure: permanent, and
    // traced by a console.log while the run reports Complete.
    //
    // The region arm's callers wrote no geometry at all -- they changed members
    // or structure -- so its swallow is a tolerance inherited from #283's
    // concurrency handling rather than a proof of safety, and Catalogue Checks
    // is what watches it (parent-short-of-its-children). #680 removes the choice
    // by moving the invalidation to one enforcement point (#667).
    if (isLockError && swallowLockErrors) {
      console.log(`[${label}] Skipping region ${regionId} - already being updated by another operation`);
      return;
    }
    if (swallowLockErrors) throw err;
    throw new AncestorInvalidationFailed(regionId, err);
  }
}

/**
 * Mark a region's ancestors stale after its own geometry has been written.
 *
 * A parent's geometry is the union of its children, so a child that gains one
 * leaves every ancestor describing a smaller world than it contains. Nothing
 * did this before: the only thing a compute did to its parent was simplify the
 * siblings' coverage, so a child computed after its parent stayed outside the
 * parent's outline for good. Four of the eight top-level regions of the
 * Administrative world view were in that state -- North America drew Mexico and
 * the Caribbean, 18.3 % of what it holds -- because the import attached the
 * members of split countries three days after the continents were computed
 * (#667).
 *
 * Nulled rather than recomputed on the spot. Recomputing Asia is a hundred
 * seconds of union, and a curator who computed one Russian oblast would wait
 * for it; a nulled continent is not drawn until the next world-view run, which
 * computes it bottom-up along with everything else missing, and Catalogue
 * Checks reports the gap in the meantime (`region-without-geometry`). Loud and
 * absent beats quiet and wrong -- the same reasoning #459 applies to a failed
 * union.
 *
 * The region itself is left alone: it has just been computed and is correct.
 *
 * Also what a hand redraw calls -- updateRegionGeometry, resetRegionToGADM,
 * createRegion with a drawn shape -- since those write a region's geom too, and
 * the region they wrote is the one that must keep it.
 *
 * A lock or deadlock here is raised, not swallowed: every caller has already
 * committed its write, so a lost invalidation leaves the ancestors stale against
 * a child that has changed, with nothing NULL beneath them and nothing that ever
 * revisits them.
 */
export async function invalidateAncestorGeometry(regionId: number): Promise<void> {
  await nullGeometryOf(regionId, false, 'invalidateAncestorGeometry', false);
}

/**
 * Clear cached geometry for a region *and* all its ancestors, so the next render
 * recomputes them from members.
 *
 * What a member or structure edit calls: nothing wrote geometry, but what the
 * region's outline was derived from changed, so its own is as stale as
 * everything above it. Anything that has just *written* a geometry calls
 * invalidateAncestorGeometry instead -- the region it wrote is the one that must
 * keep what it was given.
 *
 * A lock or deadlock here is swallowed, on the reasoning that the operation
 * racing this one is another edit nulling the same rows. That is a tolerance
 * carried over from #283, not a guarantee: if it is wrong, the region and its
 * ancestors keep stale outlines and Catalogue Checks is what reports it
 * (`parent-short-of-its-children`). See #680.
 */
export async function invalidateRegionGeometry(regionId: number): Promise<void> {
  await nullGeometryOf(regionId, true, 'invalidateRegionGeometry', true);
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

  // The SSE stream calls this for every child that has no geometry, before
  // computing the region the curator actually asked for. That parent's own
  // union is the expensive one and the one that times out -- and if it does,
  // these child writes have already consumed the NULLs the run's closure seeds
  // on, leaving the parent stale and unreachable by any later run. Invalidating
  // from the writer, rather than from whichever caller happens to finish, is
  // what keeps that from depending on the parent succeeding (#667).
  if (result.rows.length > 0) await invalidateAncestorGeometry(regionId);

  return {
    computed: result.rows.length > 0,
    points: result.rows[0]?.points,
  };
}

