/**
 * The finder's pass in the background (#1272), and Jev's judgement of what it
 * proposed (#1355): the summary says what Jev was asked and answered, and a
 * pass without a judge asks nothing.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./componentItemFinder.js', () => ({
  findComponentItems: vi.fn(async () => ({
    matches: [],
    report: {
      points: 10, partOf: 2, near: 1, numbered: 0, exact: 1, wholeSites: 0, settlements: 0,
      atTheComponent: 0, unsearched: 0, unreadSites: 0, queries: 5,
    },
  })),
}));

const { findUnescoComponentItems } = await import('./componentItemJob.js');
const { runningSyncs } = await import('./types.js');

afterEach(() => { runningSyncs.clear(); });

describe("the component-item pass's summary", () => {
  it('says what Jev judged, site by site, once the proposals are written', async () => {
    const site = vi.fn(async (id: number) => (id === 1
      ? { asked: 2, same: 1, other: 1, refused: 0, inputTokens: 600, failed: false }
      : { asked: 1, same: 0, other: 0, refused: 1, inputTokens: 400, failed: false }));

    await findUnescoComponentItems(null, {
      budgetUsd: 0.1, budgetTokens: 2_380_952,
      sites: async () => [{ experienceId: 1, unjudged: 2 }, { experienceId: 2, unjudged: 1 }],
      site,
    });

    expect(site.mock.calls.map(([id]) => id)).toEqual([1, 2]);
    expect(runningSyncs.get(1)?.statusMessage).toContain(
      '; Jev judged 3 candidates — 1 the same place, 1 another, 1 unanswered — for 1000 input tokens',
    );
  });

  it("leaves a site whose questions would pass the budget for its card, and still asks a smaller one after it", async () => {
    const site = vi.fn(async (_id: number) => ({ asked: 1, same: 1, other: 0, refused: 0, inputTokens: 500, failed: false }));

    // 1,200 tokens: room for two questions at 600 each, not for a site of three.
    await findUnescoComponentItems(null, {
      budgetUsd: 0.0000504, budgetTokens: 1200,
      sites: async () => [{ experienceId: 1, unjudged: 3 }, { experienceId: 2, unjudged: 1 }],
      site,
    });

    expect(site.mock.calls.map(([id]) => id)).toEqual([2]);
    expect(runningSyncs.get(1)?.statusMessage).toContain("; 3 candidates past the pass's budget of $0.0000504 wait for their card");
  });

  it('stops asking after a call Jev did not answer, and says how many candidates wait for their card', async () => {
    const site = vi.fn(async (_id: number) => ({ asked: 0, same: 0, other: 0, refused: 0, inputTokens: 0, failed: true }));

    await findUnescoComponentItems(null, {
      budgetUsd: 0.1, budgetTokens: 2_380_952,
      sites: async () => [{ experienceId: 1, unjudged: 2 }, { experienceId: 2, unjudged: 3 }],
      site,
    });

    expect(site).toHaveBeenCalledTimes(1);
    expect(runningSyncs.get(1)?.statusMessage).toContain('; Jev did not answer, so 5 candidates wait for their card');
  });

  it('asks nothing and says nothing of Jev without a judge', async () => {
    await findUnescoComponentItems(null);

    expect(runningSyncs.get(1)?.status).toBe('complete');
    expect(runningSyncs.get(1)?.statusMessage).not.toContain('Jev');
  });
});
