/**
 * The street-art entrance (#2035): the union of the English Wikipedia
 * categories, the genres, the class of a wall of graffiti paintings (#2055)
 * and the places the source already holds as street art, and without a copy
 * of the categories it reads the others and says so.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { QueryRunner, SparqlFn } from '../wikidataQueries.js';

const mocks = vi.hoisted(() => ({
  latestStructure: vi.fn(),
  structureItemsInCategories: vi.fn(),
  admittedExternalIds: vi.fn(),
  fetchItemsOfGenres: vi.fn(),
  fetchItemsOfClasses: vi.fn(),
}));
vi.mock('../../dumps/wikipedia/structureTables.js', () => ({ latestStructure: mocks.latestStructure }));
vi.mock('../wikipediaStructure.js', () => ({ structureItemsInCategories: mocks.structureItemsInCategories }));
vi.mock('../admission.js', () => ({ admittedExternalIds: mocks.admittedExternalIds }));
vi.mock('./streetArtQueries.js', () => ({
  fetchItemsOfGenres: mocks.fetchItemsOfGenres,
  fetchItemsOfClasses: mocks.fetchItemsOfClasses,
}));

import {
  enterStreetArtPlaces, NOT_A_PLACE_CATEGORY, STREET_ART_CATEGORY, GRAFFITI_WALL_CLASSES, STREET_ART_GENRES,
} from './entrances.js';

const sparql = vi.fn<SparqlFn>(async () => []);
const run: QueryRunner = { sparql, phase: () => {}, step: async () => {} };

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  mocks.structureItemsInCategories.mockResolvedValue(['Q1630131', 'Q18932366']);
  mocks.fetchItemsOfGenres.mockResolvedValue(['Q1630131', 'Q5908090']);
  // The East Side Gallery, which only its class names.
  mocks.fetchItemsOfClasses.mockResolvedValue(['Q313746']);
  mocks.admittedExternalIds.mockResolvedValue(new Set(['Q5127018']));
});

describe('the street-art entrance (#2035)', () => {
  it('names the items of the categories, the genres, the class and the held street-art places once each', async () => {
    mocks.latestStructure.mockResolvedValue({ dumpDate: '2026-10-01' });
    expect((await enterStreetArtPlaces(run)).sort())
      .toEqual(['Q1630131', 'Q18932366', 'Q313746', 'Q5127018', 'Q5908090']);
    expect(mocks.structureItemsInCategories).toHaveBeenCalledWith(STREET_ART_CATEGORY, NOT_A_PLACE_CATEGORY);
    expect(mocks.fetchItemsOfGenres).toHaveBeenCalledWith(sparql, STREET_ART_GENRES);
    expect(mocks.fetchItemsOfClasses).toHaveBeenCalledWith(sparql, GRAFFITI_WALL_CLASSES);
    expect(mocks.admittedExternalIds).toHaveBeenCalledWith(3, 'street-art');
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('named 5 items: 2 by an English Wikipedia category'));
  });

  it('reads the genres, the class and the held places alone when no copy of the categories is built, and says so', async () => {
    mocks.latestStructure.mockResolvedValue(null);
    expect((await enterStreetArtPlaces(run)).sort()).toEqual(['Q1630131', 'Q313746', 'Q5127018', 'Q5908090']);
    expect(mocks.structureItemsInCategories).not.toHaveBeenCalled();
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('the street-art categories are not read'));
  });
});
