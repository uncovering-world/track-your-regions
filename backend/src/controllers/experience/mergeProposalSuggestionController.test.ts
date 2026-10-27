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
  name: 'Svetitskhoveli Cathedral', kinds: ['Places of worship'], partOf: null, item: 'Q42587240',
  countries: ['Georgia'], pairs: [],
};
const PAIR = {
  proposalId: 51, otherId: 37310, otherName: 'Svetitskhoveli Cathedral', otherKinds: [],
  otherPartOf: 'Historical Monuments of Mtskheta', otherItem: 'Q1152972', otherCountries: ['Georgia'],
  distanceM: 62, similarity: 1, exact: false, foundBy: 'similar' as const, reachM: 300, asked: {}, stored: null,
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
});
