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

  it('reads the world view id from the query string when told to', async () => {
    mockedQuery.mockResolvedValue({ rows: [{ is_public: true }] });
    const next = vi.fn();
    const res = makeRes();
    await requireVisibleWorldView('worldViewIdQuery')(
      { query: { worldViewId: '7' } } as never,
      res as never,
      next,
    );

    const [, params] = mockedQuery.mock.calls[0] as [string, unknown[]];
    expect(params).toEqual([7]);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('answers 404 when the id is missing or unparseable', async () => {
    const next = vi.fn();
    const res = makeRes();
    await requireVisibleWorldView('worldViewIdQuery')(
      { query: {} } as never,
      res as never,
      next,
    );

    expect(res.status).toHaveBeenCalledWith(404);
    expect(mockedQuery).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  // regionIdQuery: an optional filter (used by /api/experiences and
  // /api/experiences/:id/locations), unlike the three mandatory-id sources
  // above. Absent must pass through untouched; present-but-unparseable must
  // still 404 rather than reach the database.

  it('resolves a region id from the query string through its world view (regionIdQuery)', async () => {
    mockedQuery.mockResolvedValue({ rows: [{ is_public: true }] });
    const next = vi.fn();
    const res = makeRes();
    await requireVisibleWorldView('regionIdQuery')(
      { query: { regionId: '42' } } as never,
      res as never,
      next,
    );

    const [sql, params] = mockedQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).toMatch(/FROM regions r/);
    expect(sql).toMatch(/JOIN world_views wv ON wv\.id = r\.world_view_id/);
    expect(params).toEqual([42]);
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  it('answers 404 for a hidden world view reached via regionIdQuery', async () => {
    mockedQuery.mockResolvedValue({ rows: [{ is_public: false }] });
    const next = vi.fn();
    const res = makeRes();
    await requireVisibleWorldView('regionIdQuery')(
      { query: { regionId: '5' } } as never,
      res as never,
      next,
    );

    // Assert the DB check actually ran (through the region->world_view join),
    // not just that the response happened to be 404 for some other reason.
    const [sql, params] = mockedQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).toMatch(/FROM regions r/);
    expect(params).toEqual([5]);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(next).not.toHaveBeenCalled();
  });

  it('lets a request through untouched when regionId is absent (optional filter)', async () => {
    const next = vi.fn();
    const res = makeRes();
    // A worldViewId param is present too, to prove absence is read from
    // req.query.regionId specifically, not stumbled into via some other field.
    await requireVisibleWorldView('regionIdQuery')(
      { query: {}, params: { worldViewId: '5' } } as never,
      res as never,
      next,
    );

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
    expect(mockedQuery).not.toHaveBeenCalled();
  });

  it('answers 404 when regionId in the query is present but unparseable', async () => {
    const next = vi.fn();
    const res = makeRes();
    // A parseable worldViewId param sits alongside the bad regionId query
    // value — if the guard mis-reads req.params instead of req.query for this
    // source, it would resolve id=77 and query the DB instead of 404ing.
    await requireVisibleWorldView('regionIdQuery')(
      { query: { regionId: 'not-a-number' }, params: { worldViewId: '77' } } as never,
      res as never,
      next,
    );

    expect(res.status).toHaveBeenCalledWith(404);
    expect(mockedQuery).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });
});
