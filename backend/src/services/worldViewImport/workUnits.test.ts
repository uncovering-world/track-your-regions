import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../db/index.js', () => ({
  pool: { query: vi.fn().mockResolvedValue({ rows: [] }) },
}));

import { pool } from '../../db/index.js';
import { touchWorkUnitForRegion } from './workUnits.js';

const mockedQuery = pool.query as unknown as ReturnType<typeof vi.fn>;

describe('touchWorkUnitForRegion', () => {
  beforeEach(() => mockedQuery.mockClear());

  it('walks ancestors (including self) to the nearest work unit', async () => {
    await touchWorkUnitForRegion(42);
    expect(mockedQuery).toHaveBeenCalledTimes(1);
    const [sql, params] = mockedQuery.mock.calls[0] as [string, unknown[]];
    expect(params).toEqual([42]);
    expect(sql).toMatch(/WITH RECURSIVE walk_up/);
    expect(sql).toMatch(/is_work_unit = TRUE/);
    expect(sql).toMatch(/LIMIT 1/);
  });

  it('moves not_started and signed_off to in_progress, never touches in_progress rows', async () => {
    await touchWorkUnitForRegion(7);
    const [sql] = mockedQuery.mock.calls[0] as [string];
    expect(sql).toMatch(/SET signoff_status = 'in_progress'/);
    expect(sql).toMatch(/signoff_status IN \('not_started', 'signed_off'\)/);
  });

  it('retains signed_off_at (badge semantics: in_progress + non-null = modified after sign-off)', async () => {
    await touchWorkUnitForRegion(7);
    const [sql] = mockedQuery.mock.calls[0] as [string];
    expect(sql).not.toMatch(/signed_off_at\s*=\s*NULL/);
  });
});
