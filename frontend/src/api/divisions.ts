/**
 * Administrative Divisions API (GADM boundaries)
 */

import type {
  AdministrativeDivision, AdministrativeDivisions, DivisionGeometry, DivisionSearchResults,
} from './client.generated';
import {
  getDivisionsByDivisionId, getDivisionsByDivisionIdAncestors, getDivisionsByDivisionIdGeometry,
  getDivisionsByDivisionIdSubdivisions, getDivisionsRoot, getDivisionsSearch,
} from './client.generated';

// What every call here answers is declared once, as a backend schema (ADR-0066),
// and generated into `client.generated.ts`. Passed on from here, so a component
// imports a call's answer from the module of the call. `AdministrativeDivision`
// itself is held by the client in the looser shape `types/index.ts` derives
// from it, as a region is, since a selection made on the map starts from what a
// tile knows.
export type {
  AdministrativeDivisions, DivisionGeometry, DivisionSearchResult, DivisionSearchResults,
} from './client.generated';

/** The top of GADM's tree, the same for every world view. */
export async function fetchRootDivisions(): Promise<AdministrativeDivisions> {
  return getDivisionsRoot();
}

export async function fetchDivision(divisionId: number): Promise<AdministrativeDivision> {
  return getDivisionsByDivisionId(divisionId);
}

export async function fetchSubdivisions(
  divisionId: number,
  worldViewId: number = 1,
  options: { getAll?: boolean; limit?: number; offset?: number } = {}
): Promise<AdministrativeDivisions> {
  return getDivisionsByDivisionIdSubdivisions(divisionId, {
    worldViewId,
    getAll: options.getAll ? 'true' : 'false',
    limit: options.limit ?? 1000,
    offset: options.offset ?? 0,
  });
}

export async function fetchDivisionAncestors(divisionId: number): Promise<AdministrativeDivisions> {
  return getDivisionsByDivisionIdAncestors(divisionId);
}

/**
 * A division's boundary. `detail` asks for a stored simplification — `low` or
 * `medium` for a preview — and is the full shape when left out, which the
 * cutting tools need, since they store what they cut (#1010). A division with
 * no stored outline answers 204, read here as null.
 */
export async function fetchDivisionGeometry(
  divisionId: number,
  options: { detail?: 'low' | 'medium' | 'high' } = {}
): Promise<DivisionGeometry | null> {
  try {
    return (await getDivisionsByDivisionIdGeometry(divisionId, { detail: options.detail ?? 'high' })) ?? null;
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
  return getDivisionsSearch({ query, worldViewId, limit });
}
