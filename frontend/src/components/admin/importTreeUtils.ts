import type { MatchTreeNode } from '../../api/adminWorldViewImport';

/**
 * Is a node truly unresolved? NOT blocking when any ancestor is matched
 * (has assigned divisions that cover this node's territory).
 */
export function isUnresolved(node: MatchTreeNode, ancestorIsMatched: boolean): boolean {
  if (ancestorIsMatched) return false;
  if (node.matchStatus === 'needs_review' || node.matchStatus === 'suggested') return true;
  if (node.matchStatus === 'no_candidates') return true;
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

/** Collect IDs of all ancestors on the path to truly unresolved nodes */
export function collectAncestorsOfUnresolved(nodes: MatchTreeNode[], ancestorIsMatched = false): Set<number> {
  const ids = new Set<number>();
  function walk(node: MatchTreeNode, covered: boolean): boolean {
    let hasUnresolved = isUnresolved(node, covered);
    const nodeIsMatched = node.matchStatus === 'auto_matched' || node.matchStatus === 'manual_matched' || node.matchStatus === 'children_matched';
    const childCovered = covered || nodeIsMatched || node.memberCount > 0;
    for (const child of node.children) {
      if (walk(child, childCovered)) hasUnresolved = true;
    }
    if (hasUnresolved && node.children.length > 0) {
      ids.add(node.id);
    }
    return hasUnresolved;
  }
  for (const root of nodes) walk(root, ancestorIsMatched);
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
