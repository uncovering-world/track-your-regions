/**
 * bboxUtils — antimeridian-aware bbox helpers for the workspace map.
 *
 * Standard min/max longitude breaks for geometries that cross the antimeridian
 * (e.g. Russia, Fiji, Chukotka): points near both +180 and −180 yield a
 * whole-world bbox instead of a narrow one.
 *
 * Fix: when the raw lng span (maxLng − minLng) > 180, shift all negative
 * longitudes by +360 and recompute. The resulting bbox may have east > 180,
 * which MapLibre GL accepts (it wraps coordinates > 180 correctly).
 *
 * Per CLAUDE.md MapLibre Gotchas: west>east means antimeridian crossing;
 * MapLibre's fitBounds handles east>180 via world-wrapping.
 */

/** Raw min/max pass over one coordinate [lon, lat]. */
function minMaxPass(
  coords: number[][],
): { minLng: number; maxLng: number; minLat: number; maxLat: number } {
  let minLng = Infinity, maxLng = -Infinity, minLat = Infinity, maxLat = -Infinity;
  for (const [lon, lat] of coords) {
    if (lon < minLng) minLng = lon;
    if (lon > maxLng) maxLng = lon;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  }
  return { minLng, maxLng, minLat, maxLat };
}

/** Flatten all coordinate pairs out of a GeoJSON Geometry. */
function flattenCoords(geom: GeoJSON.Geometry): number[][] {
  const out: number[][] = [];
  function walk(v: unknown): void {
    if (!v || !Array.isArray(v)) return;
    if (typeof v[0] === 'number') {
      out.push(v as number[]);
    } else {
      for (const item of v) walk(item);
    }
  }
  if (geom.type === 'GeometryCollection') {
    for (const g of geom.geometries) {
      for (const c of flattenCoords(g)) out.push(c);
    }
  } else {
    walk(geom.coordinates);
  }
  return out;
}

/**
 * Compute the bbox of a set of GeoJSON features, antimeridian-aware.
 *
 * Returns [west, south, east, north].
 * For antimeridian-crossing geometries, east may be > 180 (MapLibre wraps it).
 * Returns null when features is empty or contains no coordinates.
 */
export function computeBbox(
  features: Array<{ geometry: GeoJSON.Geometry }>,
): [number, number, number, number] | null {
  const allCoords: number[][] = [];
  for (const f of features) {
    for (const c of flattenCoords(f.geometry)) allCoords.push(c);
  }
  if (allCoords.length === 0) return null;

  const { minLng, maxLng, minLat, maxLat } = minMaxPass(allCoords);
  if (!isFinite(minLng)) return null;

  const rawSpan = maxLng - minLng;

  // Not an antimeridian crossing — return as-is.
  if (rawSpan <= 180) {
    return [minLng, minLat, maxLng, maxLat];
  }

  // Antimeridian crossing: shift lng < 0 by +360 and recompute min/max.
  const shifted = allCoords.map(([lon, lat]) => [lon < 0 ? lon + 360 : lon, lat]);
  const s = minMaxPass(shifted);
  return [s.minLng, s.minLat, s.maxLng, s.maxLat];
}
