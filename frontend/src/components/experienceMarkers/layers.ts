/**
 * The sources, layers and zoom thresholds Map Mode's experience layer is made of.
 *
 * Split out of `ExperienceMarkers` under the 800-line rule in
 * `docs/tech/development-guide.md`: these are declarations, and the component
 * that reads them is behaviour. Each paint property here is set against a
 * specific failure, and those reasons are kept with the property rather than in
 * the component, so a future edit meets them where the value is.
 *
 * The pin, its badge, the highlight and the hover ring are not declared here
 * but in `scene.ts`, which Discover draws from as well (#1132). What this file
 * adds to them is Map mode's own: the heatmap they cross-fade with. The extent
 * outline is Map mode's alone and stays here whole.
 */

import type { LayerProps } from 'react-map-gl/maplibre';
import type { ExpressionSpecification } from 'maplibre-gl';
import {
  SCENE_SOURCES, EMPTY_FC,
  sceneMarkerLayer, sceneSplitMarkerLayer, sceneBadgeBgLayer, sceneBadgeTextLayer,
  sceneHoverGlowLayer, sceneHoverRingLayer, sceneHighlightRingLayer, sceneHighlightPointLayer,
} from './scene';

// What the rest of Map mode imports from here, declared once in the scene.
export {
  EMPTY_FC, buildPointHoverData, buildPointsHoverData,
  LAYER_MARKERS, LAYER_MARKER_COUNT_BADGE_BG, LAYER_MARKER_COUNT_BADGE_TEXT,
  MARKER_LAYERS, LAYER_HIGHLIGHT_POINT,
} from './scene';

/**
 * The three shapes of layer this file declares, named so that a definition can
 * be *spread* into another one. `LayerProps` is a union over every layer type,
 * and spreading a value typed as the union loses the discriminant, so the world
 * layer — which is these layers over its own GeoJSON source (`worldPointLayers.ts`) —
 * could not be built from them without restating their paint.
 */
type CircleLayerProps = Extract<LayerProps, { type: 'circle' }>;
type HeatmapLayerProps = Extract<LayerProps, { type: 'heatmap' }>;
type SymbolLayerProps = Extract<LayerProps, { type: 'symbol' }>;

export const SOURCE_MARKERS = SCENE_SOURCES.markers;
const LAYER_HEAT = 'exp-heatmap';
/**
 * Below this, density; from it, individual markers.
 *
 * Exported because the world layer draws the same two ways at the same two
 * zooms (#910): `worldPointsView.ts` reads `MARKER_FADE_START` to decide which
 * of the endpoint's two tiers to ask for, so the read that carries names is in
 * hand by the time the first pin fades in. Nothing in the backend reads these
 * constants — the first build of that layer was a tile function that did, and
 * ADR-0061 chose against it.
 */
export const HEATMAP_MAX_ZOOM = 5;

/**
 * Where the markers start fading in — the same zoom at which the heat starts
 * fading out, so the two cross instead of one ending where the other begins.
 *
 * `minzoom` alone cannot do this. It is a hard cutoff: MapLibre applies no
 * cross-fade to circle or symbol layers at a zoom bound, so markers pinned to
 * HEATMAP_MAX_ZOOM appeared at exactly z5 while the heat had already ramped to
 * nothing over the half level below it. At z4.9 that left heat at ~0.17 and no
 * markers at all — a one-sided fade with a dip in it. Both layers now span the
 * band and ramp their opacity across it in opposite directions.
 */
export const MARKER_FADE_START = HEATMAP_MAX_ZOOM - 0.5;

export const SOURCE_HIGHLIGHT = SCENE_SOURCES.highlight;
export const SOURCE_HOVER = SCENE_SOURCES.hover;

/**
 * The outline of the place the reader is looking at, where the catalogue has
 * one: an archaeology site's excavation boundary as OpenStreetMap drew it
 * (ADR-0059). One place at a time — whichever is hovered, else whichever is
 * selected — because it answers the question "how big is this, on the ground",
 * and a map of every outline at once is a different feature (a tile layer,
 * waiting on #755).
 */
export const SOURCE_EXTENT = 'exp-extent';

/**
 * The extent source's payload: one feature carrying the colour its pin is drawn
 * in, so the outline and the marker read as the same object.
 *
 * The colour rides on the feature rather than on the layer for the reason the
 * markers' does (#814): a paint expression keyed on a literal hangs a kind's
 * colour on a value some other kind also carries, and the same object then
 * reads two colours depending on where you look at it.
 */
export function buildExtentData(
  boundary: GeoJSON.Geometry | null | undefined,
  color: string,
): GeoJSON.FeatureCollection {
  if (!boundary) return EMPTY_FC;
  return {
    type: 'FeatureCollection',
    features: [{ type: 'Feature', geometry: boundary, properties: { color } }],
  };
}

// ── Layer style definitions ──

/**
 * Density instead of counts at overview zoom.
 *
 * Replaces clustering rather than sitting beside it: a clustered source cannot
 * drive a heatmap, because MapLibre substitutes aggregates for the points and
 * the heat would be computed from cluster centroids. With `cluster` off, the
 * one source serves both this and the individual markers above the threshold.
 */
export const heatmapLayer: HeatmapLayerProps = {
  id: LAYER_HEAT,
  type: 'heatmap',
  source: SOURCE_MARKERS,
  maxzoom: HEATMAP_MAX_ZOOM,
  paint: {
    'heatmap-weight': 1,
    // The radius stays flat on purpose. It is in screen pixels, so zooming in
    // spreads the points across more of the screen while the blur stays the same
    // size — which is what makes a blob resolve into the finer structure inside
    // it. Growing the radius with zoom cancels exactly that, and the map then
    // shows the same clumps at every level.
    'heatmap-radius': 16,
    // Intensity is the one that has to move, and it is the ruler that can: it
    // scales density before the colour ramp reads it, so it changes what the
    // ramp sees without touching the spatial scale the radius sets.
    //
    // It runs WELL below one on the overview on purpose, and the number is set
    // by a specific question: what should a single lone point look like?
    //
    // At one, the answer was "the same as Rome". A lone marker peaks near the
    // top of the ramp all by itself, so Kazan with one site and Rome with twenty
    // both came out the hottest colour — the ramp was saturated before points
    // ever began to accumulate, and no palette can separate "dense" from
    // "denser" when every one of those pixels asks it for the same value. That
    // is also what made Europe read as one blob. Held down here, a lone point
    // lands in the lower third — visible, clearly cold — and the hot end is left
    // to places where points genuinely pile up.
    //
    // The climb is late for the opposite reason. Each zoom level doubles the
    // on-screen distance between points, so a fixed radius covers roughly a
    // quarter as many and density falls about fourfold per level, which would
    // fade the layer out on the way in. The gain arrives where that
    // loss does, past zoom 3, rather than on the overview where it only floods.
    'heatmap-intensity': ['interpolate', ['linear'], ['zoom'],
      0, 0.22, 3, 0.4, HEATMAP_MAX_ZOOM, 3],
    // Inferno, cold to hot. Replaces a single teal at varying alpha, which could
    // say "something is here" but not "much more here than there" — one hue
    // separates presence from absence and nothing else. Zero stays fully
    // transparent; lifting it would tint the ocean.
    'heatmap-color': [
      'interpolate', ['linear'], ['heatmap-density'],
      0, 'rgba(59, 15, 112, 0)',
      0.15, 'rgba(59, 15, 112, 0.5)',
      0.35, 'rgba(140, 41, 129, 0.68)',
      0.55, 'rgba(222, 73, 104, 0.78)',
      0.75, 'rgba(254, 159, 109, 0.85)',
      1, 'rgba(254, 207, 146, 0.92)',
    ],
    // Fades out across the same band the markers fade in over, so the two cross
    // rather than hand over at a line. Held at full strength until that band
    // starts: spread across a whole level, the fade itself read as the layer
    // dying before anything replaced it.
    'heatmap-opacity': ['interpolate', ['linear'], ['zoom'],
      0, 0.85, MARKER_FADE_START, 0.85, HEATMAP_MAX_ZOOM, 0],
  },
};

/**
 * The pins fade in across the band the heat fades out over. The ramp is one
 * value for every pin layer, so the point, its badge and the badge's number
 * arrive together.
 */
const FADE_IN: ExpressionSpecification = ['interpolate', ['linear'], ['zoom'],
  MARKER_FADE_START, 0, HEATMAP_MAX_ZOOM, 1];

/**
 * The scene's pin (`scene.ts`), plus what only this map has: the cross-fade
 * with the heatmap, as a `minzoom` at the start of the band and an opacity ramp
 * across it. Everything else — colour, radius, stroke — is the scene's, and
 * Discover draws the same definition.
 *
 * No `point_count` filter on the marker layers. With `cluster` off the source
 * never produces an aggregate feature, so `['!', ['has', 'point_count']]` held
 * for every feature it would ever see — a filter that selected nothing and read
 * as if clustering were still in play.
 */
export const markerLayer: CircleLayerProps = {
  ...sceneMarkerLayer,
  minzoom: MARKER_FADE_START,
  paint: {
    ...sceneMarkerLayer.paint,
    'circle-opacity': FADE_IN,
    'circle-stroke-opacity': FADE_IN,
  },
};

/** The split disc of a pin that shows several kinds (#1262), fading in with the pin under it. */
export const markerSplitLayer: SymbolLayerProps = {
  ...sceneSplitMarkerLayer,
  minzoom: MARKER_FADE_START,
  paint: { 'icon-opacity': FADE_IN },
};

export const markerCountBadgeBgLayer: CircleLayerProps = {
  ...sceneBadgeBgLayer,
  minzoom: MARKER_FADE_START,
  paint: {
    ...sceneBadgeBgLayer.paint,
    'circle-opacity': FADE_IN,
    'circle-stroke-opacity': FADE_IN,
  },
};

export const markerCountBadgeTextLayer: SymbolLayerProps = {
  ...sceneBadgeTextLayer,
  minzoom: MARKER_FADE_START,
  paint: {
    ...sceneBadgeTextLayer.paint,
    'text-opacity': FADE_IN,
  },
};

// The selection and the hover are the scene's as they stand: nothing about them
// changes with the heatmap, so this map adds nothing to them.
export const hoverGlowLayer: CircleLayerProps = sceneHoverGlowLayer;
export const hoverRingLayer: CircleLayerProps = sceneHoverRingLayer;
export const highlightRingLayer: LayerProps = sceneHighlightRingLayer;
export const highlightPointLayer: LayerProps = sceneHighlightPointLayer;

const LAYER_EXTENT_FILL = 'exp-extent-fill';
const LAYER_EXTENT_LINE = 'exp-extent-line';

/**
 * The wash inside the outline.
 *
 * 15%, and the number is against a specific failure: at 30% the basemap's own
 * place names stopped being readable inside Pompeii, and a traveller reading a
 * site's outline is usually reading the streets under it at the same time. The
 * fallback colour is Archaeology's amber-brown, which is the only kind with an
 * extent today; the feature's own colour is what actually paints.
 */
export const extentFillLayer: LayerProps = {
  id: LAYER_EXTENT_FILL,
  type: 'fill',
  source: SOURCE_EXTENT,
  paint: {
    'fill-color': ['coalesce', ['get', 'color'], '#B45309'],
    'fill-opacity': 0.15,
  },
};

/**
 * And the outline itself, which is what actually says where the site ends.
 *
 * Two pixels at nine tenths opacity: the fill can be faint because the line is
 * not, and the tenth that is left keeps a basemap label crossing the boundary
 * legible under it. Both layers are rendered before the marker sources, so
 * every pin and badge paints over them — MapLibre draws in the order layers are
 * added, and an outline over a pin would hide the thing the reader clicked.
 */
export const extentLineLayer: LayerProps = {
  id: LAYER_EXTENT_LINE,
  type: 'line',
  source: SOURCE_EXTENT,
  paint: {
    'line-color': ['coalesce', ['get', 'color'], '#B45309'],
    'line-width': 2,
    'line-opacity': 0.9,
  },
};
