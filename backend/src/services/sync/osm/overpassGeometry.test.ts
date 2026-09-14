/**
 * Rings from members: the one thing the Overpass door has to do that the
 * mirror did for it. Shapes are small squares with the coordinates written
 * out, so a failure names the vertex.
 */
import { describe, it, expect } from 'vitest';
import { geometryOf, joinRings, type OverpassPoint } from './overpassGeometry.js';
import { wktAreaOf, wktIsPolygonal } from './types.js';

const p = (lon: number, lat: number): OverpassPoint => ({ lat, lon });

/** A unit square, closed, counter-clockwise from (0,0). */
const SQUARE = [p(0, 0), p(1, 0), p(1, 1), p(0, 1), p(0, 0)];

describe('geometryOf', () => {
  it('reads a node as a point, with or without its coordinate', () => {
    expect(geometryOf({ type: 'node', id: 441183, lat: 37.98, lon: 23.73 }))
      .toEqual({ type: 'POINT', wkt: 'POINT(23.73 37.98)' });
    expect(geometryOf({ type: 'node', id: 441183, tags: { place: 'city' } }))
      .toEqual({ type: 'POINT', wkt: null });
  });

  it('reads a closed way as a polygon and an open one as a line', () => {
    const closed = geometryOf({ type: 'way', id: 1, geometry: SQUARE });
    expect(closed.type).toBe('POLYGON');
    expect(closed.wkt).toBe('POLYGON((0 0,1 0,1 1,0 1,0 0))');
    expect(wktIsPolygonal(closed.wkt)).toBe(true);

    const open = geometryOf({ type: 'way', id: 2, geometry: SQUARE.slice(0, 3) });
    expect(open).toEqual({ type: 'LINESTRING', wkt: 'LINESTRING(0 0,1 0,1 1)' });
  });

  it('knows nothing about a way answered with its tags alone', () => {
    expect(geometryOf({ type: 'way', id: 3, tags: { place: 'town' } }))
      .toEqual({ type: null, wkt: null });
  });

  it('joins a multipolygon relation from split, mixed-direction outer ways', () => {
    // The square as three segments: one drawn backwards, and the join order
    // in the answer not the ring order.
    const relation = geometryOf({
      type: 'relation', id: 4423249, tags: { type: 'multipolygon' },
      members: [
        { type: 'way', ref: 1, role: 'outer', geometry: [p(0, 0), p(1, 0)] },
        { type: 'way', ref: 3, role: 'outer', geometry: [p(0, 0), p(0, 1), p(1, 1)] },
        { type: 'way', ref: 2, role: 'outer', geometry: [p(1, 1), p(1, 0)] },
      ],
    });
    expect(relation.type).toBe('MULTIPOLYGON');
    expect(wktIsPolygonal(relation.wkt)).toBe(true);
    expect(wktAreaOf(relation.wkt)).toBeCloseTo(1, 3);
  });

  it('puts an inner ring inside the outer ring that contains it', () => {
    const hole = [p(0.25, 0.25), p(0.75, 0.25), p(0.75, 0.75), p(0.25, 0.75), p(0.25, 0.25)];
    const relation = geometryOf({
      type: 'relation', id: 1, tags: { type: 'multipolygon' },
      members: [
        { type: 'way', ref: 1, role: 'outer', geometry: SQUARE },
        { type: 'way', ref: 2, role: 'inner', geometry: hole },
        // A second outer far away, which the hole must not be attached to.
        { type: 'way', ref: 3, role: 'outer', geometry: SQUARE.map((v) => p(v.lon + 10, v.lat)) },
      ],
    });
    expect(relation.wkt).toBe(
      'MULTIPOLYGON(((0 0,1 0,1 1,0 1,0 0),(0.25 0.25,0.75 0.25,0.75 0.75,0.25 0.75,0.25 0.25)),'
      + '((10 0,11 0,11 1,10 1,10 0)))',
    );
    expect(wktAreaOf(relation.wkt)).toBeCloseTo(1.75, 3);
  });

  it('reads a member with no role as outer, the way a boundary relation means it', () => {
    const relation = geometryOf({
      type: 'relation', id: 2729059, tags: { type: 'boundary', boundary: 'protected_area' },
      members: [{ type: 'way', ref: 1, geometry: SQUARE }],
    });
    expect(relation.wkt).toBe('MULTIPOLYGON(((0 0,1 0,1 1,0 1,0 0)))');
  });

  it('draws nothing for an outer ring that does not close', () => {
    const relation = geometryOf({
      type: 'relation', id: 1, tags: { type: 'multipolygon' },
      members: [{ type: 'way', ref: 1, role: 'outer', geometry: SQUARE.slice(0, 4) }],
    });
    expect(relation).toEqual({ type: null, wkt: null });
  });

  it('never joins a site relation into an outline nobody mapped', () => {
    const relation = geometryOf({
      type: 'relation', id: 11268149, tags: { type: 'site' },
      members: [
        { type: 'way', ref: 1, geometry: SQUARE.slice(0, 3) },
        { type: 'way', ref: 2, geometry: SQUARE.slice(2) },
      ],
    });
    expect(relation).toEqual({ type: 'GEOMETRYCOLLECTION', wkt: null });
  });

  it('knows nothing about a relation answered with its tags alone', () => {
    expect(geometryOf({ type: 'relation', id: 1, tags: { type: 'multipolygon' } }))
      .toEqual({ type: null, wkt: null });
  });
});

describe('joinRings', () => {
  it('keeps every ring that closes and drops every segment that cannot', () => {
    const rings = joinRings([
      SQUARE,
      [p(5, 5), p(6, 5)],
      [p(6, 6), p(5, 6), p(5, 5)],
      [p(6, 5), p(6, 6)],
      [p(20, 20), p(21, 21)],
    ]);
    expect(rings).toHaveLength(2);
    expect(rings.every((ring) => ring[0].lat === ring[ring.length - 1].lat
      && ring[0].lon === ring[ring.length - 1].lon)).toBe(true);
  });
});
