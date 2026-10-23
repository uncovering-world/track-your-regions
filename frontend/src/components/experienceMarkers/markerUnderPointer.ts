/**
 * What the pointer is on, among the pins and the selected object's highlight
 * dots, answered once for every gesture (#1916).
 *
 * The hover and the click both read this function, so a click opens the place
 * the hover card names: where a selected object's dot is drawn over another
 * place's pin — the Serapeum of Alexandria and Pompey's Pillar, 81 m apart, at
 * city zoom — both gestures answer the dot. A gesture that queried the layers
 * on its own could prefer them differently, which is why neither does.
 *
 * The topmost drawn feature wins, which is the one the reader sees under the
 * pointer. `queryRenderedFeatures` lists what it finds in rendering order, top
 * first, when asked across layers at once (`docs/tech/maplibre-patterns.md`
 * § Overlapping interactive layers has the counterpart rule for the region
 * tiles, where the order is settled by a preference instead). A layer the
 * style does not hold is left out of the query: this component unmounts its
 * sources while a region loads, and naming a missing layer makes
 * `queryRenderedFeatures` fire an error on the ordinary path of pointing at the
 * map mid-load.
 */

import type { MapGeoJSONFeature, Point } from 'maplibre-gl';
import { LAYER_HIGHLIGHT_POINT, MARKER_LAYERS } from './scene';

/** The feature under the pointer, read in the terms the gestures act on. */
export type MarkerUnderPointer =
  | {
    kind: 'pin';
    experienceId: number;
    /** The place the pin draws; null for a folded pin or a stand-in for places the batch does not hold. */
    locationId: number | null;
    /** Whether the builder drew it folded — the pin's own answer, never inferred from its badge. */
    folded: boolean;
    name: string;
    coordinates: [number, number];
  }
  | {
    kind: 'highlight';
    /** A dot of the selected object's places; null where the dot stands for the object itself. */
    locationId: number | null;
    name: string;
    coordinates: [number, number];
  };

/** The layers a pointer is answered from, in the order they are queried; only those the style holds. */
export const POINTER_LAYERS = [...MARKER_LAYERS, LAYER_HIGHLIGHT_POINT] as const;

/** What is asked of the map: whether a layer is on it, and what is drawn at a point. */
export interface QueryableMap {
  getLayer(id: string): unknown;
  queryRenderedFeatures(point: Point, options: { layers: string[] }): MapGeoJSONFeature[];
}

function readFeature(feature: MapGeoJSONFeature): MarkerUnderPointer | null {
  const props = feature.properties ?? {};
  const coordinates = (feature.geometry as GeoJSON.Point).coordinates as [number, number];
  const locationId = (props.locationId as number | null | undefined) ?? null;
  if (feature.layer.id === LAYER_HIGHLIGHT_POINT) {
    return { kind: 'highlight', locationId, name: String(props.name ?? ''), coordinates };
  }
  const experienceId = props.experienceId as number | undefined;
  if (experienceId == null) return null;
  return {
    kind: 'pin',
    experienceId,
    locationId,
    folded: props.folded === true,
    name: String(props.experienceName || props.name || ''),
    coordinates,
  };
}

/**
 * The topmost pin or highlight dot under `point`, or null where there is none —
 * or where none of the layers is on the map yet.
 */
export function markerUnderPointer(map: QueryableMap, point: Point): MarkerUnderPointer | null {
  const layers = POINTER_LAYERS.filter(id => map.getLayer(id));
  if (layers.length === 0) return null;
  const under = map.queryRenderedFeatures(point, { layers });
  if (under.length === 0) return null;
  return readFeature(under[0]);
}

/**
 * The key `useMarkerInteractions` dedupes hovers by, in one key space for both
 * layers: a pin is its object and place, a dot is `highlight:` and its place,
 * so moving between the two cannot look like staying on one thing.
 */
export function hoverKeyOf(under: MarkerUnderPointer | null): string | null {
  if (under == null) return null;
  if (under.kind === 'highlight') return `highlight:${under.locationId ?? ''}`;
  return `${under.experienceId}:${under.locationId ?? ''}`;
}
