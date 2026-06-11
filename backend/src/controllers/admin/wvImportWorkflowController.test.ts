import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../db/index.js', () => ({
  pool: { query: vi.fn().mockResolvedValue({ rows: [] }) },
}));
vi.mock('../../services/worldViewImport/verifyWorkUnit.js', () => ({
  verifyWorkUnit: vi.fn(),
}));
vi.mock('../../services/worldViewImport/workUnits.js', () => ({
  touchWorkUnitForRegion: vi.fn().mockResolvedValue(undefined),
}));

import { pool } from '../../db/index.js';
import { verifyWorkUnit } from '../../services/worldViewImport/verifyWorkUnit.js';
import { touchWorkUnitForRegion } from '../../services/worldViewImport/workUnits.js';
import { signOffWorkUnit, setWorkUnitFlag, reopenWorkUnit, setReferenceTerritory, confirmHierarchy } from './wvImportWorkflowController.js';
import type { AuthenticatedRequest } from '../../middleware/auth.js';
import type { Response } from 'express';

const mockedQuery = pool.query as unknown as ReturnType<typeof vi.fn>;
const mockedVerify = verifyWorkUnit as unknown as ReturnType<typeof vi.fn>;
const mockedTouch = touchWorkUnitForRegion as unknown as ReturnType<typeof vi.fn>;

function mockRes(): Response {
  const res = { status: vi.fn(), json: vi.fn() } as unknown as Response;
  (res.status as ReturnType<typeof vi.fn>).mockReturnValue(res);
  return res;
}

function req(worldViewId: number, body: Record<string, unknown>): AuthenticatedRequest {
  return { params: { worldViewId: String(worldViewId) }, body } as unknown as AuthenticatedRequest;
}

const CLEAN_VERIFY = {
  referenceDivisionIds: [10], referenceSource: 'members',
  unassignedLeaves: [], coverageGaps: [], overlaps: [],
  blockers: [], verifiedAt: '2026-06-11T00:00:00.000Z',
};

describe('signOffWorkUnit', () => {
  beforeEach(() => { mockedQuery.mockReset(); mockedVerify.mockReset(); });

  it('404s when the region is not a work unit of this world view (IDOR guard)', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [] }); // unit lookup
    const res = mockRes();
    await signOffWorkUnit(req(1, { regionId: 5 }), res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(mockedVerify).not.toHaveBeenCalled();
  });

  it('409s with blockers when hierarchy is not confirmed', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [{ hierarchy_confirmed: false }] });
    mockedVerify.mockResolvedValueOnce(CLEAN_VERIFY);
    const res = mockRes();
    await signOffWorkUnit(req(1, { regionId: 5 }), res);
    expect(res.status).toHaveBeenCalledWith(409);
    const payload = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(payload.blockers).toContain('hierarchy_not_confirmed');
  });

  it('409s with verify blockers (gate cannot drift from verify)', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [{ hierarchy_confirmed: true }] });
    mockedVerify.mockResolvedValueOnce({ ...CLEAN_VERIFY, blockers: ['coverage_gaps'] });
    const res = mockRes();
    await signOffWorkUnit(req(1, { regionId: 5 }), res);
    expect(res.status).toHaveBeenCalledWith(409);
    const payload = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(payload.blockers).toContain('coverage_gaps');
  });

  it('signs off when hierarchy confirmed and verify is clean', async () => {
    mockedQuery
      .mockResolvedValueOnce({ rows: [{ hierarchy_confirmed: true }] })
      .mockResolvedValue({ rows: [] }); // the UPDATE
    mockedVerify.mockResolvedValueOnce(CLEAN_VERIFY);
    const res = mockRes();
    await signOffWorkUnit(req(1, { regionId: 5 }), res);
    const updateSql = mockedQuery.mock.calls
      .map(c => c[0] as string)
      .find(s => /SET signoff_status = 'signed_off'/.test(s));
    expect(updateSql).toBeDefined();
    expect(updateSql).toMatch(/signed_off_at = NOW\(\)/);
  });
});

describe('setWorkUnitFlag', () => {
  beforeEach(() => mockedQuery.mockReset());

  it('404s for regions outside the world view (IDOR guard)', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [] });
    const res = mockRes();
    await setWorkUnitFlag(req(1, { regionId: 9, isWorkUnit: true }), res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('demotion resets the sign-off lifecycle', async () => {
    mockedQuery
      .mockResolvedValueOnce({ rows: [{ '?column?': 1 }] })
      .mockResolvedValueOnce({ rows: [] });
    const res = mockRes();
    await setWorkUnitFlag(req(1, { regionId: 9, isWorkUnit: false }), res);
    const [sql] = mockedQuery.mock.calls[1] as [string];
    expect(sql).toMatch(/is_work_unit = FALSE/);
    expect(sql).toMatch(/signoff_status = 'not_started'/);
    expect(sql).toMatch(/signed_off_at = NULL/);
  });

  it('promotion only sets the flag (upsert shape)', async () => {
    mockedQuery
      .mockResolvedValueOnce({ rows: [{ '?column?': 1 }] })
      .mockResolvedValueOnce({ rows: [] });
    const res = mockRes();
    await setWorkUnitFlag(req(1, { regionId: 9, isWorkUnit: true }), res);
    const [sql] = mockedQuery.mock.calls[1] as [string];
    expect(sql).toMatch(/ON CONFLICT \(region_id\) DO UPDATE SET is_work_unit = TRUE/);
    expect(sql).not.toMatch(/signoff_status/);
  });

  it('promotes regions without an import-state row (upsert)', async () => {
    mockedQuery
      .mockResolvedValueOnce({ rows: [{ '?column?': 1 }] }) // guard: row from regions
      .mockResolvedValueOnce({ rows: [] }); // INSERT...ON CONFLICT
    const res = mockRes();
    await setWorkUnitFlag(req(1, { regionId: 7, isWorkUnit: true }), res);
    expect(res.status).not.toHaveBeenCalled(); // no 404
    const [sql] = mockedQuery.mock.calls[1] as [string];
    expect(sql).toMatch(/INSERT INTO region_import_state/);
    expect(sql).toMatch(/ON CONFLICT \(region_id\) DO UPDATE SET is_work_unit = TRUE/);
  });
});

describe('confirmHierarchy', () => {
  beforeEach(() => { mockedQuery.mockReset(); mockedTouch.mockReset(); mockedTouch.mockResolvedValue(undefined); });

  it('stales the unit when unconfirming (sign-off precondition removed)', async () => {
    mockedQuery
      .mockResolvedValueOnce({ rows: [{ hierarchy_confirmed: true }] }) // unit lookup
      .mockResolvedValueOnce({ rows: [] }); // the UPDATE
    const res = mockRes();
    await confirmHierarchy(req(1, { regionId: 5, confirmed: false }), res);
    expect(mockedTouch).toHaveBeenCalledWith(5);
  });

  it('does not stale the unit when confirming', async () => {
    mockedQuery
      .mockResolvedValueOnce({ rows: [{ hierarchy_confirmed: false }] })
      .mockResolvedValueOnce({ rows: [] });
    const res = mockRes();
    await confirmHierarchy(req(1, { regionId: 5, confirmed: true }), res);
    expect(mockedTouch).not.toHaveBeenCalled();
  });
});

describe('setReferenceTerritory', () => {
  beforeEach(() => { mockedQuery.mockReset(); mockedTouch.mockReset(); mockedTouch.mockResolvedValue(undefined); });

  it('stales the unit — the reference is the verification basis', async () => {
    mockedQuery
      .mockResolvedValueOnce({ rows: [{ hierarchy_confirmed: true }] }) // unit lookup
      .mockResolvedValueOnce({ rows: [] }); // the UPDATE
    const res = mockRes();
    await setReferenceTerritory(req(1, { regionId: 5, divisionIds: [10, 11] }), res);
    expect(mockedTouch).toHaveBeenCalledWith(5);
  });
});

describe('reopenWorkUnit', () => {
  beforeEach(() => { mockedQuery.mockReset(); });

  it('clears signed_off_at and sets in_progress together (badge model)', async () => {
    mockedQuery
      .mockResolvedValueOnce({ rows: [{ hierarchy_confirmed: true }] })
      .mockResolvedValueOnce({ rows: [] });
    const res = mockRes();
    await reopenWorkUnit(req(1, { regionId: 5 }), res);
    const [sql] = mockedQuery.mock.calls[1] as [string];
    expect(sql).toMatch(/signoff_status = 'in_progress'/);
    expect(sql).toMatch(/signed_off_at = NULL/);
  });
});

import { getWorkflowDashboard } from './wvImportWorkflowController.js';

describe('getWorkflowDashboard', () => {
  beforeEach(() => { mockedQuery.mockReset(); mockedQuery.mockResolvedValue({ rows: [] }); });

  it('aggregates per-unit progress in a single query (no full-tree fetch)', async () => {
    const res = mockRes();
    await getWorkflowDashboard(
      { params: { worldViewId: '1' } } as unknown as AuthenticatedRequest, res);
    expect(mockedQuery).toHaveBeenCalledTimes(2); // skeleton_confirmed + units
    const unitSql = mockedQuery.mock.calls[1][0] as string;
    expect(unitSql).toMatch(/is_work_unit = TRUE/);
    expect(unitSql).toMatch(/WITH RECURSIVE/);
    expect(unitSql).toMatch(/assignment_waived/);
  });
});
