import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../db/index.js', () => ({ pool: { query: vi.fn() } }));

import { pool } from '../../db/index.js';
import { attachCrowding, crowdingOf } from './reviewQueueCrowding.js';
import type { ReviewQueueItem } from '../../api/responses/reviewQueue.js';

const mockedQuery = vi.mocked(pool.query);

/** A card about a membership, or about the place as a whole. */
const card = (membershipId: number | null) => ({ id: 1, membership_id: membershipId }) as unknown as ReviewQueueItem;

beforeEach(() => { mockedQuery.mockReset(); });

describe('attachCrowding (#2282)', () => {
  it("asks once for the page's memberships and writes each card's city, null where the rule does not reach", async () => {
    mockedQuery.mockResolvedValue({
      rows: [{
        membership_id: 14, crowding_limit: 10, radius_km: 10, around: 22, shadowed: true, outranked_by: 13,
        measured: true, measurable: true, better_known: 15,
      }],
    } as never);
    // Schloßplatz twice (an arrival and a held change of one membership), San Luigi's church, and a whole-place card.
    const cards = [card(14), card(14), card(50), card(null)];

    await attachCrowding(cards, { userId: 7, isAdmin: false });

    expect(mockedQuery).toHaveBeenCalledTimes(1);
    expect(mockedQuery.mock.calls[0][1]).toEqual([7, [14, 50]]);
    const crowded = {
      limit: 10, radiusKm: 10, around: 22, shadowed: true, outrankedBy: 13, measured: true, betterKnown: 15, measuringRun: null, measurable: true,
    };
    expect(cards.map(c => c.crowding)).toEqual([crowded, crowded, null, null]);
  });

  it('asks nothing for a page with no membership on it', async () => {
    const cards = [card(null)];
    await attachCrowding(cards, { userId: 7, isAdmin: true });
    expect(mockedQuery).not.toHaveBeenCalled();
    expect(cards[0].crowding).toBeNull();
  });
});

describe('crowdingOf (#2282)', () => {
  it('answers by membership, each asked once, and leaves out a membership the rule does not reach', async () => {
    mockedQuery.mockResolvedValue({
      rows: [{
        membership_id: 14, crowding_limit: 10, radius_km: 10, around: 22, shadowed: false, outranked_by: null,
        measured: true, measurable: true, better_known: 0,
      }],
    } as never);

    // Schloßplatz in Squares & streets, and in a kind with no display rule.
    const found = await crowdingOf([14, 14, 60], { userId: 7, isAdmin: false });

    expect(mockedQuery).toHaveBeenCalledTimes(1);
    expect(mockedQuery.mock.calls[0][1]).toEqual([7, [14, 60]]);
    expect([...found]).toEqual([[14, {
      limit: 10, radiusKm: 10, around: 22, shadowed: false, outrankedBy: null, measured: true, betterKnown: 0, measuringRun: null, measurable: true,
    }]]);
    // Zero by this count is checked against the rule's own count, which leaves out works and shadow pins.
    expect(String(mockedQuery.mock.calls[0][0])).toMatch(/WHEN around\.higher = 0 THEN crowding_outranked_by\(c\.id\)/);
  });

  it('names the run whose end measures a place not measured yet (#2420)', async () => {
    mockedQuery
      .mockResolvedValueOnce({
        rows: [{
          membership_id: 14, crowding_limit: 10, radius_km: 10, around: 15, shadowed: false, outranked_by: null,
          measured: false, measurable: true, better_known: null,
        }],
      } as never)
      .mockResolvedValueOnce({ rows: [{ name: 'Places of worship' }] } as never);

    // The Russian Church in Florence, arrived after the last run measured fame.
    const found = await crowdingOf([14], { userId: 7, isAdmin: false });

    expect(String(mockedQuery.mock.calls[1][0])).toMatch(/status = 'running' AND NOT l\.is_dry_run/);
    expect(found.get(14)).toMatchObject({ measured: false, betterKnown: null, measuringRun: 'Places of worship' });
    // A place not measured yet is counted by the rule alone, which counts the curator's list pins with no score.
    expect(String(mockedQuery.mock.calls[0][0])).toMatch(/CASE WHEN cf\.score IS NULL THEN crowding_outranked_by\(c\.id\)/);
  });

  it('names no run for a place no run can measure, and asks for none (#2420)', async () => {
    mockedQuery.mockResolvedValueOnce({
      rows: [{
        membership_id: 14, crowding_limit: 10, radius_km: 10, around: 15, shadowed: false, outranked_by: null,
        measured: false, measurable: false, better_known: null,
      }],
    } as never);

    // A church a curator made by hand: its membership's key is no Wikidata item.
    const found = await crowdingOf([14], { userId: 7, isAdmin: false });

    expect(mockedQuery).toHaveBeenCalledTimes(1);
    expect(found.get(14)).toMatchObject({ measured: false, measurable: false, measuringRun: null });
  });

  it('asks nothing for no membership', async () => {
    expect((await crowdingOf([], { userId: 7, isAdmin: true })).size).toBe(0);
    expect(mockedQuery).not.toHaveBeenCalled();
  });
});
