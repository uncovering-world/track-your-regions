/**
 * Geometry read operations for regions
 */

import { Request, Response } from 'express';
import { respond } from '../../api/respond.js';
import { DisplayGeometryStatus } from '../../api/responses/geometry.js';
import { RegionGeometry } from '../../api/responses/regions.js';
import { pool } from '../../db/index.js';
import { regionGeometryOf, type RegionGeometryRow } from './regionGeometryAnswerRows.js';

/**
 * Get geometry status for a world view
 * Returns counts of regions with/without geometries
 */
export async function getDisplayGeometryStatus(req: Request, res: Response): Promise<void> {
  const worldViewId = parseInt(String(req.params.worldViewId));

  const result = await pool.query<{ total: number; with_geom: number; with_anchor: number; hull_regions: number; with_hull: number }>(`
    SELECT
      COUNT(*)::int as total,
      COUNT(CASE WHEN geom IS NOT NULL THEN 1 END)::int as with_geom,
      COUNT(CASE WHEN anchor_point IS NOT NULL THEN 1 END)::int as with_anchor,
      COUNT(CASE WHEN uses_hull = true THEN 1 END)::int as hull_regions,
      COUNT(CASE WHEN hull_geom IS NOT NULL THEN 1 END)::int as with_hull
    FROM regions
    WHERE world_view_id = $1
  `, [worldViewId]);

  const row = result.rows[0];
  respond(res, DisplayGeometryStatus, {
    total: row.total,
    withGeom: row.with_geom,
    withAnchor: row.with_anchor,
    hullRegions: row.hull_regions,
    withHull: row.with_hull,
  });
}

/**
 * Get geometry for a region
 * Query params:
 * - detail: 'high' (the stored outline, the default) or 'hull' (the hull, where
 *   the region has one, with whether it crosses the antimeridian)
 * Returns the stored geometry if it exists, otherwise 204 No Content.
 * Does NOT auto-compute geometry - use computeWorldViewGeometries for that
 */
export async function getRegionGeometry(req: Request, res: Response): Promise<void> {
  const regionId = parseInt(String(req.params.regionId));
  const wantsHull = req.query.detail === 'hull';

  // The hull, and whether it crosses the dateline, come in the same read. That
  // is read off focus_bbox -- west > east -- which the trigger computed from
  // this same hull by the one rule (#674).
  const result = await pool.query<RegionGeometryRow>(
    `SELECT
       ST_AsGeoJSON(geom)::json AS geometry,
       CASE WHEN $2 THEN ST_AsGeoJSON(hull_geom)::json END AS hull_geometry,
       focus_bbox[1] > focus_bbox[3] AS crosses_dateline,
       is_custom_boundary, uses_hull,
       ST_X(anchor_point) AS anchor_lng, ST_Y(anchor_point) AS anchor_lat
     FROM regions
     WHERE id = $1 AND geom IS NOT NULL`,
    [regionId, wantsHull],
  );

  if (result.rows.length === 0) {
    // No geometry computed yet
    res.status(204).send();
    return;
  }

  respond(res, RegionGeometry, regionGeometryOf(regionId, result.rows[0], wantsHull));
}

