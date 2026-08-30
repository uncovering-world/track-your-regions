import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Response } from 'express';
import type { AuthenticatedRequest } from '../../middleware/auth.js';

/**
 * A structural change in the import review invalidates the unions it moved.
 *
 * `regions.geom` is the union of a region's children and its own member
 * divisions, and since ADR-0035 a *geometry* write carries the news upward on
 * its own: `trg_regions_geom_invalidates_parent` nulls the parent, and nulling
 * the parent is itself a geometry write, so the walk is the cascade. A
 * structural change writes no geometry -- a region changes parents, or stops
 * existing -- so the trigger never sees it, and the ADR leaves that case to
 * TypeScript in as many words. The World View Editor already names its rows
 * (`regionCrud.updateRegion`, `regionCrud.deleteRegion`); the import-review
 * tree operations named none, which is #496.
 *
 * Missing it is permanent rather than late. An ordinary run's closure is every
 * region with no geometry *and every ancestor of one*
 * (`computationProgress.loadGroupsToCompute`), so a parent that keeps a stale
 * outline with nothing `NULL` beneath it is never selected again and every run
 * reports Complete. Only a forced run recovers it.
 *
 * Each case below names the rows that handler has to clear, and why those and
 * not others. The `pg` lane here is mocked, so what it can prove is which rows
 * the handler asks to be cleared -- that the trigger then carries the news to
 * their ancestors is ADR-0035's, verified against a live database.
 */

const { mockPoolQuery, mockClientQuery, mockClientRelease, mockPoolConnect } = vi.hoisted(() => {
  const clientQuery = vi.fn();
  const clientRelease = vi.fn();
  return {
    mockPoolQuery: vi.fn(),
    mockClientQuery: clientQuery,
    mockClientRelease: clientRelease,
    mockPoolConnect: vi.fn(async () => ({ query: clientQuery, release: clientRelease })),
  };
});

vi.mock('../../db/index.js', () => ({
  pool: { query: mockPoolQuery, connect: mockPoolConnect },
}));

// Heavy imports the three controllers pull in but no case below reaches.
vi.mock('../../services/worldViewImport/index.js', () => ({ matchChildrenAsCountries: vi.fn() }));
vi.mock('../../services/worldViewImport/aiMatcher.js', () => ({
  dbSearchSingleRegion: vi.fn(async () => ({ found: 0 })),
  trigramSearch: vi.fn(async () => []),
}));
vi.mock('../../services/worldViewImport/spatialAnomalyDetector.js', () => ({
  detectAnomaliesForRegion: vi.fn(),
}));

import { reparentRegion } from './wvImportRenameController.js';
import {
  mergeChildIntoParent,
  removeRegionFromImport,
  dismissChildren,
  pruneToLeaves,
} from './wvImportTreeOpsController.js';
import { smartFlatten } from './wvImportFlattenController.js';

type Row = Record<string, unknown>;
type Answer = [RegExp, Row[]];

/** First matching pattern wins, so order the specific ones before the general. */
function answering(answers: Answer[]) {
  return async (sql: string) => {
    const hit = answers.find(([pattern]) => pattern.test(sql));
    const rows = hit ? hit[1] : [];
    return { rows, rowCount: rows.length };
  };
}

/** The region ids a handler asked the database to clear, in the order it asked. */
function invalidated(): number[] {
  return mockPoolQuery.mock.calls
    .filter(call => /SET\s+geom = NULL/.test(String(call[0])))
    .map(call => (call[1] as unknown[])[0] as number);
}

function makeReq(body: Row, worldViewId = '31'): AuthenticatedRequest {
  return { params: { worldViewId }, body } as unknown as AuthenticatedRequest;
}

function makeRes(): Response & { _status?: number; _body?: unknown } {
  const res = {} as Response & { _status?: number; _body?: unknown };
  res.status = vi.fn((code: number) => { res._status = code; return res; }) as unknown as Response['status'];
  res.json = vi.fn((body: unknown) => { res._body = body; return res; }) as unknown as Response['json'];
  return res;
}

beforeEach(() => {
  mockPoolQuery.mockReset();
  mockClientQuery.mockReset();
  mockClientRelease.mockReset();
  mockPoolConnect.mockClear();
  mockPoolQuery.mockImplementation(answering([]));
  mockClientQuery.mockImplementation(answering([]));
});

describe('reparentRegion', () => {
  const POOL: Answer[] = [
    [/SELECT id, parent_region_id FROM regions/, [{ id: 200, parent_region_id: 100 }]],
    [/SELECT id FROM regions WHERE id = \$1 AND world_view_id/, [{ id: 300 }]],
    [/WITH RECURSIVE/, []],
  ];

  it('clears both parents, the one that lost a child and the one that gained it', async () => {
    // Not the moved region: an import reparent writes `parent_region_id` and
    // nothing else, so the region's own members and children -- everything its
    // union is made of -- are exactly what they were. `regionCrud.updateRegion`
    // names three rows because it also moves a division membership between the
    // two parents; here there is no membership to move.
    mockPoolQuery.mockImplementation(answering(POOL));

    await reparentRegion(makeReq({ regionId: 200, newParentId: 300 }), makeRes());

    expect(invalidated()).toEqual([100, 300]);
  });

  it('clears the old parent alone when a region is moved out to the root', async () => {
    mockPoolQuery.mockImplementation(answering(POOL));

    await reparentRegion(makeReq({ regionId: 200, newParentId: null }), makeRes());

    expect(invalidated()).toEqual([100]);
  });

  it('clears the new parent alone when a root region is moved under one', async () => {
    mockPoolQuery.mockImplementation(answering([
      [/SELECT id, parent_region_id FROM regions/, [{ id: 200, parent_region_id: null }]],
      ...POOL.slice(1),
    ]));

    await reparentRegion(makeReq({ regionId: 200, newParentId: 300 }), makeRes());

    expect(invalidated()).toEqual([300]);
  });

  it('clears nothing when the move is refused', async () => {
    // A circular move is rejected before the UPDATE, so no union has changed.
    mockPoolQuery.mockImplementation(answering([
      [/SELECT id, parent_region_id FROM regions/, [{ id: 200, parent_region_id: 100 }]],
      [/SELECT id FROM regions WHERE id = \$1 AND world_view_id/, [{ id: 300 }]],
      [/WITH RECURSIVE/, [{ id: 300 }]],
    ]));

    const res = makeRes();
    await reparentRegion(makeReq({ regionId: 200, newParentId: 300 }), res);

    expect(res._status).toBe(400);
    expect(invalidated()).toEqual([]);
  });

  it('clears nothing when the request moves a region to the parent it already has', async () => {
    mockPoolQuery.mockImplementation(answering(POOL));

    await reparentRegion(makeReq({ regionId: 200, newParentId: 100 }), makeRes());

    expect(invalidated()).toEqual([]);
  });
});

describe('mergeChildIntoParent', () => {
  it('clears the parent, which absorbs the child’s members and grandchildren', async () => {
    // Not the grandchildren: they change parents but keep every member they
    // had, so their own outlines still hold. Not the child either -- it is
    // deleted by this statement.
    mockClientQuery.mockImplementation(answering([
      [/SELECT id, name FROM regions WHERE parent_region_id/, [{ id: 201, name: 'Child' }]],
      [/SELECT id, name FROM regions WHERE id = \$1 AND world_view_id/, [{ id: 100, name: 'Parent' }]],
    ]));

    await mergeChildIntoParent(makeReq({ regionId: 100 }), makeRes());

    expect(invalidated()).toEqual([100]);
  });

  it('clears nothing when the merge is refused for having the wrong child count', async () => {
    mockClientQuery.mockImplementation(answering([
      [/SELECT id, name FROM regions WHERE parent_region_id/, [{ id: 201, name: 'A' }, { id: 202, name: 'B' }]],
      [/SELECT id, name FROM regions WHERE id = \$1 AND world_view_id/, [{ id: 100, name: 'Parent' }]],
    ]));

    const res = makeRes();
    await mergeChildIntoParent(makeReq({ regionId: 100 }), res);

    expect(res._status).toBe(400);
    expect(invalidated()).toEqual([]);
  });
});

describe('removeRegionFromImport', () => {
  const found: Answer = [
    /SELECT id, name, parent_region_id FROM regions/,
    [{ id: 200, name: 'Removed', parent_region_id: 100 }],
  ];

  it('clears the parent when the children are moved up into it', async () => {
    mockClientQuery.mockImplementation(answering([found]));

    await removeRegionFromImport(makeReq({ regionId: 200, reparentChildren: true }), makeRes());

    expect(invalidated()).toEqual([100]);
  });

  it('clears the parent when the whole branch is deleted', async () => {
    mockClientQuery.mockImplementation(answering([found, [/WITH RECURSIVE/, [{ id: 301 }]]]));

    await removeRegionFromImport(makeReq({ regionId: 200, reparentChildren: false }), makeRes());

    expect(invalidated()).toEqual([100]);
  });

  it('clears nothing when the removed region was a root, having no parent to go stale', async () => {
    mockClientQuery.mockImplementation(answering([
      [/SELECT id, name, parent_region_id FROM regions/, [{ id: 200, name: 'Root', parent_region_id: null }]],
    ]));

    await removeRegionFromImport(makeReq({ regionId: 200, reparentChildren: true }), makeRes());

    expect(invalidated()).toEqual([]);
  });
});

describe('dismissChildren', () => {
  it('clears the region whose children are gone, keeping its own members', async () => {
    // The descendants are deleted outright and nothing moves up, so the only
    // union that changes is the one they were part of.
    mockClientQuery.mockImplementation(answering([
      [/SELECT id, name FROM regions WHERE id = \$1 AND world_view_id/, [{ id: 100, name: 'Parent' }]],
      [/WITH RECURSIVE[\s\S]*SELECT id FROM desc_regions/, [{ id: 201 }, { id: 202 }]],
    ]));

    const res = makeRes();
    await dismissChildren(makeReq({ regionId: 100 }), res);

    expect(res._body).toMatchObject({ dismissed: 2 });
    expect(invalidated()).toEqual([100]);
  });

  it('clears nothing when there was nothing to dismiss', async () => {
    mockClientQuery.mockImplementation(answering([
      [/SELECT id, name FROM regions WHERE id = \$1 AND world_view_id/, [{ id: 100, name: 'Parent' }]],
    ]));

    const res = makeRes();
    await dismissChildren(makeReq({ regionId: 100 }), res);

    expect(res._status).toBe(400);
    expect(invalidated()).toEqual([]);
  });
});

describe('pruneToLeaves', () => {
  it('clears the children that lost descendants, and not the one that had none', async () => {
    // Not the region itself: its children are still its children, and each one
    // cleared is a geometry write, so the trigger takes the news up from there.
    // Child 202 is a leaf already -- the prune deletes nothing under it, so it
    // draws exactly what it drew and asking for it to be recomputed would be
    // asking for a union nobody changed.
    mockClientQuery.mockImplementation(answering([
      [/SELECT id, name FROM regions WHERE id = \$1 AND world_view_id/, [{ id: 100, name: 'Parent' }]],
      [/SELECT id FROM regions WHERE parent_region_id = \$1/, [{ id: 201 }, { id: 202 }]],
      [/WITH RECURSIVE[\s\S]*SELECT id, root_child FROM desc_regions/, [
        { id: 301, root_child: 201 },
        { id: 302, root_child: 201 },
      ]],
    ]));

    const res = makeRes();
    await pruneToLeaves(makeReq({ regionId: 100 }), res);

    expect(res._body).toMatchObject({ pruned: 2 });
    expect(invalidated()).toEqual([201]);
  });

  it('clears nothing when the direct children have no descendants to prune', async () => {
    mockClientQuery.mockImplementation(answering([
      [/SELECT id, name FROM regions WHERE id = \$1 AND world_view_id/, [{ id: 100, name: 'Parent' }]],
      [/SELECT id FROM regions WHERE parent_region_id = \$1/, [{ id: 201 }]],
    ]));

    const res = makeRes();
    await pruneToLeaves(makeReq({ regionId: 100 }), res);

    expect(res._status).toBe(400);
    expect(invalidated()).toEqual([]);
  });
});

describe('smartFlatten', () => {
  it('clears the region that absorbed the divisions of the descendants it deleted', async () => {
    mockPoolQuery.mockImplementation(answering([
      [/SELECT id, name FROM regions WHERE id = \$1 AND world_view_id/, [{ id: 100, name: 'Parent' }]],
      [/WITH RECURSIVE/, [{ id: 201, name: 'A' }, { id: 202, name: 'B' }]],
      [/SELECT DISTINCT region_id FROM region_members/, [{ region_id: 201 }, { region_id: 202 }]],
    ]));

    const res = makeRes();
    await smartFlatten(makeReq({ regionId: 100 }), res);

    expect(res._body).toMatchObject({ absorbed: 2 });
    expect(invalidated()).toEqual([100]);
  });

  it('clears nothing when the flatten is refused for an unmatched child', async () => {
    mockPoolQuery.mockImplementation(answering([
      [/SELECT id, name FROM regions WHERE id = \$1 AND world_view_id/, [{ id: 100, name: 'Parent' }]],
      [/WITH RECURSIVE/, [{ id: 201, name: 'A' }]],
      [/SELECT DISTINCT region_id FROM region_members/, []],
    ]));

    const res = makeRes();
    await smartFlatten(makeReq({ regionId: 100 }), res);

    expect(res._status).toBe(400);
    expect(invalidated()).toEqual([]);
  });
});

describe('undo restores regions with no geometry, which is what makes it self-healing', () => {
  it('names no geometry column when it recreates a deleted region', () => {
    // Undoing a dismiss, a prune or a smart flatten needs no invalidation of
    // its own: every region it recreates arrives with `geom NULL`, which is
    // precisely what seeds the run's closure -- the restored rows are selected,
    // and every ancestor of one with them, so the parent is recomputed without
    // anybody naming it. Restore a snapshot of `geom` here and that stops being
    // true, and the undo paths would need what the forward paths need.
    const source = readFileSync(
      join(__dirname, 'wvImportHierarchyController.ts'), 'utf8',
    ).replace(/\s+/g, ' ');
    const start = source.indexOf('async function restoreDescendantRegions');
    expect(start, 'restoreDescendantRegions is missing').toBeGreaterThan(-1);
    const end = source.indexOf('async function insertImportStatesIfMissing', start);
    expect(end, 'insertImportStatesIfMissing no longer follows it').toBeGreaterThan(start);

    const body = source.slice(start, end);
    expect(body).toContain('INSERT INTO regions (id, name, parent_region_id, is_leaf, world_view_id)');
    expect(body).not.toMatch(/(?<!\w)geom/);
  });
});
