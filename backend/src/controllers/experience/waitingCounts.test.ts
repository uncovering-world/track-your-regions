/**
 * Tests for what a source is holding.
 *
 * The number these produce is the one a curator reads in the sync panel before
 * opening the queue, so the thing worth pinning is that the two cannot disagree:
 * each predicate here has to say what the matching query in
 * `reviewQueueController.ts` says, and the one case where a wrong reading is
 * plausible — a proposal pointer whose changeset holds only a *curator's* claim —
 * has to count zero, because it raises no `held` card either (#519).
 *
 * Asserted on the SQL, like the queue's own tests: the behaviour behind it was
 * checked against a live database with all four states built by hand, including
 * that case beside a genuinely held one, and a mocked query cannot tell a correct
 * predicate from a wrong one.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../db/index.js', () => ({
  pool: { query: vi.fn() },
}));

import { pool } from '../../db/index.js';
import {
  waitingCountsByCategory, arrivalWaitingSql, heldWaitingSql, contentsWaitingSql,
} from './waitingCounts.js';

const mockedQuery = pool.query as unknown as ReturnType<typeof vi.fn>;

describe('the waiting predicates', () => {
  it('counts an arrival only while the source still offers it and the catalogue accepts it', () => {
    const sql = arrivalWaitingSql();
    expect(sql).toContain("e.curation_state = 'pending'");
    // Both, not either: a withdrawn unread row is `missing`'s question, and a
    // refused one is answered rather than waiting. The queue's `arrivals` query
    // carries the same pair, and a count that dropped one would send a curator
    // looking for a card that is not there.
    expect(sql).toContain('e.missing_since IS NULL');
    expect(sql).toContain("e.admission <> 'refused'");
  });

  it('counts a held proposal by the field saying so, not by the absence of a claim', () => {
    const sql = heldWaitingSql();
    expect(sql).toContain('e.pending_change_sync_log_id IS NOT NULL');
    expect(sql).toMatch(/\(f->>'held'\)::boolean/);
    // #519: a field refused because a curator claimed it is a different card with
    // a different answer, so `curatedConflict` must not reach this count. The
    // predicate names `held` positively, which is what keeps it out.
    expect(sql).not.toContain('curatedConflict');
    expect(sql).toContain('ch.sync_log_id = e.pending_change_sync_log_id');
  });

  it('asks both content axes, and only about points the source still offers', () => {
    const sql = contentsWaitingSql();
    // A visible row: an unread row itself is an arrival, counted once above.
    expect(sql).toContain("e.curation_state <> 'pending'");
    expect(sql).toContain('el.missing_since IS NULL');
    expect(sql).toContain("el.curation_state = 'pending'");
    // Two tables, because a link's state and its work's state are independent —
    // a work reviewed in one venue and unread in another has to count.
    expect(sql).toContain("et.curation_state = 'pending'");
    expect(sql).toContain("t.curation_state = 'pending'");
  });
});

describe('waitingCountsByCategory', () => {
  beforeEach(() => mockedQuery.mockReset());

  it('asks once for every source, with the three kinds as filters on one pass', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [] });

    await waitingCountsByCategory();

    expect(mockedQuery).toHaveBeenCalledTimes(1);
    const [sql] = mockedQuery.mock.calls[0] as [string];
    expect(sql).toContain('GROUP BY e.category_id');
    for (const kind of [arrivalWaitingSql(), heldWaitingSql(), contentsWaitingSql()]) {
      expect(sql).toContain(kind);
    }
    // `::int` on each: COUNT is bigint, which pg hands over as a string, and
    // `'0' === 0` is false — a panel comparing against 0 to decide whether to
    // show "nothing waiting" would show a count of zero as work to do.
    expect(sql.match(/::int/g)).toHaveLength(3);
  });

  it('answers by category id, so a source with nothing waiting is absent rather than wrong', async () => {
    mockedQuery.mockResolvedValueOnce({
      rows: [{ category_id: 2, arrivals: 18, held: 1, contents: 3 }],
    });

    const counts = await waitingCountsByCategory();

    expect(counts.get(2)).toEqual({ arrivals: 18, held: 1, contents: 3 });
    // Nothing invents a zero row here: a category `GROUP BY` never saw is missing
    // from the map, and the caller decides what absence means. `getCategories`
    // reads it as three zeros, which is right for the panel and would be wrong
    // for a caller asking "did this source get counted at all".
    expect(counts.get(1)).toBeUndefined();
  });
});
