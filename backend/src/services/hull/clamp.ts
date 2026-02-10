/**
 * Coordinate clamping utilities - KEY to preventing world-wrapping
 */

/**
 * Normalize longitude to the target range.
 * If a coordinate wrapped around (e.g., 181 becomes -179), bring it back.
 */
export function normalizeLngForRange(lng: number, targetRange: { min: number; max: number }): number {
  // If we're targeting positive range (east side) and got a negative number,
  // the coordinate probably wrapped around from past 180
  if (targetRange.min >= 0 && lng < 0) {
    // E.g., -179 should become 181, then clamp to 180
    return lng + 360;
  }
  // If we're targeting negative range (west side) and got a positive number,
  // the coordinate probably wrapped around from past -180
  if (targetRange.max <= 0 && lng > 0) {
    // E.g., 179 should become -181, then clamp to -180
    return lng - 360;
  }
  return lng;
}

/**
 * Clamp a polygon's coordinates to stay within longitude bounds.
 * This prevents the polygon from wrapping around the world.
 * First normalizes coordinates that may have wrapped, then clamps.
 */
export function clampPolygonToLngRange(
  polygon: GeoJSON.Polygon,
  minLng: number,
  maxLng: number
): GeoJSON.Polygon {
  const targetRange = { min: minLng, max: maxLng };

  const clampedCoords = polygon.coordinates.map(ring =>
    ring.map(coord => {
      // First normalize in case coordinate wrapped around
      let lng = normalizeLngForRange(coord[0], targetRange);
      // Then clamp to the actual range
      lng = Math.max(minLng, Math.min(maxLng, lng));
      const lat = coord[1];
      return [lng, lat] as GeoJSON.Position;
    })
  );
  return { type: 'Polygon', coordinates: clampedCoords };
}

/**
 * Ensure coordinates at the clamped boundary are exactly at the boundary value.
 * This creates a clean edge at the dateline.
 */
export function ensureEdgeAt(
  polygon: GeoJSON.Polygon,
  edgeValue: number,
  side: 'min' | 'max'
): GeoJSON.Polygon {
  const tolerance = 1; // If within 1 degree of edge, snap to edge

  const fixedCoords = polygon.coordinates.map(ring =>
    ring.map(coord => {
      const lng = coord[0];
      const lat = coord[1];

      if (side === 'max' && lng >= edgeValue - tolerance) {
        return [edgeValue, lat] as GeoJSON.Position;
      }
      if (side === 'min' && lng <= edgeValue + tolerance) {
        return [edgeValue, lat] as GeoJSON.Position;
      }
      return coord;
    })
  );

  return { type: 'Polygon', coordinates: fixedCoords };
}
