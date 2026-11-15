/** What the street-art line reads (#2035). */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SparqlFn } from '../wikidataQueries.js';
import type { EntityFacts } from './queries.js';

const mocks = vi.hoisted(() => ({
  fetchStreetArtMarks: vi.fn(),
  fetchRootsOfClasses: vi.fn(),
  guidedOf: vi.fn(),
  yearlyReaders: vi.fn(),
  yearlyReadersAtRank: vi.fn(async () => 10_000 as number | null),
}));
vi.mock('../places/worldBars.js', () => ({ guidedOf: mocks.guidedOf }));
vi.mock('../places/candidates.js', () => ({ yearlyReaders: mocks.yearlyReaders, yearlyReadersAtRank: mocks.yearlyReadersAtRank }));
vi.mock('./streetArtQueries.js', () => ({
  fetchStreetArtMarks: mocks.fetchStreetArtMarks,
  fetchRootsOfClasses: mocks.fetchRootsOfClasses,
}));

import { readStreetArt, streetArtGuideOf } from './streetArtPlaces.js';
import { NOT_A_STREET_ART_PLACE, READERS_MARK_RANK } from './streetArtTest.js';

const sparql = vi.fn<SparqlFn>(async () => []);

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

describe('what the street-art line reads (#2035)', () => {
  it('asks the marks, the guides and the readers of the candidates, and the roots of their classes', async () => {
    const marks = new Map([['Q1630131', { atlasObscura: true, ended: false }]]);
    const guided = new Set(['Q1630131']);
    const readers = new Map([['Q1630131', 40_000]]);
    const roots = new Map([['Q2977', ['Q1370598']]]);
    mocks.fetchStreetArtMarks.mockResolvedValue(marks);
    mocks.guidedOf.mockResolvedValue(guided);
    mocks.yearlyReaders.mockResolvedValue(readers);
    mocks.fetchRootsOfClasses.mockResolvedValue(roots);
    const facts = new Map([
      ['Q1630131', { classes: ['Q42948'] }],
      ['Q2035001', { classes: ['Q2977'] }],
    ]) as unknown as ReadonlyMap<string, EntityFacts>;

    expect(await readStreetArt(sparql, ['Q1630131', 'Q2035001', 'Q2035002'], facts)).toEqual({ marks, guided, readers, readersMark: 10_000, roots });
    expect(mocks.yearlyReadersAtRank).toHaveBeenCalledWith(READERS_MARK_RANK);
    expect(mocks.fetchStreetArtMarks).toHaveBeenCalledWith(sparql, ['Q1630131', 'Q2035001', 'Q2035002']);
    expect(mocks.fetchRootsOfClasses).toHaveBeenCalledWith(sparql, ['Q42948', 'Q2977'], Object.keys(NOT_A_STREET_ART_PLACE));
  });

  it('reads no readers where the year yields no mark: readers are no mark against nothing (ADR-0184)', async () => {
    mocks.fetchStreetArtMarks.mockResolvedValue(new Map());
    mocks.guidedOf.mockResolvedValue(new Set());
    mocks.yearlyReaders.mockResolvedValue(new Map([['Q1630131', 40_000]]));
    mocks.fetchRootsOfClasses.mockResolvedValue(new Map());
    mocks.yearlyReadersAtRank.mockResolvedValueOnce(null);

    const reading = await readStreetArt(sparql, ['Q1630131'], new Map());

    expect(reading.readers).toBeNull();
    expect(reading.readersMark).toBe(0);
  });

  it("takes each place's guide as last read when no usage build is in place (ADR-0175 decision 6)", async () => {
    mocks.fetchStreetArtMarks.mockResolvedValue(new Map());
    mocks.guidedOf.mockResolvedValue(null);
    mocks.yearlyReaders.mockResolvedValue(new Map());
    mocks.fetchRootsOfClasses.mockResolvedValue(new Map());
    const memory = { bars: null, readers: new Map(), guided: new Map([['Q1630131', true]]) };

    const reading = await readStreetArt(sparql, ['Q1630131', 'Q2035001'], new Map(), memory);

    expect(reading.guided).toBeNull();
    expect(streetArtGuideOf('Q1630131', reading)).toBe(true);
    // Never read: unknown, never no guide.
    expect(streetArtGuideOf('Q2035001', reading)).toBeNull();
  });

  it("asks no memory while the usage build answers", async () => {
    mocks.guidedOf.mockResolvedValue(new Set(['Q1630131']));
    const memory = { bars: null, readers: new Map(), guided: new Map([['Q2035001', true]]) };

    const reading = await readStreetArt(sparql, ['Q1630131', 'Q2035001'], new Map(), memory);

    expect(streetArtGuideOf('Q2035001', reading)).toBe(false);
  });
});
