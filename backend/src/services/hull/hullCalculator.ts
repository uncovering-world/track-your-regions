/**
 * Hull calculation using turf.js
 */

import * as turf from '@turf/turf';
import type { HullParams, Point } from './types.js';
import { crossesDateline, splitPointsAtDateline } from './dateline.js';
import { clampPolygonToLngRange, ensureEdgeAt } from './clamp.js';
import { alignDatelineEdges } from './align.js';

/**
 * Buffer a geometry and clamp the result to the given longitude range.
 * Returns null if turf.buffer produced no geometry.
 */
function bufferAndClamp(
  feature: GeoJSON.Feature<GeoJSON.Geometry>,
  bufferKm: number,
  lngRange: { min: number; max: number }
): GeoJSON.Polygon | null {
  const buffered = turf.buffer(feature, bufferKm, { units: 'kilometers' });
  if (!buffered?.geometry) return null;
  return clampPolygonToLngRange(buffered.geometry as GeoJSON.Polygon, lngRange.min, lngRange.max);
}

/**
 * Build the raw hull polygon for ≥3 points: try concave first, fall back to convex.
 */
function buildHullPolygon(
  pointCollection: GeoJSON.FeatureCollection<GeoJSON.Point>,
  concavity: number
): GeoJSON.Feature<GeoJSON.Polygon> | null {
  const bbox = turf.bbox(pointCollection);
  const maxEdge = Math.max(bbox[2] - bbox[0], bbox[3] - bbox[1]) * concavity;

  try {
    const candidate = turf.concave(pointCollection, { maxEdge, units: 'degrees' });
    if (candidate?.geometry?.type === 'Polygon') {
      return candidate as GeoJSON.Feature<GeoJSON.Polygon>;
    }
  } catch {
    // Concave failed — fall through to convex
  }

  const convex = turf.convex(pointCollection);
  return convex?.geometry ? convex as GeoJSON.Feature<GeoJSON.Polygon> : null;
}

/**
 * Generate hull for a group of points, clamping to specified longitude range.
 */
export function generateHullForPointGroup(
  points: Point[],
  params: HullParams,
  lngRange: { min: number; max: number }
): GeoJSON.Polygon | null {
  if (!points || points.length < 1) {
    return null;
  }

  // Handle small point counts via buffer-only paths
  if (points.length === 1) {
    return bufferAndClamp(turf.point([points[0].lng, points[0].lat]), params.bufferKm, lngRange);
  }
  if (points.length === 2) {
    const line = turf.lineString([
      [points[0].lng, points[0].lat],
      [points[1].lng, points[1].lat],
    ]);
    return bufferAndClamp(line, params.bufferKm, lngRange);
  }

  const pointFeatures = points.map(p => turf.point([p.lng, p.lat]));
  const pointCollection = turf.featureCollection(pointFeatures);

  try {
    const hull = buildHullPolygon(pointCollection, params.concavity);
    if (!hull?.geometry) return null;

    // Clamp BEFORE buffering to prevent crossing boundaries
    let clamped = clampPolygonToLngRange(hull.geometry, lngRange.min, lngRange.max);

    // Buffer the clamped hull, then re-clamp
    const afterBuffer = bufferAndClamp(turf.feature(clamped), params.bufferKm, lngRange);
    if (afterBuffer) clamped = afterBuffer;

    // Simplify, then re-clamp
    const simplified = turf.simplify(turf.feature(clamped), {
      tolerance: params.simplifyTolerance,
      highQuality: true,
    });
    if (simplified?.geometry) {
      clamped = clampPolygonToLngRange(simplified.geometry as GeoJSON.Polygon, lngRange.min, lngRange.max);
    }

    return clamped;
  } catch (e) {
    console.error(`[Hull TS] Error generating hull for point group:`, e);
    return null;
  }
}

/** Generate the east-side hull for a dateline-crossing region. */
function generateEastDatelineHull(
  eastPoints: Point[],
  params: HullParams
): GeoJSON.Polygon | null {
  if (eastPoints.length < 1) return null;
  const minEastLng = Math.min(...eastPoints.map(p => p.lng));
  const hull = generateHullForPointGroup(eastPoints, params, { min: Math.max(0, minEastLng - 5), max: 180 });
  if (!hull) return null;
  const snapped = ensureEdgeAt(hull, 180, 'max');
  console.log(`[Hull TS] East hull generated with ${snapped.coordinates[0].length} points`);
  return snapped;
}

/** Generate the west-side hull for a dateline-crossing region. */
function generateWestDatelineHull(
  westPoints: Point[],
  params: HullParams
): GeoJSON.Polygon | null {
  if (westPoints.length < 1) return null;
  const maxWestLng = Math.max(...westPoints.map(p => p.lng));
  const hull = generateHullForPointGroup(westPoints, params, { min: -180, max: Math.min(0, maxWestLng + 5) });
  if (!hull) return null;
  const snapped = ensureEdgeAt(hull, -180, 'min');
  console.log(`[Hull TS] West hull generated with ${snapped.coordinates[0].length} points`);
  return snapped;
}

/** Combine the east+west hulls (after edge alignment) into a single GeoJSON geometry. */
function combineDatelineHulls(
  eastHull: GeoJSON.Polygon | null,
  westHull: GeoJSON.Polygon | null
): GeoJSON.Geometry | null {
  let east = eastHull;
  let west = westHull;
  if (east && west) {
    const aligned = alignDatelineEdges(east, west);
    east = aligned.east;
    west = aligned.west;
  }
  const parts: GeoJSON.Position[][][] = [];
  if (east) parts.push(east.coordinates);
  if (west) parts.push(west.coordinates);

  if (parts.length === 0) return null;
  if (parts.length === 1) return { type: 'Polygon', coordinates: parts[0] };
  return { type: 'MultiPolygon', coordinates: parts };
}

/** Pick the longitude range for a non-dateline region, clamping near ±180. */
function selectLngRange(points: Point[]): { min: number; max: number } {
  const lngs = points.map(p => p.lng);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);

  if (maxLng > 170) {
    console.log(`[Hull TS] Near eastern dateline, clamping to max 180`);
    return { min: Math.max(-180, minLng - 10), max: 180 };
  }
  if (minLng < -170) {
    console.log(`[Hull TS] Near western dateline, clamping to min -180`);
    return { min: -180, max: Math.min(180, maxLng + 10) };
  }
  return { min: -180, max: 180 };
}

/**
 * Generate a hull from points with proper dateline handling.
 * For dateline-crossing regions, generates two separate hulls that meet at ±180.
 */
export function generateHullFromPoints(
  points: Point[],
  params: HullParams
): GeoJSON.Geometry | null {
  if (!points || points.length < 1) return null;

  if (crossesDateline(points)) {
    console.log(`[Hull TS] Region crosses dateline, generating split hulls`);
    const { eastPoints, westPoints } = splitPointsAtDateline(points);
    console.log(`[Hull TS] East points: ${eastPoints.length}, West points: ${westPoints.length}`);
    const eastHull = generateEastDatelineHull(eastPoints, params);
    const westHull = generateWestDatelineHull(westPoints, params);
    const combined = combineDatelineHulls(eastHull, westHull);
    if (!combined) console.log(`[Hull TS] No hulls generated for dateline-crossing region`);
    return combined;
  }

  // Non-dateline case: generate single hull with bounds chosen to prevent wrapping near ±180
  console.log(`[Hull TS] Region does not cross dateline, generating single hull`);
  return generateHullForPointGroup(points, params, selectLngRange(points));
}
