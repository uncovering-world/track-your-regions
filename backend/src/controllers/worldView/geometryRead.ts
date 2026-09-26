/**
 * Geometry read operations for regions
 */

import type { z } from 'zod/v4';
import { NO_CONTENT } from '../../api/route.js';
import type { DisplayGeometryStatus } from '../../api/responses/geometry.js';
import type { RegionGeometry } from '../../api/responses/regions.js';
import type { regionGeometryDetailQuerySchema, regionIdParamSchema, worldViewIdParamSchema } from '../../types/index.js';
import { pool } from '../../db/index.js';
import { regionGeometryOf, type RegionGeometryRow } from './regionGeometryAnswerRows.js';

/**
 * Get geometry status for a world view
 * Returns counts of regions with/without geometries
 */
export async function getDisplayGeometryStatus(
  { params: { worldViewId } }: { params: z.output<typeof worldViewIdParamSchema> },
): Promise<DisplayGeometryStatus> {
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
  return {
    total: row.total,
    withGeom: row.with_geom,
    withAnchor: row.with_anchor,
    hullRegions: row.hull_regions,
    withHull: row.with_hull,
  };
}

/**
 * Get geometry for a region
 * Query params:
 * - detail: 'high' (the stored outline, the default) or 'hull' (the hull, where
 *   the region has one, with whether it crosses the antimeridian)
 * Returns the stored geometry if it exists, otherwise 204 No Content.
 * Does NOT auto-compute geometry - use computeWorldViewGeometries for that
 */
export async function getRegionGeometry(
  { params: { regionId }, query: { detail } }: {
    params: z.output<typeof regionIdParamSchema>;
    query: z.output<typeof regionGeometryDetailQuerySchema>;
  },
): Promise<RegionGeometry | typeof NO_CONTENT> {
  const wantsHull = detail === 'hull';

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

  // No geometry computed yet
  if (result.rows.length === 0) return NO_CONTENT;

  return regionGeometryOf(regionId, result.rows[0], wantsHull);
}

