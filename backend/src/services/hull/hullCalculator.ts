/**
 * Hull calculation using turf.js
 */

import * as turf from '@turf/turf';
import type { HullParams, Point } from './types.js';
import { crossesDateline, splitPointsAtDateline } from './dateline.js';
import { clampPolygonToLngRange, ensureEdgeAt } from './clamp.js';
import { alignDatelineEdges } from './align.js';

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

  // Handle small point counts
  if (points.length === 1) {
    const buffered = turf.buffer(
      turf.point([points[0].lng, points[0].lat]),
      params.bufferKm,
      { units: 'kilometers' }
    );
    if (buffered?.geometry) {
      return clampPolygonToLngRange(buffered.geometry as GeoJSON.Polygon, lngRange.min, lngRange.max);
    }
    return null;
  }

  if (points.length === 2) {
    const line = turf.lineString([
      [points[0].lng, points[0].lat],
      [points[1].lng, points[1].lat]
    ]);
    const buffered = turf.buffer(line, params.bufferKm, { units: 'kilometers' });
    if (buffered?.geometry) {
      return clampPolygonToLngRange(buffered.geometry as GeoJSON.Polygon, lngRange.min, lngRange.max);
    }
    return null;
  }

  const pointFeatures = points.map(p => turf.point([p.lng, p.lat]));
  const pointCollection = turf.featureCollection(pointFeatures);

  try {
    const bbox = turf.bbox(pointCollection);
    const bboxWidth = bbox[2] - bbox[0];
    const bboxHeight = bbox[3] - bbox[1];
    const maxDimension = Math.max(bboxWidth, bboxHeight);
    const maxEdge = maxDimension * params.concavity;

    let hull: GeoJSON.Feature<GeoJSON.Polygon> | null = null;

    // Try concave hull first
    try {
      const candidate = turf.concave(pointCollection, { maxEdge, units: 'degrees' });
      if (candidate?.geometry?.type === 'Polygon') {
        hull = candidate as GeoJSON.Feature<GeoJSON.Polygon>;
      }
    } catch {
      // Concave failed
    }

    // Fallback to convex hull
    if (!hull) {
      const convex = turf.convex(pointCollection);
      if (convex?.geometry) {
        hull = convex as GeoJSON.Feature<GeoJSON.Polygon>;
      }
    }

    if (!hull?.geometry) {
      return null;
    }

    // Clamp BEFORE buffering to prevent crossing boundaries
    let clamped = clampPolygonToLngRange(hull.geometry, lngRange.min, lngRange.max);

    // Buffer the clamped hull
    const buffered = turf.buffer(turf.feature(clamped), params.bufferKm, { units: 'kilometers' });
    if (buffered?.geometry) {
      // Clamp AGAIN after buffering
      clamped = clampPolygonToLngRange(buffered.geometry as GeoJSON.Polygon, lngRange.min, lngRange.max);
    }

    // Simplify
    const simplified = turf.simplify(turf.feature(clamped), {
      tolerance: params.simplifyTolerance,
      highQuality: true
    });
    if (simplified?.geometry) {
      // Clamp one more time after simplify
      clamped = clampPolygonToLngRange(simplified.geometry as GeoJSON.Polygon, lngRange.min, lngRange.max);
    }

    return clamped;
  } catch (e) {
    console.error(`[Hull TS] Error generating hull for point group:`, e);
    return null;
  }
}

/**
 * Generate a hull from points with proper dateline handling.
 * For dateline-crossing regions, generates two separate hulls that meet at ±180.
 */
export function generateHullFromPoints(
  points: Point[],
  params: HullParams
): GeoJSON.Geometry | null {
  if (!points || points.length < 1) {
    return null;
  }

  // Check if this region crosses the dateline
  if (crossesDateline(points)) {
    console.log(`[Hull TS] Region crosses dateline, generating split hulls`);

    const { eastPoints, westPoints } = splitPointsAtDateline(points);
    console.log(`[Hull TS] East points: ${eastPoints.length}, West points: ${westPoints.length}`);

    // Generate hull for EAST group (positive longitudes near 180)
    let eastHull: GeoJSON.Polygon | null = null;
    if (eastPoints.length >= 1) {
      const minEastLng = Math.min(...eastPoints.map(p => p.lng));
      eastHull = generateHullForPointGroup(eastPoints, params, { min: Math.max(0, minEastLng - 5), max: 180 });
      if (eastHull) {
        eastHull = ensureEdgeAt(eastHull, 180, 'max');
        console.log(`[Hull TS] East hull generated with ${eastHull.coordinates[0].length} points`);
      }
    }

    // Generate hull for WEST group (negative longitudes near -180)
    let westHull: GeoJSON.Polygon | null = null;
    if (westPoints.length >= 1) {
      const maxWestLng = Math.max(...westPoints.map(p => p.lng));
      westHull = generateHullForPointGroup(westPoints, params, { min: -180, max: Math.min(0, maxWestLng + 5) });
      if (westHull) {
        westHull = ensureEdgeAt(westHull, -180, 'min');
        console.log(`[Hull TS] West hull generated with ${westHull.coordinates[0].length} points`);
      }
    }

    // Align the edge points at the dateline so both polygons meet at the same latitudes
    if (eastHull && westHull) {
      const aligned = alignDatelineEdges(eastHull, westHull);
      eastHull = aligned.east;
      westHull = aligned.west;
    }

    const parts: GeoJSON.Position[][][] = [];
    if (eastHull) parts.push(eastHull.coordinates);
    if (westHull) parts.push(westHull.coordinates);

    if (parts.length === 0) {
      console.log(`[Hull TS] No hulls generated for dateline-crossing region`);
      return null;
    }

    if (parts.length === 1) {
      return { type: 'Polygon', coordinates: parts[0] };
    }

    return { type: 'MultiPolygon', coordinates: parts };
  }

  // Non-dateline case: generate single hull
  // But use stricter bounds based on actual points to prevent wrapping
  console.log(`[Hull TS] Region does not cross dateline, generating single hull`);

  const lngs = points.map(p => p.lng);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);

  // For regions near the dateline (close to ±180), use stricter bounds
  // to prevent buffer from wrapping around
  let lngRange: { min: number; max: number };

  if (maxLng > 170) {
    // Region is near eastern dateline - clamp to 180
    lngRange = { min: Math.max(-180, minLng - 10), max: 180 };
    console.log(`[Hull TS] Near eastern dateline, clamping to max 180`);
  } else if (minLng < -170) {
    // Region is near western dateline - clamp to -180
    lngRange = { min: -180, max: Math.min(180, maxLng + 10) };
    console.log(`[Hull TS] Near western dateline, clamping to min -180`);
  } else {
    // Normal region - use wide range
    lngRange = { min: -180, max: 180 };
  }

  const hull = generateHullForPointGroup(points, params, lngRange);
  return hull;
}
