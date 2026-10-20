import { describe, expect, it } from 'vitest';
import type { OsmObject } from '../osm/types.js';
import type { SparqlBinding } from '../wikidataUtils.js';
import { visitWitnessReader } from './visitWitnesses.js';

/**
 * The four witnesses read together (#1768), with each door stood in by what
 * it said of dry run 178's places on 2026-10-20: the Roman Baths are used by
 * Wikivoyage, photographed on site, listed and mapped as a museum; Stapleton
 * International Airport is none of these, though its category holds files.
 * The Tannenberg Memorial is stood in here with photographs taken there and
 * nothing else.
 */

const BATHS = { qid: 'Q2540426', lat: 51.3809, lon: -2.3595 };
const STAPLETON = { qid: 'Q1436575', lat: 39.779255, lon: -104.88184 };
const TANNENBERG = { qid: 'Q180973', lat: 53.4917, lon: 20.1342 };
const museum: OsmObject = { ref: 'way/1', kind: 'way', tags: { tourism: 'museum' }, geometryType: null, wkt: null };

describe('the visit witnesses of a set of places', () => {
  it('reads each witness from its own door, and asks Commons only about a place with a category and a point', async () => {
    const asked: string[] = [];
    const read = visitWitnessReader({
      sparql: (async () => [
        { e: { value: 'http://www.wikidata.org/entity/Q2540426' }, formal: { value: 'x' } },
        { e: { value: 'http://www.wikidata.org/entity/Q2540426' }, category: { value: 'Roman Baths (Bath)' } },
        { e: { value: 'http://www.wikidata.org/entity/Q1436575' }, category: { value: 'Stapleton International Airport' } },
        { e: { value: 'http://www.wikidata.org/entity/Q180973' }, category: { value: 'Tannenberg Memorial' } },
      ]) as unknown as (query: string) => Promise<SparqlBinding[]>,
      photos: async (question) => {
        asked.push(JSON.parse(question).category);
        const near: Record<string, string> = { 'Roman Baths (Bath)': '98', 'Tannenberg Memorial': '12' };
        return [{ near: { value: near[JSON.parse(question).category] ?? '0' } }];
      },
      guide: async () => new Set([BATHS.qid]),
    });
    const witnesses = await read([BATHS, STAPLETON, TANNENBERG, { qid: 'Q42', lat: null, lon: null }], new Map([[BATHS.qid, [museum]]]));
    expect(witnesses.get(BATHS.qid)).toEqual(['guide', 'photos', 'formal', 'map']);
    expect(witnesses.get(STAPLETON.qid)).toEqual([]);
    expect(witnesses.get(TANNENBERG.qid)).toEqual(['photos']);
    expect(witnesses.get('Q42')).toEqual([]);
    expect(asked).toEqual(['Roman Baths (Bath)', 'Stapleton International Airport', 'Tannenberg Memorial']);
  });

  it('asks nothing of an empty set', async () => {
    const read = visitWitnessReader({
      sparql: (async () => { throw new Error('asked'); }) as unknown as (query: string) => Promise<SparqlBinding[]>,
      photos: async () => { throw new Error('asked'); },
      guide: async () => { throw new Error('asked'); },
    });
    expect((await read([], new Map())).size).toBe(0);
  });
});
