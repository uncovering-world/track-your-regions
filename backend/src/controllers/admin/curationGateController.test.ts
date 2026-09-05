/**
 * Tests for the curation-gate switch.
 *
 * The rule worth pinning is the one a column name cannot state: **switching a
 * gate on is not retroactive.** Nothing about `requires_curation = true` implies
 * anything about rows the source already published, and a statement that touched
 * them would remove a whole category from the product on one click. So the test
 * asserts what the statement does *not* say as firmly as what it does.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../db/index.js', () => ({
  pool: { query: vi.fn() },
}));

import { pool } from '../../db/index.js';
import { setCurationGate } from './curationGateController.js';

const mockedQuery = pool.query as unknown as ReturnType<typeof vi.fn>;

function makeRes() {
  return { json: vi.fn(), status: vi.fn().mockReturnThis() };
}

function makeReq(requiresCuration: boolean) {
  return {
    params: { categoryId: '2' },
    body: { requiresCuration },
    user: { id: 1, role: 'admin' as const },
  } as never;
}

describe('setCurationGate', () => {
  beforeEach(() => mockedQuery.mockReset());

  it('writes the source and says nothing about its rows', async () => {
    mockedQuery.mockResolvedValueOnce({
      rows: [{ id: 2, name: 'Art Museums', requires_curation: true }],
    });

    await setCurationGate(makeReq(true), makeRes() as never);

    expect(mockedQuery).toHaveBeenCalledTimes(1);
    const [sql, params] = mockedQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('UPDATE experience_categories');
    // The whole of "not retroactive", asserted as an absence: no statement here
    // may reach `experiences`, and there may be no second statement to do it.
    expect(sql).not.toMatch(/experiences\b(?!_categories)/);
    expect(params).toEqual([true, 2]);
  });

  it('refuses a category that is not active, rather than gating one nobody can run', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [] });
    const res = makeRes();

    await setCurationGate(makeReq(true), res as never);

    const [sql] = mockedQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('is_active = true');
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ error: 'Category not found' });
  });

  it('answers with the state the source is now in, not the state that was asked for', async () => {
    // The response is built from `RETURNING`, so a request that lost a race
    // reports what is stored rather than echoing its own body back.
    mockedQuery.mockResolvedValueOnce({
      rows: [{ id: 2, name: 'Art Museums', requires_curation: false }],
    });
    const res = makeRes();

    await setCurationGate(makeReq(true), res as never);

    expect(res.json).toHaveBeenCalledWith({
      categoryId: 2, name: 'Art Museums', requiresCuration: false,
    });
  });

  it('turns a gate off with the same single statement', async () => {
    mockedQuery.mockResolvedValueOnce({
      rows: [{ id: 2, name: 'Art Museums', requires_curation: false }],
    });

    await setCurationGate(makeReq(false), makeRes() as never);

    // Turning it off must not publish anything: the only statement is the same
    // one-table update, so nothing can move a row out of `pending` here.
    expect(mockedQuery).toHaveBeenCalledTimes(1);
    const [sql, params] = mockedQuery.mock.calls[0] as [string, unknown[]];
    expect(params).toEqual([false, 2]);
    expect(sql).not.toContain('curation_state');
  });
});
