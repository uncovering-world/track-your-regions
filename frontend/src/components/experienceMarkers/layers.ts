/**
 * The sources, layers and zoom thresholds Map Mode's experience layer is made of.
 *
 * Split out of `ExperienceMarkers` under the 800-line rule in
 * `docs/tech/development-guide.md`: these are declarations, and the component
 * that reads them is behaviour. Each paint property here is set against a
 * specific failure, and those reasons are kept with the property rather than in
 * the component, so a future edit meets them where the value is.
 */

import type { LayerProps } from 'react-map-gl/maplibre';

export const SOURCE_MARKERS = 'exp-markers';
const LAYER_HEAT = 'exp-heatmap';
/** Below this, density; from it, individual markers. */
const HEATMAP_MAX_ZOOM = 5;

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
const MARKER_FADE_START = HEATMAP_MAX_ZOOM - 0.5;

export const SOURCE_HIGHLIGHT = 'exp-highlight';
export const SOURCE_HOVER = 'exp-hover';

/**
 * What every hover source starts from, and what it goes back to when the
 * pointer leaves. One collection, shared: both files that write to
 * `SOURCE_HOVER` clear it, and two identical literals are two things to keep
 * in step for no gain.
 */
export const EMPTY_FC: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };

/**
 * The ring's payload: points, no properties — the hover layers paint by geometry
 * alone. Every writer goes through here (a marker hovered, a highlight dot
 * hovered, a place row, an object row ringing all of its places), so a property
 * the layers start reading is added once rather than at four literals the
 * compiler cannot connect.
 */
export function buildPointsHoverData(coords: [number, number][]): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: coords.map(c => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: c },
      properties: {},
    })),
  };
}

/** The single-point case, which is three of the four writers. */
export function buildPointHoverData(coords: [number, number]): GeoJSON.FeatureCollection {
  return buildPointsHoverData([coords]);
}

// Layer IDs
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
const LAYER_HOVER_GLOW = 'exp-hover-glow';
const LAYER_HOVER_RING = 'exp-hover-ring';
const LAYER_HIGHLIGHT_RING = 'exp-highlight-ring';
export const LAYER_HIGHLIGHT_POINT = 'exp-highlight-point';

// ── Layer style definitions ──

/**
 * Density instead of counts at overview zoom.
 *
 * Replaces clustering rather than sitting beside it: a clustered source cannot
 * drive a heatmap, because MapLibre substitutes aggregates for the points and
 * the heat would be computed from cluster centroids. With `cluster` off, the
 * one source serves both this and the individual markers above the threshold.
 */
export const heatmapLayer: LayerProps = {
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
    // quarter as many and density falls about fourfold per level — which is what
    // used to make the layer fade out on the way in. The gain arrives where that
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
 * No `point_count` filter on the marker layers. With `cluster` off the source
 * never produces an aggregate feature, so `['!', ['has', 'point_count']]` held
 * for every feature it would ever see — a filter that selected nothing and read
 * as if clustering were still in play.
 */
export const markerLayer: LayerProps = {
  id: LAYER_MARKERS,
  minzoom: MARKER_FADE_START,
  type: 'circle',
  source: SOURCE_MARKERS,
  paint: {
    'circle-color': [
      'match', ['get', 'category'],
      'cultural', '#8B5CF6',
      // Museums, named rather than left to the fallback below — which is also
      // what public art takes, and the two must not share a pin colour.
      'art', '#2563EB',
      'natural', '#10B981',
      'mixed', '#F59E0B',
      '#0d9488',
    ],
    'circle-radius': 6,
    'circle-stroke-width': 2,
    'circle-stroke-color': '#ffffff',
    'circle-opacity': ['interpolate', ['linear'], ['zoom'],
      MARKER_FADE_START, 0, HEATMAP_MAX_ZOOM, 1],
    'circle-stroke-opacity': ['interpolate', ['linear'], ['zoom'],
      MARKER_FADE_START, 0, HEATMAP_MAX_ZOOM, 1],
  },
};

export const markerCountBadgeBgLayer: LayerProps = {
  id: LAYER_MARKER_COUNT_BADGE_BG,
  minzoom: MARKER_FADE_START,
  type: 'circle',
  source: SOURCE_MARKERS,
  filter: ['>', ['coalesce', ['get', 'locationCount'], 1], 1],
  paint: {
    'circle-color': '#0f172a',
    'circle-radius': 8,
    'circle-stroke-width': 1.5,
    'circle-stroke-color': '#ffffff',
    'circle-translate': [8, -8],
    'circle-translate-anchor': 'viewport',
    'circle-opacity': ['interpolate', ['linear'], ['zoom'],
      MARKER_FADE_START, 0, HEATMAP_MAX_ZOOM, 1],
    'circle-stroke-opacity': ['interpolate', ['linear'], ['zoom'],
      MARKER_FADE_START, 0, HEATMAP_MAX_ZOOM, 1],
  },
};

export const markerCountBadgeTextLayer: LayerProps = {
  id: LAYER_MARKER_COUNT_BADGE_TEXT,
  minzoom: MARKER_FADE_START,
  type: 'symbol',
  source: SOURCE_MARKERS,
  filter: ['>', ['coalesce', ['get', 'locationCount'], 1], 1],
  layout: {
    'text-field': ['to-string', ['get', 'locationCount']],
    'text-size': 9,
    'text-font': ['Open Sans Bold'],
    'text-offset': [0.88, -0.88],
    'text-anchor': 'center',
    'text-allow-overlap': true,
  },
  paint: {
    'text-opacity': ['interpolate', ['linear'], ['zoom'],
      MARKER_FADE_START, 0, HEATMAP_MAX_ZOOM, 1],
    'text-color': '#ffffff',
    'text-halo-color': '#0f172a',
    'text-halo-width': 0.2,
  },
};

export const hoverGlowLayer: LayerProps = {
  id: LAYER_HOVER_GLOW,
  type: 'circle',
  source: SOURCE_HOVER,
  paint: {
    'circle-color': '#f97316',
    'circle-radius': ['coalesce', ['get', 'hoverRadius'], 24],
    'circle-opacity': 0.18,
    'circle-blur': 0.6,
  },
};

export const hoverRingLayer: LayerProps = {
  id: LAYER_HOVER_RING,
  type: 'circle',
  source: SOURCE_HOVER,
  paint: {
    'circle-color': 'transparent',
    'circle-radius': ['coalesce', ['get', 'ringRadius'], 18],
    'circle-stroke-width': 3,
    'circle-stroke-color': '#f97316',
    'circle-stroke-opacity': 1,
  },
};

export const highlightRingLayer: LayerProps = {
  id: LAYER_HIGHLIGHT_RING,
  type: 'circle',
  source: SOURCE_HIGHLIGHT,
  paint: {
    'circle-color': 'transparent',
    'circle-radius': 14,
    'circle-stroke-width': 3,
    'circle-stroke-color': '#ef4444',
    'circle-stroke-opacity': 0.8,
  },
};

export const highlightPointLayer: LayerProps = {
  id: LAYER_HIGHLIGHT_POINT,
  type: 'circle',
  source: SOURCE_HIGHLIGHT,
  paint: {
    'circle-color': '#ef4444',
    'circle-radius': 6,
    'circle-stroke-width': 2,
    'circle-stroke-color': '#ffffff',
  },
};
