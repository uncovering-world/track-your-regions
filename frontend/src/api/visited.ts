/**
 * API functions for user visited regions
 */

import { API_URL, authFetchJson } from './fetchUtils';

export interface VisitedRegion {
  region_id: number;
  visited_at: string;
  notes: string | null;
}

/**
 * Get all visited regions for current user
 */
export async function fetchVisitedRegions(): Promise<VisitedRegion[]> {
  return authFetchJson<VisitedRegion[]>(`${API_URL}/api/users/me/visited-regions`);
}

/**
 * Get visited regions for a specific world view
 */
export async function fetchVisitedRegionsByWorldView(worldViewId: number): Promise<VisitedRegion[]> {
  return authFetchJson<VisitedRegion[]>(`${API_URL}/api/users/me/visited-regions/by-world-view/${worldViewId}`);
}

/**
 * Mark a region as visited
 */
export async function markRegionVisited(regionId: number, notes?: string): Promise<VisitedRegion> {
  return authFetchJson<VisitedRegion>(`${API_URL}/api/users/me/visited-regions/${regionId}`, {
    method: 'POST',
    body: JSON.stringify({ notes }),
  });
}

/**
 * Unmark a region as visited
 */
export async function unmarkRegionVisited(regionId: number): Promise<void> {
  await authFetchJson<void>(`${API_URL}/api/users/me/visited-regions/${regionId}`, {
    method: 'DELETE',
  });
}
