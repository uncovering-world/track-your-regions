/**
 * A region's members, from the rows their queries answer to the shape the
 * answer declares (`RegionMember` in `api/responses/regions.ts`, ADR-0066).
 *
 * A member is one of two things, and each has its own mapper: a subregion
 * carries its colour, a division its member row and whether it is a cut part.
 * Each writes the keys its variant has and leaves the other's absent, which is
 * what the schema's refinement holds.
 */

import type { RegionMember } from '../../api/responses/regions.js';
import type { AdministrativeDivisionsRow, RegionMembersRow, RegionsRow } from '../../db/schema.generated.js';

export type SubregionMemberRow = Pick<RegionsRow, 'id' | 'name' | 'color'>;

export function subregionMemberOf(row: SubregionMemberRow): RegionMember {
  return {
    id: row.id,
    name: row.name,
    hasChildren: false,
    memberType: 'subregion',
    isSubregion: true,
    color: row.color,
    path: row.name,
  };
}

/**
 * A division member, after the walk up GADM that builds its path. Its `name` is
 * the member's custom name where it has one, and the division's otherwise.
 */
export type DivisionMemberRow = Pick<AdministrativeDivisionsRow, 'id' | 'name' | 'has_children'> & {
  member_row_id: RegionMembersRow['id'];
  path: string;
  has_custom_geom: boolean;
};

export function divisionMemberOf(row: DivisionMemberRow): RegionMember {
  return {
    id: row.id,
    memberRowId: row.member_row_id,
    name: row.name,
    hasChildren: row.has_children,
    memberType: 'division',
    isSubregion: false,
    path: row.path,
    hasCustomGeometry: row.has_custom_geom,
  };
}
