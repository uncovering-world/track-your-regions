/**
 * Shared map utilities
 */

import type { MapRef } from 'react-map-gl/maplibre';

/**
 * Smart bounds fitting that handles antimeridian-crossing regions.
 *
 * The bbox uses the convention [west, south, east, north] where west > east
 * indicates the region crosses the antimeridian. MapLibre's fitBounds handles
 * this natively when passed [[west, south], [east, north]].
 *
 * For very large regions (continent-scale), zoom is clamped to a minimum of 1
 * to avoid showing the entire globe.
 */
export function smartFitBounds(
  mapRef: MapRef,
  bbox: [number, number, number, number], // [west, south, east, north]
  options: {
    padding?: number;
    duration?: number;
    geojson?: GeoJSON.FeatureCollection;
    anchorPoint?: [number, number] | null;
  } = {}
) {
  const { padding = 50, duration = 500, anchorPoint } = options;
  const [west, south, east, north] = bbox;

  const crossesAntimeridian = west > east;
  const lngSpan = crossesAntimeridian ? (east + 360) - west : east - west;
  const latSpan = north - south;

  // Determine max zoom based on region size
  const effectiveMaxZoom = lngSpan > 100 || latSpan > 50 ? 4 :
                           lngSpan > 50 || latSpan > 30 ? 6 : 12;

  const map = mapRef.getMap();

  if (crossesAntimeridian && anchorPoint) {
    // MapLibre's cameraForBounds doesn't handle antimeridian correctly.
    // Use the pre-computed anchor point as center, and compute zoom from
    // cameraForBounds on a shifted bbox in [0, 360] space.
    const shiftedWest = west;
    const shiftedEast = east + 360;
    const cam = map.cameraForBounds(
      [[shiftedWest, south], [shiftedEast, north]],
      { padding, maxZoom: effectiveMaxZoom }
    );
    const zoom = Math.max(1, cam?.zoom ?? 2);
    map.flyTo({ center: anchorPoint as [number, number], zoom, duration });
  } else {
    // Normal region: cameraForBounds works correctly
    const cam = map.cameraForBounds(
      [[west, south], [east, north]],
      { padding, maxZoom: effectiveMaxZoom }
    );

    if (cam && cam.zoom !== undefined) {
      const zoom = Math.max(1, cam.zoom);
      map.flyTo({ center: cam.center, zoom, duration });
    } else {
      // Fallback: direct fitBounds (shouldn't normally happen)
      mapRef.fitBounds(
        [[west, south], [east, north]],
        { padding, duration, maxZoom: effectiveMaxZoom }
      );
    }
  }
}
