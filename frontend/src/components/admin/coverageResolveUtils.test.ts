import { describe, it, expect } from 'vitest';
import { allLeavesApplied, collectSubtreeIds, findSubtreeNode, gapTree } from './coverageResolveUtils';

/**
 * A gap's tree is read one level at a time (#1030): the coverage answer
 * carries Australia's states, and New South Wales's own level arrives when the
 * reviewer expands it.
 */
const STATES = [
  { id: 4, name: 'New South Wales', hasChildren: true },
  { id: 5, name: 'Northern Territory', hasChildren: false },
];
const SYDNEY = { id: 6, name: 'Sydney', hasChildren: false };

describe('gapTree', () => {
  it('leaves a branch nobody expanded unread, and nests one that was', () => {
    expect(gapTree(STATES, new Map())[0]).toEqual({ id: 4, name: 'New South Wales', hasChildren: true });
    expect(gapTree(STATES, new Map([[4, [SYDNEY]]]))[0]).toEqual({
      id: 4, name: 'New South Wales', hasChildren: true, children: [{ ...SYDNEY }],
    });
  });

  it('answers no tree for a gap with nothing under it', () => {
    expect(gapTree(undefined, new Map())).toEqual([]);
  });
});

describe('allLeavesApplied', () => {
  it('does not take an unread branch as covered', () => {
    // Northern Territory is applied, New South Wales was never opened: nothing
    // under it can have been applied yet, so the gap is not resolved.
    expect(allLeavesApplied(gapTree(STATES, new Map()), new Set([5]))).toBe(false);
  });

  it('takes a branch as covered once its read leaves are applied', () => {
    const tree = gapTree(STATES, new Map([[4, [SYDNEY]]]));
    expect(allLeavesApplied(tree, new Set([5, 6]))).toBe(true);
    expect(allLeavesApplied(tree, new Set([5]))).toBe(false);
  });

  it('takes an applied node as covering whatever lies under it, read or not', () => {
    expect(allLeavesApplied(gapTree(STATES, new Map()), new Set([4, 5]))).toBe(true);
  });
});

describe('the read tree', () => {
  it('finds and collects the nodes read so far', () => {
    const tree = gapTree(STATES, new Map([[4, [SYDNEY]]]));
    expect(findSubtreeNode(tree, 6)?.name).toBe('Sydney');
    const ids = new Set<number>();
    collectSubtreeIds(tree, ids);
    expect([...ids].sort()).toEqual([4, 5, 6]);
  });
});
