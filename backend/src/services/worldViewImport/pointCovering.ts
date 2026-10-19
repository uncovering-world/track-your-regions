/**
 * Which of the GADM divisions holding a region's marker points Point Match
 * offers (`pointMatcher.ts`). Neither rule offers a division beside its own
 * descendant (#1623).
 */

export interface CandidateDivision {
  id: number;
  name: string;
  parentId: number | null;
  /** Below the scope's divisions when a scope is searched, below the GADM root otherwise. */
  gadmDepth: number;
  path: string;
}

/** A division that holds one point, with the GADM root it sits under (null when a scope was searched). */
export interface PointDivision extends CandidateDivision {
  rootId: number | null;
}

/**
 * With a matched ancestor: the shallowest divisions under the scope that hold
 * a point, each dropped when an ancestor of it is already in the set.
 */
export function buildCoveringSet(
  pointDivisionMap: Map<number, CandidateDivision>,
  scopeRootIds: Set<number>,
  siblingDivisionIds: Set<number>,
): CandidateDivision[] {
  const sortedCandidates = [...pointDivisionMap.values()]
    .filter(c => !scopeRootIds.has(c.id) && !siblingDivisionIds.has(c.id))
    .sort((a, b) => a.gadmDepth - b.gadmDepth);

  const selectedIds = new Set<number>();
  const coveringSet: CandidateDivision[] = [];

  for (const candidate of sortedCandidates) {
    let ancestorSelected = false;
    let walkId: number | null = candidate.parentId;
    while (walkId != null) {
      if (selectedIds.has(walkId)) {
        ancestorSelected = true;
        break;
      }
      const parent = pointDivisionMap.get(walkId);
      walkId = parent?.parentId ?? null;
      if (!parent) break;
    }
    if (!ancestorSelected) {
      selectedIds.add(candidate.id);
      coveringSet.push(candidate);
    }
  }
  return coveringSet;
}

/**
 * With no matched ancestor: the deepest division that holds every point, one
 * for the points under each GADM root. Unscoped, every division holding a
 * point is a candidate down from the continent, so the shallowest would be
 * Africa for a point in Cairo. The deepest common one is the region's own
 * division where the region is one, and a division inside it where its points
 * cluster. The children that hold a point, which the geoshape matcher's
 * drill-down would offer, split a leaf that is one division into pieces.
 *
 * Each point's list holds the ancestors of every division holding it, as the
 * unscoped query answers it. The point is counted under the root of its
 * deepest division only, so that root is common to all of the group's points
 * and the deepest common division always exists.
 */
export function deepestCommonDivisions(pointHits: PointDivision[][]): CandidateDivision[] {
  const groups = new Map<number, PointDivision[][]>();
  for (const hits of pointHits) {
    if (hits.length === 0) continue;
    const deepest = hits.reduce((a, b) => (b.gadmDepth > a.gadmDepth ? b : a));
    const root = deepest.rootId ?? deepest.id;
    // A point stands under one root: where simplified continent outlines
    // overlap, its divisions under another root are not counted for it.
    const underRoot = hits.filter(d => (d.rootId ?? d.id) === root);
    groups.set(root, [...(groups.get(root) ?? []), underRoot]);
  }

  const offered: CandidateDivision[] = [];
  for (const group of groups.values()) {
    const held = new Map<number, { division: PointDivision; points: number }>();
    for (const hits of group) {
      for (const division of hits) {
        const entry = held.get(division.id) ?? { division, points: 0 };
        entry.points += 1;
        held.set(division.id, entry);
      }
    }
    const common = [...held.values()].filter(entry => entry.points === group.length);
    if (common.length === 0) continue;
    const best = common.reduce((a, b) => {
      if (b.division.gadmDepth !== a.division.gadmDepth) return b.division.gadmDepth > a.division.gadmDepth ? b : a;
      return b.division.id < a.division.id ? b : a;
    });
    const { id, name, parentId, gadmDepth, path } = best.division;
    offered.push({ id, name, parentId, gadmDepth, path });
  }
  return offered;
}
