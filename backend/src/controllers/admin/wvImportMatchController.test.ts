/**
 * Tests for getMatchTree suggestions subquery contract.
 *
 * We mock pool.query and inspect the SQL string passed to it, asserting the
 * two key properties of the read-side dedup fix:
 *   (a) already-assigned divisions are excluded via the rm2 subquery
 *   (b) DISTINCT ON (rms.division_id) is applied to keep only the best score
 *       per division
 *
 * Note: ~10 write-side INSERT sites still create duplicate rows; a future
 * write-side fix or unique constraint should address that. This read-side
 * chokepoint ensures the tree never surfaces stale/duplicate suggestions
 * regardless of what is stored.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../db/index.js', () => ({
  pool: { query: vi.fn() },
}));
vi.mock('../../services/ai/openaiService.js', () => ({
  matchDivisionsByVision: vi.fn(),
}));
vi.mock('./wvImportMatchHelpers.js', () => ({
  generateDivisionsSvg: vi.fn(),
  fetchMarkersForDivisions: vi.fn(),
}));
vi.mock('../../services/worldViewImport/workUnits.js', () => ({
  touchWorkUnitForRegion: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('./wvImportMatchReview.js', () => ({
  resolveWaterReview: vi.fn(),
  getWaterCropImage: vi.fn(),
  resolveClusterReview: vi.fn(),
  getClusterPreviewImage: vi.fn(),
  getClusterHighlightImage: vi.fn(),
  resolveIcpAdjustment: vi.fn(),
}));

import { pool } from '../../db/index.js';
import { getMatchTree } from './wvImportMatchController.js';
import type { AuthenticatedRequest } from '../../middleware/auth.js';
import type { Response } from 'express';

const mockedQuery = pool.query as unknown as ReturnType<typeof vi.fn>;

function mockRes(): Response {
  const res = { status: vi.fn(), json: vi.fn() } as unknown as Response;
  (res.status as ReturnType<typeof vi.fn>).mockReturnValue(res);
  return res;
}

function req(worldViewId: number): AuthenticatedRequest {
  return { params: { worldViewId: String(worldViewId) } } as unknown as AuthenticatedRequest;
}

describe('getMatchTree — suggestions subquery contract', () => {
  beforeEach(() => {
    mockedQuery.mockReset();
    // Return empty rows so the tree-building loop is a no-op
    mockedQuery.mockResolvedValue({ rows: [] });
  });

  it('(a) excludes divisions already assigned to the same region (rm2 subquery)', async () => {
    const res = mockRes();
    await getMatchTree(req(2), res);

    expect(mockedQuery).toHaveBeenCalledOnce();
    const sql: string = mockedQuery.mock.calls[0][0] as string;

    // Must contain the member-exclusion correlated subquery scoped to r.id
    expect(sql).toMatch(
      /AND rms\.division_id NOT IN \(SELECT division_id FROM region_members rm2 WHERE rm2\.region_id = r\.id\)/,
    );
  });

  it('(b) uses DISTINCT ON (rms.division_id) to keep only the best score per division', async () => {
    const res = mockRes();
    await getMatchTree(req(2), res);

    expect(mockedQuery).toHaveBeenCalledOnce();
    const sql: string = mockedQuery.mock.calls[0][0] as string;

    // Must use DISTINCT ON to dedup by division_id
    expect(sql).toMatch(/DISTINCT ON \(rms\.division_id\)/);

    // Inner ORDER BY must put the highest score first for DISTINCT ON to pick it
    expect(sql).toMatch(/ORDER BY rms\.division_id,\s*rms\.score DESC/);
  });

  it('returns an empty tree (json) when no regions exist', async () => {
    const res = mockRes();
    await getMatchTree(req(99), res);

    expect(res.json).toHaveBeenCalledWith([]);
  });
});
