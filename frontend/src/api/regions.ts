/**
 * Regions API (user-defined regions within a WorldView)
 */

import type { Region, RegionMember, GeoJSONFeature } from '../types';
import { API_URL, authFetchJson } from './fetchUtils.js';
import type { GeoJSONFeatureCollection } from './types.js';

export interface RegionSearchResult {
  id: number;
  name: string;
  parentRegionId: number | null;
  description: string | null;
  color: string | null;
  isArchipelago: boolean;
  focusBbox: [number, number, number, number] | null;
  anchorPoint: [number, number] | null;
  hasSubregions: boolean;
  path: string;
  relevance_score: number;
}

export async function searchRegions(
  worldViewId: number,
  query: string,
  limit: number = 50
): Promise<RegionSearchResult[]> {
  if (!query || query.length < 2) {
    return [];
  }
  const params = new URLSearchParams({
    query,
    limit: String(limit),
  });
  return authFetchJson<RegionSearchResult[]>(`${API_URL}/api/world-views/${worldViewId}/regions/search?${params}`);
}

export async function fetchRegions(worldViewId: number): Promise<Region[]> {
  return authFetchJson<Region[]>(`${API_URL}/api/world-views/${worldViewId}/regions`);
}

export async function fetchRootRegions(worldViewId: number): Promise<Region[]> {
  return authFetchJson<Region[]>(`${API_URL}/api/world-views/${worldViewId}/regions/root`);
}

export async function fetchLeafRegions(worldViewId: number): Promise<Region[]> {
  return authFetchJson<Region[]>(`${API_URL}/api/world-views/${worldViewId}/regions/leaf`);
}

export async function fetchSubregions(regionId: number): Promise<Region[]> {
  return authFetchJson<Region[]>(`${API_URL}/api/world-views/regions/${regionId}/subregions`);
}

export async function fetchRegionAncestors(regionId: number): Promise<Region[]> {
  return authFetchJson<Region[]>(`${API_URL}/api/world-views/regions/${regionId}/ancestors`);
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
  data: { name?: string; description?: string; color?: string; parentRegionId?: number | null; isArchipelago?: boolean }
): Promise<Region> {
  return authFetchJson<Region>(`${API_URL}/api/world-views/regions/${regionId}`, {
    method: 'PUT',
    body: JSON.stringify({
      name: data.name,
      description: data.description,
      color: data.color,
      parentRegionId: data.parentRegionId,
      isArchipelago: data.isArchipelago,
    }),
  });
}

export async function updateRegionGeometry(
  regionId: number,
  geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon,
  isCustomBoundary: boolean = true,
  tsHullGeometry?: GeoJSON.Polygon | GeoJSON.MultiPolygon | null
): Promise<void> {
  await authFetchJson<void>(`${API_URL}/api/world-views/regions/${regionId}/geometry`, {
    method: 'PUT',
    body: JSON.stringify({ geometry, isCustomBoundary, tsHullGeometry }),
  });
}

export async function deleteRegion(regionId: number, options?: { moveChildrenToParent?: boolean }): Promise<void> {
  const params = options?.moveChildrenToParent ? '?moveChildrenToParent=true' : '';
  await authFetchJson<void>(`${API_URL}/api/world-views/regions/${regionId}${params}`, {
    method: 'DELETE',
  });
}

export async function fetchRegionGeometry(regionId: number, detail?: 'high' | 'display' | 'ts_hull' | 'anchor'): Promise<GeoJSONFeature | null> {
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

export async function fetchRegionMembers(regionId: number): Promise<RegionMember[]> {
  return authFetchJson<RegionMember[]>(`${API_URL}/api/world-views/regions/${regionId}/members`);
}

export async function fetchRegionMemberGeometries(regionId: number): Promise<GeoJSON.FeatureCollection | null> {
  try {
    return await authFetchJson<GeoJSON.FeatureCollection>(`${API_URL}/api/world-views/regions/${regionId}/members/geometries`);
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
): Promise<{ added: number; createdRegions?: { id: number; name: string; divisionId: number }[] }> {
  return authFetchJson<{ added: number; createdRegions?: { id: number; name: string; divisionId: number }[] }>(
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
): Promise<{ removed: number }> {
  return authFetchJson<{ removed: number }>(`${API_URL}/api/world-views/regions/${regionId}/members`, {
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
): Promise<void> {
  await authFetchJson<void>(`${API_URL}/api/world-views/regions/${fromRegionId}/members/move`, {
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
  }
): Promise<{ added: number; removedOriginal: boolean; createdRegions?: { id: number; name: string; divisionId: number }[] }> {
  return authFetchJson<{ added: number; removedOriginal: boolean; createdRegions?: { id: number; name: string; divisionId: number }[] }>(
    `${API_URL}/api/world-views/regions/${regionId}/members/${divisionId}/add-children`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        childIds: options?.childIds,
        removeOriginal: options?.removeOriginal,
        inheritColor: options?.inheritColor,
        createAsSubregions: options?.createAsSubregions,
      }),
    }
  );
}

/** Flatten a subregion - moves all divisions from subregion to parent and deletes subregion */
export async function flattenSubregion(
  parentRegionId: number,
  subregionId: number
): Promise<{ movedDivisions: number; deletedRegion: boolean }> {
  return authFetchJson<{ movedDivisions: number; deletedRegion: boolean }>(
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
): Promise<{ createdRegions: { id: number; name: string }[]; expandedCount: number }> {
  return authFetchJson<{ createdRegions: { id: number; name: string }[]; expandedCount: number }>(
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
): Promise<Record<number, number>> {
  if (divisionIds.length === 0) return {};
  return authFetchJson<Record<number, number>>(
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
    const url = `${API_URL}/api/world-views/regions/${regionId}/subregions/geometries${queryString ? `?${queryString}` : ''}`;
    return await authFetchJson<GeoJSONFeatureCollection>(url);
  } catch {
    return null;
  }
}
