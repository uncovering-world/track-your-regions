/**
 * The AI settings read is one statement behind a 60 s cache, and the write is
 * an upsert on the key that drops the cache. These pin the SQL each sends and
 * the cache's two promises: a warm read sends nothing, a write makes the next
 * read go back to the table.
 *
 * The cache is module state, so every test loads a fresh copy of the module.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../db/index.js', () => ({
  pool: { query: vi.fn() },
}));

type Query = ReturnType<typeof vi.fn>;
const load = () => import('./aiSettingsService.js');

let mockedQuery: Query;
let service: Awaited<ReturnType<typeof load>>;

beforeEach(async () => {
  vi.resetModules();
  const { pool } = await import('../../db/index.js');
  // The mocked pool outlives the module reset; its calls are cleared here.
  mockedQuery = pool.query as unknown as Query;
  mockedQuery.mockReset();
  mockedQuery.mockResolvedValue({ rows: [] });
  service = await load();
});

describe('reading a setting', () => {
  it('selects key and value from ai_settings once and serves the rest from the cache', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [{ key: 'model.extraction', value: 'gpt-x' }] });

    expect(await service.getModelForFeature('extraction')).toBe('gpt-x');
    expect(await service.getSetting('model.extraction')).toBe('gpt-x');
    expect(await service.getAllSettings()).toEqual({ 'model.extraction': 'gpt-x' });

    expect(mockedQuery).toHaveBeenCalledTimes(1);
    const [sql, params] = mockedQuery.mock.calls[0] as [string, unknown[] | undefined];
    expect(sql).toMatch(/SELECT key, value FROM ai_settings/);
    expect(params).toBeUndefined();
  });

  it('falls back to the per-feature default, then the global one', async () => {
    expect(await service.getModelForFeature('cv_cluster_match')).toBe('o4-mini');
    expect(await service.getModelForFeature('never_configured')).toBe('gpt-4.1-mini');
    expect(await service.getSetting('absent')).toBeUndefined();
  });
});

describe('updateSetting', () => {
  it('upserts on the key with the value as the only parameters', async () => {
    await service.updateSetting('model.extraction', 'gpt-y');

    const [sql, params] = mockedQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).toMatch(/INSERT INTO ai_settings \(key, value, updated_at\)/);
    expect(sql).toMatch(/ON CONFLICT \(key\) DO UPDATE SET value = EXCLUDED\.value, updated_at = NOW\(\)/);
    expect(params).toEqual(['model.extraction', 'gpt-y']);
  });

  it('drops the cache, so the next read goes back to the table', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [{ key: 'model.extraction', value: 'gpt-x' }] });
    await service.getSetting('model.extraction');

    await service.updateSetting('model.extraction', 'gpt-y');
    mockedQuery.mockResolvedValueOnce({ rows: [{ key: 'model.extraction', value: 'gpt-y' }] });

    expect(await service.getSetting('model.extraction')).toBe('gpt-y');
    const selects = mockedQuery.mock.calls.filter(([sql]) => /^SELECT/.test(String(sql)));
    expect(selects).toHaveLength(2);
  });
});
