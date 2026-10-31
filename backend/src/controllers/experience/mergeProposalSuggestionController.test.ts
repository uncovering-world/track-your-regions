import { describe, expect, it, vi } from 'vitest';

vi.mock('../../db/index.js', () => ({ pool: { query: vi.fn(), connect: vi.fn() }, rollbackQuietly: vi.fn() }));

import { questionFor } from './mergeProposalSuggestionController.js';

/**
 * The question Jev is asked about a pair of near places (#1249), on
 * Mtskheta's shape (#1250): the Places of worship row Svetitskhoveli
 * Cathedral, and the part of the Historical Monuments of Mtskheta of the same
 * name 62 m off, which is in no kind of its own.
 */
const ANCHOR = {
  name: 'Svetitskhoveli Cathedral', kinds: ['Places of worship'], partOf: null, item: 'Q42587240', itemClaimed: true,
  countries: ['Georgia'], pairs: [],
};
const PAIR = {
  proposalId: 51, otherId: 37310, otherName: 'Svetitskhoveli Cathedral', otherKinds: [],
  otherPartOf: 'Historical Monuments of Mtskheta', otherItem: 'Q1152972', otherItemClaimed: true, otherCountries: ['Georgia'],
  distanceM: 62, similarity: 1, exact: false, foundBy: 'similar' as const, matchedWords: null, reachM: 300, asked: {}, stored: null,
};

describe('the question about a pair of near places', () => {
  it("says a part is a component of its site, never that it lies inside one, and the other place's kinds", () => {
    const { instructions } = questionFor(ANCHOR, PAIR);
    expect(instructions).toContain('"Svetitskhoveli Cathedral" is in Places of worship and has Wikidata item Q42587240.');
    expect(instructions).toContain('"Svetitskhoveli Cathedral" is a component of the World Heritage site "Historical Monuments of Mtskheta", in Georgia');
    expect(instructions).not.toContain('is in a component');
  });

  it('names both what a part with a kind of its own is in and the site it is a component of', () => {
    const { instructions } = questionFor(ANCHOR, { ...PAIR, otherKinds: ['Archaeology'] });
    expect(instructions).toContain('is a component of the World Heritage site "Historical Monuments of Mtskheta" and is in Archaeology');
  });

  it("says the words a containment stood on, a town's name alone as such (#2194)", () => {
    // Tallinn's Old Town beside Freedom Square: the one word the two names share is the town's.
    const tallinn = questionFor({ ...ANCHOR, name: 'Historic Centre (Old Town) of Tallinn' }, {
      ...PAIR, otherName: 'Freedom Square (Tallinn)', similarity: 0.19, foundBy: 'words', matchedWords: ['tallinn'],
    });
    expect(tallinn.instructions).toContain('The one significant word the two places\' names share is "tallinn". ');
    expect(tallinn.instructions).not.toContain('Every significant word');
    const abbey = questionFor(ANCHOR, { ...PAIR, foundBy: 'words', matchedWords: ['westminster', 'abbey'] });
    expect(abbey.instructions).toContain('Every significant word of one of the places\' names stands in one of the other\'s: "westminster", "abbey".');
    const unrecorded = questionFor(ANCHOR, { ...PAIR, foundBy: 'words', matchedWords: null });
    expect(unrecorded.instructions).toContain('Every significant word of one of the places\' names stands in one of the other\'s. ');
  });

  it('says whose item one shared item is: claimed by one place, by both, or by neither (#2194)', () => {
    // Q957628 is the Saint Stepanos Monastery's own and is carried by each of the ensemble's three components.
    const { instructions } = questionFor(
      { ...ANCHOR, name: 'Saint Stepanos Monastery', item: 'Q957628' },
      { ...PAIR, otherName: 'The main church (Monastery of Saint Stepanos Esemble)', otherItem: 'Q957628', otherItemClaimed: false },
    );
    expect(instructions).toContain('The Wikidata item Q957628 is "Saint Stepanos Monastery"\'s own; '
      + '"The main church (Monastery of Saint Stepanos Esemble)" carries it too, as several places do, and only refers to it.');
    expect(instructions).not.toContain('different Wikidata items');
    const both = questionFor({ ...ANCHOR, item: 'Q957628' }, { ...PAIR, otherItem: 'Q957628' });
    expect(both.instructions).toContain('Both claim the Wikidata item Q957628 as their own.');
    const neither = questionFor({ ...ANCHOR, item: 'Q957628', itemClaimed: false }, { ...PAIR, otherItem: 'Q957628', otherItemClaimed: false });
    expect(neither.instructions).toContain('Both carry the Wikidata item Q957628, neither as its own: several places carry it.');
  });
});
