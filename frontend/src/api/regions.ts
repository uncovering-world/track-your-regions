/**
 * Regions API (user-defined regions within a WorldView)
 */

import type {
  ChildDivisionsAdded, DescendantMemberGeometries, DivisionsAdded, DivisionsRemoved, DivisionUsageCounts, MemberGeometries,
  MemberMoved, Region, RegionGeometry, RegionImageOverlay, RegionMembers, Regions, RegionSearchResults, SubregionFlattened,
  SubregionsExpanded,
} from './client.generated';
import {
  deleteWorldViewsRegionsByRegionId, deleteWorldViewsRegionsByRegionIdImageOverlay, deleteWorldViewsRegionsByRegionIdMembers,
  getWorldViewsByWorldViewIdRegions, getWorldViewsRegionsByRegionIdImageOverlay, putWorldViewsRegionsByRegionIdImageOverlay,
  getWorldViewsByWorldViewIdRegionsRoot, getWorldViewsByWorldViewIdRegionsSearch,
  getWorldViewsRegionsByRegionIdAncestors, getWorldViewsRegionsByRegionIdGeometry, getWorldViewsRegionsByRegionIdMembers,
  getWorldViewsRegionsByRegionIdMembersDescendantGeometries, getWorldViewsRegionsByRegionIdMembersGeometries,
  getWorldViewsRegionsByRegionIdSubregions, postWorldViewsByWorldViewIdDivisionUsage, postWorldViewsByWorldViewIdRegions,
  postWorldViewsRegionsByParentRegionIdFlattenBySubregionId, postWorldViewsRegionsByRegionIdExpand,
  postWorldViewsRegionsByRegionIdMembers, postWorldViewsRegionsByRegionIdMembersByDivisionIdAddChildren,
  postWorldViewsRegionsByRegionIdMembersMove, putWorldViewsRegionsByRegionId, putWorldViewsRegionsByRegionIdGeometry,
  type AddChildDivisionsBody, type AddDivisionsToRegionBody, type CreateRegionBody, type RegionImageOverlayBody,
  type UpdateRegionBody,
} from './client.generated';

// What every call here answers is declared once, as a backend schema (ADR-0066),
// and generated into `client.generated.ts`. Passed on from here, so a component
// imports a call's answer from the module of the call. `Region` itself is the
// one exception: the client holds a region in the looser shape `types/index.ts`
// derives from it, since a selection made on the map starts from what a tile
// knows, and every answer here is assignable to that.
export type {
  AnchorPoint, AreaGeometry, ChildDivisionsAdded, CreatedSubregion, DescendantMemberGeometries, DescendantMemberGeometry,
  DivisionsAdded, DivisionsRemoved, DivisionUsageCounts, FocusBbox, MemberGeometries, MemberGeometry, MemberMoved,
  RegionGeometry, RegionGeometryProperties, RegionImageOverlay, RegionImageOverlayBody, RegionMember, RegionMembers,
  RegionMemberType, Regions, RegionSearchResult,
  RegionSearchResults, SubregionFlattened, SubregionsExpanded, UpdateRegionBody,
} from './client.generated';

export async function searchRegions(
  worldViewId: number,
  query: string,
  limit: number = 50
): Promise<RegionSearchResults> {
  if (!query || query.length < 2) {
    return [];
  }
  return getWorldViewsByWorldViewIdRegionsSearch(worldViewId, { query, limit });
}

export async function fetchRegions(worldViewId: number): Promise<Regions> {
  return getWorldViewsByWorldViewIdRegions(worldViewId);
}

export async function fetchRootRegions(worldViewId: number): Promise<Regions> {
  return getWorldViewsByWorldViewIdRegionsRoot(worldViewId);
}

export async function fetchSubregions(regionId: number): Promise<Regions> {
  return getWorldViewsRegionsByRegionIdSubregions(regionId);
}

export async function fetchRegionAncestors(regionId: number): Promise<Regions> {
  return getWorldViewsRegionsByRegionIdAncestors(regionId);
}

export async function createRegion(
  worldViewId: number,
  data: CreateRegionBody,
): Promise<Region> {
  return postWorldViewsByWorldViewIdRegions(worldViewId, data);
}

export async function updateRegion(
  regionId: number,
  data: UpdateRegionBody,
): Promise<Region> {
  return putWorldViewsRegionsByRegionId(regionId, data);
}

export async function updateRegionGeometry(
  regionId: number,
  geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon,
  isCustomBoundary: boolean = true,
  hullGeometry?: GeoJSON.Polygon | GeoJSON.MultiPolygon | null
): Promise<void> {
  await putWorldViewsRegionsByRegionIdGeometry(regionId, { geometry, isCustomBoundary, hullGeometry });
}

export async function deleteRegion(regionId: number, options?: { moveChildrenToParent?: boolean }): Promise<void> {
  await deleteWorldViewsRegionsByRegionId(
    regionId, options?.moveChildrenToParent ? { moveChildrenToParent: 'true' } : undefined,
  );
}

/** A region's stored outline, or its hull; null where it has none computed yet. */
export async function fetchRegionGeometry(regionId: number, detail?: 'high' | 'hull'): Promise<RegionGeometry | null> {
  try {
    // A region with no outline computed yet answers 204, read as undefined.
    return (await getWorldViewsRegionsByRegionIdGeometry(regionId, detail ? { detail } : undefined)) ?? null;
  } catch {
    return null;
  }
}

// =============================================================================
// Region Members
// =============================================================================

export async function fetchRegionMembers(regionId: number): Promise<RegionMembers> {
  return getWorldViewsRegionsByRegionIdMembers(regionId);
}

export async function fetchRegionMemberGeometries(regionId: number): Promise<MemberGeometries | null> {
  try {
    return await getWorldViewsRegionsByRegionIdMembersGeometries(regionId);
  } catch {
    return null;
  }
}

export async function fetchDescendantMemberGeometries(regionId: number): Promise<DescendantMemberGeometries | null> {
  try {
    return await getWorldViewsRegionsByRegionIdMembersDescendantGeometries(regionId);
  } catch {
    return null;
  }
}

export async function addDivisionsToRegion(
  regionId: number,
  divisionIds: number[],
  options?: Omit<AddDivisionsToRegionBody, 'divisionIds'>,
): Promise<DivisionsAdded> {
  return postWorldViewsRegionsByRegionIdMembers(regionId, { divisionIds, ...options });
}

export async function removeDivisionsFromRegion(
  regionId: number,
  divisionIds?: number[],
  memberRowIds?: number[]
): Promise<DivisionsRemoved> {
  return deleteWorldViewsRegionsByRegionIdMembers(regionId, { divisionIds, memberRowIds });
}

export async function moveMemberToRegion(
  fromRegionId: number,
  memberRowId: number,
  toRegionId: number
): Promise<MemberMoved> {
  return postWorldViewsRegionsByRegionIdMembersMove(fromRegionId, { memberRowId, toRegionId });
}

export async function addChildDivisionsAsSubregions(
  regionId: number,
  divisionId: number,
  options: AddChildDivisionsBody = {},
): Promise<ChildDivisionsAdded> {
  return postWorldViewsRegionsByRegionIdMembersByDivisionIdAddChildren(regionId, divisionId, options);
}

/** Flatten a subregion - moves all divisions from subregion to parent and deletes subregion */
export async function flattenSubregion(
  parentRegionId: number,
  subregionId: number
): Promise<SubregionFlattened> {
  return postWorldViewsRegionsByParentRegionIdFlattenBySubregionId(parentRegionId, subregionId);
}

/** Expand division members to subregions (opposite of flatten) */
export async function expandToSubregions(
  regionId: number,
  options?: { inheritColor?: boolean }
): Promise<SubregionsExpanded> {
  return postWorldViewsRegionsByRegionIdExpand(regionId, options || {});
}

/** Get usage counts for divisions within a world view */
export async function fetchDivisionUsageCounts(
  worldViewId: number,
  divisionIds: number[]
): Promise<DivisionUsageCounts> {
  if (divisionIds.length === 0) return {};
  return postWorldViewsByWorldViewIdDivisionUsage(worldViewId, { divisionIds });
}

// =============================================================================
// Reference map (#595)
// =============================================================================

/** A region's reference map in the Create Subregions dialog, or null where it has none (a 204). */
export async function fetchRegionImageOverlay(regionId: number): Promise<RegionImageOverlay | null> {
  return (await getWorldViewsRegionsByRegionIdImageOverlay(regionId)) ?? null;
}

/** Keep a region's reference map, replacing the one it had; answered with no body. */
export async function saveRegionImageOverlay(regionId: number, body: RegionImageOverlayBody): Promise<void> {
  await putWorldViewsRegionsByRegionIdImageOverlay(regionId, body);
}

/** Take a region's reference map away. */
export async function deleteRegionImageOverlay(regionId: number): Promise<void> {
  await deleteWorldViewsRegionsByRegionIdImageOverlay(regionId);
}
