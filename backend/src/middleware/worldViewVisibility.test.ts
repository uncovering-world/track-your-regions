import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../db/index.js', () => ({
  pool: { query: vi.fn() },
}));

import { pool } from '../db/index.js';
import { requireVisibleWorldView } from './worldViewVisibility.js';

const mockedQuery = pool.query as unknown as ReturnType<typeof vi.fn>;

function makeRes() {
  return { json: vi.fn(), status: vi.fn().mockReturnThis() };
}

describe('requireVisibleWorldView', () => {
  beforeEach(() => {
    mockedQuery.mockReset();
  });

  it('lets admins through without querying', async () => {
    const next = vi.fn();
    const res = makeRes();
    await requireVisibleWorldView('worldViewIdParam')(
      { user: { role: 'admin' }, params: { worldViewId: '1' } } as never,
      res as never,
      next,
    );

    expect(next).toHaveBeenCalledTimes(1);
    expect(mockedQuery).not.toHaveBeenCalled();
  });

  it('lets anonymous callers through for a published world view', async () => {
    mockedQuery.mockResolvedValue({ rows: [{ is_public: true }] });
    const next = vi.fn();
    const res = makeRes();
    await requireVisibleWorldView('worldViewIdParam')(
      { params: { worldViewId: '2' } } as never,
      res as never,
      next,
    );

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  it('answers 404 for a hidden world view, not 403', async () => {
    // 403 would confirm the world view exists. 404 says nothing.
    mockedQuery.mockResolvedValue({ rows: [{ is_public: false }] });
    const next = vi.fn();
    const res = makeRes();
    await requireVisibleWorldView('worldViewIdParam')(
      { params: { worldViewId: '1' } } as never,
      res as never,
      next,
    );

    expect(res.status).toHaveBeenCalledWith(404);
    expect(next).not.toHaveBeenCalled();
  });

  it('answers 404 when the id does not resolve at all', async () => {
    mockedQuery.mockResolvedValue({ rows: [] });
    const next = vi.fn();
    const res = makeRes();
    await requireVisibleWorldView('worldViewIdParam')(
      { params: { worldViewId: '999' } } as never,
      res as never,
      next,
    );

    expect(res.status).toHaveBeenCalledWith(404);
    expect(next).not.toHaveBeenCalled();
  });

  it('resolves a region id through its world view', async () => {
    mockedQuery.mockResolvedValue({ rows: [{ is_public: true }] });
    const next = vi.fn();
    const res = makeRes();
    await requireVisibleWorldView('regionIdParam')(
      { params: { regionId: '42' } } as never,
      res as never,
      next,
    );

    const [sql, params] = mockedQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).toMatch(/FROM regions r/);
    expect(sql).toMatch(/JOIN world_views wv ON wv\.id = r\.world_view_id/);
    expect(params).toEqual([42]);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('answers 404 when the id is missing or unparseable', async () => {
    const next = vi.fn();
    const res = makeRes();
    await requireVisibleWorldView('worldViewIdParam')(
      { params: {} } as never,
      res as never,
      next,
    );

    expect(res.status).toHaveBeenCalledWith(404);
    expect(mockedQuery).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });
});
