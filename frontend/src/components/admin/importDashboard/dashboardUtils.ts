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

/**
 * Nodes the skeleton pass must resolve: unresolved (needs_review /
 * no_candidates) non-unit nodes OUTSIDE every work unit's subtree.
 * Work-unit subtrees are the country loop's responsibility.
 */
export function collectSkeletonCandidates(tree: MatchTreeNode[]): SkeletonCandidate[] {
  const out: SkeletonCandidate[] = [];
  const walk = (nodes: MatchTreeNode[]): void => {
    for (const n of nodes) {
      if (n.isWorkUnit) continue; // unit boundary — its subtree is country-loop scope
      if (n.matchStatus === 'needs_review' || n.matchStatus === 'no_candidates') {
        out.push({ id: n.id, name: n.name, matchStatus: n.matchStatus });
      }
      walk(n.children);
    }
  };
  walk(tree);
  return out;
}
