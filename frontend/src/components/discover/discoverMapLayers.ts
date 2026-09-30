/**
 * The sources and layers Discover's map is built from.
 *
 * Split out of `DiscoverExperienceView` under the 800-line rule in
 * `docs/tech/development-guide.md`. These are declarations — what the map holds
 * and how it paints — while the component keeps the behaviour: which features go
 * into the sources, and what a click or a hover means. The handlers stay there
 * because they read this component's refs and props.
 *
 * The pin, its badge, the highlight and the hover ring are the scene Map mode
 * draws too (`experienceMarkers/scene.ts`, #1132), added here as declared. What
 * this file adds is Discover's one difference: its markers source clusters, so
 * it holds the bubbles and their counts, and each pin layer is kept off the
 * aggregate features with a not-a-cluster test.
 */

import * as maplibregl from 'maplibre-gl';
import {
  SCENE_SOURCES, SCENE_MARKER_ORDER, SCENE_OVERLAY_ORDER, EMPTY_FC,
} from '../experienceMarkers/scene';

/** The cluster bubbles and their counts — the layers only this map has. */
export const LAYER_CLUSTERS = 'clusters';
export const LAYER_CLUSTER_COUNT = 'cluster-count';

/** A feature that is not a cluster: the test every pin layer here is kept to. */
export const NOT_CLUSTER: maplibregl.FilterSpecification = ['!', ['has', 'point_count']];

/**
 * A scene pin layer as this map draws it: the same layer, kept off the
 * clusters. A layer with a filter of its own (the badge's) keeps it, joined to
 * the not-a-cluster test.
 */
export function unclustered<L extends maplibregl.CircleLayerSpecification | maplibregl.SymbolLayerSpecification>(
  layer: L,
): L {
  return { ...layer, filter: layer.filter ? ['all', NOT_CLUSTER, layer.filter] : NOT_CLUSTER };
}

/**
 * How big a cluster bubble is painted, by how many points it holds.
 *
 * One table, two readers: the paint expression below and the hover ring, which
 * has to sit just outside the bubble. Stated once because a tweak here would
 * otherwise mis-size a ring in a different file, with no test or type between
 * them.
 */
const CLUSTER_RADIUS_STEPS: ReadonlyArray<readonly [number, number]> = [
  [0, 14], [10, 18], [30, 22], [100, 26],
];

/**
 * The MapLibre `step` expression for the table above.
 *
 * Typed loosely on purpose: the style spec's expression types cannot describe a
 * `step` whose stop count is computed, and the alternative — writing the numbers
 * out here as well — is the duplication this table exists to remove.
 */
function clusterRadiusExpression(): maplibregl.ExpressionSpecification {
  const stops = CLUSTER_RADIUS_STEPS.slice(1).flatMap(([from, radius]) => [from, radius]);
  const expr = ['step', ['get', 'point_count'], CLUSTER_RADIUS_STEPS[0][1], ...stops];
  return expr as unknown as maplibregl.ExpressionSpecification;
}

/** The same table, read directly: the radius a bubble of `count` points is drawn at. */
export function clusterRadiusFor(count: number): number {
  let radius = CLUSTER_RADIUS_STEPS[0][1];
  for (const [from, r] of CLUSTER_RADIUS_STEPS) if (count >= from) radius = r;
  return radius;
}

/** Adds every source and layer the view needs, in paint order. */
export function addDiscoverMapLayers(map: maplibregl.Map): void {
  map.addSource(SCENE_SOURCES.markers, {
    type: 'geojson',
    data: EMPTY_FC,
    cluster: true,
    clusterMaxZoom: 12,
    clusterRadius: 50,
    // No `promoteId`. Deriving each feature's id from `properties.id` keys
    // every place of an object the same, since a place is the feature and
    // that id is one per object — MapLibre would then share the first
    // feature-state written here across forty pins. Nothing reads
    // feature-state on this source, so
    // this removes a latent collision rather than a live bug.
  });
  map.addSource(SCENE_SOURCES.highlight, { type: 'geojson', data: EMPTY_FC });
  map.addSource(SCENE_SOURCES.hover, { type: 'geojson', data: EMPTY_FC });

  // ── Layers (order matters: bottom → top) ──

  // Cluster circles
  map.addLayer({
    id: LAYER_CLUSTERS,
    type: 'circle',
    source: SCENE_SOURCES.markers,
    filter: ['has', 'point_count'],
    paint: {
      'circle-color': [
        'step', ['get', 'point_count'],
        '#7dd3c8', 10, '#5ab8aa', 30, '#3d9d8f', 100, '#2a7d72',
      ],
      'circle-radius': clusterRadiusExpression(),
      'circle-stroke-width': 2,
      'circle-stroke-color': '#ffffff',
      'circle-opacity': 0.9,
    },
  });

  // Cluster count labels
  map.addLayer({
    id: LAYER_CLUSTER_COUNT,
    type: 'symbol',
    source: SCENE_SOURCES.markers,
    filter: ['has', 'point_count'],
    layout: {
      'text-field': ['get', 'point_count_abbreviated'],
      'text-size': 11,
      'text-font': ['Open Sans Bold'],
    },
    paint: { 'text-color': '#ffffff' },
  });

  // The pins and their badges, then the selection and the hover over them —
  // the scene's layers in the scene's order, the same as Map mode's.
  for (const layer of SCENE_MARKER_ORDER) map.addLayer(unclustered(layer));
  for (const layer of SCENE_OVERLAY_ORDER) map.addLayer(layer);
}
