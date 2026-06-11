import { describe, it, expect } from 'vitest';
import {
  deriveUnitStatus,
  groupUnitsByContinent,
  groupUnitsByAncestorPath,
  findDuplicateSourceUrls,
  buildSkeletonForest,
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

describe('buildSkeletonForest', () => {
  const mkNode = (
    id: number, name: string, matchStatus: string | null,
    isWorkUnit: boolean, children: MatchTreeNode[] = [], memberCount = 0,
  ): MatchTreeNode =>
    ({ id, name, matchStatus, isWorkUnit, memberCount, children } as unknown as MatchTreeNode);

  it('turns work-unit nodes into leaves — their subtrees are dropped', () => {
    const tree: MatchTreeNode[] = [
      mkNode(1, 'Africa', null, false, [
        mkNode(2, 'West Africa', null, false, [
          mkNode(3, 'Senegal', 'children_matched', true, [
            mkNode(4, 'Ziguinchor', 'auto_matched', false),  // should be dropped
          ]),
        ]),
      ]),
    ];
    const forest = buildSkeletonForest(tree);
    const westAfrica = forest[0].children[0];
    const senegal = westAfrica.children[0];
    // Senegal is a work unit — leaf in forest
    expect(senegal.isWorkUnit).toBe(true);
    expect(senegal.children).toHaveLength(0);
    expect(senegal.hasChildren).toBe(false);
    // Ziguinchor should not appear anywhere
    const allIds = (nodes: typeof forest): number[] =>
      nodes.flatMap(n => [n.id, ...allIds(n.children)]);
    expect(allIds(forest)).not.toContain(4);
    // Containers with children have hasChildren=true
    expect(forest[0].hasChildren).toBe(true);
    expect(westAfrica.hasChildren).toBe(true);
  });

  it('counts childUnits recursively on containers', () => {
    const tree: MatchTreeNode[] = [
      mkNode(1, 'Africa', null, false, [
        mkNode(2, 'West Africa', null, false, [
          mkNode(3, 'Senegal', 'children_matched', true),
          mkNode(4, 'Ghana', 'children_matched', true),
        ]),
        mkNode(5, 'Central Africa', null, false, [
          mkNode(6, 'Congo', 'children_matched', true),
        ]),
      ]),
    ];
    const forest = buildSkeletonForest(tree);
    const africa = forest[0];
    const westAfrica = africa.children[0];
    const centralAfrica = africa.children[1];
    expect(westAfrica.childUnits).toBe(2);
    expect(centralAfrica.childUnits).toBe(1);
    expect(africa.childUnits).toBe(3);
  });

  it('propagates memberCount from source MatchTreeNode onto SkeletonNode', () => {
    const tree: MatchTreeNode[] = [
      mkNode(1, 'Europe', null, false, [
        mkNode(2, 'Chechnya', 'children_matched', true, [], 3),  // work unit with 3 members
        mkNode(3, 'Sub-continent', null, false, [], 5),           // container with 5 members
      ]),
    ];
    const forest = buildSkeletonForest(tree);
    const europe = forest[0];
    const chechnya = europe.children[0];
    const subContinent = europe.children[1];
    expect(chechnya.memberCount).toBe(3);
    expect(subContinent.memberCount).toBe(5);
  });

  it('retains unresolved non-unit leaves (worklist candidates)', () => {
    const tree: MatchTreeNode[] = [
      mkNode(1, 'Africa', null, false, [
        mkNode(2, 'UnknownRegion', 'needs_review', false),
      ]),
    ];
    const forest = buildSkeletonForest(tree);
    const unknown = forest[0].children[0];
    expect(unknown.id).toBe(2);
    expect(unknown.matchStatus).toBe('needs_review');
    expect(unknown.isWorkUnit).toBe(false);
  });
});
