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

describe('finalizeReview — workflow gate', () => {
  beforeEach(() => mockedQuery.mockReset());

  it('400s when work units are not all signed off', async () => {
    mockedQuery
      .mockResolvedValueOnce(NO_UNMATCHED)
      .mockResolvedValueOnce({ rows: [{ skeleton_confirmed: true, unsigned_units: '3' }] });
    const res = mockRes();
    await finalizeReview(REQ, res);
    expect(res.status).toHaveBeenCalledWith(400);
    const payload = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(payload.unsignedUnits).toBe(3);
  });

  it('400s when the skeleton is not confirmed', async () => {
    mockedQuery
      .mockResolvedValueOnce(NO_UNMATCHED)
      .mockResolvedValueOnce({ rows: [{ skeleton_confirmed: false, unsigned_units: '0' }] });
    const res = mockRes();
    await finalizeReview(REQ, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('proceeds to the source_type update when the gate passes', async () => {
    mockedQuery
      .mockResolvedValueOnce(NO_UNMATCHED)
      .mockResolvedValueOnce({ rows: [{ skeleton_confirmed: true, unsigned_units: '0' }] })
      .mockResolvedValueOnce({ rows: [{ id: 1, name: 'Test WV' }] }); // UPDATE world_views RETURNING id, name
    const res = mockRes();
    await finalizeReview(REQ, res);
    const sqls = mockedQuery.mock.calls.map(c => c[0] as string);
    expect(sqls.some(s => /UPDATE world_views/.test(s) && /source_type/.test(s))).toBe(true);
    expect(res.status).not.toHaveBeenCalledWith(400);
  });
});
