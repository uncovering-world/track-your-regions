/**
 * The two writes behind ADR-0051 decision 4: a curator sets a run's batch of
 * open questions aside, and brings it back. `reviewQueueKeys.test.ts` (and the
 * `reviewQueueKeys.ts` module itself) pin the read side that already honours
 * this table — these pin the write side, which the read has been waiting on.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../db/index.js', () => ({
  pool: { query: vi.fn() },
}));

import { pool } from '../../db/index.js';
import { setRunAside, bringRunBack } from './reviewQueueSetAside.js';

const mockedQuery = pool.query as unknown as ReturnType<typeof vi.fn>;

function makeRes() {
  return { json: vi.fn(), status: vi.fn().mockReturnThis() };
}

const CURATOR = { id: 9, role: 'curator' as const };

describe('setRunAside', () => {
  beforeEach(() => {
    mockedQuery.mockReset();
  });

  it('inserts for the calling user only, never an id in the body or params', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [{ sync_log_id: 98 }] });

    await setRunAside(
      { user: CURATOR, params: { syncLogId: 98 } } as never, makeRes() as never);

    expect(mockedQuery.mock.calls[0][1][0]).toBe(CURATOR.id);
    // And the run is the one the path named. Asserting only the user leaves the
    // second half of "for the calling user, on that run" unpinned: an insert
    // that bound the wrong id would hide a batch nobody asked to hide.
    expect(mockedQuery.mock.calls[0][1][1]).toBe(98);
  });

  it('refuses a dry run: the insert only ever matches a real one', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [{ sync_log_id: 98 }] });

    await setRunAside(
      { user: CURATOR, params: { syncLogId: 98 } } as never, makeRes() as never);

    const sql = String(mockedQuery.mock.calls[0][0]);
    // The whole predicate, to the end of its line: `toContain('is_dry_run = FALSE')` is
    // satisfied by a statement that goes on to say `OR TRUE`, which is exactly the
    // weakening this case exists to catch. It costs the assertion its indifference to how
    // the statement is laid out — deliberate here, and here only: this is the one clause
    // the module's docblock spends a paragraph on.
    expect(sql).toMatch(/WHERE\s+l\.id = \$2\s+AND\s+l\.is_dry_run = FALSE\s*$/m);
  });

  it('answers 404 when the run does not exist (and a dry run reads the same way)', async () => {
    // ON CONFLICT DO NOTHING returns nothing whether the run is missing, is a
    // dry run, or was already set aside — the existence check is what tells
    // those apart, and it finds nothing here either.
    mockedQuery.mockResolvedValueOnce({ rows: [] });
    mockedQuery.mockResolvedValueOnce({ rows: [] });
    const res = makeRes();

    await setRunAside(
      { user: CURATOR, params: { syncLogId: 404 } } as never, res as never);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ error: expect.any(String) });
  });

  it('answers 200 with setAside: true on a fresh insert', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [{ sync_log_id: 98 }] });
    const res = makeRes();

    await setRunAside(
      { user: CURATOR, params: { syncLogId: 98 } } as never, res as never);

    expect(res.json).toHaveBeenCalledWith({ syncLogId: 98, setAside: true });
  });

  it('is idempotent: a run already set aside by this curator still answers 200', async () => {
    // The conflict branch: ON CONFLICT DO NOTHING returns nothing because the
    // row is already there, and the existence check finds it.
    mockedQuery.mockResolvedValueOnce({ rows: [] });
    mockedQuery.mockResolvedValueOnce({ rows: [{ '?column?': 1 }] });
    const res = makeRes();

    await setRunAside(
      { user: CURATOR, params: { syncLogId: 98 } } as never, res as never);

    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ syncLogId: 98, setAside: true });
  });
});

describe('bringRunBack', () => {
  beforeEach(() => {
    mockedQuery.mockReset();
  });

  it('deletes for the calling user only', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 });

    await bringRunBack(
      { user: CURATOR, params: { syncLogId: 98 } } as never, makeRes() as never);

    const [sql, params] = mockedQuery.mock.calls[0];
    expect(String(sql)).toContain('DELETE FROM curator_queue_set_aside');
    expect(params[0]).toBe(CURATOR.id);
    expect(params[1]).toBe(98);
  });

  it('is idempotent: a run never set aside still answers 200 (rowCount: 0)', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    const res = makeRes();

    await bringRunBack(
      { user: CURATOR, params: { syncLogId: 98 } } as never, res as never);

    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ syncLogId: 98, setAside: false });
  });
});
