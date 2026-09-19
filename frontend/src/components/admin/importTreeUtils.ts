import type { MatchTreeNode } from '../../api/admin/worldViewImport';
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

/** The node with this id, wherever it sits, or `null` when the tree has none. */
export function findNodeById(nodes: MatchTreeNode[], regionId: number): MatchTreeNode | null {
  for (const n of nodes) {
    if (n.id === regionId) return n;
    const found = findNodeById(n.children, regionId);
    if (found) return found;
  }
  return null;
}

/** The name of the node with this id, or `''` when the tree does not hold it. */
export function findNodeName(nodes: MatchTreeNode[], regionId: number): string {
  return findNodeById(nodes, regionId)?.name ?? '';
}

/**
 * Which source URLs more than one node carries, and which of those the nodes
 * agree about — same match status and the same set of divisions — so a row can
 * say "duplicate" and "already synced" apart.
 */
export function duplicateSourceUrls(nodes: MatchTreeNode[]): {
  duplicateUrls: Set<string>; syncedUrls: Set<string>;
} {
  const urlNodes = new Map<string, MatchTreeNode[]>();
  function walk(level: MatchTreeNode[]) {
    for (const node of level) {
      if (node.sourceUrl) {
        const existing = urlNodes.get(node.sourceUrl);
        if (existing) existing.push(node);
        else urlNodes.set(node.sourceUrl, [node]);
      }
      walk(node.children);
    }
  }
  walk(nodes);
  const duplicateUrls = new Set<string>();
  const syncedUrls = new Set<string>();
  for (const [url, carriers] of urlNodes) {
    if (carriers.length > 1) {
      duplicateUrls.add(url);
      const refStatus = carriers[0].matchStatus;
      const refDivs = carriers[0].assignedDivisions.map(d => d.divisionId).sort((a, b) => a - b).join(',');
      const allSame = carriers.every(n =>
        n.matchStatus === refStatus &&
        n.assignedDivisions.map(d => d.divisionId).sort((a, b) => a - b).join(',') === refDivs,
      );
      if (allSame) syncedUrls.add(url);
    }
  }
  return { duplicateUrls, syncedUrls };
}

/**
 * Each node's *direct* parent's region map and its name, for the preview to
 * fall back on. Only the parent's own map is passed down — an inherited
 * ancestor map is not this node's fallback.
 */
export function parentRegionMaps(nodes: MatchTreeNode[]): {
  urlById: Map<number, string>; nameById: Map<number, string>;
} {
  const urlById = new Map<number, string>();
  const nameById = new Map<number, string>();
  function walk(level: MatchTreeNode[], parentMapUrl: string | null, parentMapName: string | null) {
    for (const node of level) {
      if (parentMapUrl) urlById.set(node.id, parentMapUrl);
      if (parentMapName) nameById.set(node.id, parentMapName);
      walk(node.children, node.regionMapUrl ?? null, node.regionMapUrl ? node.name : null);
    }
  }
  walk(nodes, null, null);
  return { urlById, nameById };
}
