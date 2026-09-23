/**
 * A region's geometry reads, from the rows their queries answer to the shapes
 * the answers declare (`api/responses/regions.ts`, ADR-0066): its own outline
 * or hull, and its members' and its descendants' members' outlines for the
 * editor. Each mapper writes the keys its schema names and nothing else a query
 * selects.
 */

import type { MultiPolygon } from '../../api/responses/experiences.js';
import type {
  AreaGeometry, DescendantMemberGeometry, MemberGeometry, RegionGeometry,
} from '../../api/responses/regions.js';
import type { AdministrativeDivisionsRow, RegionMembersRow, RegionsRow } from '../../db/schema.generated.js';

/** The region's own read: its outline, and its hull where the hull was asked for. */
export type RegionGeometryRow = Pick<RegionsRow, 'is_custom_boundary' | 'uses_hull'> & {
  geometry: MultiPolygon;
  hull_geometry: MultiPolygon | null;
  /** Null while the region has no focus frame. */
  crosses_dateline: boolean | null;
  anchor_lng: number | null;
  anchor_lat: number | null;
};

export function regionGeometryOf(id: number, row: RegionGeometryRow, wantsHull: boolean): RegionGeometry {
  const hull = wantsHull ? row.hull_geometry : null;
  // Asked for the hull: which one came back, `real` where the region has none.
  let displayMode: RegionGeometry['properties']['displayMode'];
  if (wantsHull) displayMode = hull ? 'hull' : 'real';
  return {
    type: 'Feature',
    properties: {
      id,
      isCustomBoundary: row.is_custom_boundary ?? false,
      usesHull: row.uses_hull ?? false,
      anchorPoint: row.anchor_lng !== null && row.anchor_lat !== null ? [row.anchor_lng, row.anchor_lat] : null,
      displayMode,
      crossesDateline: hull ? row.crosses_dateline === true : undefined,
    },
    geometry: hull ?? row.geometry,
  };
}

/** One division member, drawn: its outline, simplified. */
export type MemberGeometryRow = {
  member_row_id: RegionMembersRow['id'];
  division_id: AdministrativeDivisionsRow['id'];
  name: string;
  geometry: AreaGeometry | null;
  has_custom_geom: boolean;
};

/** A member whose outline simplified to nothing is left out. */
export function hasGeometry<T extends { geometry: AreaGeometry | null }>(row: T): row is T & { geometry: AreaGeometry } {
  return row.geometry !== null;
}

export function memberGeometryOf(row: MemberGeometryRow & { geometry: AreaGeometry }): MemberGeometry {
  return {
    type: 'Feature',
    properties: {
      memberRowId: row.member_row_id,
      divisionId: row.division_id,
      name: row.name,
      hasCustomGeom: row.has_custom_geom,
    },
    geometry: row.geometry,
  };
}

/** One division member of a descendant region, drawn. */
export type DescendantMemberGeometryRow = MemberGeometryRow & {
  region_name: RegionsRow['name'];
  region_id: RegionsRow['id'];
  root_ancestor_id: RegionsRow['id'];
};

export function descendantMemberGeometryOf(
  row: DescendantMemberGeometryRow & { geometry: AreaGeometry },
): DescendantMemberGeometry {
  return {
    type: 'Feature',
    properties: {
      memberRowId: row.member_row_id,
      divisionId: row.division_id,
      name: row.name,
      regionName: row.region_name,
      regionId: row.region_id,
      rootAncestorId: row.root_ancestor_id,
      hasCustomGeom: row.has_custom_geom,
    },
    geometry: row.geometry,
  };
}
