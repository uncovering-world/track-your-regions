/**
 * What a feature of the world layer carries, and what makes one answerable.
 *
 * Two things are pinned here, and the second is the one this file exists for.
 *
 * The **shape** per tier, asserted through the real builder rather than against
 * a hand-written fixture: the overview's whole economy is that a point is a
 * coordinate and nothing else, and a property leaking into it is 267 kB on the
 * map's first screen instead of 37 with nothing on screen looking wrong.
 *
 * The **agreement** between the two pointer paths. `useMapInteractions` decides
 * whether a gesture belongs to this layer rather than to the region under it,
 * and `useWorldPointInteractions` decides whether it can build a card from the
 * same feature. They are in different directories and never import each other,
 * and while the question was spelled twice they drifted: the capped overview
 * claimed the click and answered nothing, which is a dead click that also blocks
 * the region. One predicate now, read by both, and the last test below is what
 * keeps it that way — it fails if either side starts spelling its own.
 */

import { describe, it, expect } from 'vitest';
import {
  isAnswerablePin, worldPointsCollection, worldPointsUrl,
  type WorldPointsQuery, type WorldPointsResponse,
} from './worldPoints';
// The two consumers' own source, read through Vite's `?raw` rather than
// `node:fs`: this package's tsconfig carries no Node types, and a build-time
// import needs none.
import mapInteractionsSource from '../components/regionMap/useMapInteractions.ts?raw';
import worldPointInteractionsSource from '../components/experienceMarkers/useWorldPointInteractions.ts?raw';

const overview: WorldPointsResponse = {
  detail: 'overview', folded: false, count: 2, lng: [1, 2], lat: [3, 4],
};

const markers: WorldPointsResponse = {
  detail: 'markers',
  folded: false,
  count: 2,
  lng: [1, 2],
  lat: [3, 4],
  locationId: [10, 11],
  experienceId: [100, 101],
  name: ['Sybaris', null],
  experienceName: ['Sybaris', 'Victory Arch'],
  kindId: [5, null],
  type: ['site', null],
};

describe('worldPointsCollection', () => {
  it('gives an overview point a coordinate and nothing else', () => {
    const features = worldPointsCollection(overview).features;
    expect(features).toHaveLength(2);
    expect(features[0].geometry.coordinates).toEqual([1, 3]);
    expect(features[0].properties).toEqual({});
    expect(features[0].id).toBeUndefined();
  });

  it('gives a marker point its identity at the top of the feature as well as in its properties', () => {
    // The top-level id is MapLibre's handle for feature state; the first build
    // of this layer had the id in one place and the hover reading the other, so
    // every pin of a serial site highlighted at once.
    const features = worldPointsCollection(markers).features;
    expect(features[0].id).toBe(10);
    expect(features[0].properties.locationId).toBe(10);
    expect(features[0].properties.experienceName).toBe('Sybaris');
    expect(features[1].properties.name).toBeNull();
    expect(features[1].properties.locationCount).toBe(1);
  });

  it('carries the fold\'s count where the answer is folded', () => {
    const folded = { ...markers, folded: true, locationCount: [28, 1] };
    const features = worldPointsCollection(folded).features;
    expect(features[0].properties.locationCount).toBe(28);
  });
});

describe('isAnswerablePin', () => {
  it('answers no for every feature the overview tier builds', () => {
    for (const feature of worldPointsCollection(overview).features) {
      expect(isAnswerablePin(feature.properties)).toBe(false);
    }
  });

  it('answers yes for every feature the markers tier builds', () => {
    for (const feature of worldPointsCollection(markers).features) {
      expect(isAnswerablePin(feature.properties)).toBe(true);
    }
  });

  it.each([
    ['nothing', undefined],
    ['null', null],
    ['no properties', {}],
    ['a place with no object', { locationId: 10 }],
  ])('answers no for %s', (_case, properties) => {
    expect(isAnswerablePin(properties as never)).toBe(false);
  });
});

describe('the identity agreement has one home', () => {
  // The repo's own pattern for a rule that must not be spelled twice (see
  // `backend/src/config/userAgentOneSource.test.ts`): read the consumers and
  // hold them to reading the predicate rather than the property.
  const consumers: [string, string][] = [
    ['useMapInteractions', mapInteractionsSource],
    ['useWorldPointInteractions', worldPointInteractionsSource],
  ];

  for (const [name, source] of consumers) {
    it(`${name} asks through isAnswerablePin`, () => {
      expect(source).toContain('isAnswerablePin');
    });

    it(`${name} does not ask the property itself`, () => {
      // The drift this guards: narrowing one side's own test — to also require
      // a `locationId`, say — left the suite green while the truncated overview
      // went back to a dead click that blocked the region under it.
      const asking = source
        .split('\n')
        .filter(line => !line.trimStart().startsWith('*') && !line.trimStart().startsWith('//'))
        .filter(line => /properties(\?\.|\.)experienceId\s*(!=|==|===|!==)/.test(line));
      expect(asking).toEqual([]);
    });
  }
});

describe('worldPointsUrl', () => {
  const query: WorldPointsQuery = { kindId: null, detail: 'overview', folded: false, box: null };
  const paramsOf = (q: WorldPointsQuery) => new URL(worldPointsUrl(q)).searchParams;

  it('asks for the overview of every kind with nothing else said', () => {
    // Every default left out: the first screen's URL is also its cache key, and
    // a parameter spelled at its default would split the cache for nothing.
    expect([...paramsOf(query).entries()]).toEqual([['detail', 'overview']]);
  });

  it('names the kind only when there is one', () => {
    expect(paramsOf({ ...query, kindId: 5 }).get('kindId')).toBe('5');
    expect(paramsOf(query).has('kindId')).toBe(false);
  });

  it('names the fold only when it is on', () => {
    expect(paramsOf({ ...query, folded: true }).get('folded')).toBe('true');
    expect(paramsOf(query).has('folded')).toBe(false);
  });

  it('writes the box west, south, east, north — the order the endpoint reads', () => {
    // The order is the whole contract: `west > east` is how a box across the
    // antimeridian is told from one that is not, so a transposition does not
    // fail, it silently names the rest of the planet.
    const box = { west: -10, south: 35, east: 30, north: 60 };
    expect(paramsOf({ ...query, detail: 'markers', box }).get('bbox')).toBe('-10,35,30,60');
  });

  it('keeps a crossing box crossing rather than normalising it', () => {
    const box = { west: 170, south: -10, east: -170, north: 10 };
    expect(paramsOf({ ...query, detail: 'markers', box }).get('bbox')).toBe('170,-10,-170,10');
  });

  it('points at the endpoint itself', () => {
    expect(worldPointsUrl(query)).toContain('/api/experiences/points?');
  });
});
