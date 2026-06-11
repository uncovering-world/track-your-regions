/**
 * Tests for workspace derivation utilities (TDD — written before implementation).
 * Covers: findSubtree, flattenSubtree, childColorMap, deriveStage.
 */
import { describe, it, expect } from 'vitest';
import {
  findSubtree,
  flattenSubtree,
  childColorMap,
  deriveStage,
  CHILD_PALETTE,
} from './workspaceUtils';
import type { MatchTreeNode } from '../../../api/admin/worldViewImport';
import type { VerifyResult } from '../../../api/admin/wvImportWorkflow';

// ─── Fixtures ────────────────────────────────────────────────────────────────

function makeNode(
  id: number,
  overrides?: Partial<MatchTreeNode> & { children?: MatchTreeNode[] },
): MatchTreeNode {
  return {
    id,
    name: `Region ${id}`,
    isLeaf: true,
    matchStatus: 'no_candidates',
    suggestions: [],
    sourceUrl: null,
    regionMapUrl: null,
    mapImageCandidates: [],
    mapImageReviewed: false,
    needsManualFix: false,
    fixNote: null,
    wikidataId: null,
    memberCount: 0,
    assignedDivisions: [],
    geoAvailable: null,
    markerPoints: null,
    hierarchyWarnings: [],
    hierarchyReviewed: false,
    isWorkUnit: false,
    hierarchyConfirmed: false,
    signoffStatus: 'not_started',
    assignmentWaived: false,
    children: [],
    ...overrides,
  };
}

function makeVerify(overrides?: Partial<VerifyResult>): VerifyResult {
  return {
    referenceDivisionIds: [1],
    referenceSource: 'reference',
    unassignedLeaves: [],
    coverageGaps: [],
    overlaps: [],
    blockers: [],
    verifiedAt: '2025-01-01T00:00:00Z',
    ...overrides,
  };
}

/** Build a small tree: root → [child1 → [grandchild1, grandchild2], child2] */
const grandchild1 = makeNode(3, { isLeaf: true, matchStatus: 'manual_matched', memberCount: 1, assignedDivisions: [{ divisionId: 100, name: 'D100', path: 'A > D100', hasCustomGeom: false }] });
const grandchild2 = makeNode(4, { isLeaf: true, matchStatus: 'no_candidates' });
const child1 = makeNode(2, { isLeaf: false, children: [grandchild1, grandchild2] });
const child2 = makeNode(5, { isLeaf: true, matchStatus: 'manual_matched', memberCount: 1, assignedDivisions: [{ divisionId: 200, name: 'D200', path: 'A > D200', hasCustomGeom: false }] });
const root = makeNode(1, { isLeaf: false, isWorkUnit: true, hierarchyConfirmed: true, children: [child1, child2] });

// ─── findSubtree ──────────────────────────────────────────────────────────────

describe('findSubtree', () => {
  it('returns the root node when id matches root', () => {
    const result = findSubtree([root], 1);
    expect(result).toBe(root);
  });

  it('returns a direct child node', () => {
    const result = findSubtree([root], 2);
    expect(result?.id).toBe(2);
  });

  it('returns a grandchild node', () => {
    const result = findSubtree([root], 3);
    expect(result?.id).toBe(3);
  });

  it('returns null when id not in tree', () => {
    const result = findSubtree([root], 999);
    expect(result).toBeNull();
  });

  it('returns null on empty tree', () => {
    expect(findSubtree([], 1)).toBeNull();
  });

  it('works with flat array (multiple roots)', () => {
    const tree = [makeNode(10), makeNode(11), makeNode(12)];
    expect(findSubtree(tree, 11)?.id).toBe(11);
  });
});

// ─── flattenSubtree ───────────────────────────────────────────────────────────

describe('flattenSubtree', () => {
  it('always includes the root at depth 0', () => {
    const rows = flattenSubtree(root, new Set());
    expect(rows[0]).toMatchObject({ node: root, depth: 0 });
  });

  it('root-only when no children expanded and has children', () => {
    const rows = flattenSubtree(root, new Set());
    // Root is always shown; collapsed children not
    expect(rows.length).toBe(1);
  });

  it('expands only immediate children when root expanded', () => {
    const rows = flattenSubtree(root, new Set([1]));
    const ids = rows.map(r => r.node.id);
    expect(ids).toContain(2);
    expect(ids).toContain(5);
    // grandchildren not shown (child1 not expanded)
    expect(ids).not.toContain(3);
    expect(ids).not.toContain(4);
  });

  it('assigns correct depths', () => {
    const rows = flattenSubtree(root, new Set([1, 2]));
    const byId = Object.fromEntries(rows.map(r => [r.node.id, r.depth]));
    expect(byId[1]).toBe(0);
    expect(byId[2]).toBe(1);
    expect(byId[3]).toBe(2);
    expect(byId[5]).toBe(1);
  });

  it('leaf node produces only itself regardless of expandedIds', () => {
    const leaf = makeNode(99, { isLeaf: true });
    const rows = flattenSubtree(leaf, new Set([99]));
    expect(rows.length).toBe(1);
    expect(rows[0].node.id).toBe(99);
  });

  it('full expansion shows all nodes', () => {
    const rows = flattenSubtree(root, new Set([1, 2]));
    const ids = new Set(rows.map(r => r.node.id));
    expect(ids).toEqual(new Set([1, 2, 3, 4, 5]));
  });
});

// ─── childColorMap ────────────────────────────────────────────────────────────

describe('childColorMap', () => {
  it('assigns a color to each direct child', () => {
    const colorMap = childColorMap(root);
    expect(colorMap.has(2)).toBe(true);
    expect(colorMap.has(5)).toBe(true);
  });

  it('does not include the root itself', () => {
    const colorMap = childColorMap(root);
    expect(colorMap.has(1)).toBe(false);
  });

  it('does not include grandchildren', () => {
    const colorMap = childColorMap(root);
    expect(colorMap.has(3)).toBe(false);
    expect(colorMap.has(4)).toBe(false);
  });

  it('assigns distinct colors when children count ≤ palette size', () => {
    const colorMap = childColorMap(root);
    const colors = [...colorMap.values()];
    expect(new Set(colors).size).toBe(colors.length);
  });

  it('cycles palette for > 12 children', () => {
    const children = Array.from({ length: 14 }, (_, i) => makeNode(100 + i, { isLeaf: true }));
    const bigRoot = makeNode(0, { isLeaf: false, children });
    const colorMap = childColorMap(bigRoot);
    expect(colorMap.size).toBe(14);
    // Color at index 12 == color at index 0
    const sorted = children.map(c => colorMap.get(c.id)!);
    expect(sorted[12]).toBe(sorted[0]);
    expect(sorted[13]).toBe(sorted[1]);
  });

  it('colors are valid CSS hex strings', () => {
    const colorMap = childColorMap(root);
    for (const color of colorMap.values()) {
      expect(color).toMatch(/^#[0-9a-fA-F]{6}$/);
    }
  });

  it('palette has exactly 12 entries', () => {
    expect(CHILD_PALETTE).toHaveLength(12);
  });
});

// ─── deriveStage ─────────────────────────────────────────────────────────────

describe('deriveStage', () => {
  it('returns "done" when unit is signed_off', () => {
    const unit = makeNode(1, { signoffStatus: 'signed_off', hierarchyConfirmed: true, children: [] });
    expect(deriveStage(unit, null)).toBe('done');
  });

  it('returns "hierarchy" when hierarchyConfirmed is false', () => {
    const unit = makeNode(1, { hierarchyConfirmed: false, isWorkUnit: true });
    expect(deriveStage(unit, null)).toBe('hierarchy');
  });

  it('returns "assignment" when hierarchy confirmed but unassigned leaves exist', () => {
    const leaf = makeNode(2, { isLeaf: true, matchStatus: 'no_candidates', memberCount: 0 });
    const unit = makeNode(1, { isLeaf: false, hierarchyConfirmed: true, children: [leaf] });
    expect(deriveStage(unit, null)).toBe('assignment');
  });

  it('returns "assignment" when leaf has needs_review status', () => {
    const leaf = makeNode(2, { isLeaf: true, matchStatus: 'needs_review', memberCount: 0 });
    const unit = makeNode(1, { isLeaf: false, hierarchyConfirmed: true, children: [leaf] });
    expect(deriveStage(unit, null)).toBe('assignment');
  });

  it('returns "verification" when hierarchy confirmed, leaves assigned, but verify has blockers', () => {
    const leaf = makeNode(2, { isLeaf: true, matchStatus: 'manual_matched', memberCount: 1, assignedDivisions: [{ divisionId: 10, name: 'D', path: '', hasCustomGeom: false }] });
    const unit = makeNode(1, { isLeaf: false, hierarchyConfirmed: true, children: [leaf] });
    const verify = makeVerify({ blockers: ['coverage_gaps'] });
    expect(deriveStage(unit, verify)).toBe('verification');
  });

  it('returns "verification" when hierarchy confirmed, leaves assigned, verify null (not run yet)', () => {
    const leaf = makeNode(2, { isLeaf: true, matchStatus: 'manual_matched', memberCount: 1, assignedDivisions: [{ divisionId: 10, name: 'D', path: '', hasCustomGeom: false }] });
    const unit = makeNode(1, { isLeaf: false, hierarchyConfirmed: true, children: [leaf] });
    // null verify means checks not run — stays at verification stage
    expect(deriveStage(unit, null)).toBe('verification');
  });

  it('returns "done" when all checks pass (signed_off)', () => {
    const unit = makeNode(1, { signoffStatus: 'signed_off', hierarchyConfirmed: true });
    const verify = makeVerify();
    expect(deriveStage(unit, verify)).toBe('done');
  });

  it('treats waived leaf as resolved for assignment stage', () => {
    const leaf = makeNode(2, { isLeaf: true, matchStatus: 'no_candidates', memberCount: 0, assignmentWaived: true });
    const unit = makeNode(1, { isLeaf: false, hierarchyConfirmed: true, children: [leaf] });
    // waived: does not count as unresolved
    expect(deriveStage(unit, null)).toBe('verification');
  });

  it('handles root that is itself a leaf (single-node unit)', () => {
    const unit = makeNode(1, { isLeaf: true, hierarchyConfirmed: true, matchStatus: 'manual_matched', memberCount: 1, assignedDivisions: [{ divisionId: 10, name: 'D', path: '', hasCustomGeom: false }] });
    expect(deriveStage(unit, null)).toBe('verification');
  });
});
