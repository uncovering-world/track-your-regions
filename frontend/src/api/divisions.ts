/**
 * Administrative Divisions API (GADM boundaries)
 */

import type {
  AdministrativeDivision,
  AdministrativeDivisionWithPath,
  GeoJSONFeature,
} from '../types';
import { API_URL, authFetchJson } from './fetchUtils.js';
import type { GeoJSONFeatureCollection } from './types.js';

export async function fetchRootDivisions(worldViewId: number = 1): Promise<AdministrativeDivision[]> {
  return authFetchJson<AdministrativeDivision[]>(`${API_URL}/api/divisions/root?worldViewId=${worldViewId}`);
}

export async function fetchDivision(divisionId: number, worldViewId: number = 1): Promise<AdministrativeDivision> {
  return authFetchJson<AdministrativeDivision>(`${API_URL}/api/divisions/${divisionId}?worldViewId=${worldViewId}`);
}

export async function fetchSubdivisions(
  divisionId: number,
  worldViewId: number = 1,
  options: { getAll?: boolean; limit?: number; offset?: number } = {}
): Promise<AdministrativeDivision[]> {
  const params = new URLSearchParams({
    worldViewId: String(worldViewId),
    getAll: String(options.getAll ?? false),
    limit: String(options.limit ?? 1000),
    offset: String(options.offset ?? 0),
  });
  return authFetchJson<AdministrativeDivision[]>(`${API_URL}/api/divisions/${divisionId}/subdivisions?${params}`);
}

export async function fetchDivisionAncestors(divisionId: number, worldViewId: number = 1): Promise<AdministrativeDivision[]> {
  return authFetchJson<AdministrativeDivision[]>(`${API_URL}/api/divisions/${divisionId}/ancestors?worldViewId=${worldViewId}`);
}

export async function fetchDivisionSiblings(divisionId: number, worldViewId: number = 1): Promise<AdministrativeDivision[]> {
  return authFetchJson<AdministrativeDivision[]>(`${API_URL}/api/divisions/${divisionId}/siblings?worldViewId=${worldViewId}`);
}

export async function fetchDivisionGeometry(
  divisionId: number,
  worldViewId: number = 1,
  options: { detail?: 'low' | 'medium' | 'high'; resolveEmpty?: boolean } = {}
): Promise<GeoJSONFeature | null> {
  const params = new URLSearchParams({
    worldViewId: String(worldViewId),
    detail: options.detail ?? 'medium',
    resolveEmpty: String(options.resolveEmpty ?? true),
  });
  try {
    return await authFetchJson<GeoJSONFeature>(`${API_URL}/api/divisions/${divisionId}/geometry?${params}`);
  } catch {
    return null;
  }
}

export async function fetchSubdivisionGeometries(divisionId: number): Promise<GeoJSONFeatureCollection | null> {
  try {
    return await authFetchJson<GeoJSONFeatureCollection>(
      `${API_URL}/api/divisions/${divisionId}/subdivisions/geometries`
    );
  } catch {
    return null;
  }
}

export async function fetchRootDivisionGeometries(): Promise<GeoJSONFeatureCollection | null> {
  try {
    return await authFetchJson<GeoJSONFeatureCollection>(
      `${API_URL}/api/divisions/root/geometries`
    );
  } catch {
    return null;
  }
}

export async function searchDivisions(
  query: string,
  worldViewId: number = 1,
  limit: number = 50
): Promise<AdministrativeDivisionWithPath[]> {
  if (!query || query.length < 2) {
    return [];
  }
  const params = new URLSearchParams({
    query,
    worldViewId: String(worldViewId),
    limit: String(limit),
  });
  return authFetchJson<AdministrativeDivisionWithPath[]>(`${API_URL}/api/divisions/search?${params}`);
}
