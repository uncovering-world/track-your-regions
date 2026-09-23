import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../db/index.js', () => ({
  pool: { query: vi.fn().mockResolvedValue({ rows: [] }) },
}));

import { pool } from '../../db/index.js';
import { getWorldViews, createWorldView, updateWorldView } from './worldViewCrud.js';

const mockedQuery = pool.query as unknown as ReturnType<typeof vi.fn>;

/** A world view as the driver hands it over: the custom one of the dev data, hidden. */
function worldViewRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 5, name: 'Travel regions', description: null, source: null,
    is_default: false, is_public: false, tile_version: 7, ...overrides,
  };
}

function makeRes() {
  return { json: vi.fn(), status: vi.fn().mockReturnThis() };
}

describe('getWorldViews visibility', () => {
  beforeEach(() => {
    mockedQuery.mockClear();
    mockedQuery.mockResolvedValue({ rows: [] });
  });

  it('hides non-public world views from anonymous callers', async () => {
    const res = makeRes();
    await getWorldViews({} as never, res as never);

    const [sql, params] = mockedQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).toMatch(/AND\s*\(\$1::boolean OR is_public\)/);
    expect(params).toEqual([false]);
  });

  it('shows every active world view to admins', async () => {
    const res = makeRes();
    await getWorldViews({ user: { role: 'admin' } } as never, res as never);

    const [sql, params] = mockedQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).toMatch(/AND\s*\(\$1::boolean OR is_public\)/);
    expect(params).toEqual([true]);
  });

  // The cache headers that keep a shared cache from serving an admin's list to
  // a visitor are not this controller's to set: `optionalAuth` on the
  // route sets them for every caller-shaped read (middleware/auth.test.ts),
  // and routes/callerShapedReads.test.ts holds that this route carries it.

  it('answers with each world view\'s visibility and tile version', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [worldViewRow({ is_default: true, is_public: true, tile_version: null })] });
    const res = makeRes();
    await getWorldViews({} as never, res as never);

    expect(res.json).toHaveBeenCalledWith([{
      id: 5, name: 'Travel regions', description: null, source: null, isDefault: true, isPublic: true, tileVersion: 0,
    }]);
  });
});

describe('createWorldView', () => {
  beforeEach(() => {
    mockedQuery.mockClear();
    mockedQuery.mockResolvedValue({ rows: [worldViewRow({ id: 9, tile_version: 0 })] });
  });

  it('answers with the world view the list would show, visibility and tile version included', async () => {
    const res = makeRes();
    await createWorldView(
      { body: { name: 'New World View' } } as never,
      res as never,
    );

    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ id: 9, isPublic: false, tileVersion: 0 }));
  });
});

describe('updateWorldView visibility', () => {
  beforeEach(() => {
    mockedQuery.mockClear();
    mockedQuery.mockResolvedValue({ rows: [worldViewRow()] });
  });

  // The client selects the world view it gets back, and takes its tile version
  // from it: an answer without one would point every tile URL at version 0.
  it('answers with the tile version, which the client keys its tile URLs on', async () => {
    const res = makeRes();
    await updateWorldView(
      { params: { worldViewId: '5' }, body: { isPublic: true } } as never,
      res as never,
    );

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ id: 5, tileVersion: 7 }));
  });

  it('passes isPublic: false through instead of collapsing it to null', async () => {
    // Regression guard: `isPublic || null` would make hiding a world view
    // impossible, since false and null both mean "leave unchanged" to COALESCE.
    const res = makeRes();
    await updateWorldView(
      { params: { worldViewId: '5' }, body: { isPublic: false } } as never,
      res as never,
    );

    const [, params] = mockedQuery.mock.calls[0] as [string, unknown[]];
    expect(params[3]).toBe(false);
  });

  it('leaves visibility untouched when isPublic is absent', async () => {
    const res = makeRes();
    await updateWorldView(
      { params: { worldViewId: '5' }, body: { name: 'Renamed' } } as never,
      res as never,
    );

    const [sql, params] = mockedQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).toMatch(/is_public = COALESCE\(\$4, is_public\)/);
    expect(params[3]).toBeNull();
  });
});
