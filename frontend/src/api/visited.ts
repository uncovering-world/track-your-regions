/**
 * Visits API client
 *
 * A reader's own record: the regions, objects and places they have been to, the
 * works they have seen, and how far through an object they are. Every call is
 * the signed-in reader's, under `/api/users/me/`.
 */

import type {
  AllLocationsMarked, AllLocationsUnmarked, ExperienceVisitedStatusResponse, ExperienceVisitMarked,
  ExperienceVisitUnmarked, LocationVisitMarked, LocationVisitUnmarked, TreasureViewMarked, TreasureViewUnmarked,
  ViewedTreasureIds, VisitedExperienceIds, VisitedLocationIds, VisitedRegion, VisitedRegions,
} from '@tyr/shared/api';
import { API_URL, authFetchJson } from './fetchUtils';

// What every call here answers is declared once, as a backend schema (ADR-0066),
// and generated into `@tyr/shared/api`. Passed on from here, so a component
// imports a call's answer from the module of the call.
export type {
  AllLocationsMarked, AllLocationsUnmarked, ExperienceVisitedStatusResponse, ExperienceVisitMarked,
  ExperienceVisitUnmarked, LocationVisitMarked, LocationVisitUnmarked, LocationWithVisitedStatus,
  TreasureViewMarked, TreasureViewUnmarked, ViewedTreasureIds, VisitedExperienceIds, VisitedLocationIds,
  VisitedRegion, VisitedRegions, VisitedStatus,
} from '@tyr/shared/api';

// =============================================================================
// Regions
// =============================================================================

/** Every region the reader has marked visited, newest first. */
export async function fetchVisitedRegions(): Promise<VisitedRegions> {
  return authFetchJson<VisitedRegions>(`${API_URL}/api/users/me/visited-regions`);
}

/** The reader's visited regions in one world view. */
export async function fetchVisitedRegionsByWorldView(worldViewId: number): Promise<VisitedRegions> {
  return authFetchJson<VisitedRegions>(`${API_URL}/api/users/me/visited-regions/by-world-view/${worldViewId}`);
}

/** Mark a region as visited. */
export async function markRegionVisited(regionId: number, notes?: string): Promise<VisitedRegion> {
  return authFetchJson<VisitedRegion>(`${API_URL}/api/users/me/visited-regions/${regionId}`, {
    method: 'POST',
    body: JSON.stringify({ notes }),
  });
}

/** Unmark a region as visited. The answer is a 204 with no body. */
export async function unmarkRegionVisited(regionId: number): Promise<void> {
  await authFetchJson<void>(`${API_URL}/api/users/me/visited-regions/${regionId}`, {
    method: 'DELETE',
  });
}

// =============================================================================
// Objects
// =============================================================================

/** The objects the reader has marked visited, optionally of one kind. */
export async function fetchVisitedExperienceIds(kindId?: number): Promise<VisitedExperienceIds> {
  const params = kindId ? `?kindId=${kindId}` : '';
  return authFetchJson<VisitedExperienceIds>(`${API_URL}/api/users/me/visited-experiences/ids${params}`);
}

/** Mark an object as visited, or renew its visit. */
export async function markExperienceVisited(experienceId: number): Promise<ExperienceVisitMarked> {
  return authFetchJson<ExperienceVisitMarked>(`${API_URL}/api/users/me/visited-experiences/${experienceId}`, {
    method: 'POST',
  });
}

/** Unmark an object as visited. */
export async function unmarkExperienceVisited(experienceId: number): Promise<ExperienceVisitUnmarked> {
  return authFetchJson<ExperienceVisitUnmarked>(`${API_URL}/api/users/me/visited-experiences/${experienceId}`, {
    method: 'DELETE',
  });
}

/** How far through an object's places the reader is, place by place. */
export async function fetchExperienceVisitedStatus(experienceId: number): Promise<ExperienceVisitedStatusResponse> {
  return authFetchJson<ExperienceVisitedStatusResponse>(
    `${API_URL}/api/users/me/experiences/${experienceId}/visited-status`,
  );
}

// =============================================================================
// Places
// =============================================================================

/** The places the reader has marked visited, optionally of one object. */
export async function fetchVisitedLocationIds(experienceId?: number): Promise<VisitedLocationIds> {
  const params = experienceId ? `?experienceId=${experienceId}` : '';
  return authFetchJson<VisitedLocationIds>(`${API_URL}/api/users/me/visited-locations/ids${params}`);
}

/** Mark a place as visited, or renew its visit. */
export async function markLocationVisited(locationId: number): Promise<LocationVisitMarked> {
  return authFetchJson<LocationVisitMarked>(`${API_URL}/api/users/me/visited-locations/${locationId}`, {
    method: 'POST',
  });
}

/** Unmark a place as visited. */
export async function unmarkLocationVisited(locationId: number): Promise<LocationVisitUnmarked> {
  return authFetchJson<LocationVisitUnmarked>(`${API_URL}/api/users/me/visited-locations/${locationId}`, {
    method: 'DELETE',
  });
}

/** Mark every place of an object as visited, or only those in a region. */
export async function markAllLocationsVisited(experienceId: number, regionId?: number): Promise<AllLocationsMarked> {
  const params = regionId ? `?regionId=${regionId}` : '';
  return authFetchJson<AllLocationsMarked>(
    `${API_URL}/api/users/me/experiences/${experienceId}/mark-all-locations${params}`,
    { method: 'POST' },
  );
}

/** Unmark every place of an object as visited, or only those in a region. */
export async function unmarkAllLocationsVisited(
  experienceId: number, regionId?: number,
): Promise<AllLocationsUnmarked> {
  const params = regionId ? `?regionId=${regionId}` : '';
  return authFetchJson<AllLocationsUnmarked>(
    `${API_URL}/api/users/me/experiences/${experienceId}/mark-all-locations${params}`,
    { method: 'DELETE' },
  );
}

// =============================================================================
// Works
// =============================================================================

/** The works the reader has marked seen, optionally of one museum. */
export async function fetchViewedTreasureIds(experienceId?: number): Promise<ViewedTreasureIds> {
  const params = experienceId ? `?experienceId=${experienceId}` : '';
  return authFetchJson<ViewedTreasureIds>(`${API_URL}/api/users/me/viewed-treasures/ids${params}`);
}

/** Mark a work as seen, and the museum it was seen at as visited where one is named. */
export async function markTreasureViewed(treasureId: number, experienceId?: number): Promise<TreasureViewMarked> {
  return authFetchJson<TreasureViewMarked>(`${API_URL}/api/users/me/viewed-treasures/${treasureId}`, {
    method: 'POST',
    body: JSON.stringify({ experienceId }),
  });
}

/** Unmark a work as seen. */
export async function unmarkTreasureViewed(treasureId: number): Promise<TreasureViewUnmarked> {
  return authFetchJson<TreasureViewUnmarked>(`${API_URL}/api/users/me/viewed-treasures/${treasureId}`, {
    method: 'DELETE',
  });
}
