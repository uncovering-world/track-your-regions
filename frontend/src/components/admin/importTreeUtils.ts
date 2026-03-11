import type { MatchTreeNode } from '../../api/adminWorldViewImport';
import type { ShadowInsertion } from './treeNodeShared';

export type FlatTreeItem =
  | { kind: 'node'; node: MatchTreeNode; depth: number; ancestorIsMatched: boolean }
  | { kind: 'shadow'; shadow: ShadowInsertion; depth: number };

/**
 * Is a node blocking the Coverage Check?
 * Matches the backend blocking definitions:
 * - needs_review/suggested: always blocking (not covered by ancestor)
 * - no_candidates: blocking when not covered AND has unresolved leaves
 *   (leaf itself counts as unresolved, container only if subtree is unresolved)
 */
export function isUnresolved(node: MatchTreeNode, ancestorHasMembers: boolean): boolean {
  if (ancestorHasMembers) return false;
  if (node.matchStatus === 'needs_review' || node.matchStatus === 'suggested') return true;
  if (node.matchStatus === 'no_candidates') {
    if (node.children.length === 0) return true;
    return !isNodeResolved(node, ancestorHasMembers);
  }
  return false;
}

/** Is a node resolved? Matched nodes count immediately; containers recurse. */
export function isNodeResolved(node: MatchTreeNode, ancestorHasMembers = false): boolean {
  const s = node.matchStatus;
  // Directly matched — done, no need to check deeper
  if (s === 'auto_matched' || s === 'manual_matched' || s === 'children_matched') {
    return true;
  }
  // Covered by ancestor geometry
  if (s === 'no_candidates' && ancestorHasMembers) {
    return true;
  }
  // Container (null or no_candidates without coverage) — resolved only if all children are
  const covered = ancestorHasMembers || node.memberCount > 0;
  if (node.children.length > 0) {
    return node.children.every(c => isNodeResolved(c, covered));
  }
  return false;
}

/**
 * Count how many direct children are fully resolved.
 * X = children that are matched themselves or whose entire subtree is matched.
 * Y = total direct children.
 */
export function countDirectChildrenResolved(children: MatchTreeNode[], ancestorHasMembers = false): { resolved: number; total: number } {
  let resolved = 0;
  for (const child of children) {
    if (isNodeResolved(child, ancestorHasMembers)) resolved++;
  }
  return { resolved, total: children.length };
}

/** Collect IDs of all ancestors on the path to blocking nodes */
export function collectAncestorsOfUnresolved(nodes: MatchTreeNode[]): Set<number> {
  const ids = new Set<number>();
  function walk(node: MatchTreeNode, ancestorHasMembers: boolean): boolean {
    let hasUnresolved = isUnresolved(node, ancestorHasMembers);
    // Only direct matches count as ancestor coverage (they have region_members).
    // children_matched has no direct assignments — its children need their own matching.
    const nodeIsMatched = node.matchStatus === 'auto_matched' || node.matchStatus === 'manual_matched';
    const childCovered = ancestorHasMembers || nodeIsMatched || node.memberCount > 0;
    for (const child of node.children) {
      if (walk(child, childCovered)) hasUnresolved = true;
    }
    if (hasUnresolved && node.children.length > 0) {
      ids.add(node.id);
    }
    return hasUnresolved;
  }
  for (const root of nodes) walk(root, false);
  return ids;
}

/** Collect IDs of all ancestors on the path to specific target node IDs */
export function collectAncestorsOfIds(nodes: MatchTreeNode[], targetIds: Set<number>): Set<number> {
  const ids = new Set<number>();
  function walk(node: MatchTreeNode): boolean {
    let hasTarget = targetIds.has(node.id);
    for (const child of node.children) {
      if (walk(child)) hasTarget = true;
    }
    if (hasTarget && node.children.length > 0) {
      ids.add(node.id);
    }
    return hasTarget;
  }
  for (const root of nodes) walk(root);
  return ids;
}

/** Collect IDs of all leaf-level unresolved nodes */
export function findUnresolvedNodes(nodes: MatchTreeNode[]): number[] {
  const result: number[] = [];
  function walk(node: MatchTreeNode, ancestorHasMembers: boolean): void {
    if (isUnresolved(node, ancestorHasMembers)) {
      result.push(node.id);
    }
    const nodeIsMatched = node.matchStatus === 'auto_matched' || node.matchStatus === 'manual_matched';
    const childCovered = ancestorHasMembers || nodeIsMatched || node.memberCount > 0;
    for (const child of node.children) {
      walk(child, childCovered);
    }
  }
  for (const root of nodes) walk(root, false);
  return result;
}

/** Collect IDs of nodes that have exactly one child (candidates for merge) */
export function findSingleChildNodes(nodes: MatchTreeNode[]): number[] {
  const result: number[] = [];
  function walk(node: MatchTreeNode): void {
    if (node.children.length === 1) {
      result.push(node.id);
    }
    for (const child of node.children) walk(child);
  }
  for (const root of nodes) walk(root);
  return result;
}

/** Collect IDs of nodes with unreviewed hierarchy warnings */
export function findNodesWithWarnings(nodes: MatchTreeNode[]): number[] {
  const result: number[] = [];
  function walk(node: MatchTreeNode): void {
    if (node.hierarchyWarnings.length > 0 && !node.hierarchyReviewed) {
      result.push(node.id);
    }
    for (const child of node.children) walk(child);
  }
  for (const root of nodes) walk(root);
  return result;
}

/** Flatten tree into visible items respecting expanded state, interleaving shadow insertions */
export function flattenVisibleTree(
  nodes: MatchTreeNode[],
  expanded: Set<number>,
  shadowsByRegionId: Map<number, ShadowInsertion[]>,
): FlatTreeItem[] {
  const result: FlatTreeItem[] = [];
  function walk(node: MatchTreeNode, depth: number, ancestorIsMatched: boolean): void {
    result.push({ kind: 'node', node, depth, ancestorIsMatched });
    if (expanded.has(node.id)) {
      const nodeIsMatched = node.matchStatus === 'auto_matched' || node.matchStatus === 'manual_matched';
      const childAncestorMatched = ancestorIsMatched || nodeIsMatched || node.memberCount > 0;
      for (const child of node.children) {
        walk(child, depth + 1, childAncestorMatched);
      }
      // Append shadow insertions after expanded children
      const shadows = shadowsByRegionId.get(node.id);
      if (shadows) {
        for (const shadow of shadows) {
          result.push({ kind: 'shadow', shadow, depth: depth + 1 });
        }
      }
    }
  }
  for (const root of nodes) walk(root, 0, false);
  return result;
}
