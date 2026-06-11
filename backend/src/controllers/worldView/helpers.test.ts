import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../db/index.js', () => ({
  pool: { query: vi.fn().mockResolvedValue({ rows: [] }) },
}));

import { pool } from '../../db/index.js';
import { invalidateRegionGeometry, ensureRegionMember, syncImportMatchStatus } from './helpers.js';

const mockedQuery = pool.query as unknown as ReturnType<typeof vi.fn>;

describe('invalidateRegionGeometry', () => {
  beforeEach(() => {
    mockedQuery.mockClear();
  });

  it('skips rows with is_custom_boundary IS TRUE — regression for #283', async () => {
    // The bug: invalidateRegionGeometry's recursive CTE includes the starting
    // region itself. Without the IS NOT TRUE guard, calling addMembers right
    // after createRegion(customGeometry) would null the just-created custom
    // shape and reset is_custom_boundary, then a subsequent recompute would
    // produce the merged-from-members geometry — losing the user's drawing.
    await invalidateRegionGeometry(42);

    expect(mockedQuery).toHaveBeenCalledTimes(1);
    const [sql, params] = mockedQuery.mock.calls[0] as [string, unknown[]];
    expect(params).toEqual([42]);
    expect(sql).toMatch(/is_custom_boundary IS NOT TRUE/);
    expect(sql).not.toMatch(/is_custom_boundary\s*=\s*false/);
  });

  it('still nulls geom + simplified columns', async () => {
    await invalidateRegionGeometry(7);
    const [sql] = mockedQuery.mock.calls[0] as [string];
    expect(sql).toMatch(/geom\s*=\s*NULL/);
    expect(sql).toMatch(/geom_3857\s*=\s*NULL/);
    expect(sql).toMatch(/geom_simplified_low\s*=\s*NULL/);
    expect(sql).toMatch(/geom_simplified_medium\s*=\s*NULL/);
  });

  it('walks ancestors via the recursive CTE', async () => {
    await invalidateRegionGeometry(1);
    const [sql] = mockedQuery.mock.calls[0] as [string];
    expect(sql).toMatch(/WITH RECURSIVE ancestors/);
    expect(sql).toMatch(/cg\.id\s*=\s*a\.parent_region_id/);
  });

  it('swallows lock/deadlock errors (concurrent invalidation safe)', async () => {
    mockedQuery.mockRejectedValueOnce(new Error('could not obtain lock on row in relation "regions"'));
    await expect(invalidateRegionGeometry(99)).resolves.toBeUndefined();

    mockedQuery.mockRejectedValueOnce(new Error('deadlock detected'));
    await expect(invalidateRegionGeometry(99)).resolves.toBeUndefined();
  });

  it('rethrows non-lock errors', async () => {
    mockedQuery.mockRejectedValueOnce(new Error('relation "regions" does not exist'));
    await expect(invalidateRegionGeometry(99)).rejects.toThrow('does not exist');
  });
});

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

describe('syncImportMatchStatus — workflow staleness chokepoint', () => {
  beforeEach(() => {
    mockedQuery.mockClear();
    mockedQuery.mockResolvedValue({ rows: [] });
  });

  it('touches the owning work unit after a member-driven sync', async () => {
    mockedQuery
      .mockResolvedValueOnce({ rows: [] })                                   // touchWorkUnitForRegion walk_up
      .mockResolvedValueOnce({ rows: [{ match_status: 'manual_matched' }] }) // ris lookup
      .mockResolvedValueOnce({ rows: [{ count: '2' }] })                     // member count
      .mockResolvedValue({ rows: [] });                                      // remaining queries
    await syncImportMatchStatus(5);
    const sqls = mockedQuery.mock.calls.map(c => c[0] as string);
    expect(sqls.some(s => /WITH RECURSIVE walk_up/.test(s))).toBe(true);
  });

  it('touches the work unit EVEN when no region_import_state row exists (editor-created subregions)', async () => {
    // The walk runs first (before the early return), so the owning work unit is
    // staled even for regions that have no import-state row of their own.
    // The match-status UPDATE query must NOT have fired.
    mockedQuery
      .mockResolvedValueOnce({ rows: [] }) // walk_up (touchWorkUnitForRegion)
      .mockResolvedValueOnce({ rows: [] }); // region_import_state SELECT → no row → early return
    await syncImportMatchStatus(5);
    const sqls = mockedQuery.mock.calls.map(c => c[0] as string);
    // Walk must have fired
    expect(sqls.some(s => /walk_up/.test(s))).toBe(true);
    // match_status UPDATE must NOT have fired (early return skipped it)
    expect(sqls.some(s => /UPDATE region_import_state SET match_status/.test(s))).toBe(false);
  });
});
