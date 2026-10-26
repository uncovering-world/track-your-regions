/**
 * What the street-art questions make of a live answer (#2035), and that a run
 * reading the subset asks the subset instead of sending SPARQL.
 */

import { describe, expect, it, vi } from 'vitest';
import type { SparqlFn } from '../wikidataQueries.js';
import type { SparqlBinding } from '../wikidataUtils.js';
import { subsetDoor } from '../subset/reader.js';
import {
  fetchItemsOfClasses, fetchItemsOfGenres, fetchRootsOfClasses, fetchStreetArtHoldings, fetchStreetArtMarks,
} from './streetArtQueries.js';

const subset = vi.hoisted(() => ({
  subsetItemsOfGenres: vi.fn(async () => ['Q5908090']),
  subsetItemsOfClasses: vi.fn(async () => ['Q313746']),
  subsetStreetArtHoldings: vi.fn(async () => [{ place: 'Q313746', work: 'Q2410932' }]),
  subsetStreetArtMarks: vi.fn(async (qids: string[]) => new Map(qids.map(q => [q, { atlasObscura: true, ended: false }]))),
  subsetRootsOfClasses: vi.fn(async () => new Map([['Q2977', ['Q1370598']]])),
}));
vi.mock('../subset/streetArt.js', () => subset);

const ENTITY = 'http://www.wikidata.org/entity/';
const ref = (qid: string) => ({ value: `${ENTITY}${qid}` });

/** A door that answers every question with `rows` and records what it was sent. */
const door = (rows: SparqlBinding[]) => vi.fn<SparqlFn>(async () => rows);

describe('the street-art questions asked live (#2035)', () => {
  it('names the items filed under the genres', async () => {
    const sparql = door([{ e: ref('Q1630131') }, { e: ref('Q5908090') }]);
    expect(await fetchItemsOfGenres(sparql, ['Q17516', 'Q17514'])).toEqual(['Q1630131', 'Q5908090']);
    expect(sparql.mock.calls[0][0]).toContain('wdt:P136');
    expect(await fetchItemsOfGenres(sparql, [])).toEqual([]);
    expect(sparql).toHaveBeenCalledTimes(1);
  });

  it('names the items of the classes through the class tree (#2055)', async () => {
    const sparql = door([{ e: ref('Q313746') }]);
    expect(await fetchItemsOfClasses(sparql, ['Q1541532'])).toEqual(['Q313746']);
    expect(sparql.mock.calls[0][0]).toContain('wdt:P31/wdt:P279*');
    expect(await fetchItemsOfClasses(sparql, [])).toEqual([]);
    expect(sparql).toHaveBeenCalledTimes(1);
  });

  it('reads what a place holds from both sides of the statement, standing only (#2055)', async () => {
    const sparql = door([
      { place: ref('Q313746'), work: ref('Q2410932') },
      { place: ref('Q313746'), work: ref('Q3057616') },
      { place: ref('Q313746'), work: { value: 'not an entity' } },
    ]);
    expect(await fetchStreetArtHoldings(sparql, ['Q313746', 'not a qid'])).toEqual([
      { place: 'Q313746', work: 'Q2410932' },
      { place: 'Q313746', work: 'Q3057616' },
    ]);
    const query = sparql.mock.calls[0][0];
    for (const property of ['P527', 'P276', 'P361']) expect(query).toContain(`p:${property}`);
    expect(query).toContain('pq:P582');
    expect(query).toContain('wikibase:DeprecatedRank');
    expect(query).not.toContain('not a qid');
  });

  it('folds the rows of an entry and an end into one mark per item', async () => {
    const sparql = door([
      { e: ref('Q1630131'), ao: { value: 'lennon-wall' } },
      { e: ref('Q904023'), end: { value: '2014-01-01T00:00:00Z' } },
      { e: ref('Q904023'), ao: { value: '5-pointz' } },
    ]);
    const marks = await fetchStreetArtMarks(sparql, ['Q1630131', 'Q904023', 'Q5908090']);
    expect(Object.fromEntries(marks)).toEqual({
      Q1630131: { atlasObscura: true, ended: false },
      Q904023: { atlasObscura: true, ended: true },
    });
  });

  it('asks the marks in batches of two hundred', async () => {
    const sparql = door([]);
    await fetchStreetArtMarks(sparql, Array.from({ length: 401 }, (_, i) => `Q${i + 1}`));
    expect(sparql).toHaveBeenCalledTimes(3);
  });

  it('names the roots each class is a kind of, once per class however often it is asked', async () => {
    const sparql = door([{ c: ref('Q2977'), root: ref('Q1370598') }, { c: ref('Q2977'), root: ref('Q16560') }]);
    const roots = await fetchRootsOfClasses(sparql, ['Q2977', 'Q2977', 'Q42948'], ['Q1370598', 'Q16560']);
    expect(Object.fromEntries(roots)).toEqual({ Q2977: ['Q1370598', 'Q16560'] });
    expect(sparql.mock.calls[0][0]).toContain('wdt:P279*');
  });
});

describe('the street-art questions asked of the subset (#2035)', () => {
  it('sends no SPARQL and answers what the subset answers', async () => {
    const sparql = subsetDoor(door([]));
    expect(await fetchItemsOfGenres(sparql, ['Q17516'])).toEqual(['Q5908090']);
    expect(await fetchItemsOfClasses(sparql, ['Q1541532'])).toEqual(['Q313746']);
    expect(await fetchStreetArtHoldings(sparql, ['Q313746'])).toEqual([{ place: 'Q313746', work: 'Q2410932' }]);
    expect(Object.fromEntries(await fetchStreetArtMarks(sparql, ['Q1630131'])))
      .toEqual({ Q1630131: { atlasObscura: true, ended: false } });
    expect(Object.fromEntries(await fetchRootsOfClasses(sparql, ['Q2977'], ['Q1370598'])))
      .toEqual({ Q2977: ['Q1370598'] });
    expect(sparql).not.toHaveBeenCalled();
  });
});
