/**
 * Coverage Resolve Utilities
 *
 * Shared types, helper functions, and small sub-components used by
 * the CoverageResolveDialog and its extracted sub-components.
 */

import type { SubtreeNode, CoverageGap } from '../../api/adminWorldViewImport';

/** Flattened node for the gap tree -- either a gap root or a subtree descendant */
export interface TreeNodeInfo {
  divisionId: number;
  name: string;
  isGapRoot: boolean;
  parentName: string | null;
  hasChildren: boolean;
  suggestion: CoverageGap['suggestion'] | null;
}

/** Find a node in a subtree by division ID */
export function findSubtreeNode(nodes: SubtreeNode[], id: number): SubtreeNode | null {
  for (const node of nodes) {
    if (node.id === id) return node;
    const found = findSubtreeNode(node.children, id);
    if (found) return found;
  }
  return null;
}

/** Collect all descendant IDs from a subtree (recursive) */
export function collectSubtreeIds(nodes: SubtreeNode[], out: Set<number>): void {
  for (const node of nodes) {
    out.add(node.id);
    collectSubtreeIds(node.children, out);
  }
}

/** Check if every branch in the subtree is covered (node itself applied, or all its leaves applied) */
export function allLeavesApplied(nodes: SubtreeNode[], applied: Set<number>): boolean {
  for (const node of nodes) {
    if (applied.has(node.id)) continue; // this node is applied -- covers all descendants
    if (node.children.length === 0) return false; // unapplied leaf
    if (!allLeavesApplied(node.children, applied)) return false;
  }
  return nodes.length > 0;
}
