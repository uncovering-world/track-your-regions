import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../db/index.js', () => ({
  pool: { query: vi.fn() },
}));

import { pool } from '../../db/index.js';
import { answer, routeAt } from '../../api/routeTesting.js';
import { userRoutes } from '../../routes/userRoutes.js';

const mockedQuery = pool.query as unknown as ReturnType<typeof vi.fn>;

/** The user routes these specs answer through (ADR-0071). */
const postVisitedRegion = routeAt(userRoutes, '/me/visited-regions/:regionId', 'post');
const deleteVisitedRegion = routeAt(userRoutes, '/me/visited-regions/:regionId', 'delete');

const READER = { id: 5, role: 'user' } as Express.User;

function makeRes() {
  const res = { json: vi.fn(), status: vi.fn(), send: vi.fn() };
  res.status.mockReturnValue(res);
  return res;
}

beforeEach(() => {
  mockedQuery.mockReset();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('marking a region visited', () => {
  it('answers the visit it wrote', async () => {
    mockedQuery
      .mockResolvedValueOnce({ rows: [{ id: 12 }] })
      .mockResolvedValueOnce({ rows: [{ region_id: 12, visited_at: new Date('2026-09-01T10:00:00Z'), notes: 'Kazan' }] });
    const res = makeRes();

    await answer(postVisitedRegion, { params: { regionId: '12' }, body: { notes: 'Kazan' }, user: READER }, res);

    expect(res.json).toHaveBeenCalledWith({ region_id: 12, visited_at: '2026-09-01T10:00:00.000Z', notes: 'Kazan' });
    const [, params] = mockedQuery.mock.calls[1] as [string, unknown[]];
    expect(params).toEqual([5, 12, 'Kazan']);
  });

  it('answers 404 for a region that is not there, not the failure sentence', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [] });
    const res = makeRes();

    await answer(postVisitedRegion, { params: { regionId: '999' }, body: {}, user: READER }, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ error: 'Region not found' });
    expect(mockedQuery).toHaveBeenCalledTimes(1);
  });

  it('answers its own sentence when the database fails, never the driver text', async () => {
    mockedQuery.mockRejectedValueOnce(new Error('relation "user_visited_regions" does not exist'));
    const res = makeRes();

    await answer(postVisitedRegion, { params: { regionId: '12' }, body: {}, user: READER }, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: 'Failed to mark region as visited' });
  });
});

describe('taking a region visited mark away', () => {
  it('answers 204', async () => {
    mockedQuery.mockResolvedValueOnce({ rowCount: 1 });
    const res = makeRes();

    await answer(deleteVisitedRegion, { params: { regionId: '12' }, user: READER }, res);

    expect(res.status).toHaveBeenCalledWith(204);
    expect(res.json).not.toHaveBeenCalled();
  });
});
