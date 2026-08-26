/**
 * Geometry CRUD operations for regions
 */

import { Request, Response } from 'express';
import { pool } from '../../db/index.js';
import { invalidateAncestorGeometry } from './helpers.js';

/**
 * The regions in scope, deepest first.
 *
 * Depth is what makes the recompute correct rather than merely ordered: a region
 * whose own union spans nearly every longitude takes focus_bbox from its children's
 * *stored* boxes, and rows written by one statement are not visible to a query inside
 * that statement's own row triggers. A single pass therefore aggregates the boxes as
 * they stood before it, leaving such a parent one generation behind whenever the same
 * run also moves one of its children. Migration 032 walks the levels for the same
 * reason.
 *
 * Both seeds -- the subtree's and the ancestor chain's -- are qualified by world
 * view as well as by id, so a region named from another world view matches nothing
 * and the run reports 0 rows rather than recomputing a hierarchy the URL never
 * named. Qualifying one seed is not enough: the chains are walked from two
 * independent starts, and the negative case returned the two ancestors with only
 * the first guarded. The recursive steps need no qualifier: parent_region_id
 * never crosses a world view.
 *
 * That is also why a scoped run reaches upwards. Naming one region and recomputing
 * only its subtree would leave the near-global ancestors above it holding a box built
 * from the values it just replaced -- Russia's eastern edge is exactly the Far Eastern
 * Federal District's, and Melanesia's is Fiji's. The migration needs no upward walk
 * because its selection predicate admits every such parent by construction; a subtree
 * has no equivalent property, so the ancestor chain is walked explicitly. It is walked
 * through rows without geometry as well, and those are dropped at the end rather than
 * in the recursion, so a parent whose own geometry was never computed does not cut the
 * chain above it.
 */
async function regionsInScopeByDepth(
  worldViewId: number,
  regionId: number | null,
): Promise<number[][]> {
  const { rows } = regionId
    ? await pool.query<{ id: number; depth: number }>(`
        WITH RECURSIVE descendants AS (
          SELECT id, parent_region_id, 0 AS depth FROM regions
          WHERE id = $1 AND world_view_id = $2
          UNION ALL
          SELECT r.id, r.parent_region_id, d.depth + 1 FROM regions r
          JOIN descendants d ON r.parent_region_id = d.id
        ),
        ancestors AS (
          SELECT p.id, p.parent_region_id, -1 AS depth FROM regions p
          JOIN regions self ON self.parent_region_id = p.id
          WHERE self.id = $1 AND self.world_view_id = $2
          UNION ALL
          SELECT p.id, p.parent_region_id, a.depth - 1 FROM regions p
          JOIN ancestors a ON a.parent_region_id = p.id
        ),
        scope AS (
          SELECT id, depth FROM descendants
          UNION ALL
          SELECT id, depth FROM ancestors
        )
        SELECT s.id, s.depth FROM scope s
        JOIN regions r ON r.id = s.id
        WHERE r.geom IS NOT NULL
        ORDER BY s.depth DESC
      `, [regionId, worldViewId])
    : await pool.query<{ id: number; depth: number }>(`
        WITH RECURSIVE region_depth AS (
          SELECT id, 0 AS depth FROM regions
          WHERE world_view_id = $1 AND parent_region_id IS NULL
          UNION ALL
          SELECT r.id, d.depth + 1 FROM regions r
          JOIN region_depth d ON r.parent_region_id = d.id
        )
        SELECT d.id, d.depth FROM region_depth d
        JOIN regions r ON r.id = d.id
        WHERE r.geom IS NOT NULL
        ORDER BY d.depth DESC
      `, [worldViewId]);

  const levels: number[][] = [];
  let currentDepth: number | null = null;
  for (const row of rows) {
    if (row.depth !== currentDepth) {
      levels.push([]);
      currentDepth = row.depth;
    }
    levels[levels.length - 1].push(row.id);
  }
  return levels;
}

/**
 * Regenerate metadata (anchor_point, focus_bbox, geom_area_km2) for all regions in a world view
 * Query params:
 * - regionId: optional - if provided, only regenerate for this region, its descendants,
 *   and the ancestors whose focus_bbox aggregates them
 *
 * anchor_point is written by trigger_update_region_focus_data, not here. Setting it
 * directly with generate_anchor_point() -- ST_PointOnSurface -- put a second, worse
 * answer in the column: for a region crossing the antimeridian the trigger's anchor is
 * the centre of the frame, and smartFitBounds reads it as the camera centre precisely
 * there, so overwriting it with a point on whichever component ST_PointOnSurface lands
 * in aims the map at one island of a region spread across the dateline. Kiribati is
 * ~4 000 km wide. The SET list named neither geom nor hull_geom, so the trigger did not
 * fire to correct it; touching hull_geom is the narrowest write that fires it (#666).
 */
export async function regenerateDisplayGeometries(req: Request, res: Response): Promise<void> {
  const worldViewId = parseInt(String(req.params.worldViewId));
  const regionId = req.query.regionId ? parseInt(String(req.query.regionId)) : null;

  console.log(`[Metadata] Regenerating metadata for worldView ${worldViewId}, regionId=${regionId}`);

  const levels = await regionsInScopeByDepth(worldViewId, regionId);
  let regeneratedCount = 0;

  for (const ids of levels) {
    const result = await pool.query(`
      UPDATE regions r
      SET
        hull_geom = r.hull_geom,
        geom_area_km2 = ST_Area(r.geom::geography) / 1000000
      WHERE r.id = ANY($1::int[])
      RETURNING r.id
    `, [ids]);
    regeneratedCount += result.rowCount ?? 0;
  }

  console.log(`[Metadata] Regenerated metadata for ${regeneratedCount} regions`);

  const response = {
    regenerated: regeneratedCount,
    message: `Regenerated metadata for ${regeneratedCount} region${regeneratedCount !== 1 ? 's' : ''}`,
  };
  res.json(response);
}


/**
 * Update a region's geometry (set custom boundary)
 * Optionally also updates the hull geometry
 * Also updates 3857 projections and simplified versions for vector tiles
 */
export async function updateRegionGeometry(req: Request, res: Response): Promise<void> {
  const regionId = parseInt(String(req.params.regionId));
  const { geometry, isCustomBoundary = true, hullGeometry } = req.body;

  if (!geometry) {
    res.status(400).json({ error: 'Geometry is required' });
    return;
  }

  // Build the update query dynamically based on whether hullGeometry is provided
  if (hullGeometry) {
    await pool.query(`
      UPDATE regions
      SET geom = validate_multipolygon(ST_GeomFromGeoJSON($1)),
          is_custom_boundary = $2,
          hull_geom = validate_multipolygon(ST_GeomFromGeoJSON($3))
      WHERE id = $4
    `, [JSON.stringify(geometry), isCustomBoundary, JSON.stringify(hullGeometry), regionId]);
  } else {
    await pool.query(`
      UPDATE regions
      SET geom = validate_multipolygon(ST_GeomFromGeoJSON($1)),
          is_custom_boundary = $2
      WHERE id = $3
    `, [JSON.stringify(geometry), isCustomBoundary, regionId]);
  }

  // A redraw moves this region's outline, so everything above it describes a
  // different world -- the case invalidateAncestorGeometry's unfiltered seed
  // term exists for, since the region redrawn is usually itself hand-drawn and
  // the walk has to continue past it. Nothing called it on this path before
  // (#667): every other caller is a member or structure edit.
  await invalidateAncestorGeometry(regionId);

  res.status(204).send();
}

/**
 * Reset a region's geometry to computed GADM boundaries
 * Clears custom boundary flag and recomputes from member divisions
 * Also updates 3857 projections and simplified versions for vector tiles
 */
export async function resetRegionToGADM(req: Request, res: Response): Promise<void> {
  const regionId = parseInt(String(req.params.regionId));

  console.log(`[ResetToGADM] Resetting region ${regionId} to GADM boundaries`);

  // First, clear the custom boundary flag and hull columns
  await pool.query(`
    UPDATE regions
    SET is_custom_boundary = false,
        hull_geom = NULL,
        hull_geom_3857 = NULL,
        hull_params = NULL
    WHERE id = $1
  `, [regionId]);

  // Now compute the geometry from member divisions and update all related columns
  const result = await pool.query(`
    WITH direct_member_geoms AS (
      SELECT ST_MakeValid(COALESCE(rm.custom_geom, ad.geom)) as geom
      FROM region_members rm
      JOIN administrative_divisions ad ON rm.division_id = ad.id
      WHERE rm.region_id = $1 AND (rm.custom_geom IS NOT NULL OR ad.geom IS NOT NULL)
    ),
    child_group_geoms AS (
      SELECT ST_MakeValid(geom) as geom
      FROM regions
      WHERE parent_region_id = $1 AND geom IS NOT NULL
    ),
    all_geoms AS (
      SELECT geom FROM direct_member_geoms WHERE geom IS NOT NULL
      UNION ALL
      SELECT geom FROM child_group_geoms WHERE geom IS NOT NULL
    ),
    merged AS (
      SELECT ST_Multi(ST_Union(geom)) as merged_geom
      FROM all_geoms
    )
    UPDATE regions r
    SET geom = validate_multipolygon(m.merged_geom)
    FROM merged m
    WHERE r.id = $1 AND m.merged_geom IS NOT NULL
    RETURNING ST_NPoints(r.geom) as points
  `, [regionId]);

  const points = result.rows[0]?.points || 0;

  // The strongest of the redraw cases: this both moves the shape and changes
  // where the upward walk stops. Before the reset the region was hand-drawn, so
  // the tree above it was out of reach by design; afterwards it is derived, its
  // outline differs, and it holds geometry with nothing NULL beneath it -- which
  // would put every ancestor outside the world-view run's closure for good
  // (#667).
  if (result.rows.length > 0) await invalidateAncestorGeometry(regionId);

  res.json({
    reset: true,
    points,
    message: 'Region reset to GADM boundaries',
  });
}
