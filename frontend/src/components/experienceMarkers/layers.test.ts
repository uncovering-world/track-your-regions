import { describe, it, expect } from 'vitest';
import type { LayerProps } from 'react-map-gl/maplibre';
import { buildExtentData, extentFillLayer, extentLineLayer, EMPTY_FC } from './layers';

const POLYGON: GeoJSON.Geometry = {
  type: 'Polygon',
  coordinates: [[[26.23, 39.95], [26.24, 39.95], [26.24, 39.96], [26.23, 39.95]]],
};

/**
 * `LayerProps` is the union of every layer react-map-gl accepts, and two of its
 * members carry neither `paint` nor `source` — a custom layer and `background` —
 * so the compiler refuses to read either off the union. The narrowing belongs to
 * the test rather than to the declarations, which stay `LayerProps` like every
 * other layer in the file.
 */
const spec = (layer: LayerProps) => layer as {
  source?: string;
  paint?: Record<string, unknown>;
};

describe('buildExtentData', () => {
  it('carries the shape and the colour the pin is drawn in', () => {
    const data = buildExtentData(POLYGON, '#B45309');
    expect(data.features).toHaveLength(1);
    expect(data.features[0].geometry).toEqual(POLYGON);
    expect(data.features[0].properties).toEqual({ color: '#B45309' });
  });

  it('draws nothing for a place with no extent', () => {
    expect(buildExtentData(null, '#B45309')).toEqual(EMPTY_FC);
    expect(buildExtentData(undefined, '#B45309')).toEqual(EMPTY_FC);
  });
});

describe('the extent layers', () => {
  it('paint in the feature\'s own colour, so two kinds are never one wash', () => {
    expect(spec(extentFillLayer).paint?.['fill-color']).toEqual(['coalesce', ['get', 'color'], '#B45309']);
    expect(spec(extentLineLayer).paint?.['line-color']).toEqual(['coalesce', ['get', 'color'], '#B45309']);
  });

  it('is a wash under the pin rather than a shape over it', () => {
    // 15%: enough to read the outline's inside as "this is the site", faint
    // enough that the markers, the labels and the basemap's own names stay
    // legible through it.
    expect(spec(extentFillLayer).paint?.['fill-opacity']).toBe(0.15);
    expect(spec(extentLineLayer).paint?.['line-width']).toBe(2);
  });

  it('reads from the extent source and from nothing else', () => {
    expect(spec(extentFillLayer).source).toBe('exp-extent');
    expect(spec(extentLineLayer).source).toBe('exp-extent');
  });
});
