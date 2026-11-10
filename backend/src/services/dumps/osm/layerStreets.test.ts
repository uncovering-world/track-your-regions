import { beforeEach, describe, expect, it, vi } from 'vitest';

const subset = { built: true, ids: [] as string[], placed: [] as Array<{ qid: string; lat: number | null; lon: number | null }> };
const asked: { classes: string[]; floor: number }[] = [];

vi.mock('../wikidata/subsetTables.js', () => ({
  latestSubset: vi.fn(async () => (subset.built ? { buildId: 1 } : null)),
  entitiesAreHeld: vi.fn(async () => subset.built),
}));
vi.mock('../../sync/subset/reader.js', () => ({ subsetRunner: () => ({ sparql: vi.fn(), phase: () => {}, step: async () => {} }) }));
vi.mock('../../sync/squares/kind.js', () => ({
  SQUARES_KIND: { name: 'squares and streets', trees: vi.fn(async () => ({})), poolClasses: () => ({ broad: [{ qid: 'Q79007', label: 'street' }], narrow: ['Q174782'] }) },
}));
vi.mock('../../sync/subset/publicArt.js', () => ({
  subsetIdsOfClasses: vi.fn(async (classes: string[], floor: number) => { asked.push({ classes, floor }); return subset.ids; }),
  subsetPlacedPoolOfIds: vi.fn(async () => subset.placed),
}));
vi.mock('../../sync/subset/kit.js', () => ({
  subsetNamesOf: vi.fn(async () => new Map([['Q820025', ['Bergmannstraße', 'Bergmann Street']], ['Q1123493', ['Plaza Mayor de Madrid']]])),
}));

const { STREET_REACH_M, streetArea, streetItems, streetsFile } = await import('./layerStreets.js');
const { POOL_MIN_SITELINKS } = await import('../../sync/publicArt/queries.js');

beforeEach(() => {
  subset.built = true;
  subset.ids = ['Q820025', 'Q1123493'];
  subset.placed = [{ qid: 'Q820025', lat: 52.4892, lon: 13.3939 }, { qid: 'Q1123493', lat: 40.4155, lon: -3.7074 }];
  asked.length = 0;
});

describe('streetItems (ADR-0194)', () => {
  it("reads the kind's own classes at the pool's floor, with each item's point and names", async () => {
    expect(await streetItems()).toEqual([
      { qid: 'Q1123493', lat: 40.4155, lon: -3.7074, names: ['Plaza Mayor de Madrid'] },
      { qid: 'Q820025', lat: 52.4892, lon: 13.3939, names: ['Bergmannstraße', 'Bergmann Street'] },
    ]);
    expect(asked).toEqual([{ classes: ['Q79007', 'Q174782'], floor: POOL_MIN_SITELINKS }]);
  });

  it('leaves out an item with no point, which no line can lie near', async () => {
    subset.placed = [{ qid: 'Q820025', lat: null, lon: null }];
    expect(await streetItems()).toEqual([]);
  });

  it('reads none while no subset is built, and the layer then keeps no street line', async () => {
    subset.built = false;
    expect(await streetItems()).toEqual([]);
    expect(asked).toEqual([]);
  });
});

describe('streetArea', () => {
  it('covers every cell within the reach of a point, the cells of a row joined into one rectangle', () => {
    const area = streetArea([{ qid: 'Q820025', lat: 52.4892, lon: 13.3939, names: [] }]) as { geometry: { type: string; coordinates: number[][][][] } };
    expect(area.geometry.type).toBe('MultiPolygon');
    // 1 km is about 0.009° of latitude and 0.015° of longitude at Berlin: two rows of four cells, each joined into one rectangle.
    const rows = area.geometry.coordinates.map(([ring]) => ({ west: ring[0][0], south: ring[0][1], east: ring[2][0], north: ring[2][1] }));
    expect(rows).toEqual([
      { west: 13.37, south: 52.48, east: 13.41, north: 52.49 },
      { west: 13.37, south: 52.49, east: 13.41, north: 52.5 },
    ]);
    const dLat = STREET_REACH_M / 111_000;
    const dLon = dLat / Math.cos((52.4892 * Math.PI) / 180);
    expect(Math.min(...rows.map(row => row.south))).toBeLessThanOrEqual(52.4892 - dLat);
    expect(Math.max(...rows.map(row => row.north))).toBeGreaterThanOrEqual(52.4892 + dLat);
    expect(Math.min(...rows.map(row => row.west))).toBeLessThanOrEqual(13.3939 - dLon);
    expect(Math.max(...rows.map(row => row.east))).toBeGreaterThanOrEqual(13.3939 + dLon);
  });

  it('draws two items in one cell once', () => {
    const one = streetArea([{ qid: 'Q1', lat: 40.4155, lon: -3.7074, names: [] }]) as { geometry: { coordinates: unknown[] } };
    const two = streetArea([{ qid: 'Q1', lat: 40.4155, lon: -3.7074, names: [] }, { qid: 'Q2', lat: 40.4156, lon: -3.7075, names: [] }]) as { geometry: { coordinates: unknown[] } };
    expect(two.geometry.coordinates).toEqual(one.geometry.coordinates);
  });

  it('draws nothing where there is no item', () => {
    expect(streetArea([])).toBeNull();
  });
});

describe('streetsFile', () => {
  it('writes one item a line, its names joined by a bar, leaving out a name the line cannot hold', () => {
    expect(streetsFile([
      { qid: 'Q820025', lat: 52.4892, lon: 13.3939, names: ['Bergmannstraße', 'Bergmann | Street', 'Bergmann\tStraße'] },
      { qid: 'Q1123493', lat: 40.4155, lon: -3.7074, names: [] },
    ])).toBe('Q820025\t52.4892\t13.3939\tBergmannstraße\nQ1123493\t40.4155\t-3.7074\t\n');
    expect(streetsFile([])).toBe('');
  });
});
