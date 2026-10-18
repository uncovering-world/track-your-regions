import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../db/index.js', () => ({
  pool: { query: vi.fn() },
}));

import { pool } from '../../db/index.js';
import { answer, routeAt } from '../../api/routeTesting.js';
import { userRoutes } from '../../routes/userRoutes.js';
import { myPreferencesBodySchema } from '../../types/index.js';

const mockedQuery = pool.query as unknown as ReturnType<typeof vi.fn>;

/** The visitor's own preferences (#1604), answered through their routes (ADR-0071). */
const getPreferences = routeAt(userRoutes, '/me/preferences', 'get');
const putPreferences = routeAt(userRoutes, '/me/preferences', 'put');

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

describe('the maps app a visitor opens places in', () => {
  it("answers the caller's own choice, and null for none", async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [{ maps_app: null }] });
    const res = makeRes();

    await answer(getPreferences, { user: READER }, res);

    expect(res.json).toHaveBeenCalledWith({ mapsApp: null });
    expect(mockedQuery.mock.calls[0]).toEqual(['SELECT maps_app FROM users WHERE id = $1', [5]]);
  });

  it("saves a choice on the caller's own row and answers what was stored", async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [{ maps_app: 'osm' }] });
    const res = makeRes();

    await answer(putPreferences, { body: { mapsApp: 'osm' }, user: READER }, res);

    expect(res.json).toHaveBeenCalledWith({ mapsApp: 'osm' });
    const [sql, params] = mockedQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('WHERE id = $1');
    expect(params).toEqual([5, 'osm']);
  });

  it('accepts only the listed maps apps, or null to be asked each time', () => {
    expect(myPreferencesBodySchema.safeParse({ mapsApp: 'google' }).success).toBe(true);
    expect(myPreferencesBodySchema.safeParse({ mapsApp: null }).success).toBe(true);
    expect(myPreferencesBodySchema.safeParse({ mapsApp: 'waze' }).success).toBe(false);
    expect(myPreferencesBodySchema.safeParse({}).success).toBe(false);
    expect(myPreferencesBodySchema.safeParse({ mapsApp: 'osm', theme: 'dark' }).success).toBe(false);
  });
});
