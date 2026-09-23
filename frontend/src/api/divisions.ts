/**
 * Administrative Divisions API (GADM boundaries)
 */

import type {
  AdministrativeDivision, AdministrativeDivisions, DivisionGeometry, DivisionSearchResults,
} from '@tyr/shared/api';
import { API_URL, authFetchJson, authFetchOptionalJson } from './fetchUtils.js';

// What every call here answers is declared once, as a backend schema (ADR-0066),
// and generated into `@tyr/shared/api`. Passed on from here, so a component
// imports a call's answer from the module of the call. `AdministrativeDivision`
// itself is held by the client in the looser shape `types/index.ts` derives
// from it, as a region is, since a selection made on the map starts from what a
// tile knows.
export type {
  AdministrativeDivisions, DivisionGeometry, DivisionSearchResult, DivisionSearchResults,
} from '@tyr/shared/api';

export async function fetchRootDivisions(worldViewId: number = 1): Promise<AdministrativeDivisions> {
  return authFetchJson<AdministrativeDivisions>(`${API_URL}/api/divisions/root?worldViewId=${worldViewId}`);
}

export async function fetchDivision(divisionId: number, worldViewId: number = 1): Promise<AdministrativeDivision> {
  return authFetchJson<AdministrativeDivision>(`${API_URL}/api/divisions/${divisionId}?worldViewId=${worldViewId}`);
}

export async function fetchSubdivisions(
  divisionId: number,
  worldViewId: number = 1,
  options: { getAll?: boolean; limit?: number; offset?: number } = {}
): Promise<AdministrativeDivisions> {
  const params = new URLSearchParams({
    worldViewId: String(worldViewId),
    getAll: String(options.getAll ?? false),
    limit: String(options.limit ?? 1000),
    offset: String(options.offset ?? 0),
  });
  return authFetchJson<AdministrativeDivisions>(`${API_URL}/api/divisions/${divisionId}/subdivisions?${params}`);
}

export async function fetchDivisionAncestors(divisionId: number, worldViewId: number = 1): Promise<AdministrativeDivisions> {
  return authFetchJson<AdministrativeDivisions>(`${API_URL}/api/divisions/${divisionId}/ancestors?worldViewId=${worldViewId}`);
}

export async function fetchDivisionSiblings(divisionId: number, worldViewId: number = 1): Promise<AdministrativeDivisions> {
  return authFetchJson<AdministrativeDivisions>(`${API_URL}/api/divisions/${divisionId}/siblings?worldViewId=${worldViewId}`);
}

export async function fetchDivisionGeometry(
  divisionId: number,
  worldViewId: number = 1,
  options: { detail?: 'low' | 'medium' | 'high'; resolveEmpty?: boolean } = {}
): Promise<DivisionGeometry | null> {
  const params = new URLSearchParams({
    worldViewId: String(worldViewId),
    detail: options.detail ?? 'medium',
    resolveEmpty: String(options.resolveEmpty ?? true),
  });
  try {
    return await authFetchOptionalJson<DivisionGeometry>(`${API_URL}/api/divisions/${divisionId}/geometry?${params}`);
  } catch {
    return null;
  }
}

export async function searchDivisions(
  query: string,
  worldViewId: number = 1,
  limit: number = 50
): Promise<DivisionSearchResults> {
  if (!query || query.length < 2) {
    return [];
  }
  const params = new URLSearchParams({
    query,
    worldViewId: String(worldViewId),
    limit: String(limit),
  });
  return authFetchJson<DivisionSearchResults>(`${API_URL}/api/divisions/search?${params}`);
}
