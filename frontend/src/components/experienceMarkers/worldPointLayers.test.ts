/**
 * The world layer draws what a region's markers draw, from a tile instead of a
 * built collection (#910) — and the promise is that the two agree about
 * everything except where the features come from.
 *
 * Two point layers on one map that disagreed about the heatmap's intensity
 * ramp, the marker's radius or the fade band between them would read as two
 * different things being shown; the world layer is therefore the region
 * layer's definitions with the source swapped, and these tests hold it to that
 * rather than to the numbers, which live next door and are tuned there.
 */

import { describe, it, expect } from 'vitest';
import type { LayerProps } from 'react-map-gl/maplibre';
import {
  heatmapLayer, hoverRingLayer, markerLayer, markerCountBadgeBgLayer,
} from './layers';
import {
  SOURCE_WORLD_POINTS, SOURCE_WORLD_HOVER, WORLD_MARKER_LAYERS,
  worldHeatmapLayer, worldMarkerLayer, worldBadgeLayers, worldHoverRingLayer,
} from './worldPointLayers';

/** See the note in `layers.test.ts`: `LayerProps` is a union two of whose members carry neither. */
const spec = (layer: LayerProps) => layer as {
  id?: string;
  source?: string;
  'source-layer'?: string;
  filter?: unknown;
  minzoom?: number;
  maxzoom?: number;
  paint?: Record<string, unknown>;
};

describe('the world layer reads the region layer\'s paint', () => {
  it('draws the heat with the same radius, palette and cross-fade', () => {
    const world = spec(worldHeatmapLayer(false)).paint ?? {};
    const region = spec(heatmapLayer).paint ?? {};
    expect(spec(worldHeatmapLayer(false)).maxzoom).toBe(spec(heatmapLayer).maxzoom);
    for (const property of Object.keys(region)) {
      // Every property but the intensity, which is how hard the ramp is driven
      // and is the one thing that cannot be shared: this layer holds the whole
      // catalogue on one screen where a region's holds a region.
      if (property === 'heatmap-intensity') continue;
      expect(world[property], property).toEqual(region[property]);
    }
  });

  it('drives the ramp softer at the overview, and meets the region layer at the handover', () => {
    const ramp = spec(worldHeatmapLayer(false)).paint?.['heatmap-intensity'] as unknown[];
    const regionRamp = spec(heatmapLayer).paint?.['heatmap-intensity'] as unknown[];
    // At world zoom, well under the region layer's — Europe was one flat mass.
    expect(ramp[4]).toBeLessThan(regionRamp[4] as number);
    // And equal where the heat is fading into the markers, so the two layers
    // are drawing the same thing by the time a reader crosses the band.
    expect(ramp.slice(-2)).toEqual(regionRamp.slice(-2));
  });

  it('draws a pin at the same size, fading in over the same band', () => {
    const world = spec(worldMarkerLayer(false)).paint ?? {};
    const region = spec(markerLayer).paint ?? {};
    expect(spec(worldMarkerLayer(false)).minzoom).toBe(spec(markerLayer).minzoom);
    for (const property of Object.keys(region)) {
      // Every property but the colour, which is the one thing a tile feature
      // cannot be handed ready-made — see below.
      if (property === 'circle-color') continue;
      expect(world[property], property).toEqual(region[property]);
    }
  });

  it('rings a hovered pin the way a region\'s markers are ringed', () => {
    expect(spec(worldHoverRingLayer).paint).toEqual(spec(hoverRingLayer).paint);
    expect(spec(worldHoverRingLayer).source).toBe(SOURCE_WORLD_HOVER);
    // Its own id, although the two layers are never mounted together: a
    // duplicate layer id is a MapLibre error at add time.
    expect(spec(worldHoverRingLayer).id).not.toBe(spec(hoverRingLayer).id);
  });
});

describe('what the world layer has to decide for itself', () => {
  it('colours a pin from the kind and the type the tile carries', () => {
    // The region layer is handed `experienceColor`'s answer per marker; a tile
    // feature carries the kind and the type instead, and MapLibre picks. That
    // the expression agrees with `experienceColor` is pinned in
    // `utils/kindColors.test.ts`; what is pinned here is that it is used.
    expect(spec(markerLayer).paint?.['circle-color']).toEqual(['get', 'color']);
    expect(spec(worldMarkerLayer(false)).paint?.['circle-color']).not.toEqual(['get', 'color']);
  });

  it('reads the tile source and its layer, on every layer it draws', () => {
    const layers = [worldHeatmapLayer(true), worldMarkerLayer(true), ...worldBadgeLayers(true)];
    for (const layer of layers) {
      expect(spec(layer).source, spec(layer).id).toBe(SOURCE_WORLD_POINTS);
      expect(spec(layer)['source-layer'], spec(layer).id).toBe('points');
    }
  });

  it('lists exactly the layers a pointer over a pin can land on', () => {
    const drawn = [worldMarkerLayer(true), ...worldBadgeLayers(true)].map(layer => spec(layer).id);
    expect([...WORLD_MARKER_LAYERS].sort()).toEqual(drawn.sort());
  });
});

describe('the fold', () => {
  it('draws every place by default', () => {
    expect(spec(worldMarkerLayer(false)).filter).toBeUndefined();
    // And no badge: unfolded, every feature is its own place, and "places this
    // pin stands for" is always one.
    expect(worldBadgeLayers(false)).toEqual([]);
  });

  it('folded, keeps the place the catalogue answers with and nothing else', () => {
    // `main` is on that place alone — the one nearest the object's own point,
    // ADR-0028 decision 2 — so the filter is the whole of the fold and costs no
    // request.
    expect(spec(worldMarkerLayer(true)).filter).toEqual(['has', 'main']);
  });

  it('folded, badges a pin that stands for more than one place', () => {
    const [background] = worldBadgeLayers(true);
    expect(spec(background).filter).toEqual(['all', ['has', 'main'], spec(markerCountBadgeBgLayer).filter]);
  });

  it('folds the heat as well as the pins', () => {
    // The Rock Art of the Mediterranean Basin is one site and 734 shelters, and
    // unfolded they read as the densest place in Europe long before a pin is
    // drawn. So the tile carries `main` at every zoom, not only where a name
    // is worth sending, and the heat answers the same question the pins do.
    expect(spec(worldHeatmapLayer(false)).filter).toBeUndefined();
    expect(spec(worldHeatmapLayer(true)).filter).toEqual(['has', 'main']);
  });
});
