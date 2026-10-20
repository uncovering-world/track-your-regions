import { describe, expect, it } from 'vitest';
import type { OsmObject } from '../osm/types.js';
import { isVisited, mapWitness, witnessesOf, witnessWords } from './witnesses.js';

/**
 * The visit witnesses (#1768, decided on #1718), on objects shaped as
 * OpenStreetMap maps the places #1718's measurement read: the Comitium and
 * Rungholt are drawn as digs or ruins, which says nothing of a visit, while
 * the Temple of Vesta's object is a temple and the Roman Baths' a museum.
 */

const object = (tags: Record<string, string>): OsmObject => ({ ref: 'way/1', kind: 'way', tags, geometryType: null, wkt: null });

describe('the map witness', () => {
  it('says yes for something standing or visited, and no for a dig or ruins alone', () => {
    expect(mapWitness([object({ historic: 'archaeological_site', building: 'ruins' })])).toBe(false);
    expect(mapWitness([object({ historic: 'archaeological_site', site_type: 'settlement' })])).toBe(false);
    expect(mapWitness([object({ building: 'yes' })])).toBe(false);
    expect(mapWitness([])).toBe(false);
    expect(mapWitness([object({ historic: 'temple' })])).toBe(true);
    expect(mapWitness([object({ tourism: 'museum' })])).toBe(true);
    expect(mapWitness([object({ historic: 'archaeological_site', opening_hours: 'Mo-Su 09:00-18:00' })])).toBe(true);
    expect(mapWitness([object({ building: 'church' })])).toBe(true);
    expect(mapWitness([object({ historic: 'ruins' }), object({ tourism: 'attraction' })])).toBe(true);
  });
});

describe('the witnesses together', () => {
  it('lists the ones that say yes in their reading order, and needs two', () => {
    const roman = witnessesOf({ guide: true, photos: true, formal: true, map: false });
    expect(roman).toEqual(['guide', 'photos', 'formal']);
    expect(isVisited(roman)).toBe(true);
    expect(isVisited(witnessesOf({ guide: false, photos: false, formal: false, map: true }))).toBe(false);
    expect(isVisited([])).toBe(false);
  });

  it('names them the way a person reads them', () => {
    expect(witnessWords([])).toBe('none');
    expect(witnessWords(['map'])).toBe('the map');
    expect(witnessWords(['guide', 'photos', 'formal'])).toBe(
      "a travel guide, photographs taken there and Wikidata's heritage, hours, visitors or website",
    );
  });
});
