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
  pool: { query: vi.fn(), connect: vi.fn() },
  rollbackQuietly: async (c: { query: (s: string) => unknown }) => {
    try { await c.query('ROLLBACK'); return undefined; } catch (e) { return e as Error; }
  },
}));

vi.mock('../experience/waitingCounts.js', () => ({
  waitingCountsByCategory: vi.fn(),
}));

import { pool } from '../../db/index.js';
import { waitingCountsByCategory } from '../experience/waitingCounts.js';
import { getCategories, reorderCategories } from './syncController.js';

const mockedQuery = pool.query as unknown as ReturnType<typeof vi.fn>;
const mockedConnect = pool.connect as unknown as ReturnType<typeof vi.fn>;
/** The same mock, in its callable shape: `vi.fn()`'s own type is not callable. */
const answer = mockedQuery as unknown as (sql: string, params?: unknown[]) => Promise<unknown>;
const mockedCounts = waitingCountsByCategory as unknown as ReturnType<typeof vi.fn>;

const SOURCES = [
  { id: 1, name: 'UNESCO World Heritage Sites', is_active: true, requires_curation: false },
  { id: 2, name: 'Art Museums', is_active: true, requires_curation: true },
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
    expect(payload[1].name).toBe('Art Museums');
    expect(payload[0].waiting).toBeNull();
    expect(payload[1].waiting).toBeNull();
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});

/**
 * The order the panel writes is one transaction, and it has to hold one
 * connection for its whole length — #532.
 *
 * `pool.query('BEGIN')` reads as a transaction and is not one: pg.Pool checks
 * out an arbitrary idle client, runs the BEGIN on it and releases it with the
 * transaction still open. Here the order is written one row at a time, so a run
 * that half-applied would leave two sources sharing a `display_priority` and one
 * with none — and the stray transaction on the released client would take a
 * different request's writes down with it when something eventually rolls back.
 */
describe('reorderCategories', () => {
  beforeEach(() => {
    mockedQuery.mockReset();
    mockedConnect.mockReset();
    mockedQuery.mockResolvedValue({ rows: [], rowCount: 1 });
  });

  /** The client the handler must pin; its statements answer from the pool's mock. */
  function pinClient() {
    const client = {
      query: vi.fn((sql: string, params?: unknown[]) => answer(sql, params)),
      release: vi.fn(),
    };
    mockedConnect.mockResolvedValue(client);
    return client;
  }

  it('writes every position on the pinned client, BEGIN through COMMIT', async () => {
    const client = pinClient();
    const res = makeRes();

    // Public Art & Monuments first, then UNESCO, then the museums.
    await reorderCategories({ body: { categoryIds: [3, 1, 2] } } as never, res as never);

    const onClient = client.query.mock.calls.map(call => String(call[0]));
    expect(onClient[0]).toBe('BEGIN');
    expect(onClient.at(-1)).toBe('COMMIT');
    expect(onClient.filter(sql => /UPDATE experience_categories/i.test(sql))).toHaveLength(3);
    expect(client.release).toHaveBeenCalledTimes(1);
    expect(res.json).toHaveBeenCalledWith({ success: true, order: [3, 1, 2] });
  });

  it('rolls back and hands the connection back when a position fails', async () => {
    const client = pinClient();
    mockedQuery
      .mockResolvedValueOnce({ rows: [] })  // BEGIN
      .mockRejectedValueOnce(new Error('deadlock detected'));

    await expect(reorderCategories(
      { body: { categoryIds: [3, 1, 2] } } as never, makeRes() as never,
    )).rejects.toThrow('deadlock detected');

    const onClient = client.query.mock.calls.map(call => String(call[0]));
    expect(onClient).toContain('ROLLBACK');
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it('never opens the transaction before the input is known to be a list', async () => {
    const client = pinClient();
    const res = makeRes();

    await reorderCategories({ body: {} } as never, res as never);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockedConnect).not.toHaveBeenCalled();
    expect(client.query).not.toHaveBeenCalled();
  });
});
