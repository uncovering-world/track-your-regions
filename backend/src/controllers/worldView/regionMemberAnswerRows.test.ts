import { describe, expect, it } from 'vitest';
import { RegionMember, RegionMembers } from '../../api/responses/regions.js';
import { divisionMemberOf, subregionMemberOf } from './regionMemberAnswerRows.js';

/**
 * Two members of Europe: Albania, a subregion, and the part of Russia west of
 * the Urals, cut from GADM's Russia (304677), since the rest of it lies in Asia.
 */
const ALBANIA = subregionMemberOf({ id: 6738, name: 'Albania', color: null });
const RUSSIA_WEST = divisionMemberOf({
  id: 304677, member_row_id: 11402, name: 'Russia (west of the Urals)', has_children: true,
  path: 'Europe > Russia (west of the Urals)', has_custom_geom: true,
});

describe('the member mappers', () => {
  it('answer both kinds of member in one list the schema accepts', () => {
    expect(RegionMembers.safeParse([ALBANIA, RUSSIA_WEST]).success).toBe(true);
  });

  it('give a subregion its colour and no member row', () => {
    expect(ALBANIA).toMatchObject({ memberType: 'subregion', isSubregion: true, color: null, path: 'Albania' });
    expect(ALBANIA).not.toHaveProperty('memberRowId');
    expect(ALBANIA).not.toHaveProperty('hasCustomGeometry');
  });

  it('give a division its member row and whether it is a cut part, and no colour', () => {
    expect(RUSSIA_WEST).toMatchObject({ memberType: 'division', isSubregion: false, memberRowId: 11402, hasCustomGeometry: true });
    expect(RUSSIA_WEST).not.toHaveProperty('color');
  });
});

describe('RegionMember', () => {
  it.each([
    ['a subregion carrying a member row', { ...ALBANIA, memberRowId: 1 }, 'memberRowId'],
    ['a division carrying a colour', { ...RUSSIA_WEST, color: '#3388ff' }, 'color'],
    ['a division without its member row', { ...RUSSIA_WEST, memberRowId: undefined }, 'memberRowId'],
    ['a flag that contradicts the type', { ...RUSSIA_WEST, isSubregion: true }, 'isSubregion'],
  ])('refuses %s', (_label, member, path) => {
    const parsed = RegionMember.safeParse(member);
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues.map((issue) => issue.path.join('.'))).toContain(path);
  });
});
