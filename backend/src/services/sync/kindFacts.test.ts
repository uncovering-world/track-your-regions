import { describe, expect, it } from 'vitest';
import { KIND_FACT_KEYS, heldFacts, splitKindFacts, withOwnFacts } from './kindFacts.js';

describe('a run record split between the place and its membership', () => {
  it('keeps the place\'s own keys on the place and a kind\'s on its membership', () => {
    // A monument's record: the item and the website are the place's whichever
    // kind offers it; the year, the makers and the classes its rule read are
    // Monuments & memorials' (ADR-0153).
    const { place, facts } = splitKindFacts({
      wikidataQid: 'Q215380', website: 'https://example.org', sitelinksCount: 40,
      year: 1591, creators: ['Muhammad Quli Qutb Shah'], wikidataClasses: ['Q4989906'], wikidataArtwork: false,
    });
    expect(place).toEqual({ wikidataQid: 'Q215380', website: 'https://example.org', sitelinksCount: 40 });
    expect(facts).toEqual({
      year: 1591, creators: ['Muhammad Quli Qutb Shah'], wikidataClasses: ['Q4989906'], wikidataArtwork: false,
    });
  });

  it('puts UNESCO\'s inscription on the World Heritage membership and its page on the place (#2068)', () => {
    // Kathmandu Valley's record: the page is about the site, the rest is the
    // inscription, which goes with the membership when UNESCO delists it.
    const { place, facts } = splitKindFacts({
      unescoUrl: 'https://whc.unesco.org/en/list/121', dateInscribed: '1979', inDanger: false,
      dangerList: null, criteria: '(iii)(iv)(vi)', region: 'Asia and the Pacific',
      transboundary: false, areaHectares: 665,
    });
    expect(place).toEqual({ unescoUrl: 'https://whc.unesco.org/en/list/121' });
    expect(Object.keys(facts).sort()).toEqual([
      'areaHectares', 'criteria', 'dangerList', 'dateInscribed', 'inDanger', 'region', 'transboundary',
    ]);
    expect(KIND_FACT_KEYS).toEqual(expect.arrayContaining(['dateInscribed', 'inDanger', 'dangerList']));
  });

  it('reads the run\'s own facts back over the place, so a diff compares what the run sent', () => {
    expect(withOwnFacts({ wikidataQid: 'Q1' }, { year: 1900 })).toEqual({ wikidataQid: 'Q1', year: 1900 });
    expect(withOwnFacts({ wikidataQid: 'Q1' }, {})).toEqual({ wikidataQid: 'Q1' });
    expect(withOwnFacts(null, null)).toBeNull();
    expect(withOwnFacts(null, { year: 1900 })).toEqual({ year: 1900 });
  });
});

describe('the facts a held place\'s membership takes from its run', () => {
  // Kathmandu Valley, taken off the danger list in 2007: the run says so, and
  // a gated source holds the flag for a curator.
  const stored = { inDanger: true, dangerList: 'Y 2003', criteria: '(iii)(iv)', areaHectares: 665 };
  const incoming = { inDanger: false, criteria: '(iii)(iv)(vi)', areaHectares: 667 };

  it('keeps a shown fact until a curator publishes it, and takes every unseen one', () => {
    expect(heldFacts(stored, incoming, [])).toEqual({
      inDanger: true, dangerList: 'Y 2003', criteria: '(iii)(iv)(vi)', areaHectares: 667,
    });
  });

  it('takes a shown fact whose rewrite passes the gate, a removal included', () => {
    expect(heldFacts(stored, incoming, ['inDanger', 'dangerList'])).toEqual({
      inDanger: false, criteria: '(iii)(iv)(vi)', areaHectares: 667,
    });
  });

  it('drops an unseen fact the run no longer sends, since unseen facts are written whole', () => {
    expect(heldFacts({ year: 1591, criteria: '(i)' }, {}, [])).toEqual({});
  });
});
