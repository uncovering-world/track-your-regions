/**
 * The near-pair card's items carry their label and description from the local
 * Wikidata subset (#1970), on Babylon: the World Heritage site resolves to the
 * item of its listing, Q100329356, the Archaeology row to the ancient city's,
 * Q5684, and only the descriptions tell the two apart.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../db/index.js', () => ({ pool: { query: vi.fn() } }));
vi.mock('../../services/sync/subset/entities.js', () => ({ termsOf: vi.fn() }));

import { pool } from '../../db/index.js';
import { termsOf } from '../../services/sync/subset/entities.js';
import { queryMergeProposals } from './reviewQueueMergeProposals.js';

const mockedQuery = pool.query as unknown as ReturnType<typeof vi.fn>;
const mockedTerms = termsOf as unknown as ReturnType<typeof vi.fn>;

describe('the near-pair card reads its items\' terms', () => {
  beforeEach(() => {
    mockedQuery.mockReset();
    mockedTerms.mockReset();
  });

  it('gives each place\'s item its label and description, and null where the subset has none', async () => {
    mockedQuery.mockResolvedValueOnce({
      rows: [{ id: 183, merge_pairs: [
        { proposalId: 37, otherWikidataItem: 'Q5684', anchorWikidataItem: 'Q100329356' },
        { proposalId: 38, otherWikidataItem: null, anchorWikidataItem: 'Q100329356' },
      ] }],
    });
    mockedTerms.mockResolvedValueOnce(new Map([
      ['Q5684', { label: 'Babylon', description: 'capital city of Babylonia and an archaeological site in modern-day Iraq' }],
    ]));
    const result = await queryMergeProposals([183]);
    // Each item asked once, whichever pair carries it.
    expect(mockedTerms).toHaveBeenCalledWith(['Q5684', 'Q100329356']);
    expect(result.rows[0].merge_pairs).toEqual([
      {
        proposalId: 37, otherWikidataItem: 'Q5684', anchorWikidataItem: 'Q100329356',
        otherWikidataLabel: 'Babylon', otherWikidataDescription: 'capital city of Babylonia and an archaeological site in modern-day Iraq',
        anchorWikidataLabel: null, anchorWikidataDescription: null,
      },
      {
        proposalId: 38, otherWikidataItem: null, anchorWikidataItem: 'Q100329356',
        otherWikidataLabel: null, otherWikidataDescription: null, anchorWikidataLabel: null, anchorWikidataDescription: null,
      },
    ]);
  });
});
