import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../db/index.js', () => ({
  pool: { query: vi.fn() },
}));

import { pool } from '../db/index.js';
import { isVisibleToReaders } from './worldViewVisibility.js';

const mockedQuery = pool.query as unknown as ReturnType<typeof vi.fn>;

/**
 * The check behind a declared route's `scope`. Who is let past it without
 * asking (an admin), and the 404 a reader gets, are the registry's, and
 * `api/route.test.ts` holds them on a real server.
 */
describe('isVisibleToReaders', () => {
  beforeEach(() => {
    mockedQuery.mockReset();
  });

  it('answers yes for a published world view', async () => {
    mockedQuery.mockResolvedValue({ rows: [{ is_public: true }] });

    expect(await isVisibleToReaders({ worldViewId: 2 })).toBe(true);
    const [sql, params] = mockedQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).toMatch(/FROM world_views/);
    expect(sql).toMatch(/is_active = true/);
    expect(params).toEqual([2]);
  });

  it('answers no for a hidden world view and for one that does not exist, alike', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [{ is_public: false }] });
    mockedQuery.mockResolvedValueOnce({ rows: [] });

    expect(await isVisibleToReaders({ worldViewId: 1 })).toBe(false);
    expect(await isVisibleToReaders({ worldViewId: 999 })).toBe(false);
  });

  it('resolves a region through its world view', async () => {
    mockedQuery.mockResolvedValue({ rows: [{ is_public: true }] });

    expect(await isVisibleToReaders({ regionId: 42 })).toBe(true);
    const [sql, params] = mockedQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).toMatch(/FROM regions r/);
    expect(sql).toMatch(/JOIN world_views wv ON wv\.id = r\.world_view_id/);
    expect(params).toEqual([42]);
  });
});
