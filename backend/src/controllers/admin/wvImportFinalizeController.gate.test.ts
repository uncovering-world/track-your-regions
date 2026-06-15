import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../db/index.js', () => ({
  pool: { query: vi.fn() },
}));

import { pool } from '../../db/index.js';
import { finalizeReview } from './wvImportFinalizeController.js';
import type { AuthenticatedRequest } from '../../middleware/auth.js';
import type { Response } from 'express';

const mockedQuery = pool.query as unknown as ReturnType<typeof vi.fn>;

function mockRes(): Response {
  const res = { status: vi.fn(), json: vi.fn() } as unknown as Response;
  (res.status as ReturnType<typeof vi.fn>).mockReturnValue(res);
  return res;
}

const REQ = { params: { worldViewId: '1' } } as unknown as AuthenticatedRequest;
const NO_UNMATCHED = { rows: [{ needs_review: '0', no_candidates: '0' }] };

// countActiveCoverageGaps runs two queries: (1) world_views dismissed ids, (2) COVERAGE_GAPS_SQL.
// When there are no gaps: dismissed=[], gaps=[].
const NO_GAPS_WV = { rows: [{ dismissed: [] }] };  // world_views dismissed_coverage_ids
const NO_GAPS_SQL = { rows: [] };                   // COVERAGE_GAPS_SQL result (no gap rows)

// When there are active gaps: dismissed=[], gaps=[{id:10,...}].
const GAPS_SQL_ONE = { rows: [{ id: 10 }] };

describe('finalizeReview — workflow gate', () => {
  beforeEach(() => mockedQuery.mockReset());

  it('400s when work units are not all signed off', async () => {
    mockedQuery
      .mockResolvedValueOnce(NO_UNMATCHED)             // unmatched query
      .mockResolvedValueOnce({ rows: [{ skeleton_confirmed: true, unsigned_units: '3' }] }) // gate query
      .mockResolvedValueOnce(NO_GAPS_WV)               // countActiveCoverageGaps: dismissed ids
      .mockResolvedValueOnce(NO_GAPS_SQL);             // countActiveCoverageGaps: COVERAGE_GAPS_SQL
    const res = mockRes();
    await finalizeReview(REQ, res);
    expect(res.status).toHaveBeenCalledWith(400);
    const payload = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(payload.unsignedUnits).toBe(3);
  });

  it('400s when the skeleton is not confirmed', async () => {
    mockedQuery
      .mockResolvedValueOnce(NO_UNMATCHED)
      .mockResolvedValueOnce({ rows: [{ skeleton_confirmed: false, unsigned_units: '0' }] })
      .mockResolvedValueOnce(NO_GAPS_WV)
      .mockResolvedValueOnce(NO_GAPS_SQL);
    const res = mockRes();
    await finalizeReview(REQ, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('400s when active coverage gaps remain (skeleton ok, units signed off)', async () => {
    mockedQuery
      .mockResolvedValueOnce(NO_UNMATCHED)
      .mockResolvedValueOnce({ rows: [{ skeleton_confirmed: true, unsigned_units: '0' }] })
      .mockResolvedValueOnce(NO_GAPS_WV)               // dismissed_coverage_ids = []
      .mockResolvedValueOnce(GAPS_SQL_ONE);            // one active gap (id=10, not dismissed)
    const res = mockRes();
    await finalizeReview(REQ, res);
    expect(res.status).toHaveBeenCalledWith(400);
    const payload = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(payload.activeGaps).toBe(1);
    expect(payload.skeletonConfirmed).toBe(true);
    expect(payload.unsignedUnits).toBe(0);
  });

  it('proceeds to the source_type update when the gate passes', async () => {
    mockedQuery
      .mockResolvedValueOnce(NO_UNMATCHED)
      .mockResolvedValueOnce({ rows: [{ skeleton_confirmed: true, unsigned_units: '0' }] })
      .mockResolvedValueOnce(NO_GAPS_WV)
      .mockResolvedValueOnce(NO_GAPS_SQL)              // zero gaps → activeGaps=0
      .mockResolvedValueOnce({ rows: [{ id: 1, name: 'Test WV' }] }); // UPDATE world_views RETURNING id, name
    const res = mockRes();
    await finalizeReview(REQ, res);
    const sqls = mockedQuery.mock.calls.map(c => c[0] as string);
    expect(sqls.some(s => /UPDATE world_views/.test(s) && /source_type/.test(s))).toBe(true);
    expect(res.status).not.toHaveBeenCalledWith(400);
  });
});
