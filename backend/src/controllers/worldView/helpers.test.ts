import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../db/index.js', () => ({
  pool: { query: vi.fn().mockResolvedValue({ rows: [] }) },
}));

import { pool } from '../../db/index.js';
import { ensureRegionMember } from './helpers.js';

const mockedQuery = pool.query as unknown as ReturnType<typeof vi.fn>;

describe('ensureRegionMember — explicit ON CONFLICT arbiter (#378)', () => {
  beforeEach(() => {
    mockedQuery.mockClear();
    mockedQuery.mockResolvedValue({ rows: [] });
  });

  it('pins the conflict arbiter to the partial unique index (custom_geom IS NULL)', async () => {
    // A bare `ON CONFLICT DO NOTHING` works today (only one unique constraint on
    // region_members), but pinning the arbiter to the partial index prevents a
    // future unique constraint from silently changing the dedupe semantics.
    await ensureRegionMember(10, 20);

    expect(mockedQuery).toHaveBeenCalledTimes(1);
    const [sql, params] = mockedQuery.mock.calls[0] as [string, unknown[]];
    expect(params).toEqual([10, 20]);
    expect(sql).toMatch(/ON CONFLICT\s*\(\s*region_id\s*,\s*division_id\s*\)\s*WHERE\s+custom_geom\s+IS\s+NULL\s+DO\s+NOTHING/i);
    // Regression: must not regress to the bare form.
    expect(sql).not.toMatch(/ON CONFLICT\s+DO\s+NOTHING\b/i);
  });

  it('inserts only the (region_id, division_id) columns, not custom_geom', async () => {
    await ensureRegionMember(1, 2);
    const [sql] = mockedQuery.mock.calls[0] as [string];
    expect(sql).toMatch(/INSERT INTO region_members\s*\(\s*region_id\s*,\s*division_id\s*\)/i);
    expect(sql).not.toMatch(/custom_geom\s*[,)]/i); // not in column list or values
  });
});
