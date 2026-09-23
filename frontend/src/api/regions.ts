/**
 * Regions API (user-defined regions within a WorldView)
 */

import type { GeoJSONFeature } from '../types';
import type {
  ChildDivisionsAdded, DivisionsAdded, DivisionsRemoved, DivisionUsageCounts, MemberMoved, Region, RegionMembers,
  Regions, RegionSearchResults, RegionUpdated, SubregionFlattened, SubregionsExpanded,
} from '@tyr/shared/api';
import { API_URL, authFetchJson } from './fetchUtils.js';
import type { GeoJSONFeatureCollection } from './types.js';

// What every call here answers is declared once, as a backend schema (ADR-0066),
// and generated into `@tyr/shared/api`. Passed on from here, so a component
// imports a call's answer from the module of the call. `Region` itself is the
// one exception: the client holds a region in the looser shape `types/index.ts`
// derives from it, since a selection made on the map starts from what a tile
// knows, and every answer here is assignable to that.
export type {
  AnchorPoint, ChildDivisionsAdded, CreatedSubregion, DivisionsAdded, DivisionsRemoved, DivisionUsageCounts, FocusBbox,
  MemberMoved, RegionMember, RegionMembers, RegionMemberType, Regions, RegionSearchResult, RegionSearchResults,
  RegionUpdated, SubregionFlattened, SubregionsExpanded,
} from '@tyr/shared/api';

export async function searchRegions(
  worldViewId: number,
  query: string,
  limit: number = 50
): Promise<RegionSearchResults> {
  if (!query || query.length < 2) {
    return [];
  }
  const params = new URLSearchParams({
    query,
    limit: String(limit),
  });
  return authFetchJson<RegionSearchResults>(`${API_URL}/api/world-views/${worldViewId}/regions/search?${params}`);
}

export async function fetchRegions(worldViewId: number): Promise<Regions> {
  return authFetchJson<Regions>(`${API_URL}/api/world-views/${worldViewId}/regions`);
}

export async function fetchRootRegions(worldViewId: number): Promise<Regions> {
  return authFetchJson<Regions>(`${API_URL}/api/world-views/${worldViewId}/regions/root`);
}

export async function fetchSubregions(regionId: number): Promise<Regions> {
  return authFetchJson<Regions>(`${API_URL}/api/world-views/regions/${regionId}/subregions`);
}

export async function fetchRegionAncestors(regionId: number): Promise<Regions> {
  return authFetchJson<Regions>(`${API_URL}/api/world-views/regions/${regionId}/ancestors`);
}

export async function createRegion(
  worldViewId: number,
  data: {
    name: string;
    description?: string;
    parentRegionId?: number;
    color?: string;
    customGeometry?: GeoJSON.Polygon | GeoJSON.MultiPolygon;
  }
): Promise<Region> {
  return authFetchJson<Region>(`${API_URL}/api/world-views/${worldViewId}/regions`, {
    method: 'POST',
    body: JSON.stringify({
      name: data.name,
      description: data.description,
      parentRegionId: data.parentRegionId,
      color: data.color,
      customGeometry: data.customGeometry,
    }),
  });
}

export async function updateRegion(
  regionId: number,
  data: { name?: string; description?: string; color?: string; parentRegionId?: number | null; usesHull?: boolean }
): Promise<RegionUpdated> {
  return authFetchJson<RegionUpdated>(`${API_URL}/api/world-views/regions/${regionId}`, {
    method: 'PUT',
    body: JSON.stringify({
      name: data.name,
      description: data.description,
      color: data.color,
      parentRegionId: data.parentRegionId,
      usesHull: data.usesHull,
    }),
  });
}

export async function updateRegionGeometry(
  regionId: number,
  geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon,
  isCustomBoundary: boolean = true,
  hullGeometry?: GeoJSON.Polygon | GeoJSON.MultiPolygon | null
): Promise<void> {
  await authFetchJson<void>(`${API_URL}/api/world-views/regions/${regionId}/geometry`, {
    method: 'PUT',
    body: JSON.stringify({ geometry, isCustomBoundary, hullGeometry }),
  });
}

export async function deleteRegion(regionId: number, options?: { moveChildrenToParent?: boolean }): Promise<void> {
  const params = options?.moveChildrenToParent ? '?moveChildrenToParent=true' : '';
  await authFetchJson<void>(`${API_URL}/api/world-views/regions/${regionId}${params}`, {
    method: 'DELETE',
  });
}

export async function fetchRegionGeometry(regionId: number, detail?: 'high' | 'display' | 'hull' | 'anchor'): Promise<GeoJSONFeature | null> {
  try {
    const params = detail ? `?detail=${detail}` : '';
    return await authFetchJson<GeoJSONFeature>(`${API_URL}/api/world-views/regions/${regionId}/geometry${params}`);
  } catch {
    return null;
  }
}

// =============================================================================
// Region Members
// =============================================================================

export async function fetchRegionMembers(regionId: number): Promise<RegionMembers> {
  return authFetchJson<RegionMembers>(`${API_URL}/api/world-views/regions/${regionId}/members`);
}

export async function fetchRegionMemberGeometries(regionId: number): Promise<GeoJSON.FeatureCollection | null> {
  try {
    return await authFetchJson<GeoJSON.FeatureCollection>(`${API_URL}/api/world-views/regions/${regionId}/members/geometries`);
  } catch {
    return null;
  }
}

export async function fetchDescendantMemberGeometries(regionId: number): Promise<GeoJSON.FeatureCollection | null> {
  try {
    return await authFetchJson<GeoJSON.FeatureCollection>(`${API_URL}/api/world-views/regions/${regionId}/members/descendant-geometries`);
  } catch {
    return null;
  }
}

export async function addDivisionsToRegion(
  regionId: number,
  divisionIds: number[],
  options?: {
    createAsSubregions?: boolean;
    includeChildren?: boolean;
    inheritColor?: boolean;
    childIds?: number[];
    customName?: string;
    customGeometry?: GeoJSON.Polygon | GeoJSON.MultiPolygon;
  }
): Promise<DivisionsAdded> {
  return authFetchJson<DivisionsAdded>(
    `${API_URL}/api/world-views/regions/${regionId}/members`,
    {
      method: 'POST',
      body: JSON.stringify({
        divisionIds: divisionIds,
        createAsSubregions: options?.createAsSubregions,
        includeChildren: options?.includeChildren,
        inheritColor: options?.inheritColor,
        childIds: options?.childIds,
        customName: options?.customName,
        customGeometry: options?.customGeometry,
      }),
    }
  );
}

export async function removeDivisionsFromRegion(
  regionId: number,
  divisionIds?: number[],
  memberRowIds?: number[]
): Promise<DivisionsRemoved> {
  return authFetchJson<DivisionsRemoved>(`${API_URL}/api/world-views/regions/${regionId}/members`, {
    method: 'DELETE',
    body: JSON.stringify({
      divisionIds: divisionIds,
      memberRowIds: memberRowIds,
    }),
  });
}

export async function moveMemberToRegion(
  fromRegionId: number,
  memberRowId: number,
  toRegionId: number
): Promise<MemberMoved> {
  return authFetchJson<MemberMoved>(`${API_URL}/api/world-views/regions/${fromRegionId}/members/move`, {
    method: 'POST',
    body: JSON.stringify({
      memberRowId,
      toRegionId,
    }),
  });
}

export async function addChildDivisionsAsSubregions(
  regionId: number,
  divisionId: number,
  options?: {
    childIds?: number[];
    removeOriginal?: boolean;
    inheritColor?: boolean;
    createAsSubregions?: boolean;
    assignments?: Array<{ gadmChildId: number; existingRegionId: number }>;
  }
): Promise<ChildDivisionsAdded> {
  return authFetchJson<ChildDivisionsAdded>(
    `${API_URL}/api/world-views/regions/${regionId}/members/${divisionId}/add-children`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        childIds: options?.childIds,
        removeOriginal: options?.removeOriginal,
        inheritColor: options?.inheritColor,
        createAsSubregions: options?.createAsSubregions,
        assignments: options?.assignments,
      }),
    }
  );
}

/** Flatten a subregion - moves all divisions from subregion to parent and deletes subregion */
export async function flattenSubregion(
  parentRegionId: number,
  subregionId: number
): Promise<SubregionFlattened> {
  return authFetchJson<SubregionFlattened>(
    `${API_URL}/api/world-views/regions/${parentRegionId}/flatten/${subregionId}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    }
  );
}

/** Expand division members to subregions (opposite of flatten) */
export async function expandToSubregions(
  regionId: number,
  options?: { inheritColor?: boolean }
): Promise<SubregionsExpanded> {
  return authFetchJson<SubregionsExpanded>(
    `${API_URL}/api/world-views/regions/${regionId}/expand`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(options || {}),
    }
  );
}

/** Get usage counts for divisions within a world view */
export async function fetchDivisionUsageCounts(
  worldViewId: number,
  divisionIds: number[]
): Promise<DivisionUsageCounts> {
  if (divisionIds.length === 0) return {};
  return authFetchJson<DivisionUsageCounts>(
    `${API_URL}/api/world-views/${worldViewId}/division-usage`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ divisionIds: divisionIds }),
    }
  );
}

// =============================================================================
// Region Geometries
// =============================================================================

export async function fetchRootRegionGeometries(worldViewId: number): Promise<GeoJSONFeatureCollection | null> {
  try {
    return await authFetchJson<GeoJSONFeatureCollection>(`${API_URL}/api/world-views/${worldViewId}/regions/root/geometries`);
  } catch {
    return null;
  }
}

export async function fetchSubregionGeometries(
  regionId: number,
  options?: { useDisplay?: boolean }
): Promise<GeoJSONFeatureCollection | null> {
  try {
    const params = new URLSearchParams();
    if (options?.useDisplay) {
      params.set('useDisplay', 'true');
    }
    const queryString = params.toString();
    const querySuffix = queryString ? `?${queryString}` : '';
    const url = `${API_URL}/api/world-views/regions/${regionId}/subregions/geometries${querySuffix}`;
    return await authFetchJson<GeoJSONFeatureCollection>(url);
  } catch {
    return null;
  }
}
