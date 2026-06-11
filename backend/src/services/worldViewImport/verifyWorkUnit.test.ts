import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../db/index.js', () => ({
  pool: { query: vi.fn().mockResolvedValue({ rows: [] }) },
}));

import { pool } from '../../db/index.js';
import { resolveReference, verifyWorkUnit } from './verifyWorkUnit.js';

const mockedQuery = pool.query as unknown as ReturnType<typeof vi.fn>;

describe('resolveReference', () => {
  beforeEach(() => mockedQuery.mockClear());

  it('prefers own region_members', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [{ division_id: 10 }, { division_id: 11 }] });
    const ref = await resolveReference(5);
    expect(ref).toEqual({ divisionIds: [10, 11], source: 'members' });
    expect(mockedQuery).toHaveBeenCalledTimes(1);
  });

  it('falls back to reference_division_ids — never to name matching', async () => {
    mockedQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ reference_division_ids: [99] }] });
    const ref = await resolveReference(5);
    expect(ref).toEqual({ divisionIds: [99], source: 'reference' });
    const sqls = mockedQuery.mock.calls.map(c => c[0] as string);
    expect(sqls.some(s => /name_normalized/.test(s))).toBe(false);
  });

  it('returns null source when neither exists', async () => {
    mockedQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ reference_division_ids: null }] });
    const ref = await resolveReference(5);
    expect(ref).toEqual({ divisionIds: [], source: null });
  });

  it('returns null source when no import-state row exists at all', async () => {
    mockedQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    const ref = await resolveReference(5);
    expect(ref).toEqual({ divisionIds: [], source: null });
  });
});

describe('verifyWorkUnit', () => {
  beforeEach(() => mockedQuery.mockClear());

  it('reports a no-reference blocker without running checks', async () => {
    mockedQuery
      .mockResolvedValueOnce({ rows: [] })                                  // own members
      .mockResolvedValueOnce({ rows: [{ reference_division_ids: null }] }); // reference col
    const result = await verifyWorkUnit(1, 5);
    expect(result.blockers).toEqual(['no_reference_territory']);
    expect(result.coverageGaps).toEqual([]);
    expect(mockedQuery).toHaveBeenCalledTimes(2);
  });

  it('scopes coverage to strict descendants and the reference closure', async () => {
    mockedQuery
      .mockResolvedValueOnce({ rows: [{ division_id: 10 }] })              // own members → reference
      .mockResolvedValueOnce({ rows: [{ count: '3' }] })                   // has child regions
      .mockResolvedValueOnce({ rows: [] })                                  // unassigned leaves
      .mockResolvedValue({ rows: [] });                                     // coverage + overlap
    await verifyWorkUnit(1, 5);
    const sqls = mockedQuery.mock.calls.map(c => c[0] as string);
    const coverageSql = sqls.find(s => /reference_closure/.test(s));
    expect(coverageSql).toBeDefined();
    expect(coverageSql).toMatch(/rm\.region_id <> \$1/);
    expect(coverageSql).toMatch(/unnest\(\$2::integer\[\]\)/);
  });

  it('skips the coverage check for leaf units (own assignment IS the coverage)', async () => {
    mockedQuery
      .mockResolvedValueOnce({ rows: [{ division_id: 10 }] }) // own members
      .mockResolvedValueOnce({ rows: [{ count: '0' }] })      // no child regions
      .mockResolvedValueOnce({ rows: [] });                    // unassigned leaves
    const result = await verifyWorkUnit(1, 5);
    expect(result.coverageGaps).toEqual([]);
    expect(result.overlaps).toEqual([]);
    expect(result.blockers).toEqual([]);
    expect(result.referenceSource).toBe('members');
    expect(result.referenceDivisionIds).toEqual([10]);
    const sqls = mockedQuery.mock.calls.map(c => c[0] as string);
    expect(sqls.some(s => /reference_closure/.test(s))).toBe(false);
  });

  it('returns an empty blocker list when all checks pass (has children)', async () => {
    mockedQuery
      .mockResolvedValueOnce({ rows: [{ division_id: 10 }] }) // own members
      .mockResolvedValueOnce({ rows: [{ count: '2' }] })      // has child regions
      .mockResolvedValueOnce({ rows: [] })                     // unassigned leaves
      .mockResolvedValueOnce({ rows: [] })                     // coverage gaps
      .mockResolvedValueOnce({ rows: [] });                    // overlaps
    const result = await verifyWorkUnit(1, 5);
    expect(result.blockers).toEqual([]);
    expect(mockedQuery).toHaveBeenCalledTimes(5);
  });

  it('flags unassigned leaves excluding waived ones', async () => {
    mockedQuery
      .mockResolvedValueOnce({ rows: [{ division_id: 10 }] })
      .mockResolvedValueOnce({ rows: [{ count: '2' }] })
      .mockResolvedValueOnce({ rows: [{ region_id: 8, name: 'Normandy' }] })
      .mockResolvedValue({ rows: [] });
    const result = await verifyWorkUnit(1, 5);
    expect(result.unassignedLeaves).toEqual([{ regionId: 8, name: 'Normandy' }]);
    expect(result.blockers).toContain('unassigned_leaves');
    const leafSql = mockedQuery.mock.calls[2][0] as string;
    expect(leafSql).toMatch(/COALESCE\(ris\.assignment_waived, FALSE\) = FALSE/);
  });

  it('counts leaves without import-state rows as unassigned (LEFT JOIN)', async () => {
    mockedQuery
      .mockResolvedValueOnce({ rows: [{ division_id: 10 }] })
      .mockResolvedValueOnce({ rows: [{ count: '1' }] })
      .mockResolvedValueOnce({ rows: [{ region_id: 9, name: 'Editor-created' }] })
      .mockResolvedValue({ rows: [] });
    const result = await verifyWorkUnit(1, 5);
    expect(result.unassignedLeaves).toEqual([{ regionId: 9, name: 'Editor-created' }]);
    const leafSql = mockedQuery.mock.calls[2][0] as string;
    expect(leafSql).toMatch(/LEFT JOIN region_import_state/);
  });

  it('flags coverage gaps and overlaps as blockers', async () => {
    mockedQuery
      .mockResolvedValueOnce({ rows: [{ division_id: 10 }] })
      .mockResolvedValueOnce({ rows: [{ count: '2' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 77, name: 'Gapland', parent_name: 'France' }] })
      .mockResolvedValueOnce({ rows: [{ division_id: 88, name: 'Shared', root_child_ids: [2, 3] }] });
    const result = await verifyWorkUnit(1, 5);
    expect(result.coverageGaps).toEqual([{ divisionId: 77, name: 'Gapland', parentName: 'France' }]);
    expect(result.overlaps).toEqual([{ divisionId: 88, name: 'Shared', regionIds: [2, 3] }]);
    expect(result.blockers).toEqual(expect.arrayContaining(['coverage_gaps', 'overlaps']));
  });
});
