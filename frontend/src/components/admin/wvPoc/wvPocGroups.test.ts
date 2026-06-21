import { describe, it, expect } from 'vitest';
import {
  buildInitialGroups,
  createCustomGroup,
  assignToGroup,
  removeFromGroup,
  groupMemberIds,
  overlappingRegionIds,
  transcontinentalSplits,
  groupMembersView,
} from './wvPocGroups';
import type { DashboardUnit } from '../../../api/admin/wvImportWorkflow';

function unit(over: Partial<DashboardUnit>): DashboardUnit {
  return {
    regionId: 1, name: 'X', continent: 'Europe', ancestorPath: ['Europe'],
    signoffStatus: 'not_started', signedOffAt: null, hierarchyConfirmed: false,
    hasReference: true, referenceDivisionIds: [1], sourceUrl: null,
    leafTotal: 0, leafResolved: 0, warningCount: 0,
    ...over,
  };
}

const sample: DashboardUnit[] = [
  unit({ regionId: 1, name: 'France', continent: 'Europe' }),
  unit({ regionId: 2, name: 'Russia', continent: 'Europe' }),
  unit({ regionId: 3, name: 'China', continent: 'Asia' }),
];

describe('wvPocGroups', () => {
  it('seeds a continent group per distinct continent with self-membership', () => {
    const s = buildInitialGroups(sample);
    expect(s.groups.map((g) => g.name).sort()).toEqual(['Asia', 'Europe']);
    expect(s.groups.every((g) => g.kind === 'continent')).toBe(true);
    const europe = s.groups.find((g) => g.name === 'Europe')!;
    expect(groupMemberIds(s, europe.id).sort()).toEqual([1, 2]);
  });

  it('creates a custom group, idempotent by slug', () => {
    let s = buildInitialGroups(sample);
    s = createCustomGroup(s, 'Eastern Europe');
    expect(s.groups.some((g) => g.kind === 'custom' && g.name === 'Eastern Europe')).toBe(true);
    const n = s.groups.length;
    s = createCustomGroup(s, 'Eastern Europe');
    expect(s.groups.length).toBe(n);
  });

  it('assigns with overlap — a country stays in its continent and the custom group', () => {
    let s = buildInitialGroups(sample);
    s = createCustomGroup(s, 'Eastern Europe');
    const ee = s.groups.find((g) => g.name === 'Eastern Europe')!;
    s = assignToGroup(s, 2, ee.id);
    expect(s.membership[2]).toContain(ee.id);
    expect(s.membership[2]).toHaveLength(2);
    expect(overlappingRegionIds(s)).toContain(2);
  });

  it('removes a membership', () => {
    let s = buildInitialGroups(sample);
    const europe = s.groups.find((g) => g.name === 'Europe')!;
    s = removeFromGroup(s, 1, europe.id);
    expect(groupMemberIds(s, europe.id)).not.toContain(1);
  });

  it('resolves a transcontinental country into Europe + Asia parts', () => {
    const s = buildInitialGroups(sample);
    const splits = transcontinentalSplits(sample, s);
    const russia = splits.find((t) => t.name === 'Russia');
    expect(russia).toBeTruthy();
    expect(russia!.parts.map((p) => p.label).sort()).toEqual(['Asian Russia', 'European Russia']);
    expect(russia!.parts.find((p) => p.label === 'Asian Russia')!.note).toMatch(/Ural/);
  });

  it('shows the transcontinental part label inside the Asia group view', () => {
    const s = buildInitialGroups(sample);
    const asia = s.groups.find((g) => g.name === 'Asia')!;
    const view = groupMembersView(sample, s, asia.id);
    const ru = view.find((v) => v.regionId === 2);
    expect(ru?.name).toBe('Asian Russia');
    expect(ru?.transcontinental).toBe(true);
    expect(view.some((v) => v.regionId === 3)).toBe(true); // China still a regular member
  });
});
