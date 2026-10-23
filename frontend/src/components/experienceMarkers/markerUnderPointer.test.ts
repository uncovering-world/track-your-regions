import { describe, it, expect, vi } from 'vitest';
import type { MapGeoJSONFeature, Point } from 'maplibre-gl';
import { hoverKeyOf, markerUnderPointer, POINTER_LAYERS, type QueryableMap } from './markerUnderPointer';
import { LAYER_HIGHLIGHT_POINT, LAYER_MARKERS, MARKER_LAYERS } from './scene';

/**
 * The one question hover and click both ask (#1916): what is topmost under the
 * pointer, a pin or a dot of the selected object. The Serapeum of Alexandria
 * and Pompey's Pillar are 81 m apart; with the Serapeum selected, its dot is
 * drawn over the Pillar's pin at city zoom, and both gestures must answer the
 * dot.
 */

const SERAPEUM: [number, number] = [29.8965, 31.1826];
const PILLAR: [number, number] = [29.8961, 31.1823];

function feature(layer: string, properties: Record<string, unknown>, coordinates: [number, number]): MapGeoJSONFeature {
  return {
    type: 'Feature', layer: { id: layer }, properties, geometry: { type: 'Point', coordinates },
  } as unknown as MapGeoJSONFeature;
}

const serapeumDot = feature(LAYER_HIGHLIGHT_POINT, { locationId: 501, name: 'Serapeum of Alexandria' }, SERAPEUM);
const pillarPin = feature(LAYER_MARKERS, {
  experienceId: 13927, locationId: 777, experienceName: "Pompey's Pillar", locationCount: 1,
}, PILLAR);

/** A map that holds `present` of the layers and answers the query with `under`, top first. */
function fakeMap(present: readonly string[], under: MapGeoJSONFeature[]) {
  const queryRenderedFeatures = vi.fn(() => under);
  const map: QueryableMap = {
    getLayer: (id: string) => (present.includes(id) ? { id } : undefined),
    queryRenderedFeatures,
  };
  return { map, queryRenderedFeatures };
}
const point = { x: 10, y: 10 } as Point;

describe('markerUnderPointer', () => {
  it('answers the dot where it is drawn over a pin, so hover and click agree on the Serapeum', () => {
    const { map } = fakeMap(POINTER_LAYERS, [serapeumDot, pillarPin]);
    const under = markerUnderPointer(map, point);
    expect(under).toEqual({
      kind: 'highlight', locationId: 501, name: 'Serapeum of Alexandria', coordinates: SERAPEUM,
    });
    expect(hoverKeyOf(under)).toBe('highlight:501');
  });

  it('answers the pin where it is alone, with its fold stated and never inferred', () => {
    const { map } = fakeMap(POINTER_LAYERS, [pillarPin]);
    expect(markerUnderPointer(map, point)).toEqual({
      kind: 'pin', experienceId: 13927, locationId: 777, folded: false, name: "Pompey's Pillar", coordinates: PILLAR,
    });
    // A folded pin says so itself; a stand-in with the same count does not.
    const folded = feature(LAYER_MARKERS, { experienceId: 7, locationId: null, locationCount: 40, folded: true, experienceName: 'Via Appia' }, PILLAR);
    const standIn = feature(LAYER_MARKERS, { experienceId: 7, locationId: null, locationCount: 40, experienceName: 'Via Appia' }, PILLAR);
    expect(markerUnderPointer(fakeMap(POINTER_LAYERS, [folded]).map, point)).toMatchObject({ kind: 'pin', folded: true, locationId: null });
    expect(markerUnderPointer(fakeMap(POINTER_LAYERS, [standIn]).map, point)).toMatchObject({ kind: 'pin', folded: false, locationId: null });
    expect(hoverKeyOf({ kind: 'pin', experienceId: 7, locationId: null, folded: true, name: '', coordinates: PILLAR })).toBe('7:');
  });

  it('names only the layers the style holds, and asks nothing when it holds none', () => {
    // The highlight layer is unmounted while a region loads; naming it would
    // make the query fire an error.
    const { map, queryRenderedFeatures } = fakeMap(MARKER_LAYERS, [pillarPin]);
    markerUnderPointer(map, point);
    expect(queryRenderedFeatures).toHaveBeenCalledWith(point, { layers: [...MARKER_LAYERS] });

    const none = fakeMap([], []);
    expect(markerUnderPointer(none.map, point)).toBeNull();
    expect(none.queryRenderedFeatures).not.toHaveBeenCalled();
    expect(hoverKeyOf(null)).toBeNull();
  });

  it('answers nothing for a pin with no object, and an empty query', () => {
    const orphan = feature(LAYER_MARKERS, { name: 'x' }, PILLAR);
    expect(markerUnderPointer(fakeMap(POINTER_LAYERS, [orphan]).map, point)).toBeNull();
    expect(markerUnderPointer(fakeMap(POINTER_LAYERS, []).map, point)).toBeNull();
  });
});
