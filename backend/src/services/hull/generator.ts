/**
 * Hull generation and database operations
 */

import { pool } from '../../db/index.js';
import * as turf from '@turf/turf';
import type {
  HullParams,
  Point,
  RegionData,
  GenerateSingleHullResult,
  PreviewHullResult,
} from './types.js';
import { DEFAULT_HULL_PARAMS } from './types.js';
import { generateHullFromPoints } from './hullCalculator.js';

/**
 * Fetch region points from database for hull generation.
 * Priority:
 * 1. If region has is_custom_boundary = true, use regions.geom (user drew custom boundary)
 * 2. If region_members have custom_geom, use those
 * 3. Otherwise use GADM geom from administrative_divisions
 * 4. Fallback to regions.geom if no members
 */
async function fetchRegionPoints(regionId: number): Promise<RegionData | null> {
  // Whether the hull has to be split at the dateline is measured over the very
  // points it is built from, by geometry_focus() in the same query -- not read
  // off regions.focus_bbox, which describes COALESCE(hull_geom, geom): after a
  // member change invalidateRegionGeometry() clears geom but not hull_geom, so
  // that box would describe the previous hull until the geometry is recomputed,
  // and the two hull endpoints run with no recompute in front of them (#674).
  const result = await pool.query(`
    SELECT
      r.id,
      r.name,
      r.uses_hull,
      r.is_custom_boundary,
      r.hull_params,
      pts.points,
      (SELECT f.west > f.east FROM geometry_focus(pts.collected) f) AS crosses_dateline
    FROM regions r
    CROSS JOIN LATERAL (
        SELECT
          json_agg(json_build_object('lng', ST_X(pt.geom), 'lat', ST_Y(pt.geom))) AS points,
          ST_Collect(pt.geom) AS collected
        FROM (
          -- If is_custom_boundary, use region's own geometry (user-drawn)
          SELECT ST_PointOnSurface((dump.geom)) as geom
          FROM ST_Dump(r.geom) as dump
          WHERE r.is_custom_boundary = true
            AND GeometryType(dump.geom) IN ('POLYGON', 'MULTIPOLYGON')
          UNION ALL
          -- Otherwise try to get points from region_members (with custom_geom support)
          SELECT ST_PointOnSurface((dump.geom)) as geom
          FROM region_members rm
          JOIN administrative_divisions ad ON rm.division_id = ad.id
          CROSS JOIN LATERAL ST_Dump(COALESCE(rm.custom_geom, ad.geom)) as dump
          WHERE r.is_custom_boundary = false
            AND rm.region_id = r.id
            AND GeometryType(dump.geom) IN ('POLYGON', 'MULTIPOLYGON')
          UNION ALL
          -- Fallback to region's own geometry if no members and not custom boundary
          SELECT ST_PointOnSurface((dump.geom)) as geom
          FROM ST_Dump(r.geom) as dump
          WHERE r.is_custom_boundary = false
            AND NOT EXISTS (SELECT 1 FROM region_members WHERE region_id = r.id)
            AND GeometryType(dump.geom) IN ('POLYGON', 'MULTIPOLYGON')
        ) pt
        WHERE pt.geom IS NOT NULL
    ) pts
    WHERE r.id = $1
  `, [regionId]);

  if (result.rows.length === 0) {
    return null;
  }

  const row = result.rows[0];

  // Parse saved hull params if available
  let savedHullParams: HullParams | null = null;
  if (row.hull_params) {
    try {
      savedHullParams = row.hull_params as HullParams;
    } catch {
      savedHullParams = null;
    }
  }

  return {
    points: (row.points || []) as Point[],
    usesHull: row.uses_hull,
    name: row.name,
    savedHullParams,
    crossesDateline: row.crosses_dateline === true,
  };
}

/**
 * Save hull geometry and params to database
 * Also updates 3857 projections and simplified versions for vector tiles
 */
async function saveHullGeometry(regionId: number, geometry: GeoJSON.Geometry, params: HullParams): Promise<void> {
  const geojson = JSON.stringify(geometry);
  const paramsJson = JSON.stringify(params);
  await pool.query(`
    UPDATE regions
    SET hull_geom = validate_multipolygon(ST_GeomFromGeoJSON($1)),
        hull_params = $2::jsonb
    WHERE id = $3
  `, [geojson, paramsJson, regionId]);
}

/**
 * Generate and save hull for a single region
 */
export async function generateSingleHull(
  regionId: number,
  params?: HullParams | null,
  useSavedParams: boolean = true
): Promise<GenerateSingleHullResult> {
  console.log(`[Hull TS] Generating hull for region ${regionId}`);

  const regionData = await fetchRegionPoints(regionId);

  if (!regionData) {
    return { generated: false, error: 'Region not found or has no geometry' };
  }

  if (!regionData.usesHull) {
    console.log(`[Hull TS] Region ${regionId} does not use hull, skipping`);
    return { generated: false, error: 'Region does not use hull' };
  }

  const { points, name, savedHullParams } = regionData;

  // Determine which params to use:
  // 1. If explicit params provided, use those
  // 2. If useSavedParams=true and we have saved params, use those
  // 3. Otherwise use defaults
  let effectiveParams: HullParams;
  if (params) {
    effectiveParams = params;
    console.log(`[Hull TS] Using explicitly provided params:`, effectiveParams);
  } else if (useSavedParams && savedHullParams) {
    effectiveParams = savedHullParams;
    console.log(`[Hull TS] Using saved params from DB:`, effectiveParams);
  } else {
    effectiveParams = DEFAULT_HULL_PARAMS;
    console.log(`[Hull TS] Using default params:`, effectiveParams);
  }

  if (points.length < 1) {
    console.log(`[Hull TS] Region ${regionId} has no points`);
    return { generated: false, error: 'No points for hull generation' };
  }

  const datelineCrossing = regionData.crossesDateline;
  console.log(`[Hull TS] ${name}: ${points.length} points, crossesDateline=${datelineCrossing}`);

  const hull = generateHullFromPoints(points, effectiveParams, datelineCrossing);

  if (!hull) {
    return { generated: false, error: 'Hull generation failed' };
  }

  try {
    await saveHullGeometry(regionId, hull, effectiveParams);
    // nosemgrep: javascript.lang.security.audit.unsafe-formatstring.unsafe-formatstring -- regionId is a number
    console.log(`[Hull TS] Saved hull for region ${regionId} with params:`, effectiveParams);
    return {
      generated: true,
      pointCount: points.length,
      crossesDateline: datelineCrossing,
    };
  } catch (e) {
    console.error(`[Hull TS] Error saving hull:`, e);
    return { generated: false, error: String(e) };
  }
}

/**
 * Preview hull generation without saving to database.
 * Returns the generated GeoJSON geometry for display.
 */
export async function previewHull(
  regionId: number,
  params: HullParams = DEFAULT_HULL_PARAMS
): Promise<PreviewHullResult> {
  // nosemgrep: javascript.lang.security.audit.unsafe-formatstring.unsafe-formatstring -- regionId is a number
  console.log(`[Hull TS] Previewing hull for region ${regionId} with params:`, params);

  const regionData = await fetchRegionPoints(regionId);

  if (!regionData) {
    return { geometry: null, pointCount: 0, crossesDateline: false, error: 'Region not found or has no geometry' };
  }

  if (!regionData.usesHull) {
    return { geometry: null, pointCount: 0, crossesDateline: false, error: 'Region does not use hull' };
  }

  const { points, name } = regionData;

  if (points.length < 1) {
    return { geometry: null, pointCount: 0, crossesDateline: false, error: 'No points for hull generation' };
  }

  // Calculate source bounds from points
  const lngs = points.map(p => p.lng);
  const lats = points.map(p => p.lat);
  const sourceBounds = {
    minLng: Math.min(...lngs),
    maxLng: Math.max(...lngs),
    minLat: Math.min(...lats),
    maxLat: Math.max(...lats),
  };

  const datelineCrossing = regionData.crossesDateline;
  console.log(`[Hull TS] Preview ${name}: ${points.length} points, bounds=[${sourceBounds.minLng.toFixed(3)}, ${sourceBounds.maxLng.toFixed(3)}], params=${JSON.stringify(params)}`);

  const hull = generateHullFromPoints(points, params, datelineCrossing);

  return {
    geometry: hull,
    pointCount: points.length,
    crossesDateline: datelineCrossing,
    sourceBounds,
  };
}

/**
 * Preview hull from provided geometry (without fetching from DB).
 * Useful when the geometry hasn't been saved yet (e.g., in boundary editor).
 */
export async function previewHullFromGeometry(
  geometry: GeoJSON.Geometry,
  params: HullParams = DEFAULT_HULL_PARAMS
): Promise<PreviewHullResult> {
  console.log(`[Hull TS] Previewing hull from provided geometry with params:`, params);

  // Extract points from the geometry
  const points: Point[] = [];

  try {
    // Use turf to get representative points from each polygon
    if (geometry.type === 'Polygon') {
      const point = turf.pointOnFeature({ type: 'Feature', properties: {}, geometry });
      if (point?.geometry?.coordinates) {
        points.push({ lng: point.geometry.coordinates[0], lat: point.geometry.coordinates[1] });
      }
    } else if (geometry.type === 'MultiPolygon') {
      for (const polygonCoords of geometry.coordinates) {
        const polygonGeom: GeoJSON.Polygon = { type: 'Polygon', coordinates: polygonCoords };
        const point = turf.pointOnFeature({ type: 'Feature', properties: {}, geometry: polygonGeom });
        if (point?.geometry?.coordinates) {
          points.push({ lng: point.geometry.coordinates[0], lat: point.geometry.coordinates[1] });
        }
      }
    }
  } catch (e) {
    console.error('[Hull TS] Error extracting points from geometry:', e);
    return { geometry: null, pointCount: 0, crossesDateline: false, error: 'Failed to extract points from geometry' };
  }

  if (points.length < 1) {
    return { geometry: null, pointCount: 0, crossesDateline: false, error: 'No points extracted from geometry' };
  }

  // Calculate source bounds from points
  const lngs = points.map(p => p.lng);
  const lats = points.map(p => p.lat);
  const sourceBounds = {
    minLng: Math.min(...lngs),
    maxLng: Math.max(...lngs),
    minLat: Math.min(...lats),
    maxLat: Math.max(...lats),
  };

  // This geometry is not stored, so no trigger has measured it -- but the
  // database is right here, and the rule lives in it. One call to
  // geometry_focus() on the whole shape, not a threshold over one point per
  // polygon (#674).
  const focus = await pool.query<{ crosses: boolean }>(
    `SELECT west > east AS crosses FROM geometry_focus(ST_GeomFromGeoJSON($1))`,
    [JSON.stringify(geometry)],
  );
  const datelineCrossing = focus.rows[0]?.crosses === true;
  console.log(`[Hull TS] Preview from geometry: ${points.length} points, bounds=[${sourceBounds.minLng.toFixed(3)}, ${sourceBounds.maxLng.toFixed(3)}]`);

  const hull = generateHullFromPoints(points, params, datelineCrossing);

  return {
    geometry: hull,
    pointCount: points.length,
    crossesDateline: datelineCrossing,
    sourceBounds,
  };
}

