/**
 * Experiences API client
 *
 * What a reader's screens ask of the catalogue: an object, a region's objects
 * and their places, the works and finds an object holds, the counts of the
 * region tree, and the New chips a reader has been shown. A curator's writes
 * are `curation.ts`; the review queue's calls are `reviewQueue.ts`.
 */

import type {
  ExperienceDetail, ExperienceKinds, ExperienceLocationsResponse, ExperienceSearch, ExperiencesByRegionResponse,
  ExperienceTreasuresResponse, NewBadgesSeen, RegionExperienceCounts, RegionExperienceLocationsResponse,
  SiteFindsResponse,
} from '@tyr/shared/api';
import { API_URL, fetchJson, authFetchJson } from './fetchUtils';

// What every call here answers is declared once, as a backend schema (ADR-0066),
// and generated into `@tyr/shared/api`. Passed on from here, so a component
// imports a call's answer from the module of the call. The visit types below
// belong to `visited.ts`'s calls, which move with their own slice of #527.
export type {
  Experience, ExperienceDetail, ExperienceKind, ExperienceKinds, ExperienceLocation, ExperienceLocationsResponse,
  ExperienceLocationWithState, ExperienceRegionRef, ExperienceSearch, ExperienceSearchResult,
  ExperiencesByRegionResponse, ExperienceTreasure, ExperienceTreasuresResponse, ImageCredit, LinkedPlace,
  NewBadgesSeen, RegionExperienceCount, RegionExperienceCounts, RegionExperienceLocation,
  RegionExperienceLocationsResponse, SiteFind, SiteFindsResponse,
} from '@tyr/shared/api';

// =============================================================================
// Types
// =============================================================================

/**
 * Location with visited status
 */
export interface LocationWithVisitedStatus {
  id: number;
  name: string | null;
  /** Nullable, for the reason given on `ExperienceLocation.ordinal`. */
  ordinal: number | null;
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

// =============================================================================
// API Functions
// =============================================================================

/**
 * Get single experience by ID
 */
export async function fetchExperience(id: number): Promise<ExperienceDetail> {
  // The experience itself is public, but the `regions[]` it returns is filtered
  // by world-view visibility — `getExperience` admits every assignment only for
  // an admin. Sent anonymously, that branch is unreachable from the app, so an
  // experience assigned only to hidden world views comes back with an empty
  // region list rather than an incomplete one, and the documented admin bypass
  // is nominal.
  return authFetchJson<ExperienceDetail>(`${API_URL}/api/experiences/${id}`);
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
    /** Objects that no longer exist. Off unless the reader asked. */
    includeLost?: boolean;
  }
): Promise<ExperiencesByRegionResponse> {
  const params = new URLSearchParams();
  if (options?.includeChildren === false) params.set('includeChildren', 'false');
  if (options?.limit) params.set('limit', String(options.limit));
  if (options?.offset) params.set('offset', String(options.offset));
  if (options?.includeLost) params.set('includeLost', 'true');

  const query = params.toString();
  const querySuffix = query ? `?${query}` : '';
  return authFetchJson<ExperiencesByRegionResponse>(
    `${API_URL}/api/experiences/by-region/${regionId}${querySuffix}`
  );
}

/**
 * Search experiences by name, across the whole catalogue.
 *
 * Two callers, one read: the visitor's search in the navigation pane, which
 * turns an answer into an address, and the curator's "search and assign"
 * dialog, which assigns one to the region it already has open.
 */
export async function searchExperiences(
  query: string,
  limit = 20
): Promise<ExperienceSearch> {
  return fetchJson(`${API_URL}/api/experiences/search?q=${encodeURIComponent(query)}&limit=${limit}`);
}

/**
 * List the kinds a traveller browses by (#819)
 */
export async function fetchExperienceKinds(): Promise<ExperienceKinds> {
  return fetchJson<ExperienceKinds>(`${API_URL}/api/experiences/kinds`);
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
  // Guarded on `regionId` like the batch below, but conditionally: the guard
  // engages only when one is passed and waves the request through when it is
  // absent. No call site passes one today — both callers want an experience's
  // locations, which is the only way to get them — so the header keeps this
  // route correct if a caller starts rather than covering one that exists.
  return authFetchJson<ExperienceLocationsResponse>(`${API_URL}/api/experiences/${experienceId}/locations${params}`);
}

/**
 * Get all locations for all experiences in a region (batch)
 * Eliminates N+1 individual location fetches
 */
export async function fetchRegionExperienceLocations(
  regionId: number,
  options?: { includeChildren?: boolean; includeLost?: boolean }
): Promise<RegionExperienceLocationsResponse> {
  const params = new URLSearchParams();
  if (options?.includeChildren === false) params.set('includeChildren', 'false');
  // Has to follow the list. A row the list is showing but this batch is not
  // arrives with no markers and a confident "0/N in region" — the denominator
  // comes from the experience, the numerator from here.
  if (options?.includeLost) params.set('includeLost', 'true');
  const query = params.toString();
  const querySuffix = query ? `?${query}` : '';
  // Authenticated for the same reason as fetchExperiencesByRegion, plus a
  // sharper one: `requireVisibleWorldView` guards this route, and a hidden world
  // view answers an anonymous caller with 404. Sent unauthenticated, the batch
  // failed for every experience in the region at once, and each row rendered the
  // absence as `0/N in region` — the count comes from this response while the
  // total falls back to `experience.location_count`.
  return authFetchJson<RegionExperienceLocationsResponse>(
    `${API_URL}/api/experiences/by-region/${regionId}/locations${querySuffix}`
  );
}

/**
 * Get treasures (artworks, artifacts) for an experience
 *
 * Authenticated, not `fetchJson`: `/:id/treasures` widens three
 * `curation_state` predicates (`$2::boolean OR …`) for a curator or admin
 * whose scope reaches the experience (`maySeeUnreadExperience`), and an
 * unauthenticated request cannot carry that scope at all — the boolean is
 * always `false`. Sent without the header, a curator opening a museum from
 * its own "unread contents" card saw exactly the published works an
 * anonymous reader sees, with nothing on screen to say more had arrived.
 */
export async function fetchExperienceTreasures(
  experienceId: number
): Promise<ExperienceTreasuresResponse> {
  return authFetchJson<ExperienceTreasuresResponse>(`${API_URL}/api/experiences/${experienceId}/treasures`);
}

/**
 * The finds dug up at a site and where they are shown (#894). Asked of a site
 * only — `hasExtent` says which rows are one — since the answer is empty for
 * everything else and the route sits under the same limiter as the reads that
 * draw the list.
 */
export async function fetchSiteFinds(experienceId: number): Promise<SiteFindsResponse> {
  return authFetchJson<SiteFindsResponse>(`${API_URL}/api/experiences/${experienceId}/finds`);
}

/**
 * Get experience counts per region per kind for a world view
 * Used by Discover page tree navigation
 */
export async function fetchExperienceRegionCounts(
  worldViewId: number,
  parentRegionId?: number
): Promise<RegionExperienceCounts> {
  const params = new URLSearchParams({ worldViewId: String(worldViewId) });
  if (parentRegionId) params.set('parentRegionId', String(parentRegionId));
  // `worldViewId` is mandatory on this route and the visibility guard reads it,
  // so on a hidden world view every anonymous call 404s and the Discover tree
  // renders counts it never received.
  return authFetchJson<RegionExperienceCounts>(`${API_URL}/api/experiences/region-counts?${params}`);
}

/**
 * Record that these chips have now been shown to the reader.
 *
 * Its own call rather than a side effect of the read that produced them: the
 * read stays repeatable, and a timestamp set by a prefetch is not an
 * impression. Only the first is kept server-side.
 */
export async function markNewBadgesSeen(experienceIds: number[]): Promise<NewBadgesSeen> {
  return authFetchJson(`${API_URL}/api/experiences/new-badges/seen`, {
    method: 'POST',
    body: JSON.stringify({ experienceIds }),
  });
}
