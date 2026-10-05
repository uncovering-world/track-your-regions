/**
 * The scene both experience maps draw, and what Map mode adds to it.
 *
 * Map mode's layers are the scene's plus the cross-fade with its heatmap — a
 * `minzoom` and an opacity ramp on the pin layers — and nothing else. A paint
 * value changed in `layers.ts` rather than in `scene.ts` would put the two maps
 * back to disagreeing about what a pin looks like, which is what this spec
 * fails on. Discover's half is `discover/discoverMapLayers.test.ts`.
 */

import { describe, it, expect } from 'vitest';
import type { LayerProps } from 'react-map-gl/maplibre';
import type { Experience } from '../../api/experiences';
import type { MarkerData } from './buildMarkers';
import {
  HEATMAP_MAX_ZOOM, MARKER_FADE_START,
  markerLayer, markerSplitLayer, markerCountBadgeBgLayer, markerCountBadgeTextLayer,
  hoverGlowLayer, hoverRingLayer, highlightRingLayer, highlightPointLayer,
  SOURCE_MARKERS, SOURCE_HIGHLIGHT, SOURCE_HOVER,
} from './layers';
import {
  SCENE_SOURCES, SCENE_MARKER_ORDER, SCENE_OVERLAY_ORDER, MARKER_LAYERS,
  sceneMarkerLayer, sceneBadgeBgLayer, sceneBadgeTextLayer,
  sceneHoverGlowLayer, sceneHoverRingLayer, sceneHighlightRingLayer, sceneHighlightPointLayer,
  EMPTY_FC, buildPointHoverData, buildPointsHoverData, buildSizedRing,
  buildHighlightData, buildMarkerFeatures, splitPinIcon, addSplitPinImages,
} from './scene';
import { experienceColor } from '../../utils/kindColors';

/** The Louvre's courtyard, which is where a reader checks a ring by eye. */
const LOUVRE: [number, number] = [2.3376, 48.8606];

type Spec = {
  id?: string;
  type?: string;
  source?: string;
  minzoom?: number;
  filter?: unknown;
  layout?: Record<string, unknown>;
  paint?: Record<string, unknown>;
};
const spec = (layer: LayerProps | object) => layer as Spec;

/** The opacity properties the cross-fade drives, by layer type. */
const FADE_KEYS = ['circle-opacity', 'circle-stroke-opacity', 'text-opacity'];
const FADE_IN = ['interpolate', ['linear'], ['zoom'], MARKER_FADE_START, 0, HEATMAP_MAX_ZOOM, 1];

/** A layer with Map mode's cross-fade taken back off. */
function withoutFade(layer: LayerProps): Spec {
  const { paint, ...rest } = spec(layer);
  delete rest.minzoom;
  const kept = Object.fromEntries(
    Object.entries(paint ?? {}).filter(([key]) => !FADE_KEYS.includes(key)),
  );
  return { ...rest, paint: kept };
}

describe("Map mode's pin layers", () => {
  const pairs: [string, LayerProps, object][] = [
    ['the point', markerLayer, sceneMarkerLayer],
    ['the badge', markerCountBadgeBgLayer, sceneBadgeBgLayer],
    ['the badge number', markerCountBadgeTextLayer, sceneBadgeTextLayer],
  ];

  it.each(pairs)('%s is the scene layer, and differs only by the cross-fade', (_name, mapMode, scene) => {
    expect(withoutFade(mapMode)).toEqual(scene);
  });

  it.each(pairs)('%s starts at the fade band and ramps its opacity across it', (_name, mapMode) => {
    const layer = spec(mapMode);
    expect(layer.minzoom).toBe(MARKER_FADE_START);
    const ramps = Object.entries(layer.paint ?? {}).filter(([key]) => FADE_KEYS.includes(key));
    expect(ramps.length).toBeGreaterThan(0);
    for (const [, value] of ramps) expect(value).toEqual(FADE_IN);
  });

  it('are the scene pin layers, in the scene order', () => {
    expect([markerLayer, markerSplitLayer, markerCountBadgeBgLayer, markerCountBadgeTextLayer].map(l => spec(l).id))
      .toEqual(SCENE_MARKER_ORDER.map(l => l.id));
    expect(SCENE_MARKER_ORDER.map(l => l.id)).toEqual([...MARKER_LAYERS]);
  });
});

describe("Map mode's selection and hover", () => {
  it('are the scene layers as they stand', () => {
    expect(hoverGlowLayer).toBe(sceneHoverGlowLayer);
    expect(hoverRingLayer).toBe(sceneHoverRingLayer);
    expect(highlightRingLayer).toBe(sceneHighlightRingLayer);
    expect(highlightPointLayer).toBe(sceneHighlightPointLayer);
  });

  it('are drawn from the scene sources', () => {
    expect([SOURCE_MARKERS, SOURCE_HIGHLIGHT, SOURCE_HOVER])
      .toEqual([SCENE_SOURCES.markers, SCENE_SOURCES.highlight, SCENE_SOURCES.hover]);
  });
});

describe('the overlay order', () => {
  it('puts the selection under the hover, the ring over its glow', () => {
    expect(SCENE_OVERLAY_ORDER.map(l => l.id)).toEqual([
      'exp-highlight-ring', 'exp-highlight-point', 'exp-hover-glow', 'exp-hover-ring',
    ]);
  });
});

describe('the hover builders', () => {
  it('ring a point with no properties, so the layers paint it at their defaults', () => {
    expect(buildPointHoverData(LOUVRE)).toEqual({
      type: 'FeatureCollection',
      features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: LOUVRE }, properties: {} }],
    });
  });

  it('size a ring to sit outside a drawn circle, and put it after the plain points', () => {
    const sized = buildSizedRing([2.35, 48.85], 22);
    expect(sized.properties).toEqual({ hoverRadius: 32, ringRadius: 26 });

    const data = buildPointsHoverData([LOUVRE], [sized]);
    expect(data.features).toHaveLength(2);
    expect(data.features[0].properties).toEqual({});
    expect(data.features[1]).toBe(sized);
  });

  it('clear to one shared empty collection', () => {
    expect(EMPTY_FC).toEqual({ type: 'FeatureCollection', features: [] });
    expect(buildPointsHoverData([])).toEqual(EMPTY_FC);
  });
});

describe('buildHighlightData', () => {
  it('names each place, and null for a dot that stands for no one place', () => {
    const data = buildHighlightData([
      { coordinates: LOUVRE, locationId: 7, name: 'Louvre' },
      { coordinates: [2.35, 48.85], locationId: null, name: 'Folded' },
    ]);
    expect(data.features.map(f => f.properties)).toEqual([
      { locationId: 7, name: 'Louvre' },
      { locationId: null, name: 'Folded' },
    ]);
    expect(data.features[0].geometry).toEqual({ type: 'Point', coordinates: LOUVRE });
  });
});

describe('buildMarkerFeatures', () => {
  const louvre = {
    id: 12, name: 'Louvre', kind_id: 2, type: null, longitude: LOUVRE[0], latitude: LOUVRE[1],
  } as unknown as Experience;

  const pin: MarkerData = {
    id: '12-34', experienceId: 12, locationId: 34, experience: louvre,
    longitude: LOUVRE[0], latitude: LOUVRE[1], locationName: 'Cour Napoléon', locationCount: 1,
  };
  // A serial site folded to one pin: Aalto Works, thirteen places in Finland,
  // at the point the catalogue answers with for the object.
  const aalto = {
    id: 40, name: 'Aalto Works', kind_id: 1, type: null, longitude: 25.73, latitude: 62.24,
  } as unknown as Experience;
  const folded: MarkerData = {
    id: '40-collapsed', experienceId: 40, locationId: null, experience: aalto,
    longitude: 25.73, latitude: 62.24, locationName: null, locationCount: 13, folded: true,
  };

  it('keys each pin by its place and carries what the handlers and layers read', () => {
    const [feature] = buildMarkerFeatures([pin]).features;
    expect(feature.id).toBe('12-34');
    expect(feature.geometry.coordinates).toEqual(LOUVRE);
    expect(feature.properties).toEqual({
      experienceId: 12,
      locationId: 34,
      name: 'Cour Napoléon',
      experienceName: 'Louvre',
      color: experienceColor(2, null),
      locationCount: 1,
      folded: false,
    });
  });

  it("names a folded pin after its object and says it is folded", () => {
    const [feature] = buildMarkerFeatures([folded]).features;
    expect(feature.properties).toMatchObject({
      name: 'Aalto Works', locationId: null, locationCount: 13, folded: true,
    });
  });
});

describe('a pin that shows several kinds', () => {
  const capitoline = { id: 6214, name: 'Capitoline Museums', kind_id: 2, type: null, longitude: 12.48, latitude: 41.89 } as unknown as Experience;
  const art = experienceColor(2, null);
  const archaeology = experienceColor(5, 'museum');

  it('draws a split disc named by its colours over a plain disc of the first (#1262)', () => {
    const pin: MarkerData = {
      id: '6214-1', experienceId: 6214, locationId: 1, experience: capitoline,
      longitude: 12.48, latitude: 41.89, locationName: null, locationCount: 1, kindColors: [art, archaeology],
    };
    const properties = buildMarkerFeatures([pin]).features[0].properties!;

    expect(properties.color).toBe(art);
    expect(properties.icon).toBe(splitPinIcon([art, archaeology]));
  });

  it('draws a plain disc, with no split image, where it shows one kind', () => {
    const pin: MarkerData = {
      id: '6214-1', experienceId: 6214, locationId: 1, experience: capitoline,
      longitude: 12.48, latitude: 41.89, locationName: null, locationCount: 1, kindColors: [archaeology],
    };
    const properties = buildMarkerFeatures([pin]).features[0].properties!;

    expect(properties.color).toBe(archaeology);
    expect(properties).not.toHaveProperty('icon');
  });

  it('asks for no image the map has, and none that is not a split pin', () => {
    const listeners: Array<(e: { id: string }) => void> = [];
    const added: string[] = [];
    const map = {
      on: (_type: 'styleimagemissing', listener: (e: { id: string }) => void) => { listeners.push(listener); },
      off: (_type: 'styleimagemissing', listener: (e: { id: string }) => void) => {
        listeners.splice(listeners.indexOf(listener), 1);
      },
      hasImage: (id: string) => id === splitPinIcon(['#000', '#fff']),
      addImage: (id: string) => { added.push(id); },
    };

    const stop = addSplitPinImages(map);
    listeners[0]({ id: 'some-other-icon' });
    listeners[0]({ id: splitPinIcon(['#000', '#fff']) });
    stop();

    expect(added).toEqual([]);
    expect(listeners).toHaveLength(0);
  });
});
