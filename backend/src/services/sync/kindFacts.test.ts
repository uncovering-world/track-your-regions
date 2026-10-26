import { describe, expect, it } from 'vitest';
import { KIND_FACT_KEYS, splitKindFacts, withOwnFacts } from './kindFacts.js';

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

  it('leaves UNESCO\'s inscription on the place until it moves to its membership', () => {
    expect(splitKindFacts({ dateInscribed: '1983', inDanger: false }).facts).toEqual({});
    expect(KIND_FACT_KEYS).not.toContain('dateInscribed');
  });

  it('reads the run\'s own facts back over the place, so a diff compares what the run sent', () => {
    expect(withOwnFacts({ wikidataQid: 'Q1' }, { year: 1900 })).toEqual({ wikidataQid: 'Q1', year: 1900 });
    expect(withOwnFacts({ wikidataQid: 'Q1' }, {})).toEqual({ wikidataQid: 'Q1' });
    expect(withOwnFacts(null, null)).toBeNull();
    expect(withOwnFacts(null, { year: 1900 })).toEqual({ year: 1900 });
  });
});
