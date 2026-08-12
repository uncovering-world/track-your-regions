/**
 * Tests for the sources list the sync panel is built on.
 *
 * The rule worth pinning is about what this endpoint owes whom: the list is what it is
 * for, and the waiting counts are an addition to it. Three screens share this query and
 * read only `data`, so a failing count that rejected the request left an admin with a
 * heading, no sources, no Start Sync and no reason — while `null` costs three numbers
 * and says so.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../db/index.js', () => ({
  pool: { query: vi.fn() },
}));

vi.mock('../experience/waitingCounts.js', () => ({
  waitingCountsByCategory: vi.fn(),
}));

import { pool } from '../../db/index.js';
import { waitingCountsByCategory } from '../experience/waitingCounts.js';
import { getCategories } from './syncController.js';

const mockedQuery = pool.query as unknown as ReturnType<typeof vi.fn>;
const mockedCounts = waitingCountsByCategory as unknown as ReturnType<typeof vi.fn>;

const SOURCES = [
  { id: 1, name: 'UNESCO World Heritage Sites', is_active: true, requires_curation: false },
  { id: 2, name: 'Top Art Museums', is_active: true, requires_curation: true },
];

function makeRes() {
  return { json: vi.fn(), status: vi.fn().mockReturnThis() };
}

describe('getCategories', () => {
  beforeEach(() => {
    mockedQuery.mockReset();
    mockedCounts.mockReset();
    mockedQuery.mockResolvedValue({ rows: SOURCES });
  });

  it('asks for the gate flag itself, not only for what is waiting under it', async () => {
    mockedCounts.mockResolvedValue(new Map());

    await getCategories({} as never, makeRes() as never);

    // Asserted against the statement rather than the fixture: the mock answers `SOURCES`
    // whatever is selected, and `pool.query`'s rows are untyped on the way into the
    // response, so dropping the column from the SELECT list breaks nothing anywhere else
    // in the tree. It fails quietly and in the wrong direction — `checked={undefined}`
    // renders the switch off and the copy takes the ungated branch, so every gated source
    // would tell an admin its content reaches readers as soon as a run writes it.
    const [sql] = mockedQuery.mock.calls[0] as [string];
    expect(sql).toContain('requires_curation');
    // The same guard the writer is pinned on: the panel lists active sources, and the
    // switch it offers for an inactive one would answer 404.
    expect(sql).toContain('is_active = true');
  });

  it('answers three zeros for a source the aggregate returned no row for', async () => {
    mockedCounts.mockResolvedValue(new Map([[2, { arrivals: 18, held: 1, contents: 3 }]]));
    const res = makeRes();

    await getCategories({} as never, res as never);

    const [payload] = res.json.mock.calls[0] as [Array<{ id: number; waiting: unknown }>];
    // The aggregate groups, so a source with nothing waiting is absent from it rather
    // than present as zero — and absence means "counted, nothing there".
    expect(payload[0].waiting).toEqual({ arrivals: 0, held: 0, contents: 0 });
    expect(payload[1].waiting).toEqual({ arrivals: 18, held: 1, contents: 3 });
  });

  it('still answers the sources when the counts fail, with the counts as null', async () => {
    mockedCounts.mockRejectedValue(new Error('canceling statement due to statement timeout'));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = makeRes();

    await getCategories({} as never, res as never);

    const [payload] = res.json.mock.calls[0] as [Array<{ id: number; name: string; waiting: unknown }>];
    // Every source still there, with everything the panel needs to run and cancel a
    // sync. `null` rather than zeros, because a zero is a claim about the source and
    // nothing checked it — the same reason `heldLeftForReview` is nullable.
    expect(payload).toHaveLength(2);
    expect(payload[1].name).toBe('Top Art Museums');
    expect(payload[0].waiting).toBeNull();
    expect(payload[1].waiting).toBeNull();
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});
