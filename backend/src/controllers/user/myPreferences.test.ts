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
    mockedQuery.mockResolvedValueOnce({ rows: [{ maps_app: null, reading_languages: null }] });
    const res = makeRes();

    await answer(getPreferences, { user: READER }, res);

    expect(res.json).toHaveBeenCalledWith({ mapsApp: null, readingLanguages: null });
    expect(mockedQuery.mock.calls[0]).toEqual(['SELECT maps_app, reading_languages FROM users WHERE id = $1', [5]]);
  });

  it("saves a choice on the caller's own row and answers what was stored", async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [{ maps_app: 'osm', reading_languages: ['ru', 'de'] }] });
    const res = makeRes();

    await answer(putPreferences, { body: { mapsApp: 'osm' }, user: READER }, res);

    expect(res.json).toHaveBeenCalledWith({ mapsApp: 'osm', readingLanguages: ['ru', 'de'] });
    const [sql, params] = mockedQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('WHERE id = $1');
    // The maps app is named and changed; the reading languages are not named, so they are kept.
    expect(params).toEqual([5, 'osm', true, null, false]);
  });

  it('accepts only the listed maps apps, or null to be asked each time', () => {
    expect(myPreferencesBodySchema.safeParse({ mapsApp: 'google' }).success).toBe(true);
    expect(myPreferencesBodySchema.safeParse({ mapsApp: null }).success).toBe(true);
    expect(myPreferencesBodySchema.safeParse({ mapsApp: 'waze' }).success).toBe(false);
    // A PUT that names no preference changes nothing, and is refused rather than answered as a save.
    expect(myPreferencesBodySchema.safeParse({}).success).toBe(false);
    expect(myPreferencesBodySchema.safeParse({ mapsApp: 'osm', theme: 'dark' }).success).toBe(false);
  });
});

describe('the languages a visitor reads Wikipedia in (#2209)', () => {
  it('saves the ordered list alone and keeps the maps app', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [{ maps_app: 'google', reading_languages: ['ru', 'de'] }] });
    const res = makeRes();

    await answer(putPreferences, { body: { readingLanguages: ['ru', 'de'] }, user: READER }, res);

    expect(res.json).toHaveBeenCalledWith({ mapsApp: 'google', readingLanguages: ['ru', 'de'] });
    expect((mockedQuery.mock.calls[0] as [string, unknown[]])[1]).toEqual([5, null, false, ['ru', 'de'], true]);
  });

  it('accepts Wikipedia language codes, each once and at most ten, or null to read the browser\'s again', () => {
    expect(myPreferencesBodySchema.safeParse({ readingLanguages: ['ru', 'zh-classical', 'be-tarask'] }).success).toBe(true);
    expect(myPreferencesBodySchema.safeParse({ readingLanguages: null }).success).toBe(true);
    expect(myPreferencesBodySchema.safeParse({ readingLanguages: ['RU'] }).success).toBe(false);
    expect(myPreferencesBodySchema.safeParse({ readingLanguages: ['ru', 'ru'] }).success).toBe(false);
    // The list is what is read ahead of English: a list naming English would hide the languages after it.
    expect(myPreferencesBodySchema.safeParse({ readingLanguages: ['en', 'ru'] }).success).toBe(false);
    expect(myPreferencesBodySchema.safeParse({ readingLanguages: ['ru;drop'] }).success).toBe(false);
    expect(myPreferencesBodySchema.safeParse({ readingLanguages: Array.from({ length: 11 }, (_, i) => `l${String.fromCharCode(97 + i)}`) }).success).toBe(false);
  });
});
