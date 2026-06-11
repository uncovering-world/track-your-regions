/**
 * Workspace derivation utilities (pure functions, no side effects).
 *
 * Responsibilities:
 * - findSubtree:     Locate a node in the match tree by ID.
 * - flattenSubtree:  Produce the visible (expanded) row list for virtualization.
 * - childColorMap:   Stable color per direct child for map rendering.
 * - deriveStage:     Compute the current workflow stage for a work unit.
 *
 * Color palette: 12 visually distinct MUI-ish hexes (avoid pure primaries
 * that clash with MUI's default blue/green; chosen for contrast on map fills).
 */
import type { MatchTreeNode } from '../../../api/admin/worldViewImport';
import type { VerifyResult } from '../../../api/admin/wvImportWorkflow';

// ─── Palette ──────────────────────────────────────────────────────────────────

/** 12 visually distinct hexes for child-region coloring on the workspace map. */
export const CHILD_PALETTE: string[] = [
  '#3182CE', // blue
  '#38A169', // green
  '#805AD5', // purple
  '#D69E2E', // yellow-amber
  '#E53E3E', // red
  '#00B5D8', // teal
  '#DD6B20', // orange
  '#D53F8C', // pink
  '#2C7A7B', // teal-dark
  '#553C9A', // indigo
  '#B7791F', // brown-gold
  '#285E61', // forest-green
];

// ─── Types ────────────────────────────────────────────────────────────────────

export type WorkspaceStage = 'hierarchy' | 'assignment' | 'verification' | 'done';

export interface FlatRow {
  node: MatchTreeNode;
  depth: number;
}

// ─── findSubtree ─────────────────────────────────────────────────────────────

/**
 * Recursively find the node with the given ID in the flat array of root nodes.
 * Returns the node if found, null otherwise.
 */
export function findSubtree(
  nodes: MatchTreeNode[],
  regionId: number,
): MatchTreeNode | null {
  for (const node of nodes) {
    if (node.id === regionId) return node;
    if (node.children.length > 0) {
      const found = findSubtree(node.children, regionId);
      if (found) return found;
    }
  }
  return null;
}

// ─── flattenSubtree ───────────────────────────────────────────────────────────

/**
 * Flatten a subtree rooted at `root` into an ordered list of visible rows.
 *
 * The root is always included.
 * Children of a node are included only when the node's id is in `expandedIds`.
 * Depth starts at 0 for the root.
 */
export function flattenSubtree(
  root: MatchTreeNode,
  expandedIds: Set<number>,
): FlatRow[] {
  const rows: FlatRow[] = [];
  function walk(node: MatchTreeNode, depth: number): void {
    rows.push({ node, depth });
    if (node.children.length > 0 && expandedIds.has(node.id)) {
      for (const child of node.children) {
        walk(child, depth + 1);
      }
    }
  }
  walk(root, 0);
  return rows;
}

// ─── childColorMap ────────────────────────────────────────────────────────────

/**
 * Return a Map from direct child ID → hex color string.
 * Colors are assigned in declaration order from CHILD_PALETTE, cycling for > 12 children.
 * Grandchildren are not included.
 */
export function childColorMap(root: MatchTreeNode): Map<number, string> {
  const map = new Map<number, string>();
  root.children.forEach((child, i) => {
    map.set(child.id, CHILD_PALETTE[i % CHILD_PALETTE.length]);
  });
  return map;
}

// ─── deriveStage ─────────────────────────────────────────────────────────────

/**
 * Derive the current workflow stage for a work unit.
 *
 * Stage rules (evaluated in priority order):
 * 1. done        → unit.signoffStatus === 'signed_off'
 * 2. hierarchy   → unit.hierarchyConfirmed === false
 * 3. assignment  → any leaf in the subtree is unresolved (matchStatus is
 *                  'no_candidates' or 'needs_review' AND memberCount === 0)
 *                  AND the leaf is not assignmentWaived
 * 4. verification → hierarchy confirmed, leaves resolved, but verify has
 *                  blockers OR verify is null (checks not yet run)
 * 5. done        → (unreachable via logic, always caught by rule 1)
 */
export function deriveStage(
  unit: MatchTreeNode,
  verify: VerifyResult | null,
): WorkspaceStage {
  // Rule 1: already signed off
  if (unit.signoffStatus === 'signed_off') return 'done';

  // Rule 2: hierarchy not confirmed
  if (!unit.hierarchyConfirmed) return 'hierarchy';

  // Rule 3: count unresolved leaves
  const unresolved = countUnresolvedLeaves(unit);
  if (unresolved > 0) return 'assignment';

  // Rule 4: checks not run or blockers present
  if (verify === null || verify.blockers.length > 0) return 'verification';

  // All rules pass (checks clean, hierarchy confirmed, leaves resolved, not signed off yet)
  return 'verification';
}

/** Count leaves that are unresolved (no members, not waived). */
function countUnresolvedLeaves(node: MatchTreeNode): number {
  if (node.isLeaf || node.children.length === 0) {
    // Treat this node as a leaf for counting purposes
    if (node.assignmentWaived) return 0;
    const unmatched = node.matchStatus === 'no_candidates' || node.matchStatus === 'needs_review';
    return unmatched && node.memberCount === 0 ? 1 : 0;
  }
  let total = 0;
  for (const child of node.children) {
    total += countUnresolvedLeaves(child);
  }
  return total;
}
