import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';

const { poolQuery, invalidateRegionGeometry } = vi.hoisted(() => ({
  poolQuery: vi.fn(),
  invalidateRegionGeometry: vi.fn(),
}));

vi.mock('../../db/index.js', () => ({
  pool: { query: (...args: unknown[]) => poolQuery(...args) },
}));
vi.mock('./helpers.js', () => ({
  ensureRegionMember: vi.fn(),
  invalidateRegionGeometry,
  syncImportMatchStatus: vi.fn(),
}));

import { moveMemberToRegion, removeDivisionsFromRegion } from './regionMemberMutations.js';
import { addChildDivisionsAsSubregions, expandToSubregions, getDivisionUsageCounts } from './regionMemberOperations.js';

function call(handler: (req: Request, res: Response) => Promise<void>, req: Record<string, unknown>) {
  const json = vi.fn();
  const res = { json, status: vi.fn().mockReturnThis() };
  return handler(req as unknown as Request, res as unknown as Response).then(() => json.mock.calls[0]?.[0]);
}

beforeEach(() => {
  poolQuery.mockReset();
  invalidateRegionGeometry.mockReset();
});

describe('removeDivisionsFromRegion', () => {
  it('counts the member rows that went, not the ids the call named', async () => {
    // Two of the three rows belong to the region; the third names another one.
    poolQuery.mockResolvedValueOnce({ rowCount: 1 }).mockResolvedValueOnce({ rowCount: 1 }).mockResolvedValueOnce({ rowCount: 0 });
    const answer = await call(removeDivisionsFromRegion, { params: { regionId: '7323' }, body: { memberRowIds: [11340, 11341, 9010] } });
    expect(answer).toEqual({ removed: 2 });
  });

  it('counts the same way when divisions are named rather than rows', async () => {
    poolQuery.mockResolvedValueOnce({ rowCount: 1 }).mockResolvedValueOnce({ rowCount: 0 });
    const answer = await call(removeDivisionsFromRegion, { params: { regionId: '7323' }, body: { divisionIds: [345039, 22704] } });
    expect(answer).toEqual({ removed: 1 });
  });
});

describe('moveMemberToRegion', () => {
  it('answers with the move, never the member row, whose cut geometry can run to megabytes', async () => {
    poolQuery.mockResolvedValueOnce({ rows: [{ id: 11340, region_id: 7349 }] });
    const answer = await call(moveMemberToRegion, { params: { regionId: '7323' }, body: { memberRowId: 11340, toRegionId: 7349 } });

    expect(answer).toEqual({ moved: true, memberRowId: 11340, fromRegionId: 7323, toRegionId: 7349 });
    expect(String(poolQuery.mock.calls[0][0])).not.toMatch(/RETURNING \*/);
  });
});

describe('expandToSubregions', () => {
  it('names the division each new subregion was made for', async () => {
    poolQuery.mockImplementation(async (sql: string) => {
      const s = String(sql);
      if (s.includes('SELECT id, name, world_view_id, color FROM regions')) {
        return { rows: [{ id: 5377, name: 'Cyprus', world_view_id: 5, color: null }] };
      }
      if (s.includes('FROM region_members rm')) return { rows: [{ division_id: 57365, name: 'Nicosia' }] };
      if (s.includes('INSERT INTO regions')) return { rows: [{ id: 9001, name: 'Nicosia' }] };
      return { rows: [] };
    });
    const answer = await call(expandToSubregions, { params: { regionId: '5377' }, body: {} });
    expect(answer).toEqual({ createdRegions: [{ id: 9001, name: 'Nicosia', divisionId: 57365 }], expandedCount: 1 });
  });
});

describe('getDivisionUsageCounts', () => {
  it('keys each count by the division id, as JSON keys an object', async () => {
    poolQuery.mockResolvedValueOnce({ rows: [{ division_id: 377, usage_count: 2 }] });
    const answer = await call(getDivisionUsageCounts, { params: { worldViewId: '5' }, body: { divisionIds: [377, 999] } });
    expect(answer).toEqual({ 377: 2 });
  });
});

describe('addChildDivisionsAsSubregions', () => {
  /**
   * Cyprus's two GADM children put into the Cyprus region as subregions:
   * Nicosia is assigned to a region that is not a child of Cyprus, which fails
   * verification, and Limassol gets a new subregion.
   */
  function mockCyprus(originalRows: number): void {
    poolQuery.mockImplementation(async (sql: string) => {
      const s = String(sql);
      if (s.includes('SELECT world_view_id, color FROM regions')) return { rows: [{ world_view_id: 5, color: null }] };
      if (s.includes('SELECT id, name, has_children FROM administrative_divisions')) {
        return { rows: [{ id: 57364, name: 'Cyprus', has_children: true }] };
      }
      if (s.includes('FROM administrative_divisions WHERE parent_id')) {
        return { rows: [{ id: 57365, name: 'Nicosia' }, { id: 57366, name: 'Limassol' }] };
      }
      if (s.includes('SELECT id FROM regions WHERE id = $1 AND world_view_id')) return { rows: [] };
      if (s.includes('INSERT INTO regions')) return { rows: [{ id: 9002, name: 'Limassol' }] };
      if (s.includes('DELETE FROM region_members')) return { rowCount: originalRows };
      return { rows: [] };
    });
  }
  const request = {
    params: { regionId: '5377', divisionId: '57364' },
    body: { assignments: [{ gadmChildId: 57365, existingRegionId: 4993 }] },
  };

  it('counts the children it placed, not the ones it skipped', async () => {
    mockCyprus(1);
    const answer = await call(addChildDivisionsAsSubregions, request);
    expect(answer).toEqual({
      added: 1, removedOriginal: true, createdRegions: [{ id: 9002, name: 'Limassol', divisionId: 57366 }],
    });
  });

  it('says the original stayed when there was no row of it to remove', async () => {
    mockCyprus(0);
    const answer = await call(addChildDivisionsAsSubregions, request) as { removedOriginal: boolean };
    expect(answer.removedOriginal).toBe(false);
  });

  it('clears Cyprus, whose union gained a Limassol that has no outline for a trigger to carry up', async () => {
    // Nothing was removed from Cyprus itself, so no member trigger fires on
    // it, and the new Limassol subregion has no geometry to cascade from.
    mockCyprus(0);
    await call(addChildDivisionsAsSubregions, { ...request, body: { ...request.body, removeOriginal: false } });
    expect(invalidateRegionGeometry).toHaveBeenCalledWith(5377);
  });

  it('names nothing when the children join Cyprus as flat members, which the member trigger clears', async () => {
    mockCyprus(1);
    await call(addChildDivisionsAsSubregions, { ...request, body: { createAsSubregions: false } });
    expect(invalidateRegionGeometry).not.toHaveBeenCalled();
  });
});
