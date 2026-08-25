/**
 * Shared map utilities
 */

import { coordEach } from '@turf/turf';
import type { MapRef } from 'react-map-gl/maplibre';

/** What a map needs to frame a shape: the box, and where to point the camera. */
export interface GeoFocus {
  /** [west, south, east, north]; west > east means the box crosses the antimeridian. */
  bbox: [number, number, number, number];
  /** [lng, lat] — the centre of the box measured in the frame the box was chosen in. */
  anchorPoint: [number, number];
}

/**
 * A span this wide is the whole world however it is measured, so no window onto
 * it is a frame. Mirrors `near_global_deg` in `update_region_focus_data()`.
 */
const NEAR_GLOBAL_DEG = 350;

/**
 * Measure a shape the way the database measures a region (#666).
 *
 * `turf.bbox` has no notion of the antimeridian: it returns the extremes of the
 * raw longitudes, so a shape reaching over the dateline comes back as
 * `[-180, …, 180]` — a claim that it spans the world. Selecting the Far Eastern
 * Federal District or Fiji in the GADM world view framed the whole globe at
 * zoom 1 for exactly that reason, the region cut in two against the edges,
 * while the same places in a custom world view were framed from `focus_bbox`
 * and came out right.
 *
 * The rule here is the one the trigger applies to `focus_bbox`: measure the
 * shape twice, once in [-180, 180] and once with negative longitudes carried up
 * by 360, and keep the tighter of the two. A shape that is tighter shifted
 * crosses the antimeridian and is returned in this repository's `west > east`
 * convention; one that is wide either way really does wrap the world and is
 * returned as it stands, so Antarctica keeps its full-width box.
 *
 * Unlike PostGIS, the shift here is one-way, so it needs no counterpart to the
 * trigger's snap: `ST_ShiftLongitude` also carries anything past +180 back down
 * to negative, which is what made the overshoot in GADM's geometry read as a
 * 370-degree span. Adding 360 only to negative longitudes leaves a vertex at
 * 180.0000000000001 where it is.
 *
 * Returns null for a shape with no coordinates — an empty collection has no
 * frame, and there is nothing useful to fly to.
 */
export function focusFromGeoJson(geojson: GeoJSON.GeoJSON): GeoFocus | null {
  let south = Infinity;
  let north = -Infinity;
  let normWest = Infinity;
  let normEast = -Infinity;
  let shiftWest = Infinity;
  let shiftEast = -Infinity;

  coordEach(geojson, ([lng, lat]) => {
    if (lat < south) south = lat;
    if (lat > north) north = lat;
    if (lng < normWest) normWest = lng;
    if (lng > normEast) normEast = lng;
    const shifted = lng < 0 ? lng + 360 : lng;
    if (shifted < shiftWest) shiftWest = shifted;
    if (shifted > shiftEast) shiftEast = shifted;
  });

  if (!Number.isFinite(normWest) || !Number.isFinite(south)) return null;

  const normSpan = normEast - normWest;
  const shiftSpan = shiftEast - shiftWest;
  const centerLat = (south + north) / 2;

  if (shiftSpan < normSpan && shiftSpan <= NEAR_GLOBAL_DEG) {
    const toNormal = (lng: number) => (lng > 180 ? lng - 360 : lng);
    let centerLng = (shiftWest + shiftEast) / 2;
    if (centerLng > 180) centerLng -= 360;
    return {
      bbox: [toNormal(shiftWest), south, toNormal(shiftEast), north],
      anchorPoint: [centerLng, centerLat],
    };
  }

  return {
    bbox: [normWest, south, normEast, north],
    anchorPoint: [(normWest + normEast) / 2, centerLat],
  };
}

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
    anchorPoint?: [number, number] | null;
  } = {}
) {
  const { padding = 50, duration = 500, anchorPoint } = options;
  const [west, south, east, north] = bbox;

  const crossesAntimeridian = west > east;
  const lngSpan = crossesAntimeridian ? (east + 360) - west : east - west;
  const latSpan = north - south;

  // Determine max zoom based on region size
  let effectiveMaxZoom = 12;
  if (lngSpan > 100 || latSpan > 50) effectiveMaxZoom = 4;
  else if (lngSpan > 50 || latSpan > 30) effectiveMaxZoom = 6;

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
