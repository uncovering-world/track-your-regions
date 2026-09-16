/**
 * The world layer's source and layers: a kind's places across the whole world,
 * before any region is chosen (#910).
 *
 * Everything about *how* a place is drawn is the region layer's, spread from
 * `layers.ts` rather than restated — the heatmap's three tuned paint properties,
 * the marker's radius and its cross-fade with the heat, the count badge's
 * offset. Two point layers on one map that disagreed about any of those would
 * read as two different things being shown. What this file changes is only what
 * has to change when the features come out of a vector tile instead of a
 * `FeatureCollection` this app built:
 *
 * - the **source**, which is Martin's `tile_experience_points` and needs a
 *   `source-layer` name;
 * - the **colour**, which the region layer is handed as a property per marker
 *   and this one has to derive from the kind and the type MapLibre can see
 *   (`kindColorExpression`, generated from the one palette — #814);
 * - the **fold**, which here is a filter rather than a rebuilt marker set: the
 *   tile flags each object's reader position, so one pin per object is
 *   `['has', 'main']` and costs no request.
 */

import type { LayerProps } from 'react-map-gl/maplibre';
import type { FilterSpecification } from 'maplibre-gl';
import {
  HEATMAP_MAX_ZOOM, heatmapLayer, hoverGlowLayer, hoverRingLayer,
  markerLayer, markerCountBadgeBgLayer, markerCountBadgeTextLayer,
} from './layers';
import { kindColorExpression } from '../../utils/kindColors';

/** The map source the world layer's tiles are attached as. */
export const SOURCE_WORLD_POINTS = 'world-points';

/** The layer name inside the tile, as `ST_AsMVT` writes it. */
const WORLD_POINTS_SOURCE_LAYER = 'points';

/** The hover ring's own source — the region layer's is not mounted at world level. */
export const SOURCE_WORLD_HOVER = 'world-hover';

/**
 * And its two layers, the region ring's paint over that source.
 *
 * Ids of their own rather than the region layer's, although the two are never
 * mounted together: a duplicate layer id is a MapLibre error at add time, and
 * "they cannot both be on screen" is a fact about this app that the style does
 * not know.
 */
export const worldHoverGlowLayer: LayerProps = {
  ...hoverGlowLayer, id: 'world-hover-glow', source: SOURCE_WORLD_HOVER,
};
export const worldHoverRingLayer: LayerProps = {
  ...hoverRingLayer, id: 'world-hover-ring', source: SOURCE_WORLD_HOVER,
};

const LAYER_WORLD_HEAT = 'world-points-heat';
const LAYER_WORLD_MARKERS = 'world-points-markers';
const LAYER_WORLD_BADGE_BG = 'world-points-badge-bg';
const LAYER_WORLD_BADGE_TEXT = 'world-points-badge-text';

/**
 * The three layers a world pin is drawn with, queried together: a pointer over
 * the badge is a pointer over the pin it belongs to.
 */
export const WORLD_MARKER_LAYERS = [
  LAYER_WORLD_MARKERS, LAYER_WORLD_BADGE_BG, LAYER_WORLD_BADGE_TEXT,
] as const;

/** What a layer of this source needs beyond the region layer's own definition. */
const onTiles = { source: SOURCE_WORLD_POINTS, 'source-layer': WORLD_POINTS_SOURCE_LAYER };

/**
 * The heat, with one number of its own: how hard the ramp is driven.
 *
 * The radius, the palette and the cross-fade are the region layer's, and every
 * reason written beside them there holds here. The **intensity** cannot be,
 * because the two layers are looking at different amounts of world. A region's
 * map is zoomed to that region; this one holds the whole catalogue on one
 * screen — 8 830 points, of which some 1 800 are in Europe — and at the region
 * layer's overview value Europe came out as a single flat amber mass from
 * Ireland to the Caucasus, which is the exact failure the note on
 * `heatmap-intensity` next door describes: saturated density cannot be
 * separated by any palette, because every such pixel asks the ramp for the same
 * value.
 *
 * So the overview is driven roughly twenty times softer, which is the factor
 * the density is over by: about a hundred points fall inside one 16 px kernel
 * over Italy at zoom 1, and the ramp clamps above one. The climb back is the
 * region layer's, arriving where the markers do — by the time the heat is
 * fading out at zoom 5 the two layers are drawing the same thing again, and
 * the numbers there have to agree for the fade to look like one handover.
 *
 * The fold applies here as much as to the pins, which is why the tile carries
 * `main` at every zoom rather than only where a name is worth sending. Measured
 * on the screen: the Rock Art of the Mediterranean Basin is one site and 734
 * rock shelters, and unfolded they saturate eastern Spain from Valencia to the
 * Pyrenees at zoom 4 — a reader judging where the world's World Heritage is
 * reads that as the densest place in Europe. Folded, the same site is one
 * point, and the heat answers "how many sites are here" instead of "how many
 * places".
 *
 * **The ruler does not change with the fold**, and that is deliberate: folded,
 * the World Heritage map is drawn from 1 272 points instead of 6 347, so it
 * comes out five times fainter, and that faintness is the answer. Scaling the
 * intensity to compensate would make the two pictures incomparable and would
 * have to be a different factor per kind — 5 for World Heritage, 2.3 across all
 * kinds, 1 for the art museums, every one of which is a single place. One
 * ruler, so that "hotter" means "more to go to" in both states and the
 * difference between them is exactly the serial sites.
 */
export function worldHeatmapLayer(folded: boolean): LayerProps {
  return {
    ...heatmapLayer,
    id: LAYER_WORLD_HEAT,
    ...onTiles,
    ...(folded ? { filter: ['has', 'main'] } : {}),
    paint: {
      ...heatmapLayer.paint,
      'heatmap-intensity': ['interpolate', ['linear'], ['zoom'],
        0, 0.012, 2, 0.05, 3, 0.15, 4, 0.6, HEATMAP_MAX_ZOOM, 3],
    },
  };
}

/** One pin per place, or — folded — one per object, at the place the catalogue answers with. */
export function worldMarkerLayer(folded: boolean): LayerProps {
  return {
    ...markerLayer,
    id: LAYER_WORLD_MARKERS,
    ...onTiles,
    ...(folded ? { filter: ['has', 'main'] } : {}),
    paint: { ...markerLayer.paint, 'circle-color': kindColorExpression() },
  };
}

/**
 * The badge, and only while folded.
 *
 * It says "places this pin stands for", which unfolded is always one: every
 * feature is its own place. The tile puts `locationCount` on the fold's pin
 * alone, so the count filter would already hide it everywhere else — the
 * `main` term is here so that the badge cannot outlive a fold being dropped
 * in a render the source has not answered yet.
 */
export function worldBadgeLayers(folded: boolean): LayerProps[] {
  if (!folded) return [];
  // Cast for the reason `clusterRadiusExpression` casts: the style spec's types
  // cannot describe a filter composed out of another one, and writing the count
  // test out again here is how the badge starts disagreeing with the region
  // layer's about what a count means.
  const whileFolded = (filter: FilterSpecification | undefined): FilterSpecification =>
    ['all', ['has', 'main'], filter] as unknown as FilterSpecification;
  return [
    {
      ...markerCountBadgeBgLayer,
      id: LAYER_WORLD_BADGE_BG,
      ...onTiles,
      filter: whileFolded(markerCountBadgeBgLayer.filter),
    },
    {
      ...markerCountBadgeTextLayer,
      id: LAYER_WORLD_BADGE_TEXT,
      ...onTiles,
      filter: whileFolded(markerCountBadgeTextLayer.filter),
    },
  ];
}
