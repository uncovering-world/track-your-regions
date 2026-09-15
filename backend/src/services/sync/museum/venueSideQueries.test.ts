/**
 * The two venue-side questions (#890): what they keep of an answer and what
 * they drop, and the one choice they make — which class types an object no
 * class question named.
 */

import { describe, it, expect } from 'vitest';
import {
  fetchVenueHoldings,
  fetchWorksByIds,
  lowestClass,
  HOLDINGS_LIMIT,
} from './venueSideQueries.js';
import type { SparqlFn } from '../wikidataQueries.js';
import type { SparqlBinding } from '../wikidataUtils.js';

const ENTITY = 'http://www.wikidata.org/entity/';
const RANK = 'http://wikiba.se/ontology#';
const uri = (qid: string) => ({ value: `${ENTITY}${qid}` });

function answering(rows: SparqlBinding[]): SparqlFn {
  return async () => rows;
}

function holding(
  work: string, venue: string, rel: 'P195' | 'P276', sl = 55, rank: 'Normal' | 'Preferred' | 'Deprecated' = 'Normal',
): SparqlBinding {
  return {
    w: uri(work), venue: uri(venue), rel: { value: rel },
    sl: { value: String(sl) }, rank: { value: `${RANK}${rank}Rank` },
  };
}

describe('fetchVenueHoldings', () => {
  it('answers one holding per current statement, with the venue as a fact of the row', async () => {
    // The Ishtar Gate is the Vorderasiatisches Museum's collection (P195, checked
    // 2026-09-15); the Pergamon Altar stands in the Pergamon Museum (P276).
    const out = await fetchVenueHoldings(answering([
      holding('Q26082', 'Q542084', 'P195', 55),
      holding('Q158058', 'Q157298', 'P276', 38),
    ]), ['Q542084', 'Q157298'], 10);
    expect(out).toEqual([
      { work: 'Q26082', venue: 'Q542084', property: 'P195', sitelinks: 55 },
      { work: 'Q158058', venue: 'Q157298', property: 'P276', sitelinks: 38 },
    ]);
  });

  it('drops a deprecated statement, as the work-side read does', async () => {
    const out = await fetchVenueHoldings(answering([
      holding('Q26082', 'Q542084', 'P195', 55, 'Deprecated'),
      holding('Q158058', 'Q157298', 'P276', 38, 'Preferred'),
    ]), ['Q542084', 'Q157298'], 10);
    expect(out.map((h) => h.work)).toEqual(['Q158058']);
  });

  it('asks nothing of no venue, and puts the floor in the question', async () => {
    const sent: string[] = [];
    const sparql: SparqlFn = async (query) => { sent.push(query); return []; };
    expect(await fetchVenueHoldings(sparql, ['not-a-qid'], 10)).toEqual([]);
    expect(sent).toHaveLength(0);
    await fetchVenueHoldings(sparql, ['Q157298'], 10);
    expect(sent[0]).toContain('FILTER(?sl >= 10)');
    expect(sent[0]).toContain('VALUES ?venue { wd:Q157298 }');
  });

  it('starts the join at the venue and tells the planner to keep that order', async () => {
    // Measured 2026-09-15: written work-first, or left to the planner, the same
    // question timed out for one venue; venue-first under `optimizer "None"`,
    // fifty venues answer in twelve seconds.
    const sent: string[] = [];
    const sparql: SparqlFn = async (query) => { sent.push(query); return []; };
    await fetchVenueHoldings(sparql, ['Q157298'], 10);
    expect(sent[0]).toContain('hint:Query hint:optimizer "None"');
    for (const property of ['P195', 'P276']) {
      const venueFirst = sent[0].indexOf(`?st ps:${property} ?venue`);
      const thenWork = sent[0].indexOf(`?w p:${property} ?st`);
      expect(venueFirst).toBeGreaterThan(-1);
      expect(thenWork).toBeGreaterThan(venueFirst);
    }
  });

  it('stops the run on an answer cut off at its limit', async () => {
    const rows = Array.from({ length: HOLDINGS_LIMIT }, (_, i) => holding(`Q${i + 1}`, 'Q157298', 'P276'));
    await expect(fetchVenueHoldings(answering(rows), ['Q157298'], 10)).rejects.toThrow(/LIMIT/);
  });
});

describe('fetchWorksByIds', () => {
  function detail(
    work: string, label: string, cls: { qid: string; label?: string }, extra: Partial<SparqlBinding> = {},
  ): SparqlBinding {
    const row: SparqlBinding = {
      w: uri(work), wLabel: { value: label }, sl: { value: '55' }, cls: uri(cls.qid), ...extra,
    };
    if (cls.label) row.clsLabel = { value: cls.label };
    return row;
  }

  it('collects every class an object carries, and types it by the lowest-numbered one', async () => {
    // The Ishtar Gate is `city gate` (Q82117) and `arch` (Q12277) on Wikidata:
    // one row per class, and the answer's order is the planner's, not ours.
    const out = await fetchWorksByIds(answering([
      detail('Q26082', 'Ishtar Gate', { qid: 'Q82117', label: 'city gate' }, { year: { value: '-575' } }),
      detail('Q26082', 'Ishtar Gate', { qid: 'Q12277', label: 'arch' }, { year: { value: '-575' } }),
    ]), ['Q26082']);
    const gate = out.get('Q26082');
    expect([...gate!.classes]).toEqual([['Q82117', 'city gate'], ['Q12277', 'arch']]);
    expect(gate!.work).toMatchObject({ label: 'Ishtar Gate', type: 'arch', typeQid: 'Q12277', year: -575, sitelinks: 55 });
  });

  it('keeps every maker across the class rows, once', async () => {
    const out = await fetchWorksByIds(answering([
      detail('Q1', 'Two makers', { qid: 'Q101687', label: 'altar' }, { creatorLabel: { value: 'A' } }),
      detail('Q1', 'Two makers', { qid: 'Q101687', label: 'altar' }, { creatorLabel: { value: 'B' } }),
      detail('Q1', 'Two makers', { qid: 'Q5', label: 'human' }, { creatorLabel: { value: 'A' } }),
    ]), ['Q1']);
    expect(out.get('Q1')!.work.creators).toEqual(['A', 'B']);
  });

  it('names a class with no label by its id, and types an object with no class as an object', async () => {
    const out = await fetchWorksByIds(answering([
      detail('Q1', 'Unlabelled class', { qid: 'Q900999', label: 'Q900999' }),
      { w: uri('Q2'), wLabel: { value: 'Classless' }, sl: { value: '12' } },
    ]), ['Q1', 'Q2']);
    expect(out.get('Q1')!.classes.get('Q900999')).toBe('Q900999');
    expect(out.get('Q1')!.work.type).toBe('object');
    expect(out.get('Q2')!.work).toMatchObject({ type: 'object', typeQid: null });
    expect(out.get('Q2')!.classes.size).toBe(0);
  });

  it('asks nothing of no id', async () => {
    const sent: string[] = [];
    const sparql: SparqlFn = async (query) => { sent.push(query); return []; };
    expect((await fetchWorksByIds(sparql, ['nope'])).size).toBe(0);
    expect(sent).toHaveLength(0);
  });
});

describe('lowestClass', () => {
  it('is the lowest number whatever the order, and null of no class', () => {
    expect(lowestClass(new Map([['Q82117', 'city gate'], ['Q12277', 'arch']]))).toBe('Q12277');
    expect(lowestClass(new Map([['Q12277', 'arch'], ['Q82117', 'city gate']]))).toBe('Q12277');
    expect(lowestClass(new Map())).toBeNull();
  });
});
