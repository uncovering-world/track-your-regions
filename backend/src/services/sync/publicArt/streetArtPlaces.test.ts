/**
 * The street-art entrance and what the line reads (#2035): the entrance is the
 * union of the English Wikipedia categories, the genres and the places the
 * source already holds as street art, and without a copy of the categories it
 * reads the other two and says so.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { QueryRunner, SparqlFn } from '../wikidataQueries.js';
import type { EntityFacts } from './queries.js';

const mocks = vi.hoisted(() => ({
  latestStructure: vi.fn(),
  structureItemsInCategories: vi.fn(),
  admittedExternalIds: vi.fn(),
  fetchItemsOfGenres: vi.fn(),
  fetchStreetArtMarks: vi.fn(),
  fetchRootsOfClasses: vi.fn(),
  guidedOf: vi.fn(),
  yearlyReaders: vi.fn(),
}));
vi.mock('../../dumps/wikipedia/structureTables.js', () => ({ latestStructure: mocks.latestStructure }));
vi.mock('../wikipediaStructure.js', () => ({ structureItemsInCategories: mocks.structureItemsInCategories }));
vi.mock('../admission.js', () => ({ admittedExternalIds: mocks.admittedExternalIds }));
vi.mock('../places/guidedLine.js', () => ({ guidedOf: mocks.guidedOf }));
vi.mock('../places/candidates.js', () => ({ yearlyReaders: mocks.yearlyReaders }));
vi.mock('./streetArtQueries.js', () => ({
  fetchItemsOfGenres: mocks.fetchItemsOfGenres,
  fetchStreetArtMarks: mocks.fetchStreetArtMarks,
  fetchRootsOfClasses: mocks.fetchRootsOfClasses,
}));

import { enterStreetArtPlaces, readStreetArt } from './streetArtPlaces.js';
import { NOT_A_PLACE_CATEGORY, NOT_A_STREET_ART_PLACE, STREET_ART_CATEGORY, STREET_ART_GENRES } from './streetArtTest.js';

const sparql = vi.fn<SparqlFn>(async () => []);
const run: QueryRunner = { sparql, phase: () => {}, step: async () => {} };

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  mocks.structureItemsInCategories.mockResolvedValue(['Q1630131', 'Q18932366']);
  mocks.fetchItemsOfGenres.mockResolvedValue(['Q1630131', 'Q5908090']);
  mocks.admittedExternalIds.mockResolvedValue(new Set(['Q5127018']));
});

describe('the street-art entrance (#2035)', () => {
  it('names the items of the categories, the genres and the held street-art places once each', async () => {
    mocks.latestStructure.mockResolvedValue({ dumpDate: '2026-10-01' });
    expect((await enterStreetArtPlaces(run)).sort()).toEqual(['Q1630131', 'Q18932366', 'Q5127018', 'Q5908090']);
    expect(mocks.structureItemsInCategories).toHaveBeenCalledWith(STREET_ART_CATEGORY, NOT_A_PLACE_CATEGORY);
    expect(mocks.fetchItemsOfGenres).toHaveBeenCalledWith(sparql, STREET_ART_GENRES);
    expect(mocks.admittedExternalIds).toHaveBeenCalledWith(3, 'street-art');
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('named 4 items: 2 by an English Wikipedia category'));
  });

  it('reads the genres and the held places alone when no copy of the categories is built, and says so', async () => {
    mocks.latestStructure.mockResolvedValue(null);
    expect((await enterStreetArtPlaces(run)).sort()).toEqual(['Q1630131', 'Q5127018', 'Q5908090']);
    expect(mocks.structureItemsInCategories).not.toHaveBeenCalled();
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('the street-art categories are not read'));
  });
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

    expect(await readStreetArt(sparql, ['Q1630131', 'Q2035001', 'Q2035002'], facts)).toEqual({ marks, guided, readers, roots });
    expect(mocks.fetchStreetArtMarks).toHaveBeenCalledWith(sparql, ['Q1630131', 'Q2035001', 'Q2035002']);
    expect(mocks.fetchRootsOfClasses).toHaveBeenCalledWith(sparql, ['Q42948', 'Q2977'], Object.keys(NOT_A_STREET_ART_PLACE));
  });
});
