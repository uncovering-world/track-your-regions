/**
 * Shared utilities for polygon cutting/splitting operations.
 * Used by CutDivisionDialog, SplitDivisionDialog, and CustomBoundaryDialog.
 */
import * as turf from '@turf/turf';

export interface CutPart {
  name: string;
  geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon;
}

/**
 * Cut a polygon using a line that goes from edge to edge.
 * Returns two parts if successful, or null if the line doesn't properly split the polygon.
 */
export function splitPolygonWithLine(
  polygon: GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>,
  linePoints: [number, number][]
): { part1: GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>; part2: GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon> } | null {
  if (linePoints.length < 2) return null;

  try {
    // Create a line from the points
    const line = turf.lineString(linePoints);

    // Buffer the line slightly to create a thin polygon that acts as the cut
    // The buffer width should be very small but enough to create a valid cut
    const bufferedLine = turf.buffer(line, 0.00001, { units: 'degrees' });
    if (!bufferedLine) return null;

    // Use the buffered line to split the polygon
    const fc = turf.featureCollection([polygon, bufferedLine]);
    const difference = turf.difference(fc);

    if (!difference) return null;

    // If the result is a MultiPolygon with 2+ parts, we have a successful split
    if (difference.geometry.type === 'MultiPolygon' && difference.geometry.coordinates.length >= 2) {
      // Extract the two largest parts
      const parts = difference.geometry.coordinates
        .map((coords, idx) => {
          const poly = turf.polygon(coords);
          return { idx, area: turf.area(poly), coords };
        })
        .sort((a, b) => b.area - a.area)
        .slice(0, 2);

      if (parts.length < 2) return null;

      const part1: GeoJSON.Feature<GeoJSON.Polygon> = {
        type: 'Feature',
        properties: {},
        geometry: { type: 'Polygon', coordinates: parts[0].coords },
      };
      const part2: GeoJSON.Feature<GeoJSON.Polygon> = {
        type: 'Feature',
        properties: {},
        geometry: { type: 'Polygon', coordinates: parts[1].coords },
      };

      return { part1, part2 };
    }

    // Try alternative approach: extend line and intersect
    return splitPolygonWithExtendedLine(polygon, linePoints);
  } catch (e) {
    console.error('Failed to split polygon with line:', e);
    return null;
  }
}

/**
 * Alternative splitting method: extend the line beyond polygon bounds and use it to create two halves.
 */
function splitPolygonWithExtendedLine(
  polygon: GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>,
  linePoints: [number, number][]
): { part1: GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>; part2: GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon> } | null {
  if (linePoints.length < 2) return null;

  try {
    const bbox = turf.bbox(polygon);
    const bboxDiagonal = Math.sqrt(
      Math.pow(bbox[2] - bbox[0], 2) + Math.pow(bbox[3] - bbox[1], 2)
    );

    // Get the line direction from first and last point
    const start = linePoints[0];
    const end = linePoints[linePoints.length - 1];
    const dx = end[0] - start[0];
    const dy = end[1] - start[1];
    const length = Math.sqrt(dx * dx + dy * dy);

    if (length === 0) return null;

    // Normalize and extend
    const extendFactor = bboxDiagonal * 2 / length;
    const extendedStart: [number, number] = [
      start[0] - dx * extendFactor,
      start[1] - dy * extendFactor,
    ];
    const extendedEnd: [number, number] = [
      end[0] + dx * extendFactor,
      end[1] + dy * extendFactor,
    ];

    // Create a very wide buffer perpendicular to the line
    // This creates two "half-planes"
    const perpDx = -dy / length;
    const perpDy = dx / length;
    const bufferSize = bboxDiagonal * 2;

    // Create polygon for "left" side of the line
    const leftPoly = turf.polygon([[
      extendedStart,
      extendedEnd,
      [extendedEnd[0] + perpDx * bufferSize, extendedEnd[1] + perpDy * bufferSize],
      [extendedStart[0] + perpDx * bufferSize, extendedStart[1] + perpDy * bufferSize],
      extendedStart,
    ]]);

    // Intersect with original polygon to get part 1
    const fc1 = turf.featureCollection([polygon, leftPoly]);
    const part1 = turf.intersect(fc1);

    // Difference to get part 2
    const fc2 = turf.featureCollection([polygon, leftPoly]);
    const part2 = turf.difference(fc2);

    if (!part1 || !part2) return null;

    // Validate both parts have meaningful area
    const area1 = turf.area(part1);
    const area2 = turf.area(part2);

    if (area1 < 1000 || area2 < 1000) return null; // Less than 1000 sq meters

    return {
      part1: part1 as GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>,
      part2: part2 as GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>,
    };
  } catch (e) {
    console.error('Failed to split polygon with extended line:', e);
    return null;
  }
}

/**
 * Check if a line intersects the boundary of a polygon at exactly 2 points (entry and exit).
 * This indicates the line goes from edge to edge.
 */
export function doesLineCrossPolygon(
  polygon: GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>,
  linePoints: [number, number][]
): boolean {
  if (linePoints.length < 2) return false;

  try {
    const line = turf.lineString(linePoints);
    const boundary = turf.polygonToLine(polygon);

    if (!boundary) return false;

    // Find intersections
    const intersections = turf.lineIntersect(line, boundary);

    // We need at least 2 intersection points (entry and exit)
    return intersections.features.length >= 2;
  } catch (e) {
    console.error('Failed to check line crossing:', e);
    return false;
  }
}

/**
 * Intersect a drawn polygon with a source geometry.
 * Used by CustomBoundaryDialog and CutDivisionDialog for polygon-based cutting.
 */
export function intersectPolygonWithSource(
  drawnPoints: [number, number][],
  sourceGeometry: GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>
): GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon> | null {
  if (drawnPoints.length < 3) return null;

  try {
    // Create polygon from drawing points (close the ring)
    const drawnPolygon = turf.polygon([[...drawnPoints, drawnPoints[0]]]);

    // Intersect with source geometry
    const fc = turf.featureCollection([
      drawnPolygon,
      sourceGeometry,
    ]) as GeoJSON.FeatureCollection<GeoJSON.Polygon | GeoJSON.MultiPolygon>;

    const intersection = turf.intersect(fc);
    return intersection as GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon> | null;
  } catch (e) {
    console.error('Failed to intersect polygon:', e);
    return null;
  }
}

/**
 * Calculate the remaining geometry after subtracting cut parts.
 */
export function calculateRemainingGeometry(
  original: GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>,
  cutParts: CutPart[]
): GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon> | null {
  if (cutParts.length === 0) return original;

  try {
    let remaining = original;

    for (const part of cutParts) {
      const partFeature: GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon> = {
        type: 'Feature',
        properties: {},
        geometry: part.geometry,
      };
      const fc = turf.featureCollection([remaining, partFeature]);
      const diff = turf.difference(fc);
      if (diff) {
        remaining = diff as GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>;
      }
    }

    return remaining;
  } catch (e) {
    console.error('Failed to calculate remaining geometry:', e);
    return original;
  }
}

/**
 * Check if the source geometry is a single polygon (not MultiPolygon with multiple parts).
 */
export function isSinglePolygon(
  geometry: GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon> | null
): boolean {
  if (!geometry) return false;

  if (geometry.geometry.type === 'Polygon') return true;
  if (geometry.geometry.type === 'MultiPolygon') {
    return geometry.geometry.coordinates.length === 1;
  }
  return false;
}
