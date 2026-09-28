/**
 * Coverage Resolve Utilities
 *
 * Shared types, helper functions, and small sub-components used by
 * the CoverageResolveDialog and its extracted sub-components.
 */

import type { GapChild, CoverageGap } from '../../api/admin/worldViewImport';

/** Flattened node for the gap tree -- either a gap root or a subtree descendant */
export interface TreeNodeInfo {
  divisionId: number;
  name: string;
  isGapRoot: boolean;
  parentName: string | null;
  hasChildren: boolean;
  suggestion: CoverageGap['suggestion'] | null;
}

/**
 * A GADM division under a gap, as far as its tree has been read. The coverage
 * answer carries one level under each gap, and a deeper level is fetched when
 * the reviewer expands a node (#1030), so `children` is undefined for a node
 * with divisions under it that nobody has expanded yet.
 */
export interface GapTreeNode {
  id: number;
  name: string;
  hasChildren: boolean;
  children?: GapTreeNode[];
  /** Its level was asked for and could not be read; a retry asks again. */
  loadFailed?: boolean;
}

/** The levels of a gap's tree read so far, keyed by the division they lie under. */
export type LoadedGapChildren = ReadonlyMap<number, GapChild[]>;

/**
 * A gap's tree from the level the coverage answer carries and the levels loaded
 * since, marking a node whose level could not be read.
 */
export function gapTree(
  children: GapChild[] | undefined,
  loaded: LoadedGapChildren,
  failed: ReadonlySet<number> = new Set(),
): GapTreeNode[] {
  return (children ?? []).map((child) => {
    const below = loaded.get(child.id);
    if (below !== undefined) return { ...child, children: gapTree(below, loaded, failed) };
    return failed.has(child.id) ? { ...child, loadFailed: true } : { ...child };
  });
}

/** Find a node in a subtree by division ID */
export function findSubtreeNode(nodes: GapTreeNode[], id: number): GapTreeNode | null {
  for (const node of nodes) {
    if (node.id === id) return node;
    const found = findSubtreeNode(node.children ?? [], id);
    if (found) return found;
  }
  return null;
}

/** Collect every descendant ID read so far (recursive) */
export function collectSubtreeIds(nodes: GapTreeNode[], out: Set<number>): void {
  for (const node of nodes) {
    out.add(node.id);
    collectSubtreeIds(node.children ?? [], out);
  }
}

/**
 * Check if every branch in the subtree is covered (node itself applied, or all
 * its leaves applied). A branch never expanded is not covered: nothing under
 * it can have been applied before it was read.
 */
export function allLeavesApplied(nodes: GapTreeNode[], applied: Set<number>): boolean {
  for (const node of nodes) {
    if (applied.has(node.id)) continue; // this node is applied -- covers all descendants
    if (!node.hasChildren || node.children === undefined) return false; // unapplied leaf, or unread branch
    if (!allLeavesApplied(node.children, applied)) return false;
  }
  return nodes.length > 0;
}
