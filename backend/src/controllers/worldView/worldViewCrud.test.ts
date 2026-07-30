import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../db/index.js', () => ({
  pool: { query: vi.fn().mockResolvedValue({ rows: [] }) },
}));

import { pool } from '../../db/index.js';
import { getWorldViews, createWorldView, updateWorldView } from './worldViewCrud.js';

const mockedQuery = pool.query as unknown as ReturnType<typeof vi.fn>;

function makeRes() {
  return { json: vi.fn(), status: vi.fn().mockReturnThis(), setHeader: vi.fn(), vary: vi.fn() };
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

  it('forbids caching a response whose body depends on the caller', async () => {
    // Express sends an ETag and `Vary: Origin` by default and says nothing about
    // who asked. That is enough for a proxy or CDN to serve an admin's list —
    // including the unpublished world views — to an anonymous visitor.
    const res = makeRes();
    await getWorldViews({ user: { role: 'admin' } } as never, res as never);

    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'private, no-store');
    // vary() rather than setHeader('Vary'): CORS has already put Origin there,
    // and setHeader would replace it instead of adding to it.
    expect(res.vary).toHaveBeenCalledWith('Authorization');
  });

  it('returns isPublic to the client', async () => {
    const res = makeRes();
    await getWorldViews({} as never, res as never);

    const [sql] = mockedQuery.mock.calls[0] as [string];
    expect(sql).toMatch(/is_public as "isPublic"/);
  });
});

describe('createWorldView', () => {
  beforeEach(() => {
    mockedQuery.mockClear();
    mockedQuery.mockResolvedValue({ rows: [{ id: 9, isDefault: false, isPublic: false }] });
  });

  it('returns isPublic to the client, symmetric with updateWorldView', async () => {
    const res = makeRes();
    await createWorldView(
      { body: { name: 'New World View' } } as never,
      res as never,
    );

    const [sql] = mockedQuery.mock.calls[0] as [string];
    expect(sql).toMatch(/is_public as "isPublic"/);
  });
});

describe('updateWorldView visibility', () => {
  beforeEach(() => {
    mockedQuery.mockClear();
    mockedQuery.mockResolvedValue({ rows: [{ id: 5 }] });
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
