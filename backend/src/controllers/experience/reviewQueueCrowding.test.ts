import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../db/index.js', () => ({ pool: { query: vi.fn() } }));

import { pool } from '../../db/index.js';
import { attachCrowding } from './reviewQueueCrowding.js';
import type { ReviewQueueItem } from '../../api/responses/reviewQueue.js';

const mockedQuery = vi.mocked(pool.query);

/** A card about a membership, or about the place as a whole. */
const card = (membershipId: number | null) => ({ id: 1, membership_id: membershipId }) as unknown as ReviewQueueItem;

beforeEach(() => { mockedQuery.mockReset(); });

describe('attachCrowding (#2282)', () => {
  it("asks once for the page's memberships and writes each card's city, null where the rule does not reach", async () => {
    mockedQuery.mockResolvedValue({
      rows: [{ membership_id: 14, crowding_limit: 10, radius_km: 10, around: 22, shadowed: true, outranked_by: 13 }],
    } as never);
    // Schloßplatz twice (an arrival and a held change of one membership), San Luigi's church, and a whole-place card.
    const cards = [card(14), card(14), card(50), card(null)];

    await attachCrowding(cards, { userId: 7, isAdmin: false });

    expect(mockedQuery).toHaveBeenCalledTimes(1);
    expect(mockedQuery.mock.calls[0][1]).toEqual([7, [14, 50]]);
    const crowded = { limit: 10, radiusKm: 10, around: 22, shadowed: true, outrankedBy: 13 };
    expect(cards.map(c => c.crowding)).toEqual([crowded, crowded, null, null]);
  });

  it('asks nothing for a page with no membership on it', async () => {
    const cards = [card(null)];
    await attachCrowding(cards, { userId: 7, isAdmin: true });
    expect(mockedQuery).not.toHaveBeenCalled();
    expect(cards[0].crowding).toBeNull();
  });
});
