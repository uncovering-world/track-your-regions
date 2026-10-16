import { afterEach, describe, expect, it } from 'vitest';
import type { RegionMember } from '../../../../../api/regions';
import { carriedGroups, forgetLegacyGroups, groupsBodyOf, groupsFromDb, legacyGroups, unassignedAmong } from './groupsStorage';
import { STORAGE_KEY_PREFIX } from './overlayStorage';

const member = (memberRowId: number, name: string): RegionMember => ({
  id: memberRowId + 1000, memberRowId, name, hasChildren: false, memberType: 'division', isSubregion: false,
  path: `Europe > Belgium > ${name}`, hasCustomGeometry: false,
});
const ANTWERP = member(1, 'Antwerp');
const LIMBURG = member(2, 'Limburg');
const NAMUR = member(3, 'Namur');

afterEach(() => localStorage.clear());

describe('the groups, between the dialog and the database (#595)', () => {
  it('reads each member back by its row, leaving out a row the region no longer holds', () => {
    const groups = groupsFromDb({ groups: [
      { name: 'Flanders', color: '#e41a1c', existingRegionId: 9322, memberRowIds: [1, 2, 99] },
      { name: 'Wallonia', color: null, existingRegionId: null, memberRowIds: [] },
    ] }, [ANTWERP, LIMBURG, NAMUR]);
    expect(groups).toEqual([
      { name: 'Flanders', color: '#e41a1c', existingRegionId: 9322, members: [ANTWERP, LIMBURG] },
      { name: 'Wallonia', members: [] },
    ]);
    expect(unassignedAmong([ANTWERP, LIMBURG, NAMUR], groups)).toEqual([NAMUR]);
  });

  it('sends the groups in their order, each member by its row', () => {
    expect(groupsBodyOf([
      { name: 'Flanders', members: [ANTWERP, LIMBURG], existingRegionId: 9322, color: '#e41a1c' },
      { name: '  ', members: [NAMUR] },
    ])).toEqual({ groups: [
      { name: 'Flanders', color: '#e41a1c', existingRegionId: 9322, memberRowIds: [1, 2] },
      { name: 'Unnamed group', color: null, existingRegionId: null, memberRowIds: [3] },
    ] });
  });
});

describe('groups an earlier session kept in this browser (#595)', () => {
  const key = `${STORAGE_KEY_PREFIX}9321`;

  it('are found, then forgotten there with the members they left, the rest of the entry kept', () => {
    localStorage.setItem(key, JSON.stringify({
      activeTab: 1, unassignedDivisions: [NAMUR], subdivisionGroups: [{ name: 'Flanders', members: [ANTWERP] }],
    }));
    expect(legacyGroups(9321)).toEqual([{ name: 'Flanders', members: [ANTWERP] }]);
    forgetLegacyGroups(9321);
    expect(JSON.parse(localStorage.getItem(key)!)).toEqual({ activeTab: 1 });
    expect(legacyGroups(9321)).toBeNull();
  });

  it('are carried forward as they are by a rewrite of the entry, until forgotten', () => {
    localStorage.setItem(key, JSON.stringify({ unassignedDivisions: [NAMUR], subdivisionGroups: [{ name: 'Flanders', members: [ANTWERP] }] }));
    // The dialog's one-second auto-save rewrites the entry with what it carries over.
    localStorage.setItem(key, JSON.stringify({ ...carriedGroups(9321), activeTab: 2 }));
    expect(legacyGroups(9321)).toEqual([{ name: 'Flanders', members: [ANTWERP] }]);
    forgetLegacyGroups(9321);
    expect(carriedGroups(9321)).toEqual({});
  });

  it('are none where the browser kept none, or kept an empty list', () => {
    expect(legacyGroups(9321)).toBeNull();
    localStorage.setItem(key, JSON.stringify({ subdivisionGroups: [] }));
    expect(legacyGroups(9321)).toBeNull();
  });
});
