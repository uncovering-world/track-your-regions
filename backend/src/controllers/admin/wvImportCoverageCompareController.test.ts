/**
 * Source-contract tests for analyzeCoverageGaps (Task 1 — plan 3g).
 *
 * Verifies:
 *   1. The handler source no longer contains ST_Difference / overlap_pct SQL.
 *   2. The handler imports and calls getCoverageBoundaries (shared boundary logic).
 *   3. Behavioral tests via mocked resolveReference + getCoverageBoundaries.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../db/index.js', () => ({
  pool: { query: vi.fn().mockResolvedValue({ rows: [] }) },
}));
vi.mock('../../services/worldViewImport/verifyWorkUnit.js', () => ({
  resolveReference: vi.fn(),
  getCoverageBoundaries: vi.fn(),
}));

import { resolveReference, getCoverageBoundaries } from '../../services/worldViewImport/verifyWorkUnit.js';
import { pool } from '../../db/index.js';
import { analyzeCoverageGaps } from './wvImportCoverageCompareController.js';
import type { AuthenticatedRequest } from '../../middleware/auth.js';
import type { Response } from 'express';

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const mockedResolveReference = resolveReference as unknown as ReturnType<typeof vi.fn>;
const mockedGetCoverageBoundaries = getCoverageBoundaries as unknown as ReturnType<typeof vi.fn>;
const mockedQuery = pool.query as unknown as ReturnType<typeof vi.fn>;

function mockRes(): Response {
  const res = { status: vi.fn(), json: vi.fn() } as unknown as Response;
  (res.status as ReturnType<typeof vi.fn>).mockReturnValue(res);
  return res;
}

function req(worldViewId: number, regionId: number): AuthenticatedRequest {
  return {
    params: { worldViewId: String(worldViewId), regionId: String(regionId) },
    query: {},
    user: { userId: 1, email: 'test@example.com', role: 'admin' },
  } as unknown as AuthenticatedRequest;
}

describe('analyzeCoverageGaps — source contract (plan 3g)', () => {
  it('handler source does NOT contain ST_Difference or overlap_pct', () => {
    const controllerSrc = fs.readFileSync(
      path.join(__dirname, 'wvImportCoverageCompareController.ts'),
      'utf8',
    );
    expect(controllerSrc).not.toContain('ST_Difference');
    expect(controllerSrc).not.toContain('overlap_pct');
  });

  it('handler source imports getCoverageBoundaries from verifyWorkUnit', () => {
    const controllerSrc = fs.readFileSync(
      path.join(__dirname, 'wvImportCoverageCompareController.ts'),
      'utf8',
    );
    expect(controllerSrc).toContain('getCoverageBoundaries');
    expect(controllerSrc).toContain('verifyWorkUnit');
  });
});

describe('analyzeCoverageGaps — behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns empty gapDivisions when reference source is null', async () => {
    mockedResolveReference.mockResolvedValueOnce({ divisionIds: [], source: null });
    const res = mockRes();
    await analyzeCoverageGaps(req(2, 164), res);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      gapDivisions: [],
      message: 'No reference territory',
    }));
    expect(mockedGetCoverageBoundaries).not.toHaveBeenCalled();
  });

  it('calls getCoverageBoundaries with the resolved reference divisionIds', async () => {
    mockedResolveReference.mockResolvedValueOnce({ divisionIds: [2487], source: 'reference' });
    mockedGetCoverageBoundaries.mockResolvedValueOnce([]);
    mockedQuery.mockResolvedValueOnce({ rows: [] }); // direct children query
    mockedQuery.mockResolvedValueOnce({ rows: [] }); // loadChildRegionDivIds
    const res = mockRes();
    await analyzeCoverageGaps(req(2, 164), res);
    expect(mockedGetCoverageBoundaries).toHaveBeenCalledWith(164, [2487]);
  });

  it('returns empty gapDivisions with siblingRegions when no boundaries found', async () => {
    mockedResolveReference.mockResolvedValueOnce({ divisionIds: [2487], source: 'reference' });
    mockedGetCoverageBoundaries.mockResolvedValueOnce([]);
    mockedQuery.mockResolvedValueOnce({ rows: [{ id: 10, name: 'Child A' }] }); // direct children
    mockedQuery.mockResolvedValueOnce({ rows: [] }); // loadChildRegionDivIds
    const res = mockRes();
    await analyzeCoverageGaps(req(2, 164), res);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      gapDivisions: [],
      siblingRegions: [],
    }));
  });

  it('enriches boundary rows and builds gapDivisions with correct shape', async () => {
    mockedResolveReference.mockResolvedValueOnce({ divisionIds: [2487], source: 'reference' });
    mockedGetCoverageBoundaries.mockResolvedValueOnce([
      { id: 2761, name: 'Cunene', parentName: 'Angola' },
    ]);
    mockedQuery.mockResolvedValueOnce({ rows: [] }); // direct children
    mockedQuery.mockResolvedValueOnce({ rows: [] }); // loadChildRegionDivIds (perChildResult)
    // enrichment query
    mockedQuery.mockResolvedValueOnce({
      rows: [{
        id: 2761, name: 'Cunene', parent_id: 2487,
        area_km2: 77251, geojson: '{"type":"Polygon","coordinates":[]}',
      }],
    });
    // buildGapNamePaths: fetch ancestor for parent_id=2487
    mockedQuery.mockResolvedValueOnce({
      rows: [{ id: 2487, name: 'Angola', parent_id: null }],
    });
    // findNearestChildPerGapDivision: no direct children → skips KNN query
    const res = mockRes();
    await analyzeCoverageGaps(req(2, 164), res);
    const call = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0] as {
      gapDivisions: Array<{
        divisionId: number; name: string; areaKm2: number; overlapWithGap: number;
        gadmParentId: number | null; geometry: unknown; suggestedTarget: unknown;
      }>;
    };
    expect(call.gapDivisions).toHaveLength(1);
    const gap = call.gapDivisions[0];
    expect(gap.divisionId).toBe(2761);
    expect(gap.name).toBe('Cunene');
    expect(gap.areaKm2).toBe(77251);
    expect(gap.overlapWithGap).toBe(1);
    expect(gap.gadmParentId).toBe(2487);
    expect(gap.geometry).toEqual({ type: 'Polygon', coordinates: [] });
    expect(gap.suggestedTarget).toBeNull();
  });
});
