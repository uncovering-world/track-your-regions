/**
 * Pure derivations for the import workflow dashboard.
 * Status semantics: spec § "Status transitions & staleness" —
 * in_progress + non-null signedOffAt = "modified after sign-off" (stale).
 */
import type { DashboardUnit } from '../../../api/admin/wvImportWorkflow';
import type { MatchTreeNode } from '../../../api/admin/worldViewImport';

export type UnitStatus = 'not_started' | 'in_progress' | 'signed_off' | 'stale';

export function deriveUnitStatus(u: DashboardUnit): UnitStatus {
  if (u.signoffStatus === 'signed_off') return 'signed_off';
  if (u.signoffStatus === 'in_progress' && u.signedOffAt != null) return 'stale';
  return u.signoffStatus;
}

export interface ContinentGroup {
  continent: string;
  units: DashboardUnit[];
}

export function groupUnitsByContinent(units: DashboardUnit[]): ContinentGroup[] {
  const byContinent = new Map<string, DashboardUnit[]>();
  for (const u of units) {
    const key = u.continent ?? 'Ungrouped';
    const list = byContinent.get(key) ?? [];
    list.push(u);
    byContinent.set(key, list);
  }
  return [...byContinent.entries()]
    .sort(([a], [b]) => {
      if (a === 'Ungrouped') return 1;
      if (b === 'Ungrouped') return -1;
      return a.localeCompare(b);
    })
    .map(([continent, list]) => ({
      continent,
      units: [...list].sort((a, b) => a.name.localeCompare(b.name)),
    }));
}

export interface AncestorPathGroup {
  label: string;
  units: DashboardUnit[];
}

/**
 * Groups units by their full ancestor path label (`ancestorPath.join(' › ')`).
 * Falls back to `continent ?? 'Ungrouped'` when `ancestorPath` is empty.
 * Groups are sorted alphabetically by label with 'Ungrouped' last.
 * Units within each group are sorted by name.
 */
export function groupUnitsByAncestorPath(units: DashboardUnit[]): AncestorPathGroup[] {
  const byLabel = new Map<string, DashboardUnit[]>();
  for (const u of units) {
    const label = u.ancestorPath.length > 0
      ? u.ancestorPath.join(' › ')
      : (u.continent ?? 'Ungrouped');
    const list = byLabel.get(label) ?? [];
    list.push(u);
    byLabel.set(label, list);
  }
  return [...byLabel.entries()]
    .sort(([a], [b]) => {
      if (a === 'Ungrouped') return 1;
      if (b === 'Ungrouped') return -1;
      return a.localeCompare(b);
    })
    .map(([label, list]) => ({
      label,
      units: [...list].sort((a, b) => a.name.localeCompare(b.name)),
    }));
}

export function findDuplicateSourceUrls(units: DashboardUnit[]): Set<string> {
  const counts = new Map<string, number>();
  for (const u of units) {
    if (u.sourceUrl) counts.set(u.sourceUrl, (counts.get(u.sourceUrl) ?? 0) + 1);
  }
  return new Set([...counts.entries()].filter(([, n]) => n > 1).map(([url]) => url));
}

export interface SkeletonCandidate {
  id: number;
  name: string;
  matchStatus: string | null;
}

/** Shared walker: collect unresolved (needs_review / no_candidates) non-unit nodes. */
function walkUnresolved<T extends { id: number; name: string; isWorkUnit: boolean; matchStatus: string | null; children: T[] }>(
  nodes: T[],
  out: SkeletonCandidate[],
): void {
  for (const n of nodes) {
    if (n.isWorkUnit) continue; // unit boundary — its subtree is country-loop scope
    if (n.matchStatus === 'needs_review' || n.matchStatus === 'no_candidates') {
      out.push({ id: n.id, name: n.name, matchStatus: n.matchStatus });
    }
    walkUnresolved(n.children, out);
  }
}

// =============================================================================
// Skeleton forest
// =============================================================================

export interface SkeletonNode {
  id: number;
  name: string;
  isWorkUnit: boolean;
  matchStatus: string | null;
  /** Number of direct and indirect work-unit descendants. */
  childUnits: number;
  /** True when the node has at least one child node in the skeleton forest. */
  hasChildren: boolean;
  /** Number of GADM division members directly assigned to this region. */
  memberCount: number;
  /** Child nodes — empty for work-unit leaves (subtrees are pruned). */
  children: SkeletonNode[];
}

/**
 * Builds a pruned view of the match tree for the Skeleton tab.
 *
 * Rules:
 * - Work-unit (`isWorkUnit`) nodes become leaves — their subtrees are dropped.
 * - Non-unit nodes with no remaining children that are unresolved
 *   (needs_review / no_candidates) are kept as-is (they are worklist items).
 * - Each container node carries a `childUnits` count (recursive sum).
 */
export function buildSkeletonForest(tree: MatchTreeNode[]): SkeletonNode[] {
  const buildNode = (n: MatchTreeNode): SkeletonNode => {
    if (n.isWorkUnit) {
      // Unit boundary — becomes a leaf, subtree dropped
      return {
        id: n.id, name: n.name, isWorkUnit: true, matchStatus: n.matchStatus,
        childUnits: 0, hasChildren: false, memberCount: n.memberCount, children: [],
      };
    }
    const children = n.children.map(buildNode);
    const childUnits = children.reduce(
      (sum, c) => sum + (c.isWorkUnit ? 1 : 0) + c.childUnits,
      0,
    );
    return {
      id: n.id, name: n.name, isWorkUnit: false, matchStatus: n.matchStatus,
      childUnits, hasChildren: n.children.length > 0, memberCount: n.memberCount, children,
    };
  };
  return tree.map(buildNode);
}

/**
 * Collects unresolved non-unit nodes from the skeleton forest
 * (the worklist sourced from the pruned forest).
 */
export function collectForestCandidates(forest: SkeletonNode[]): SkeletonCandidate[] {
  const out: SkeletonCandidate[] = [];
  walkUnresolved(forest, out);
  return out;
}
