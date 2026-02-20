/**
 * Geometry CRUD operations for regions
 */

import { Request, Response } from 'express';
import { pool } from '../../db/index.js';

/**
 * Regenerate metadata (anchor_point, geom_area_km2) for all regions in a world view
 * Query params:
 * - regionId: optional - if provided, only regenerate for this region and its descendants
 */
export async function regenerateDisplayGeometries(req: Request, res: Response): Promise<void> {
  const worldViewId = parseInt(String(req.params.worldViewId));
  const regionId = req.query.regionId ? parseInt(String(req.query.regionId)) : null;

  console.log(`[Metadata] Regenerating metadata for worldView ${worldViewId}, regionId=${regionId}`);

  let result;

  if (regionId) {
    // Regenerate for specific region and all its descendants
    result = await pool.query(`
      WITH RECURSIVE descendants AS (
        SELECT id FROM regions WHERE id = $1
        UNION ALL
        SELECT r.id FROM regions r
        JOIN descendants d ON r.parent_region_id = d.id
      )
      UPDATE regions r
      SET
        anchor_point = generate_anchor_point(r.geom),
        geom_area_km2 = ST_Area(r.geom::geography) / 1000000
      WHERE r.id IN (SELECT id FROM descendants) AND r.geom IS NOT NULL
      RETURNING r.id
    `, [regionId]);
  } else {
    // Regenerate metadata for all regions with geom
    result = await pool.query(`
      UPDATE regions r
      SET
        anchor_point = generate_anchor_point(r.geom),
        geom_area_km2 = ST_Area(r.geom::geography) / 1000000
      WHERE r.world_view_id = $1 AND r.geom IS NOT NULL
      RETURNING r.id
    `, [worldViewId]);
  }

  const regeneratedCount = result.rowCount ?? 0;
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
  // Support both new (regionId) and legacy (groupId) param names
  const regionId = parseInt(String(req.params.regionId || req.params.groupId));
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

  res.status(204).send();
}

/**
 * Reset a region's geometry to computed GADM boundaries
 * Clears custom boundary flag and recomputes from member divisions
 * Also updates 3857 projections and simplified versions for vector tiles
 */
export async function resetRegionToGADM(req: Request, res: Response): Promise<void> {
  const regionId = parseInt(String(req.params.regionId || req.params.groupId));

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

  res.json({
    reset: true,
    points,
    message: 'Region reset to GADM boundaries',
  });
}
