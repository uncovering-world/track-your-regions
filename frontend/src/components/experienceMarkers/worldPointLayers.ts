/**
 * The world layer's source and layers: a kind's places across the whole world,
 * before any region is chosen (#910).
 *
 * Everything about *how* a place is drawn is the region layer's, spread from
 * `layers.ts` rather than restated — the heatmap's tuned paint, the marker's
 * radius and its cross-fade with the heat, the count badge's offset and filter.
 * Two point layers on one map that disagreed about any of those would read as
 * two different things being shown. What this file changes is only what has to
 * change when the features come from the catalogue's own endpoint:
 *
 * - the **colour**, which the region layer is handed as a property per marker
 *   and this one derives from the kind and the type (`kindColorExpression`,
 *   generated from the one palette — #814);
 * - the **intensity** of the heat, which is the one number a world of points
 *   cannot share with a region's;
 * - and **nothing about the fold**, which is the difference from the first
 *   build of this layer. A tile had to carry every place and flag the one each
 *   object folds to, because a tile is cached under its URL and must answer
 *   both states; the endpoint is asked for the state that is being drawn and
 *   answers only that. So there is no `['has', 'main']` filter here, and the
 *   folded World Heritage map is 1 272 points rather than 6 347 sent and 5 075
 *   filtered away.
 */

import type { LayerProps } from 'react-map-gl/maplibre';
import {
  HEATMAP_MAX_ZOOM, heatmapLayer, hoverGlowLayer, hoverRingLayer,
  markerLayer, markerCountBadgeBgLayer, markerCountBadgeTextLayer,
} from './layers';
import { kindColorExpression } from '../../utils/kindColors';

/** The map source the world layer's points are attached as. */
export const SOURCE_WORLD_POINTS = 'world-points';

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
const LAYER_WORLD_CAPPED = 'world-points-capped';
const LAYER_WORLD_BADGE_BG = 'world-points-badge-bg';
const LAYER_WORLD_BADGE_TEXT = 'world-points-badge-text';

/**
 * Every layer a world pin can be drawn by, queried together: a pointer over the
 * badge is a pointer over the pin it belongs to, and a capped read's pins are
 * pins.
 *
 * **This list is what answers a pointer, so a drawable pin layer missing from
 * it is a pin that cannot be hovered and a click that falls through to the
 * region underneath** — `useWorldPointInteractions` and `useMapInteractions`
 * both filter it, and the second returns false when nothing in it is drawn,
 * which is what lets a click reach the map. The capped layer was added without
 * being listed here, and in the truncated state it is the *only* visible pin
 * layer, so every pin on that map would have selected a division instead of
 * opening a place.
 *
 * Listing a layer the style does not currently hold costs nothing: both callers
 * ask `map.getLayer` per event, which is what the badge layers coming and going
 * with the fold already requires. So the rule is to list every pin layer this
 * module can produce, drawn or not.
 */
export const WORLD_MARKER_LAYERS = [
  LAYER_WORLD_MARKERS, LAYER_WORLD_CAPPED, LAYER_WORLD_BADGE_BG, LAYER_WORLD_BADGE_TEXT,
] as const;

/** What a layer of this source needs beyond the region layer's own definition. */
const onSource = { source: SOURCE_WORLD_POINTS };

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
 * over Italy at zoom 1, and the ramp clamps above one. The climb back arrives
 * where the markers do — by the time the heat is fading out at zoom 5 the two
 * layers are drawing the same thing again, and the numbers there have to agree
 * for the fade to look like one handover.
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
export const worldHeatmapLayer: LayerProps = {
  ...heatmapLayer,
  id: LAYER_WORLD_HEAT,
  ...onSource,
  paint: {
    ...heatmapLayer.paint,
    'heatmap-intensity': ['interpolate', ['linear'], ['zoom'],
      0, 0.012, 2, 0.05, 3, 0.15, 4, 0.6, HEATMAP_MAX_ZOOM, 3],
  },
};

/** One pin per place, or — folded — one per object, at the place the catalogue answers with. */
export const worldMarkerLayer: LayerProps = {
  ...markerLayer,
  id: LAYER_WORLD_MARKERS,
  ...onSource,
  paint: { ...markerLayer.paint, 'circle-color': kindColorExpression() },
};

/**
 * The pins, at every zoom, for a read the endpoint had to cap.
 *
 * The heat is the thing that lies about a truncated set — it would show the
 * catalogue as thinner exactly where it is thickest — so the layer drops it and
 * draws the places themselves instead. Each one is a true statement about
 * somewhere a traveller can go, whether or not others were left out; a density
 * is not.
 *
 * It needs a definition of its own rather than the marker layer above because
 * that one starts at `MARKER_FADE_START` and fades in across the band, and the
 * tier that reaches the cap first is the overview — the unboxed whole-world read
 * — which is served entirely *below* the band. Dropping the heat there without
 * this would leave four layers in the style with nothing visible in any of them
 * and nothing saying why.
 *
 * **Below the band these pins carry no identity, and that is the overview tier's
 * own shape rather than an oversight here**: a point there is a coordinate and
 * nothing else, which is what makes the first screen 37 kB instead of 267. So a
 * capped overview draws positions in the unknown colour (`#6366F1`, what
 * `kindColorExpression` coalesces a missing `kindId` to) and answers no pointer
 * — `onAWorldPoint` requires an identity before it claims a gesture, so the
 * region underneath stays reachable, exactly as it does under the heat this
 * stands in for. Above the band the same layer draws features that *do* carry
 * identity, and there it behaves as a pin: hover, name, card.
 *
 * Unreachable on today's catalogue (20 000 against 8 830), so this is what the
 * map does on the day the tier design is outgrown rather than a state a reader
 * meets.
 */
export const worldCappedMarkerLayer: LayerProps = {
  ...markerLayer,
  id: LAYER_WORLD_CAPPED,
  ...onSource,
  minzoom: 0,
  paint: {
    ...markerLayer.paint,
    'circle-color': kindColorExpression(),
    // Flat rather than the band's ramp: below the band that ramp is zero, which
    // is exactly the blankness this layer exists to avoid.
    'circle-opacity': 0.85,
    'circle-stroke-opacity': 0.85,
  },
};

/**
 * The badge, reused whole, and only while the reader has folded something.
 *
 * It says "places this pin stands for", and its filter — `locationCount` above
 * one — is the region layer's own: an unfolded answer carries no such property
 * and the filter's `coalesce` reads that as one, so the filter alone would
 * already draw the badge exactly where there is something to say. That is why
 * the property carries the region layer's name rather than a word of this
 * endpoint's choosing.
 *
 * The fold is still asked, because a filter that matches nothing is not a layer
 * that costs nothing: these two are in the style, and the style is what the map
 * walks per tile and per frame. Unfolded is the state the map opens in and the
 * one its budgets are measured on, so the two layers it cannot use are two the
 * first screen does not carry — and the first screen is the one place this
 * layer's cost has been measured at all (#915; `docs/tech/performance.md`
 * carries the figures and says which build and which machine each came from,
 * which is why none is quoted here).
 */
export function worldBadgeLayers(folded: boolean): LayerProps[] {
  if (!folded) return [];
  return [
    { ...markerCountBadgeBgLayer, id: LAYER_WORLD_BADGE_BG, ...onSource },
    { ...markerCountBadgeTextLayer, id: LAYER_WORLD_BADGE_TEXT, ...onSource },
  ];
}

/** What an answer's own shape says about it, which is all these layers need. */
export interface DrawableAnswer {
  detail: 'overview' | 'markers';
  folded: boolean;
  truncated?: true;
}

/**
 * The layers an answer can actually be drawn through.
 *
 * Chosen from the **answer's** own shape rather than from the question being
 * asked, and that difference is the whole of this function. Crossing the fade
 * band changes the tier and the box together, so for one round trip the answer
 * in hand is the previous tier's. Discarding it there — the first fix for that
 * mismatch — unmounted every layer at each upward crossing, which turned the
 * band's cross-fade into a hard cutoff and paid the style churn the mount gate
 * exists to avoid, per crossing rather than once per load. Drawing it through
 * the layers its own shape supports keeps both.
 *
 * The rule underneath is a difference between the two tiers, not a preference:
 *
 * - **The heat can draw either tier**, because density needs only coordinates,
 *   and both tiers carry those. A boxed markers answer feeding the heat inside
 *   the band draws density for the viewport and its margin, which is the whole
 *   of what is on screen.
 * - **A pin can only draw the markers tier**, because a pin is a claim about a
 *   named place and the overview carries no properties at all. Mounted against
 *   overview features it would be pins in the unknown colour that answer no
 *   pointer — which is the state the capped layer had to be taught to avoid.
 * - **The badge follows the answer's own fold**, not the control's: its count
 *   is a property of the features in hand, so an answer folded the other way
 *   simply has no count to draw.
 * - **A capped read replaces the heat with its own pins**, for the reason that
 *   layer's docblock gives.
 */
export function worldLayersFor(answer: DrawableAnswer | undefined): LayerProps[] {
  if (!answer) return [];
  const layers: LayerProps[] = [
    answer.truncated ? worldCappedMarkerLayer : worldHeatmapLayer,
  ];
  if (answer.detail === 'markers') {
    layers.push(worldMarkerLayer, ...worldBadgeLayers(answer.folded));
  }
  return layers;
}
