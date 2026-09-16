/**
 * The world layer's layers.
 *
 * What these pin is the part that is easy to get wrong twice: the world layer
 * borrows the region layer's paint, so anything it restates instead of
 * borrowing is a second answer waiting to drift, and anything it mounts that
 * the first screen cannot use is work the map's budgets pay for.
 */

import { describe, it, expect } from 'vitest';
import {
  SOURCE_WORLD_POINTS, WORLD_MARKER_LAYERS,
  worldBadgeLayers, worldCappedMarkerLayer, worldHeatmapLayer, worldLayersFor,
  worldMarkerLayer, worldHoverGlowLayer, worldHoverRingLayer,
} from './worldPointLayers';
import {
  MARKER_FADE_START,
  heatmapLayer, markerLayer, markerCountBadgeBgLayer, markerCountBadgeTextLayer,
} from './layers';

/**
 * A layer read as a plain record.
 *
 * `LayerProps` is the union of every layer kind the style spec has, and only
 * some of them carry `paint`, `filter`, `layout` or a zoom range — so reading
 * any of those off the union needs a cast, the same one the fold's own filter
 * needs where it is built.
 */
const asRecord = (layer: unknown) => layer as Record<string, unknown>;

describe('the world layer borrows the region layer\'s paint', () => {
  it('keeps the heat\'s radius and palette, changing only how hard the ramp is driven', () => {
    // The two layers hold different amounts of world, so the intensity cannot
    // be shared; everything else must be, or the handover at the fade band
    // reads as two different things being shown.
    const shared = asRecord(asRecord(heatmapLayer).paint);
    const world = asRecord(asRecord(worldHeatmapLayer).paint);
    for (const property of Object.keys(shared)) {
      if (property === 'heatmap-intensity') continue;
      expect(world[property]).toEqual(shared[property]);
    }
    expect(world['heatmap-intensity']).not.toEqual(shared['heatmap-intensity']);
  });

  it('keeps the marker\'s radius and fade, changing only the colour it has to derive', () => {
    const shared = asRecord(asRecord(markerLayer).paint);
    const world = asRecord(asRecord(worldMarkerLayer).paint);
    for (const property of Object.keys(shared)) {
      if (property === 'circle-color') continue;
      expect(world[property]).toEqual(shared[property]);
    }
    expect(world['circle-color']).not.toEqual(shared['circle-color']);
  });

  it('keeps the cross-fade zooms, so the heat and the pins hand over together', () => {
    expect(asRecord(worldHeatmapLayer).maxzoom).toBe(asRecord(heatmapLayer).maxzoom);
    expect(asRecord(worldMarkerLayer).minzoom).toBe(asRecord(markerLayer).minzoom);
  });
});

describe('what the first screen carries', () => {
  it('mounts no badge layer until the reader has folded something', () => {
    // The badge's own filter would already hide it — an unfolded answer carries
    // no `locationCount` — but a layer with a filter that matches nothing is
    // still a layer the style walks. Unfolded is the state the map opens in and
    // the one its budgets are measured on.
    expect(worldBadgeLayers(false)).toEqual([]);
  });

  it('mounts both of them once it has', () => {
    const layers = worldBadgeLayers(true);
    expect(layers).toHaveLength(2);
    expect(layers.map(layer => asRecord(layer).source)).toEqual([SOURCE_WORLD_POINTS, SOURCE_WORLD_POINTS]);
  });

  it('leaves the badge\'s own filter and text to the region layer', () => {
    // The property is called `locationCount` for this reason: a word of the
    // endpoint's own would mean restating the filter here, which is how the two
    // layers start disagreeing about what a count means.
    const [background, text] = worldBadgeLayers(true).map(asRecord);
    expect(background.filter).toEqual(asRecord(markerCountBadgeBgLayer).filter);
    expect(text.filter).toEqual(asRecord(markerCountBadgeTextLayer).filter);
    expect(asRecord(text.layout)['text-field'])
      .toEqual(asRecord(asRecord(markerCountBadgeTextLayer).layout)['text-field']);
  });
});

describe('the layer ids', () => {
  it('are the world layer\'s own, although the two layers are never mounted together', () => {
    // A duplicate layer id is a MapLibre error at add time, and "they cannot
    // both be on screen" is a fact about this app that the style does not know.
    const idOf = (layer: unknown) => String(asRecord(layer).id);
    const ids = [
      idOf(worldHeatmapLayer), idOf(worldMarkerLayer),
      ...worldBadgeLayers(true).map(idOf),
      idOf(worldHoverGlowLayer), idOf(worldHoverRingLayer),
    ];
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^world-/);
    for (const id of ids) {
      expect(id).not.toBe(idOf(heatmapLayer));
      expect(id).not.toBe(idOf(markerLayer));
    }
  });

  it('names every pin layer this module can draw, so none is left unanswerable', () => {
    // Derived from the module's exports rather than written out, because the
    // failure this guards is exactly a layer being added and not listed: the
    // capped layer was, and in the truncated state it is the only visible pin
    // layer, so every pin would have fallen through to the region under it.
    // `useMapInteractions` returns false when nothing listed here is drawn,
    // which is what lets a click reach the map.
    const pinLayers = [worldMarkerLayer, worldCappedMarkerLayer, ...worldBadgeLayers(true)]
      .map(layer => String(asRecord(layer).id));
    expect([...WORLD_MARKER_LAYERS].sort()).toEqual(pinLayers.sort());
  });

  it('names no layer a pointer is never over', () => {
    // The heat is not hoverable — a pointer is over a density, not a place —
    // and the hover ring is drawn *in answer to* a hover rather than queried.
    for (const layer of [worldHeatmapLayer, worldHoverGlowLayer, worldHoverRingLayer]) {
      expect([...WORLD_MARKER_LAYERS]).not.toContain(String(asRecord(layer).id));
    }
  });
});

describe('what a capped read draws', () => {
  it('draws its pins at every zoom, because the tier that gets capped is below the band', () => {
    // The overview is the unboxed whole-world read and the first to reach the
    // cap, and it is served entirely below MARKER_FADE_START. A layer inheriting
    // the band's minzoom would draw nothing there, which is the blank map this
    // definition exists to avoid.
    expect(asRecord(worldCappedMarkerLayer).minzoom).toBe(0);
    expect(asRecord(worldMarkerLayer).minzoom).toBe(MARKER_FADE_START);
  });

  it('is opaque rather than ramped, since the band\'s ramp is zero below the band', () => {
    const paint = asRecord(asRecord(worldCappedMarkerLayer).paint);
    expect(paint['circle-opacity']).toBe(0.85);
    expect(paint['circle-stroke-opacity']).toBe(0.85);
  });

  it('asks the colour the same way as the ordinary pins, and the radius too', () => {
    // The *expression* is shared, which is all this can assert: below the band
    // the features carry no `kindId` — a coordinate is the whole of an overview
    // point — so the same expression resolves to the unknown colour there and
    // to the kind's colour above the band. The comment beside the layer says
    // so; a test claiming "the same colours" would be claiming the tier's data
    // rather than the layer's definition.
    const capped = asRecord(asRecord(worldCappedMarkerLayer).paint);
    const world = asRecord(asRecord(worldMarkerLayer).paint);
    expect(capped['circle-color']).toEqual(world['circle-color']);
    expect(capped['circle-radius']).toEqual(world['circle-radius']);
  });

  it('has an id of its own, so it can sit beside the others without colliding', () => {
    const ids = [worldHeatmapLayer, worldMarkerLayer, worldCappedMarkerLayer]
      .map(layer => String(asRecord(layer).id));
    expect(new Set(ids).size).toBe(3);
  });
});

describe('worldLayersFor', () => {
  const ids = (answer: Parameters<typeof worldLayersFor>[0]) =>
    worldLayersFor(answer).map(layer => String(asRecord(layer).id));
  const heat = String(asRecord(worldHeatmapLayer).id);
  const pins = String(asRecord(worldMarkerLayer).id);
  const capped = String(asRecord(worldCappedMarkerLayer).id);
  const badges = worldBadgeLayers(true).map(layer => String(asRecord(layer).id));

  it('draws an overview through the heat alone — its features have no identity to pin', () => {
    expect(ids({ detail: 'overview', folded: false })).toEqual([heat]);
  });

  it('draws a markers answer through the heat and the pins, so the band cross-fades', () => {
    // Both span MARKER_FADE_START → HEATMAP_MAX_ZOOM on purpose; dropping either
    // inside the band makes the handover a cutoff instead of a fade.
    expect(ids({ detail: 'markers', folded: false })).toEqual([heat, pins]);
  });

  it('adds the badges only when the answer itself is folded, not when the control is', () => {
    expect(ids({ detail: 'markers', folded: true })).toEqual([heat, pins, ...badges]);
    expect(ids({ detail: 'overview', folded: true })).toEqual([heat]);
  });

  it('replaces the heat with the capped pins when the read was capped', () => {
    expect(ids({ detail: 'overview', folded: false, truncated: true })).toEqual([capped]);
    expect(ids({ detail: 'markers', folded: false, truncated: true })).toEqual([capped, pins]);
  });

  it('draws nothing at all without an answer, so the style stays empty until there is one', () => {
    expect(ids(undefined)).toEqual([]);
  });

  it('mounts no layer that reads a property against an overview answer', () => {
    // The invariant behind all of the above, and stated as what it is rather
    // than as "no pin layer": the capped layer *is* a pin layer by this file's
    // own reckoning, and it is mounted for a truncated overview on purpose.
    // What it may not do is read a property — `kindColorExpression` coalesces a
    // missing `kindId` and nothing else on it looks at the feature — which is
    // exactly why it was allowed to draw identity-less pins. That is what makes
    // the previous tier safe to keep drawing while the next read is in flight.
    for (const folded of [false, true]) {
      for (const truncated of [undefined, true as const]) {
        const drawn = ids({ detail: 'overview', folded, truncated });
        expect(drawn).not.toContain(pins);
        for (const badge of badges) expect(drawn).not.toContain(badge);
      }
    }
  });
});
