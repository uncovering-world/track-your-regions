/**
 * Experiences API client
 *
 * Public endpoints for browsing experiences.
 */

import { fetchJson, authFetchJson } from './fetchUtils';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

// =============================================================================
// Types
// =============================================================================

export interface Experience {
  id: number;
  external_id: string;
  name: string;
  short_description: string | null;
  category: string | null;
  country_codes: string[];
  country_names: string[];
  image_url: string | null;
  date_inscribed?: string;
  in_danger: boolean;
  longitude: number;
  latitude: number;
  source_name: string;
  source_priority?: number;
  location_count?: number;
  created_at?: string;
  // Curator rejection fields (only present when curator has scope)
  is_rejected?: boolean;
  rejection_reason?: string | null;
}

/**
 * Individual location within a multi-location experience
 */
export interface ExperienceLocation {
  id: number;
  experience_id: number;
  name: string | null;
  external_ref: string | null;
  ordinal: number;
  longitude: number;
  latitude: number;
  created_at: string;
  in_region?: boolean; // Whether this location is in the queried region
}

/**
 * Location with visited status
 */
export interface LocationWithVisitedStatus {
  id: number;
  name: string | null;
  ordinal: number;
  longitude: number;
  latitude: number;
  isVisited: boolean;
  visitedAt: string | null;
  notes: string | null;
  inRegion?: boolean; // Whether location is in the current explored region
}

/**
 * Visited status for an experience
 */
export type VisitedStatus = 'not_visited' | 'partial' | 'visited';

/**
 * Experience visited status response
 */
export interface ExperienceVisitedStatusResponse {
  experienceId: number;
  visitedStatus: VisitedStatus;
  totalLocations: number;
  visitedLocations: number;
  locations: LocationWithVisitedStatus[];
}

/**
 * Experience locations response
 */
export interface ExperienceLocationsResponse {
  experienceId: number;
  experienceName: string;
  locations: ExperienceLocation[];
  totalLocations: number;
}

export interface ExperienceDetail extends Experience {
  source_id: number;
  name_local: Record<string, string> | null;
  description: string | null;
  tags: string[] | null;
  metadata: Record<string, unknown> | null;
  boundary_geojson: GeoJSON.Geometry | null;
  area_km2: number | null;
  source_description: string | null;
  regions: {
    id: number;
    name: string;
    world_view_id: number;
    world_view_name: string;
  }[];
}

export interface ExperiencesResponse {
  experiences: Experience[];
  total: number;
  limit: number;
  offset: number;
}

export interface ExperiencesByRegionResponse {
  region: {
    id: number;
    name: string;
    world_view_name: string;
  };
  experiences: Experience[];
  total: number;
  limit: number;
  offset: number;
}

export interface ExperienceSource {
  id: number;
  name: string;
  description: string | null;
  is_active: boolean;
  last_sync_at: string | null;
  last_sync_status: string | null;
  display_priority: number;
  experience_count: string;
}

// =============================================================================
// API Functions
// =============================================================================

/**
 * List experiences with filtering
 */
export async function fetchExperiences(params?: {
  sourceId?: number;
  category?: string;
  country?: string;
  regionId?: number;
  search?: string;
  bbox?: string;
  limit?: number;
  offset?: number;
}): Promise<ExperiencesResponse> {
  const searchParams = new URLSearchParams();
  if (params?.sourceId) searchParams.set('sourceId', String(params.sourceId));
  if (params?.category) searchParams.set('category', params.category);
  if (params?.country) searchParams.set('country', params.country);
  if (params?.regionId) searchParams.set('regionId', String(params.regionId));
  if (params?.search) searchParams.set('search', params.search);
  if (params?.bbox) searchParams.set('bbox', params.bbox);
  if (params?.limit) searchParams.set('limit', String(params.limit));
  if (params?.offset) searchParams.set('offset', String(params.offset));

  const query = searchParams.toString();
  return fetchJson<ExperiencesResponse>(`${API_URL}/api/experiences${query ? `?${query}` : ''}`);
}

/**
 * Get single experience by ID
 */
export async function fetchExperience(id: number): Promise<ExperienceDetail> {
  return fetchJson<ExperienceDetail>(`${API_URL}/api/experiences/${id}`);
}

/**
 * Get experiences by region
 * Uses authFetchJson to send auth headers when available (optionalAuth on backend).
 * This enables curators to see rejected items marked with is_rejected.
 */
export async function fetchExperiencesByRegion(
  regionId: number,
  options?: {
    includeChildren?: boolean;
    limit?: number;
    offset?: number;
  }
): Promise<ExperiencesByRegionResponse> {
  const params = new URLSearchParams();
  if (options?.includeChildren === false) params.set('includeChildren', 'false');
  if (options?.limit) params.set('limit', String(options.limit));
  if (options?.offset) params.set('offset', String(options.offset));

  const query = params.toString();
  return authFetchJson<ExperiencesByRegionResponse>(
    `${API_URL}/api/experiences/by-region/${regionId}${query ? `?${query}` : ''}`
  );
}

/**
 * Search experiences
 */
export async function searchExperiences(
  query: string,
  limit = 20
): Promise<{ query: string; results: Experience[]; total: number }> {
  return fetchJson(`${API_URL}/api/experiences/search?q=${encodeURIComponent(query)}&limit=${limit}`);
}

/**
 * List experience sources
 */
export async function fetchExperienceSources(): Promise<ExperienceSource[]> {
  return fetchJson<ExperienceSource[]>(`${API_URL}/api/experiences/sources`);
}

/**
 * Get locations for an experience (multi-location support)
 * @param regionId - Optional: include in_region flag for each location
 */
export async function fetchExperienceLocations(
  experienceId: number,
  regionId?: number
): Promise<ExperienceLocationsResponse> {
  const params = regionId ? `?regionId=${regionId}` : '';
  return fetchJson<ExperienceLocationsResponse>(`${API_URL}/api/experiences/${experienceId}/locations${params}`);
}

/**
 * Content item within an experience (artwork, artifact)
 */
export interface ExperienceContent {
  id: number;
  external_id: string;
  name: string;
  content_type: string;
  artist: string | null;
  year: number | null;
  image_url: string | null;
  sitelinks_count: number;
}

export interface ExperienceContentsResponse {
  experienceId: number;
  contents: ExperienceContent[];
  total: number;
}

/**
 * Get contents (artworks, artifacts) for an experience
 */
export async function fetchExperienceContents(
  experienceId: number
): Promise<ExperienceContentsResponse> {
  return fetchJson<ExperienceContentsResponse>(`${API_URL}/api/experiences/${experienceId}/contents`);
}

/**
 * Region experience count breakdown by source
 */
export interface RegionExperienceCount {
  region_id: number;
  region_name: string;
  region_color: string | null;
  has_subregions: boolean;
  source_counts: Record<number, number>;
}

/**
 * Get experience counts per region per source for a world view
 * Used by Discover page tree navigation
 */
export async function fetchExperienceRegionCounts(
  worldViewId: number,
  parentRegionId?: number
): Promise<RegionExperienceCount[]> {
  const params = new URLSearchParams({ worldViewId: String(worldViewId) });
  if (parentRegionId) params.set('parentRegionId', String(parentRegionId));
  return fetchJson<RegionExperienceCount[]>(`${API_URL}/api/experiences/region-counts?${params}`);
}

// =============================================================================
// Curation API (curator-only)
// =============================================================================

/**
 * Reject an experience from a region
 */
export async function rejectExperience(
  experienceId: number,
  regionId: number,
  reason?: string,
): Promise<{ success: boolean }> {
  return authFetchJson(`${API_URL}/api/experiences/${experienceId}/reject`, {
    method: 'POST',
    body: JSON.stringify({ regionId, reason }),
  });
}

/**
 * Unreject an experience from a region
 */
export async function unrejectExperience(
  experienceId: number,
  regionId: number,
): Promise<{ success: boolean }> {
  return authFetchJson(`${API_URL}/api/experiences/${experienceId}/unreject`, {
    method: 'POST',
    body: JSON.stringify({ regionId }),
  });
}

/**
 * Manually assign an experience to a region
 */
export async function assignExperienceToRegion(
  experienceId: number,
  regionId: number,
): Promise<{ success: boolean }> {
  return authFetchJson(`${API_URL}/api/experiences/${experienceId}/assign`, {
    method: 'POST',
    body: JSON.stringify({ regionId }),
  });
}

/**
 * Create a new manual experience under a chosen source
 */
export async function createManualExperience(data: {
  name: string;
  shortDescription?: string;
  category?: string;
  longitude: number;
  latitude: number;
  imageUrl?: string;
  tags?: string[];
  countryCode?: string;
  countryName?: string;
  regionId: number;
  sourceId?: number;
  websiteUrl?: string;
  wikipediaUrl?: string;
}): Promise<{ id: number; name: string; externalId: string }> {
  return authFetchJson(`${API_URL}/api/experiences`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

/**
 * Edit an experience's fields (curator)
 */
export async function editExperience(
  experienceId: number,
  data: {
    name?: string;
    shortDescription?: string;
    description?: string;
    category?: string;
    imageUrl?: string;
    tags?: string[];
    websiteUrl?: string;
    wikipediaUrl?: string;
  },
): Promise<{ success: boolean; experienceId: number; curatedFields: string[] }> {
  return authFetchJson(`${API_URL}/api/experiences/${experienceId}/edit`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

/**
 * Curation log entry
 */
export interface CurationLogEntry {
  id: number;
  action: string;
  region_id: number | null;
  region_name: string | null;
  details: Record<string, unknown> | null;
  created_at: string;
  curator_name: string;
}

/**
 * Get curation log for an experience
 */
export async function fetchCurationLog(
  experienceId: number,
): Promise<CurationLogEntry[]> {
  return authFetchJson(`${API_URL}/api/experiences/${experienceId}/curation-log`);
}

/**
 * Unassign a manual experience from a region
 */
export async function unassignExperienceFromRegion(
  experienceId: number,
  regionId: number,
): Promise<{ success: boolean }> {
  return authFetchJson(`${API_URL}/api/experiences/${experienceId}/assign/${regionId}`, {
    method: 'DELETE',
  });
}

/**
 * Remove an experience from a region entirely (any assignment type).
 * Unlike unassign, this works for both auto and manual assignments.
 * The rejection row is kept as a guard against spatial recompute.
 */
export async function removeExperienceFromRegion(
  experienceId: number,
  regionId: number,
): Promise<{ success: boolean }> {
  return authFetchJson(`${API_URL}/api/experiences/${experienceId}/remove-from-region/${regionId}`, {
    method: 'DELETE',
  });
}
