import { describe, it, expect } from 'vitest';
import {
  deriveUnitStatus,
  groupUnitsByContinent,
  groupUnitsByAncestorPath,
  findDuplicateSourceUrls,
  collectSkeletonCandidates,
  type UnitStatus,
} from './dashboardUtils';
import type { DashboardUnit } from '../../../api/admin/wvImportWorkflow';
import type { MatchTreeNode } from '../../../api/admin/worldViewImport';

function unit(over: Partial<DashboardUnit>): DashboardUnit {
  return {
    regionId: 1, name: 'X', continent: 'Europe', ancestorPath: [],
    signoffStatus: 'not_started',
    signedOffAt: null, hierarchyConfirmed: false, hasReference: true,
    referenceDivisionIds: [1], sourceUrl: null, leafTotal: 1, leafResolved: 0,
    warningCount: 0, ...over,
  };
}

describe('deriveUnitStatus', () => {
  it.each<[Partial<DashboardUnit>, UnitStatus]>([
    [{ signoffStatus: 'not_started' }, 'not_started'],
    [{ signoffStatus: 'in_progress' }, 'in_progress'],
    [{ signoffStatus: 'signed_off', signedOffAt: '2026-06-11T00:00:00Z' }, 'signed_off'],
    [{ signoffStatus: 'in_progress', signedOffAt: '2026-06-11T00:00:00Z' }, 'stale'],
  ])('%o → %s', (over, expected) => {
    expect(deriveUnitStatus(unit(over))).toBe(expected);
  });
});

describe('groupUnitsByContinent', () => {
  it('groups and sorts continents alphabetically, null last as "Ungrouped"', () => {
    const groups = groupUnitsByContinent([
      unit({ regionId: 1, continent: 'Europe', name: 'B' }),
      unit({ regionId: 2, continent: null, name: 'C' }),
      unit({ regionId: 3, continent: 'Africa', name: 'A' }),
    ]);
    expect(groups.map(g => g.continent)).toEqual(['Africa', 'Europe', 'Ungrouped']);
  });

  it('sorts units in a group by name', () => {
    const groups = groupUnitsByContinent([
      unit({ regionId: 1, name: 'Zambia', continent: 'Africa' }),
      unit({ regionId: 2, name: 'Algeria', continent: 'Africa' }),
    ]);
    expect(groups[0].units.map(u => u.name)).toEqual(['Algeria', 'Zambia']);
  });
});

describe('groupUnitsByAncestorPath', () => {
  it('uses joined ancestorPath as label for units with a non-empty path', () => {
    const groups = groupUnitsByAncestorPath([
      unit({ regionId: 1, name: 'Senegal', ancestorPath: ['Africa', 'West Africa'], continent: 'Africa' }),
      unit({ regionId: 2, name: 'Ghana', ancestorPath: ['Africa', 'West Africa'], continent: 'Africa' }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].label).toBe('Africa › West Africa');
    expect(groups[0].units.map(u => u.name)).toEqual(['Ghana', 'Senegal']);
  });

  it('falls back to continent then Ungrouped when ancestorPath is empty', () => {
    const groups = groupUnitsByAncestorPath([
      unit({ regionId: 1, name: 'Asia-root', ancestorPath: [], continent: 'Asia' }),
      unit({ regionId: 2, name: 'Mystery', ancestorPath: [], continent: null }),
    ]);
    const labels = groups.map(g => g.label);
    expect(labels).toContain('Asia');
    expect(labels).toContain('Ungrouped');
  });

  it('sorts groups alphabetically with Ungrouped last', () => {
    const groups = groupUnitsByAncestorPath([
      unit({ regionId: 1, name: 'X', ancestorPath: [], continent: null }),
      unit({ regionId: 2, name: 'Y', ancestorPath: ['Africa', 'West Africa'], continent: 'Africa' }),
      unit({ regionId: 3, name: 'Z', ancestorPath: ['Africa', 'Central Africa'], continent: 'Africa' }),
    ]);
    const labels = groups.map(g => g.label);
    expect(labels).toEqual(['Africa › Central Africa', 'Africa › West Africa', 'Ungrouped']);
  });
});

describe('findDuplicateSourceUrls', () => {
  it('returns the set of sourceUrls appearing on 2+ units', () => {
    const dupes = findDuplicateSourceUrls([
      unit({ regionId: 1, sourceUrl: 'wv/Russia' }),
      unit({ regionId: 2, sourceUrl: 'wv/Russia' }),
      unit({ regionId: 3, sourceUrl: 'wv/France' }),
      unit({ regionId: 4, sourceUrl: null }),
    ]);
    expect(dupes.has('wv/Russia')).toBe(true);
    expect(dupes.has('wv/France')).toBe(false);
  });
});

describe('collectSkeletonCandidates', () => {
  const leaf = (id: number, name: string, matchStatus: string | null, isWorkUnit = false): MatchTreeNode =>
    ({ id, name, matchStatus, isWorkUnit, children: [] } as unknown as MatchTreeNode);

  it('returns unresolved non-unit nodes that are not inside any work unit', () => {
    const tree: MatchTreeNode[] = [
      {
        ...leaf(1, 'Europe', null),
        children: [
          { ...leaf(2, 'France', 'needs_review') },               // candidate
          { ...leaf(3, 'Germany', 'children_matched', true),      // unit: its subtree excluded
            children: [leaf(4, 'Bavaria', 'no_candidates')] },
        ],
      } as unknown as MatchTreeNode,
    ];
    const ids = collectSkeletonCandidates(tree).map(c => c.id);
    expect(ids).toContain(2);
    expect(ids).not.toContain(3);
    expect(ids).not.toContain(4);
    expect(ids).not.toContain(1); // container without unresolved status is not a candidate
  });
});
