/**
 * The one scene both experience maps draw: the sources, the layers and their
 * paint for a pin, its count badge, the selected object's highlight and the
 * hover ring, and the builders of the data those sources hold (#1132).
 *
 * Map mode declares its layers in react-map-gl JSX and Discover calls MapLibre
 * directly, so the two had each their own copy of every value here — the ring's
 * orange and radii, the badge's offset, the highlight's red — and a change made
 * in one file and missed in the other failed nothing. Each map now takes these
 * definitions and adds only what is genuinely its own: Map mode the minzoom and
 * the opacity ramps of its cross-fade with the heatmap (`layers.ts`), Discover
 * its clustering (`discover/discoverMapLayers.ts`). The ids are shared as well:
 * the two are separate map instances, so the same id on both is no collision.
 *
 * Declarations only, and at the bottom of the import graph: `layers.ts` imports
 * this file and never the other way, so neither map's own additions can leak
 * into the other's.
 */

import type {
  CircleLayerSpecification, FilterSpecification, SymbolLayerSpecification,
} from 'maplibre-gl';
import type { MarkerData } from './buildMarkers';
import { experienceColor } from '../../utils/kindColors';

/** The three GeoJSON sources the scene is drawn from, by role. */
export const SCENE_SOURCES = {
  markers: 'exp-markers',
  highlight: 'exp-highlight',
  hover: 'exp-hover',
} as const;

// Layer ids
export const LAYER_MARKERS = 'exp-markers-points';
export const LAYER_MARKER_COUNT_BADGE_BG = 'exp-marker-count-badge-bg';
export const LAYER_MARKER_COUNT_BADGE_TEXT = 'exp-marker-count-badge-text';
/**
 * The three layers one pin is drawn with: its point, and the badge that says how
 * many places it stands for. Queried together, because a pointer over any of
 * them is a pointer over the same pin.
 */
export const MARKER_LAYERS = [
  LAYER_MARKERS, LAYER_MARKER_COUNT_BADGE_BG, LAYER_MARKER_COUNT_BADGE_TEXT,
] as const;
export const LAYER_HOVER_GLOW = 'exp-hover-glow';
export const LAYER_HOVER_RING = 'exp-hover-ring';
export const LAYER_HIGHLIGHT_RING = 'exp-highlight-ring';
export const LAYER_HIGHLIGHT_POINT = 'exp-highlight-point';

/**
 * A badge is drawn only on a pin that stands for more places than itself — a
 * folded pin, or a stand-in for places the batch does not hold. A place drawn as
 * itself carries a count of one, or none, and `coalesce` reads none as one.
 */
const BADGE_FILTER: FilterSpecification = ['>', ['coalesce', ['get', 'locationCount'], 1], 1];

// ── Layers ──

/**
 * One pin per place. No filter: the source as Map mode holds it never produces
 * an aggregate feature, and Discover, whose source clusters, adds the
 * not-a-cluster test itself as its declared difference.
 */
export const sceneMarkerLayer: CircleLayerSpecification = {
  id: LAYER_MARKERS,
  type: 'circle',
  source: SCENE_SOURCES.markers,
  paint: {
    // Decided once, in `experienceColor` (the kind's colour, refined by the type
    // where the types are told apart), and carried on the feature: a `match` on
    // the type value here has no literal to key a museum's blue on and drops a
    // monument into the fallback (#814).
    'circle-color': ['get', 'color'],
    'circle-radius': 6,
    'circle-stroke-width': 2,
    'circle-stroke-color': '#ffffff',
  },
};

export const sceneBadgeBgLayer: CircleLayerSpecification = {
  id: LAYER_MARKER_COUNT_BADGE_BG,
  type: 'circle',
  source: SCENE_SOURCES.markers,
  filter: BADGE_FILTER,
  paint: {
    'circle-color': '#0f172a',
    'circle-radius': 8,
    'circle-stroke-width': 1.5,
    'circle-stroke-color': '#ffffff',
    'circle-translate': [8, -8],
    'circle-translate-anchor': 'viewport',
  },
};

export const sceneBadgeTextLayer: SymbolLayerSpecification = {
  id: LAYER_MARKER_COUNT_BADGE_TEXT,
  type: 'symbol',
  source: SCENE_SOURCES.markers,
  filter: BADGE_FILTER,
  layout: {
    'text-field': ['to-string', ['get', 'locationCount']],
    'text-size': 9,
    'text-font': ['Open Sans Bold'],
    'text-offset': [0.88, -0.88],
    'text-anchor': 'center',
    'text-allow-overlap': true,
  },
  paint: {
    'text-color': '#ffffff',
    'text-halo-color': '#0f172a',
    'text-halo-width': 0.2,
  },
};

/** The selected object's places: a red ring around a red dot. */
export const sceneHighlightRingLayer: CircleLayerSpecification = {
  id: LAYER_HIGHLIGHT_RING,
  type: 'circle',
  source: SCENE_SOURCES.highlight,
  paint: {
    'circle-color': 'transparent',
    'circle-radius': 14,
    'circle-stroke-width': 3,
    'circle-stroke-color': '#ef4444',
    'circle-stroke-opacity': 0.8,
  },
};

export const sceneHighlightPointLayer: CircleLayerSpecification = {
  id: LAYER_HIGHLIGHT_POINT,
  type: 'circle',
  source: SCENE_SOURCES.highlight,
  paint: {
    'circle-color': '#ef4444',
    'circle-radius': 6,
    'circle-stroke-width': 2,
    'circle-stroke-color': '#ffffff',
  },
};

/**
 * The hover: a soft orange glow and a ring over it. Both radii are read off the
 * feature first, so a ring can be sized to sit outside a bubble it surrounds
 * (`buildSizedRing`); a plain point is ringed at the defaults.
 */
export const sceneHoverGlowLayer: CircleLayerSpecification = {
  id: LAYER_HOVER_GLOW,
  type: 'circle',
  source: SCENE_SOURCES.hover,
  paint: {
    'circle-color': '#f97316',
    'circle-radius': ['coalesce', ['get', 'hoverRadius'], 24],
    'circle-opacity': 0.18,
    'circle-blur': 0.6,
  },
};

export const sceneHoverRingLayer: CircleLayerSpecification = {
  id: LAYER_HOVER_RING,
  type: 'circle',
  source: SCENE_SOURCES.hover,
  paint: {
    'circle-color': 'transparent',
    'circle-radius': ['coalesce', ['get', 'ringRadius'], 18],
    'circle-stroke-width': 3,
    'circle-stroke-color': '#f97316',
    'circle-stroke-opacity': 1,
  },
};

/** A pin's layers, bottom to top: the point, then its badge over it. */
export const SCENE_MARKER_ORDER = [
  sceneMarkerLayer, sceneBadgeBgLayer, sceneBadgeTextLayer,
] as const;

/**
 * What is painted over the pins, bottom to top: the selection, then the hover.
 * The hover is on top because it answers the pointer, which can be over a
 * selected place as well as over a pin. Both maps add these in this order.
 */
export const SCENE_OVERLAY_ORDER = [
  sceneHighlightRingLayer, sceneHighlightPointLayer, sceneHoverGlowLayer, sceneHoverRingLayer,
] as const;

// ── Data ──

/**
 * What every hover source starts from, and what it goes back to when the
 * pointer leaves. One collection, shared: every file that writes a hover source
 * clears it, and identical literals are things to keep in step for no gain.
 */
export const EMPTY_FC: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };

/**
 * A ring sized to sit just outside a drawn circle of `radius` pixels — a
 * cluster bubble, which is bigger than the default ring and would swallow it.
 */
export function buildSizedRing(
  coordinates: [number, number],
  radius: number,
): GeoJSON.Feature<GeoJSON.Point> {
  return {
    type: 'Feature',
    geometry: { type: 'Point', coordinates },
    properties: { hoverRadius: radius + 10, ringRadius: radius + 4 },
  };
}

/**
 * The ring's payload: points with no properties — the hover layers paint a
 * plain point by geometry alone — then any rings sized to a bubble. Every
 * writer on both maps goes through here, so a property the layers start reading
 * is added once rather than at literals the compiler cannot connect.
 */
export function buildPointsHoverData(
  coords: [number, number][],
  sizedRings: ReadonlyArray<GeoJSON.Feature<GeoJSON.Point>> = [],
): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: [
      ...coords.map(c => ({
        type: 'Feature' as const,
        geometry: { type: 'Point' as const, coordinates: c },
        properties: {},
      })),
      ...sizedRings,
    ],
  };
}

/** The single-point case, which is most of the writers. */
export function buildPointHoverData(coords: [number, number]): GeoJSON.FeatureCollection {
  return buildPointsHoverData([coords]);
}

/** A place the highlight draws: where, which place (null for the object's own point), what it is called. */
export interface HighlightPlace {
  coordinates: [number, number];
  locationId: number | null;
  name: string;
}

/**
 * The highlight's payload. `locationId` is what a dot's hover names to the
 * panel, so a dot that stands for no one place — a folded object's, or the
 * object's own point when none of its places is at hand — carries null, and the
 * listeners that hand the hover over read null as "no place to name".
 */
export function buildHighlightData(places: ReadonlyArray<HighlightPlace>): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: places.map(p => ({
      type: 'Feature' as const,
      geometry: { type: 'Point' as const, coordinates: p.coordinates },
      properties: { locationId: p.locationId, name: p.name },
    })),
  };
}

/**
 * The markers source's payload: one feature per pin the builder made
 * (`buildExperienceMarkers`).
 */
export function buildMarkerFeatures(
  markers: ReadonlyArray<MarkerData>,
): GeoJSON.FeatureCollection<GeoJSON.Point> {
  return {
    type: 'FeatureCollection',
    features: markers.map((m) => ({
      type: 'Feature' as const,
      // The place's key, `${experienceId}-${locationId}` (`MarkerData.id`).
      // Nothing reads it back — the handlers ask for `experienceId` and
      // `locationId` — and MapLibre does not key feature-state by it: a string
      // id is parsed to its leading integer, which is the object's, so every
      // place of an object shares one. A layer that starts reading
      // feature-state here needs a numeric id of the place's own first.
      id: m.id,
      geometry: { type: 'Point' as const, coordinates: [m.longitude, m.latitude] },
      properties: {
        // No `id` here: the feature-level one above is what identifies a
        // marker, and nothing reads a property by that name — the handlers ask
        // for `experienceId`/`locationId`, the popup for the names, the badge
        // layers for `locationCount`.
        experienceId: m.experienceId,
        locationId: m.locationId,
        name: m.locationName || m.experience.name,
        experienceName: m.experience.name,
        // The pin's colour, decided once for every surface (`experienceColor`):
        // the kind's, refined by the type where the types are told apart.
        color: experienceColor(m.experience.kind_id, m.experience.type),
        // 1 for a place drawn as itself, the count only for a pin standing in
        // for places it does not draw — which is what the badge means.
        locationCount: m.locationCount,
        // Whether this pin was drawn folded, which a click needs and cannot
        // infer: a stand-in pin looks the same from the outside.
        folded: m.folded === true,
      },
    })),
  };
}
