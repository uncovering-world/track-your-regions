/**
 * The sources and layers Discover's map is built from.
 *
 * Split out of `DiscoverExperienceView` under the 800-line rule in
 * `docs/tech/development-guide.md`. These are declarations — what the map holds
 * and how it paints — while the component keeps the behaviour: which features go
 * into the sources, and what a click or a hover means. The handlers stay there
 * because they read this component's refs and props.
 */

import maplibregl from 'maplibre-gl';

export const SOURCE_ID = 'experience-markers';
export const HIGHLIGHT_SOURCE_ID = 'highlight-markers';
export const HOVER_SOURCE_ID = 'hover-marker';

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
    map.addSource(SOURCE_ID, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
      cluster: true,
      clusterMaxZoom: 12,
      clusterRadius: 50,
      // No `promoteId`. It used to derive each feature's id from
      // `properties.id`, which was one per object; a place is a feature now and
      // that id repeats across every place of an object — MapLibre would key
      // them all the same, and the first feature-state written here would be
      // shared by forty pins. Nothing reads feature-state on this source, so
      // this removes a latent collision rather than a live bug.
    });

    map.addSource(HIGHLIGHT_SOURCE_ID, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    });

    map.addSource(HOVER_SOURCE_ID, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    });

    // ── Layers (order matters: bottom → top) ──

    // Cluster circles
    map.addLayer({
      id: 'clusters',
      type: 'circle',
      source: SOURCE_ID,
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
      id: 'cluster-count',
      type: 'symbol',
      source: SOURCE_ID,
      filter: ['has', 'point_count'],
      layout: {
        'text-field': ['get', 'point_count_abbreviated'],
        'text-size': 11,
        'text-font': ['Open Sans Bold'],
      },
      paint: { 'text-color': '#ffffff' },
    });

    // Individual markers
    map.addLayer({
      id: 'unclustered-point',
      type: 'circle',
      source: SOURCE_ID,
      filter: ['!', ['has', 'point_count']],
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
      },
    });

    // Multi-location badge background (shows total locations behind marker)
    map.addLayer({
      id: 'unclustered-count-badge-bg',
      type: 'circle',
      source: SOURCE_ID,
      filter: ['all', ['!', ['has', 'point_count']], ['>', ['coalesce', ['get', 'locationCount'], 1], 1]],
      paint: {
        'circle-color': '#0f172a',
        'circle-radius': 8,
        'circle-stroke-width': 1.5,
        'circle-stroke-color': '#ffffff',
        'circle-translate': [8, -8],
        'circle-translate-anchor': 'viewport',
      },
    });

    map.addLayer({
      id: 'unclustered-count-badge-text',
      type: 'symbol',
      source: SOURCE_ID,
      filter: ['all', ['!', ['has', 'point_count']], ['>', ['coalesce', ['get', 'locationCount'], 1], 1]],
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
    });

    // Hover glow (soft orange fill behind the ring — visible even on clusters)
    map.addLayer({
      id: 'hover-glow',
      type: 'circle',
      source: HOVER_SOURCE_ID,
      paint: {
        'circle-color': '#f97316',
        'circle-radius': ['coalesce', ['get', 'hoverRadius'], 24],
        'circle-opacity': 0.18,
        'circle-blur': 0.6,
      },
    });

    // Hover ring (bright orange, prominent)
    map.addLayer({
      id: 'hover-ring',
      type: 'circle',
      source: HOVER_SOURCE_ID,
      paint: {
        'circle-color': 'transparent',
        'circle-radius': ['coalesce', ['get', 'ringRadius'], 18],
        'circle-stroke-width': 3,
        'circle-stroke-color': '#f97316',
        'circle-stroke-opacity': 1,
      },
    });

    // Highlight markers (red ring for selected experience locations)
    map.addLayer({
      id: 'highlight-ring',
      type: 'circle',
      source: HIGHLIGHT_SOURCE_ID,
      paint: {
        'circle-color': 'transparent',
        'circle-radius': 14,
        'circle-stroke-width': 3,
        'circle-stroke-color': '#ef4444',
        'circle-stroke-opacity': 0.8,
      },
    });
    map.addLayer({
      id: 'highlight-point',
      type: 'circle',
      source: HIGHLIGHT_SOURCE_ID,
      paint: {
        'circle-color': '#ef4444',
        'circle-radius': 6,
        'circle-stroke-width': 2,
        'circle-stroke-color': '#ffffff',
      },
    });
}
