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
/** The split disc drawn over a pin that shows several kinds (#1262). */
export const LAYER_MARKERS_SPLIT = 'exp-markers-split';
export const LAYER_MARKER_COUNT_BADGE_BG = 'exp-marker-count-badge-bg';
export const LAYER_MARKER_COUNT_BADGE_TEXT = 'exp-marker-count-badge-text';
/**
 * The layers one pin is drawn with: its point, the split disc over a pin that
 * shows several kinds, and the badge that says how many places it stands for.
 * Queried together, because a pointer over any of them is a pointer over the
 * same pin.
 */
export const MARKER_LAYERS = [
  LAYER_MARKERS, LAYER_MARKERS_SPLIT, LAYER_MARKER_COUNT_BADGE_BG, LAYER_MARKER_COUNT_BADGE_TEXT,
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

/**
 * A pin that shows several kinds of a place, drawn over its plain disc as a disc
 * split into one slice per kind (#1262): the Capitoline Museums half blue for
 * Art Museums and half brown for Archaeology. The image is drawn on first use
 * from the colours its name carries (`addSplitPinImages`). The split disc is one
 * of the pin's interactive layers (`MARKER_LAYERS`); the plain disc under it is
 * what shows if the image cannot be drawn.
 */
export const sceneSplitMarkerLayer: SymbolLayerSpecification = {
  id: LAYER_MARKERS_SPLIT,
  type: 'symbol',
  source: SCENE_SOURCES.markers,
  filter: ['has', 'icon'],
  layout: {
    'icon-image': ['get', 'icon'],
    'icon-allow-overlap': true,
    'icon-ignore-placement': true,
  },
};

/** A pin's layers, bottom to top: the point, its split disc, then its badge over it. */
export const SCENE_MARKER_ORDER = [
  sceneMarkerLayer, sceneSplitMarkerLayer, sceneBadgeBgLayer, sceneBadgeTextLayer,
] as const;

/** The image name of a split pin: its colours, in the kinds' display order. */
const SPLIT_PIN_PREFIX = 'pin-split:';
export function splitPinIcon(colors: readonly string[]): string {
  return `${SPLIT_PIN_PREFIX}${colors.join(',')}`;
}

/**
 * The split disc of a pin whose kinds have these colours, one slice per kind,
 * on both maps; undefined where every slice would be one colour, so the plain
 * disc is drawn.
 */
export function splitPinIconFor(colors: readonly string[]): string | undefined {
  return new Set(colors).size > 1 ? splitPinIcon(colors) : undefined;
}

/** The disc's radius and stroke, the plain pin's (`sceneMarkerLayer`). */
const PIN_RADIUS = 6;
const PIN_STROKE = 2;
const PIXEL_RATIO = 2;

/**
 * A split disc as MapLibre takes an image, or null where no canvas can be had
 * (a test's DOM, a browser that refuses one): the plain disc under it stays.
 */
export function drawSplitPin(colors: readonly string[]): { width: number; height: number; data: Uint8ClampedArray } | null {
  const size = (PIN_RADIUS + PIN_STROKE) * 2 * PIXEL_RATIO;
  const canvas = typeof document === 'undefined' ? null : document.createElement('canvas');
  const ctx = canvas?.getContext('2d');
  if (!canvas || !ctx) return null;
  canvas.width = size;
  canvas.height = size;
  const centre = size / 2;
  const radius = PIN_RADIUS * PIXEL_RATIO;
  colors.forEach((color, i) => {
    const from = -Math.PI / 2 + (2 * Math.PI * i) / colors.length;
    const to = -Math.PI / 2 + (2 * Math.PI * (i + 1)) / colors.length;
    ctx.beginPath();
    ctx.moveTo(centre, centre);
    ctx.arc(centre, centre, radius, from, to);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
  });
  // MapLibre draws a circle's stroke outside its radius, so the ring is centred
  // half a stroke out: a split pin is the plain pin's size, not a smaller disc.
  ctx.beginPath();
  ctx.arc(centre, centre, (PIN_RADIUS + PIN_STROKE / 2) * PIXEL_RATIO, 0, 2 * Math.PI);
  ctx.lineWidth = PIN_STROKE * PIXEL_RATIO;
  ctx.strokeStyle = '#ffffff';
  ctx.stroke();
  return { width: size, height: size, data: ctx.getImageData(0, 0, size, size).data };
}

/** The part of a map this needs, so a test can hand in a stand-in. */
interface ImageHost {
  on(type: 'styleimagemissing', listener: (e: { id: string }) => void): unknown;
  off(type: 'styleimagemissing', listener: (e: { id: string }) => void): unknown;
  hasImage(id: string): boolean;
  addImage(id: string, image: { width: number; height: number; data: Uint8ClampedArray }, options: { pixelRatio: number }): unknown;
}

/**
 * Draw a split pin's image the first time the map asks for it, on either map
 * (#1262). Returns the way to stop.
 */
export function addSplitPinImages(map: ImageHost): () => void {
  const onMissing = (e: { id: string }) => {
    if (!e.id.startsWith(SPLIT_PIN_PREFIX) || map.hasImage(e.id)) return;
    const image = drawSplitPin(e.id.slice(SPLIT_PIN_PREFIX.length).split(','));
    if (image) map.addImage(e.id, image, { pixelRatio: PIXEL_RATIO });
  };
  map.on('styleimagemissing', onMissing);
  return () => { map.off('styleimagemissing', onMissing); };
}

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

/** A marker's `icon` property, present only where its kinds split the disc. */
function splitIconProperty(colors: readonly string[] | undefined): { icon?: string } {
  const icon = colors ? splitPinIconFor(colors) : undefined;
  return icon ? { icon } : {};
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
        color: m.kindColors?.[0] ?? experienceColor(m.experience.kind_id, m.experience.type),
        // A pin that shows several kinds of the place draws them as a split disc (#1262).
        ...splitIconProperty(m.kindColors),
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
