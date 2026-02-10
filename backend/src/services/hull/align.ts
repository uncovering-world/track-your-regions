/**
 * Dateline edge alignment utilities for seamless polygon joins
 */

/**
 * Extract latitudes of points that are at the specified longitude edge.
 */
export function extractEdgeLatitudes(polygon: GeoJSON.Polygon, edgeLng: number): number[] {
  const lats: number[] = [];
  const tolerance = 0.01;

  for (const ring of polygon.coordinates) {
    for (const coord of ring) {
      if (Math.abs(coord[0] - edgeLng) < tolerance) {
        lats.push(coord[1]);
      }
    }
  }

  return lats;
}

/**
 * Adjust a polygon's edge points to span a specific latitude range.
 * Preserves the polygon shape but extends/adjusts edge points at the dateline.
 */
export function adjustEdgeLatRange(
  polygon: GeoJSON.Polygon,
  edgeLng: number,
  targetMinLat: number,
  targetMaxLat: number
): GeoJSON.Polygon {
  const tolerance = 0.01;
  const ring = [...polygon.coordinates[0]];

  // Find current edge points
  const edgePoints: { idx: number; lat: number }[] = [];
  for (let i = 0; i < ring.length; i++) {
    if (Math.abs(ring[i][0] - edgeLng) < tolerance) {
      edgePoints.push({ idx: i, lat: ring[i][1] });
    }
  }

  if (edgePoints.length === 0) {
    return polygon;
  }

  // Find current min/max lat of edge points
  const currentMinLat = Math.min(...edgePoints.map(p => p.lat));
  const currentMaxLat = Math.max(...edgePoints.map(p => p.lat));

  // Find the edge point indices for min and max lat
  const minLatIdx = edgePoints.find(p => p.lat === currentMinLat)?.idx;
  const maxLatIdx = edgePoints.find(p => p.lat === currentMaxLat)?.idx;

  if (minLatIdx === undefined || maxLatIdx === undefined) {
    return polygon;
  }

  // Extend the edge points to cover the target range
  // Update the min/max lat points to the target values
  const newRing = ring.map((coord, _i) => {
    if (Math.abs(coord[0] - edgeLng) < tolerance) {
      // This is an edge point - scale its latitude to the new range
      const currentLat = coord[1];
      if (currentMinLat === currentMaxLat) {
        // All edge points at same lat - can't interpolate, just use middle
        return [edgeLng, (targetMinLat + targetMaxLat) / 2] as GeoJSON.Position;
      }
      // Linear interpolation from current range to target range
      const t = (currentLat - currentMinLat) / (currentMaxLat - currentMinLat);
      const newLat = targetMinLat + t * (targetMaxLat - targetMinLat);
      return [edgeLng, newLat] as GeoJSON.Position;
    }
    return coord;
  });

  return { type: 'Polygon', coordinates: [newRing, ...polygon.coordinates.slice(1)] };
}

/**
 * Align the dateline edges of two polygons so they meet at the same latitude points.
 * This creates a seamless join at the ±180 boundary.
 *
 * Strategy: Find the overlapping latitude range and adjust edge points to match,
 * but preserve the overall polygon shape.
 */
export function alignDatelineEdges(
  eastPoly: GeoJSON.Polygon,
  westPoly: GeoJSON.Polygon
): { east: GeoJSON.Polygon; west: GeoJSON.Polygon } {
  // Extract edge points at the dateline from each polygon
  const eastEdgeLats = extractEdgeLatitudes(eastPoly, 180);
  const westEdgeLats = extractEdgeLatitudes(westPoly, -180);

  console.log(`[Hull TS] East edge lats: ${eastEdgeLats.length}, West edge lats: ${westEdgeLats.length}`);

  if (eastEdgeLats.length === 0 || westEdgeLats.length === 0) {
    return { east: eastPoly, west: westPoly };
  }

  // Find the overlapping latitude range
  const eastMinLat = Math.min(...eastEdgeLats);
  const eastMaxLat = Math.max(...eastEdgeLats);
  const westMinLat = Math.min(...westEdgeLats);
  const westMaxLat = Math.max(...westEdgeLats);

  // Use the union of both ranges for the shared edge
  const sharedMinLat = Math.min(eastMinLat, westMinLat);
  const sharedMaxLat = Math.max(eastMaxLat, westMaxLat);

  console.log(`[Hull TS] Shared lat range: ${sharedMinLat.toFixed(2)} to ${sharedMaxLat.toFixed(2)}`);

  // Adjust each polygon's edge points to span the shared range
  const newEast = adjustEdgeLatRange(eastPoly, 180, sharedMinLat, sharedMaxLat);
  const newWest = adjustEdgeLatRange(westPoly, -180, sharedMinLat, sharedMaxLat);

  return { east: newEast, west: newWest };
}
