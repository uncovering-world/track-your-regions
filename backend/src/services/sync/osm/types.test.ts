/**
 * The shapes an OSM answer arrives in, on rows copied from the measurement of
 * 2026-09-14 (`data/cache/osm-sites/osm-tags.json`): Troy's excavation polygon,
 * Athens' city node, Rhodes' island relation.
 */
import { describe, it, expect } from 'vitest';
import {
  foldOsmRows, largestByArea, osmRefOf, wktAreaOf, wktIsPolygonal, type OsmObject,
} from './types.js';
import type { SparqlBinding } from '../wikidataUtils.js';

const row = (fields: Record<string, string>): SparqlBinding =>
  Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, { value: v }]));

describe('osmRefOf', () => {
  it('reads the kind and the id a person would quote', () => {
    expect(osmRefOf('https://www.openstreetmap.org/way/423938794'))
      .toEqual({ ref: 'way/423938794', kind: 'way' });
    expect(osmRefOf('https://www.openstreetmap.org/node/441183'))
      .toEqual({ ref: 'node/441183', kind: 'node' });
    expect(osmRefOf('https://www.openstreetmap.org/relation/305693'))
      .toEqual({ ref: 'relation/305693', kind: 'relation' });
  });

  it('answers nothing for anything else, rather than inventing a reference', () => {
    expect(osmRefOf('https://www.openstreetmap.org/changeset/1')).toBeNull();
    expect(osmRefOf('way/12')).toBeNull();
    expect(osmRefOf('')).toBeNull();
  });
});

describe('wktIsPolygonal', () => {
  it('takes a polygon and a multipolygon, and nothing else', () => {
    expect(wktIsPolygonal('POLYGON((26.2 39.9,26.3 39.9,26.3 40.0,26.2 39.9))')).toBe(true);
    expect(wktIsPolygonal('MULTIPOLYGON(((1 1,2 1,2 2,1 1)))')).toBe(true);
    expect(wktIsPolygonal('POINT(23.734 37.984)')).toBe(false);
    expect(wktIsPolygonal('LINESTRING(1 1,2 2)')).toBe(false);
    // A geometry collection is what a relation of mixed members answers with.
    expect(wktIsPolygonal('GEOMETRYCOLLECTION(POLYGON((1 1,2 1,2 2,1 1)))')).toBe(false);
    expect(wktIsPolygonal('')).toBe(false);
    expect(wktIsPolygonal(null)).toBe(false);
  });
});

describe('foldOsmRows', () => {
  it('groups the objects under the item that was asked about, tags and all', () => {
    const into = new Map<string, OsmObject[]>([['Q22647', []], ['Q1524', []]]);
    foldOsmRows([
      row({
        q: 'Q22647',
        s: 'https://www.openstreetmap.org/way/423938794',
        type: 'https://www.openstreetmap.org/way',
        geomType: 'POLYGON((26.',
        wkt: 'POLYGON((26.2 39.9,26.3 39.9,26.3 40.0,26.2 39.9))',
        historic: 'archaeological_site',
        archaeological_site: 'city',
        heritage: '1',
        tourism: 'attraction',
        boundary: 'protected_area',
        name: "Troya'nın Arkeolojik Alanı",
      }),
      row({
        q: 'Q1524',
        s: 'https://www.openstreetmap.org/node/441183',
        type: 'https://www.openstreetmap.org/node',
        geomType: 'POINT(23.734',
        place: 'city',
        name: 'Αθήνα',
      }),
    ], into);

    const troy = into.get('Q22647')!;
    expect(troy).toHaveLength(1);
    expect(troy[0].ref).toBe('way/423938794');
    expect(troy[0].kind).toBe('way');
    expect(troy[0].tags.historic).toBe('archaeological_site');
    expect(troy[0].tags.archaeological_site).toBe('city');
    expect(troy[0].geometryType).toBe('POLYGON');
    expect(troy[0].wkt).toMatch(/^POLYGON/);

    const athens = into.get('Q1524')!;
    expect(athens[0].tags.place).toBe('city');
    // The empty string the query binds where the WKT rule says "do not send it"
    // is no geometry, not an empty one.
    expect(athens[0].wkt).toBeNull();
  });

  it('merges a second row about the same object rather than listing it twice', () => {
    const into = new Map<string, OsmObject[]>([['Q5788', []]]);
    foldOsmRows([
      row({
        q: 'Q5788', s: 'https://www.openstreetmap.org/way/424506592',
        type: 'https://www.openstreetmap.org/way', historic: 'archaeological_site',
      }),
      row({
        q: 'Q5788', s: 'https://www.openstreetmap.org/way/424506592',
        type: 'https://www.openstreetmap.org/way', boundary: 'protected_area',
      }),
    ], into);
    expect(into.get('Q5788')).toHaveLength(1);
    expect(into.get('Q5788')![0].tags).toEqual({
      historic: 'archaeological_site', boundary: 'protected_area',
    });
  });

  it('drops a row about an item nobody asked about, rather than inventing a key', () => {
    const into = new Map<string, OsmObject[]>([['Q22647', []]]);
    foldOsmRows([row({
      q: 'Q999999', s: 'https://www.openstreetmap.org/node/1',
      type: 'https://www.openstreetmap.org/node',
    })], into);
    expect(into.has('Q999999')).toBe(false);
    expect(into.get('Q22647')).toEqual([]);
  });
});

describe('wktAreaOf', () => {
  it('measures the ground a polygon covers, holes taken away, and nothing for a point or a line', () => {
    // A unit square on the equator, then the same square with a quarter cut
    // out of it; the scale at the equator is one.
    expect(wktAreaOf('POLYGON((0 0,1 0,1 1,0 1,0 0))')).toBeCloseTo(1, 3);
    expect(wktAreaOf('POLYGON((0 0,1 0,1 1,0 1,0 0),(0 0,0.5 0,0.5 0.5,0 0.5,0 0))')).toBeCloseTo(0.75, 3);
    expect(wktAreaOf('MULTIPOLYGON(((0 0,1 0,1 1,0 1,0 0)),((2 0,3 0,3 1,2 1,2 0)))')).toBeCloseTo(2, 3);
    // The spaced spelling some writers use, and a hole inside a multipolygon.
    expect(wktAreaOf('MULTIPOLYGON (((0 0, 1 0, 1 1, 0 1, 0 0), (0 0, 0.5 0, 0.5 0.5, 0 0.5, 0 0)))'))
      .toBeCloseTo(0.75, 3);
    expect(wktAreaOf('POINT(1 1)')).toBe(0);
    expect(wktAreaOf('LINESTRING(0 0,1 1)')).toBe(0);
    expect(wktAreaOf(null)).toBe(0);
  });

  it('reads a degree of longitude as narrower away from the equator', () => {
    const square = (lat: number) =>
      `POLYGON((0 ${lat},1 ${lat},1 ${lat + 1},0 ${lat + 1},0 ${lat}))`;
    expect(wktAreaOf(square(60))).toBeLessThan(wktAreaOf(square(0)) * 0.6);
  });
});

describe('largestByArea', () => {
  const of = (ref: string, wkt: string | null): OsmObject =>
    ({ ref, kind: 'way', tags: {}, geometryType: null, wkt });

  it('takes the polygon covering the most ground, not the one with the most vertices', () => {
    // A small ruin traced in six points against the park around it drawn in
    // four: the longer WKT is the smaller shape.
    const chosen = largestByArea([
      of('way/1', 'POLYGON((0 0,0.1 0,0.1 0.1,0.05 0.12,0.02 0.11,0 0.1,0 0))'),
      of('way/2', 'POLYGON((0 0,1 0,1 1,0 1,0 0))'),
    ]);
    expect(chosen?.ref).toBe('way/2');
  });

  it('answers nothing where nothing carries a geometry', () => {
    expect(largestByArea([of('way/1', null)])).toBeNull();
    expect(largestByArea([])).toBeNull();
  });
});
