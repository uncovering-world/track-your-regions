import { describe, it, expect } from 'vitest';
import { focusFromGeoJson, frameGeoJson, smartFitBounds } from './mapUtils';
import type { MapLike } from './mapUtils';

/**
 * Three shapes have to stay apart, and #666 is what happens when they do not:
 * a large region crossing the antimeridian, a small one, and one that really
 * does wrap the world. The first two were measured as global and framed as the
 * whole Earth at zoom 1, cut in two against the left and right edges, with the
 * camera pointed at an ocean thousands of kilometres away — the Far Eastern
 * Federal District at 0°E 59.5°N, in the North Sea east of Shetland, and Fiji
 * at 0°E 16.8°S, in the open Atlantic west of Namibia. The third has to keep
 * its full-width box, because for Antarctica that box is true.
 *
 * The numbers below are the bounds those regions actually have on the dev
 * database, overshoot included: GADM's geometry reaches a fraction of a
 * micrometre past +180, which is what defeated the detection in the trigger.
 */

function ring(coords: [number, number][]): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      properties: {},
      geometry: { type: 'Polygon', coordinates: [[...coords, coords[0]]] },
    }],
  };
}

describe('focusFromGeoJson', () => {
  it('frames a large region crossing the antimeridian, not the world', () => {
    // Far Eastern Federal District: 105.5°E eastwards across the dateline to
    // 169.7°W, with vertices overshooting to 180.0000000000001.
    const focus = focusFromGeoJson(ring([
      [105.5235, 42.284584],
      [180.0000000000001, 60],
      [-169.6526, 65],
      [-179.99999999999994, 76.754166],
    ]));

    expect(focus).not.toBeNull();
    const [west, south, east, north] = focus!.bbox;
    expect(west).toBeCloseTo(105.5235, 4);
    expect(east).toBeCloseTo(-169.6526, 4);
    expect(south).toBeCloseTo(42.284584, 6);
    expect(north).toBeCloseTo(76.754166, 6);
    // west > east is this repository's antimeridian convention
    expect(west).toBeGreaterThan(east);
    // Magadan Oblast by the Sea of Okhotsk, not the North Sea
    expect(focus!.anchorPoint[0]).toBeCloseTo(147.9354, 3);
    expect(focus!.anchorPoint[1]).toBeCloseTo(59.5194, 3);
  });

  it('frames a small region crossing the antimeridian', () => {
    // Fiji: between Viti Levu and Vanua Levu, 176.9°E to 178.2°W.
    const focus = focusFromGeoJson(ring([
      [176.8997, -21.0425],
      [180.0000000000001, -17],
      [-178.2286, -15],
      [-179.99999999999994, -12.461724],
    ]));

    const [west, south, east, north] = focus!.bbox;
    expect(west).toBeCloseTo(176.8997, 4);
    expect(east).toBeCloseTo(-178.2286, 4);
    expect(south).toBeCloseTo(-21.0425, 4);
    expect(north).toBeCloseTo(-12.461724, 6);
    expect(focus!.anchorPoint[0]).toBeCloseTo(179.3356, 3);
    expect(focus!.anchorPoint[1]).toBeCloseTo(-16.7521, 3);
  });

  it('leaves a region that really wraps the world global', () => {
    // Antarctica: a coast that circles the pole passes through every longitude,
    // so the shifted measurement is no tighter than the plain one — 359.9995°
    // against 360° on the dev database. That is what "global" means here, and
    // it is why a near-global shifted span may not be dressed up as a window.
    const focus = focusFromGeoJson(ring([
      [-179.99999999999994, -89.999999],
      [-90, -70],
      [-0.0005, -65],
      [0, -65],
      [90, -70],
      [180.0000000000001, -59.59375],
    ]));

    const [west, , east] = focus!.bbox;
    expect(west).toBeLessThan(east);
    expect(east - west).toBeGreaterThan(350);
    expect(focus!.anchorPoint[0]).toBeCloseTo(0, 6);
  });

  it('measures an ordinary region the plain way', () => {
    // France: nothing to shift, and shifting it would claim a 345° span.
    const focus = focusFromGeoJson(ring([
      [-5.1, 42.3],
      [8.2, 42.3],
      [8.2, 51.1],
      [-5.1, 51.1],
    ]));

    expect(focus!.bbox).toEqual([-5.1, 42.3, 8.2, 51.1]);
    expect(focus!.anchorPoint[0]).toBeCloseTo(1.55, 6);
    expect(focus!.anchorPoint[1]).toBeCloseTo(46.7, 6);
  });

  it('measures a region wholly west of Greenwich the plain way', () => {
    // Every longitude negative, so shifting moves the whole shape and the two
    // spans come out equal: the shift must not win a tie.
    const focus = focusFromGeoJson(ring([
      [-124.7, 32.5],
      [-66.9, 32.5],
      [-66.9, 49.4],
      [-124.7, 49.4],
    ]));

    expect(focus!.bbox).toEqual([-124.7, 32.5, -66.9, 49.4]);
    expect(focus!.anchorPoint[0]).toBeCloseTo(-95.8, 6);
  });

  it('keeps a shifted span of exactly 350° as a crossing window', () => {
    // Everything on Earth except the strip between 5°W and 5°E. Plain span is
    // 360; shifted, the negatives come up by 360 and the span is 355 − 5 = 350
    // — the threshold itself, which both the trigger and this helper treat as
    // still a window (`<=`). The box has to come out as west 5, east −5.
    const focus = focusFromGeoJson(ring([
      [5, -10],
      [90, -10],
      [175, -10],
      [180, 10],
      [-180, 10],
      [-90, 10],
      [-5, 10],
    ]));

    const [west, , east] = focus!.bbox;
    expect(west).toBe(5);
    expect(east).toBe(-5);
    expect(focus!.anchorPoint[0]).toBeCloseTo(180, 6);
  });

  it('files a shifted span just past 350° as global', () => {
    // The same shape with the strip narrowed to 4°W–4°E: shifted span 352.
    // Narrower than the plain 360, and no more of a frame for that — this is
    // where the threshold says "the whole world however it is measured".
    const focus = focusFromGeoJson(ring([
      [4, -10],
      [90, -10],
      [175, -10],
      [180, 10],
      [-180, 10],
      [-90, 10],
      [-4, 10],
    ]));

    const [west, , east] = focus!.bbox;
    expect(west).toBe(-180);
    expect(east).toBe(180);
    expect(focus!.anchorPoint[0]).toBe(0);
  });

  it('has no frame for a shape with no coordinates', () => {
    expect(focusFromGeoJson({ type: 'FeatureCollection', features: [] })).toBeNull();
  });
});

/**
 * A map that records what the camera was asked to do. `cameraForBounds` answers
 * with the box's midpoint and a zoom that says which box it was given, so a
 * test can tell the shifted [0, 360] box from the plain one.
 */
function mockMap() {
  const calls: { cameraForBounds: unknown[]; flyTo: unknown[]; fitBounds: unknown[] } = {
    cameraForBounds: [], flyTo: [], fitBounds: [],
  };
  const map = {
    cameraForBounds: (bounds: [[number, number], [number, number]], opts: { maxZoom: number }) => {
      calls.cameraForBounds.push({ bounds, opts });
      const [[w, s], [e, n]] = bounds;
      // A wider box asks for a lower zoom; a world-wide one for less than 1.
      let zoom = 7;
      if (e - w > 300) zoom = 0.1;
      else if (e - w > 100) zoom = 3;
      return { center: [(w + e) / 2, (s + n) / 2], zoom: Math.min(opts.maxZoom, zoom) };
    },
    flyTo: (o: unknown) => { calls.flyTo.push(o); },
    fitBounds: (b: unknown, o: unknown) => { calls.fitBounds.push({ b, o }); },
  };
  return { map: map as unknown as MapLike, calls };
}

describe('frameGeoJson', () => {
  it('flies a crossing shape to its anchor, with the zoom of the shifted box', () => {
    const { map, calls } = mockMap();
    frameGeoJson(map, ring([
      [176.8997, -21.0425], [180.0000000000001, -17], [-178.2286, -15], [-179.99999999999994, -12.461724],
    ]), { padding: 40, duration: 0 });

    // Zoom is asked of the box carried up past 180 — never of [-180 .. 180].
    const asked = calls.cameraForBounds[0] as { bounds: [[number, number], [number, number]] };
    expect(asked.bounds[0][0]).toBeCloseTo(176.8997, 4);
    expect(asked.bounds[1][0]).toBeCloseTo(181.7714, 4);
    const flown = calls.flyTo[0] as { center: [number, number]; zoom: number; duration: number };
    expect(flown.center[0]).toBeCloseTo(179.3356, 3);
    expect(flown.center[1]).toBeCloseTo(-16.7521, 3);
    expect(flown.duration).toBe(0);
    expect(calls.fitBounds).toHaveLength(0);
  });

  it('flies an ordinary shape where cameraForBounds says', () => {
    const { map, calls } = mockMap();
    frameGeoJson(map, ring([[-5.1, 42.3], [8.2, 42.3], [8.2, 51.1], [-5.1, 51.1]]), { padding: 40 });

    const asked = calls.cameraForBounds[0] as { bounds: [[number, number], [number, number]] };
    expect(asked.bounds).toEqual([[-5.1, 42.3], [8.2, 51.1]]);
    const flown = calls.flyTo[0] as { center: [number, number]; zoom: number };
    expect(flown.center[0]).toBeCloseTo(1.55, 6);
    expect(flown.zoom).toBe(7);
  });

  it('leaves the map alone for a shape with no coordinates', () => {
    const { map, calls } = mockMap();
    frameGeoJson(map, { type: 'FeatureCollection', features: [] });
    frameGeoJson(map, null);
    frameGeoJson(null, ring([[0, 0], [1, 0], [1, 1], [0, 1]]));
    expect(calls.cameraForBounds).toHaveLength(0);
    expect(calls.flyTo).toHaveLength(0);
  });

  it('accepts the MapLibre map itself, not only the react-map-gl ref', () => {
    // A ref wraps the map in getMap(); a raw map is the map. Both frame.
    const { map: raw, calls: rawCalls } = mockMap();
    const { map: inner, calls: refCalls } = mockMap();
    const ref = { getMap: () => inner } as unknown as MapLike;
    const shape = ring([[10, 50], [10.5, 50], [10.5, 50.5], [10, 50.5]]);
    frameGeoJson(raw, shape);
    frameGeoJson(ref, shape);
    expect(rawCalls.flyTo).toHaveLength(1);
    expect(refCalls.flyTo).toHaveLength(1);
  });

  it('lets maxZoom lower the size-derived cap, never raise it', () => {
    const { map, calls } = mockMap();
    const small = ring([[10, 50], [10.5, 50], [10.5, 50.5], [10, 50.5]]);
    frameGeoJson(map, small, { maxZoom: 10 });
    frameGeoJson(map, small, { maxZoom: 20 });
    const asks = calls.cameraForBounds as { opts: { maxZoom: number } }[];
    expect(asks[0].opts.maxZoom).toBe(10);
    expect(asks[1].opts.maxZoom).toBe(12);
  });
});

/** A ring round the whole world, with a vertex every 30° along both edges. */
function worldRing(): GeoJSON.FeatureCollection {
  const lngs = Array.from({ length: 13 }, (_, i) => -180 + i * 30);
  return ring([
    ...lngs.map((lng): [number, number] => [lng, -60]),
    ...[...lngs].reverse().map((lng): [number, number] => [lng, 80]),
  ]);
}

describe('frameGeoJson and the zoom floor', () => {
  it('fits a world-scale shape at the zoom it asks for, with no floor', () => {
    // Every region plus every gap of an import, in a half-width pane: the box is
    // the world, the pane wants zoom 0.1, and a floor of 1 would show half of it.
    const { map, calls } = mockMap();
    // Vertices every 30° all the way round: a ring with corners at ±179 alone is
    // a 2° strip over the dateline to the rule, and one with a vertex every 90°
    // is a 270° window the other way round — both rightly. Only a shape that is
    // wide however it is measured is global.
    const world = worldRing();
    frameGeoJson(map, world, { padding: 30 });
    smartFitBounds(map, [-179, -60, 179, 80], { padding: 30 });
    const flown = calls.flyTo as { zoom: number }[];
    expect(flown[0].zoom).toBeCloseTo(0.1, 6);
    expect(flown[1].zoom).toBe(1);
  });

  it('lets a caller set its own floor', () => {
    const { map, calls } = mockMap();
    frameGeoJson(map, worldRing(), { minZoom: 2 });
    expect((calls.flyTo[0] as { zoom: number }).zoom).toBe(2);
  });
});

describe('smartFitBounds', () => {
  it('frames a crossing box at its anchor only when one is given', () => {
    // Without an anchor there is nowhere to point the camera; the plain path runs.
    const { map, calls } = mockMap();
    smartFitBounds(map, [176.9, -21, -178.2, -12.5], { anchorPoint: [179.34, -16.75] });
    smartFitBounds(map, [176.9, -21, -178.2, -12.5]);
    const flown = calls.flyTo as { center: [number, number] }[];
    expect(flown[0].center).toEqual([179.34, -16.75]);
    expect(flown[1].center[0]).not.toBeCloseTo(179.34, 1);
  });
});
