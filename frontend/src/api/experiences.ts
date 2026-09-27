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
import {
  getExperiencesById, getExperiencesByIdFinds, getExperiencesByIdLocations, getExperiencesByIdTreasures,
  getExperiencesByRegionByRegionId, getExperiencesByRegionByRegionIdLocations, getExperiencesKinds,
  getExperiencesRegionCounts, getExperiencesSearch, postExperiencesNewBadgesSeen,
} from './client.generated';

// What every call here answers is declared once, as a backend schema (ADR-0066),
// and generated into `@tyr/shared/api`. Passed on from here, so a component
// imports a call's answer from the module of the call.
export type {
  Experience, ExperienceDetail, ExperienceKind, ExperienceKinds, ExperienceLocation, ExperienceLocationsResponse,
  ExperienceLocationWithState, ExperienceRegionRef, ExperienceSearch, ExperienceSearchResult,
  ExperiencesByRegionResponse, ExperienceTreasure, ExperienceTreasuresResponse, ImageCredit, LinkedPlace,
  NewBadgesSeen, RegionExperienceCount, RegionExperienceCounts, RegionExperienceLocation,
  RegionExperienceLocationsResponse, SiteFind, SiteFindsResponse,
} from '@tyr/shared/api';

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
  return getExperiencesById(id);
}

/**
 * Get experiences by region
 * Sends the session's token when there is one (the route's access is `optional`).
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
  // Each is sent only when it moves off the route's default.
  return getExperiencesByRegionByRegionId(regionId, {
    includeChildren: options?.includeChildren === false ? 'false' : undefined,
    limit: options?.limit || undefined,
    offset: options?.offset || undefined,
    includeLost: options?.includeLost ? 'true' : undefined,
  });
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
  return getExperiencesSearch({ q: query, limit });
}

/**
 * List the kinds a traveller browses by (#819)
 */
export async function fetchExperienceKinds(): Promise<ExperienceKinds> {
  return getExperiencesKinds();
}

/**
 * Get locations for an experience (multi-location support)
 * @param regionId - Optional: include in_region flag for each location
 */
export async function fetchExperienceLocations(
  experienceId: number,
  regionId?: number
): Promise<ExperienceLocationsResponse> {
  // Guarded on `regionId` like the batch below, but conditionally: the guard
  // engages only when one is passed and waves the request through when it is
  // absent. No call site passes one today — both callers want an experience's
  // locations, which is the only way to get them — so the header keeps this
  // route correct if a caller starts rather than covering one that exists.
  return getExperiencesByIdLocations(experienceId, regionId ? { regionId } : undefined);
}

/**
 * Get all locations for all experiences in a region (batch)
 * Eliminates N+1 individual location fetches
 */
export async function fetchRegionExperienceLocations(
  regionId: number,
  options?: { includeChildren?: boolean; includeLost?: boolean }
): Promise<RegionExperienceLocationsResponse> {
  // `includeLost` has to follow the list. A row the list is showing but this batch is not
  // arrives with no markers and a confident "0/N in region" — the denominator
  // comes from the experience, the numerator from here.
  // Authenticated for the same reason as fetchExperiencesByRegion, plus a
  // sharper one: the route names its region's world view as its `scope`, and a
  // hidden world view answers an anonymous caller with 404. Sent unauthenticated, the batch
  // failed for every experience in the region at once, and each row rendered the
  // absence as `0/N in region` — the count comes from this response while the
  // total falls back to `experience.location_count`.
  return getExperiencesByRegionByRegionIdLocations(regionId, {
    includeChildren: options?.includeChildren === false ? 'false' : undefined,
    includeLost: options?.includeLost ? 'true' : undefined,
  });
}

/**
 * Get treasures (artworks, artifacts) for an experience
 *
 * It must carry the session's token: `/:id/treasures` widens three
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
  return getExperiencesByIdTreasures(experienceId);
}

/**
 * The finds dug up at a site and where they are shown (#894). Asked of a site
 * only — `hasExtent` says which rows are one — since the answer is empty for
 * everything else and the route sits under the same limiter as the reads that
 * draw the list.
 */
export async function fetchSiteFinds(experienceId: number): Promise<SiteFindsResponse> {
  return getExperiencesByIdFinds(experienceId);
}

/**
 * Get experience counts per region per kind for a world view
 * Used by Discover page tree navigation
 */
export async function fetchExperienceRegionCounts(
  worldViewId: number,
  parentRegionId?: number
): Promise<RegionExperienceCounts> {
  // `worldViewId` is mandatory on this route and the visibility guard reads it,
  // so on a hidden world view every anonymous call 404s and the Discover tree
  // renders counts it never received.
  return getExperiencesRegionCounts({ worldViewId, parentRegionId: parentRegionId || undefined });
}

/**
 * Record that these chips have now been shown to the reader.
 *
 * Its own call rather than a side effect of the read that produced them: the
 * read stays repeatable, and a timestamp set by a prefetch is not an
 * impression. Only the first is kept server-side.
 */
export async function markNewBadgesSeen(experienceIds: number[]): Promise<NewBadgesSeen> {
  return postExperiencesNewBadgesSeen({ experienceIds });
}
