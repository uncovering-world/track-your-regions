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
import {
  deleteUsersMeExperiencesByExperienceIdMarkAllLocations, deleteUsersMeViewedTreasuresByTreasureId,
  deleteUsersMeVisitedExperiencesByExperienceId, deleteUsersMeVisitedLocationsByLocationId,
  deleteUsersMeVisitedRegionsByRegionId, getUsersMeExperiencesByIdVisitedStatus, getUsersMeViewedTreasuresIds,
  getUsersMeVisitedExperiencesIds, getUsersMeVisitedLocationsIds, getUsersMeVisitedRegions,
  getUsersMeVisitedRegionsByWorldViewByWorldViewId, postUsersMeExperiencesByExperienceIdMarkAllLocations,
  postUsersMeViewedTreasuresByTreasureId, postUsersMeVisitedExperiencesByExperienceId,
  postUsersMeVisitedLocationsByLocationId, postUsersMeVisitedRegionsByRegionId,
} from './client.generated';

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
  return getUsersMeVisitedRegions();
}

/** The reader's visited regions in one world view. */
export async function fetchVisitedRegionsByWorldView(worldViewId: number): Promise<VisitedRegions> {
  return getUsersMeVisitedRegionsByWorldViewByWorldViewId(worldViewId);
}

/** Mark a region as visited. */
export async function markRegionVisited(regionId: number, notes?: string): Promise<VisitedRegion> {
  return postUsersMeVisitedRegionsByRegionId(regionId, { notes });
}

/** Unmark a region as visited. The answer is a 204 with no body. */
export async function unmarkRegionVisited(regionId: number): Promise<void> {
  await deleteUsersMeVisitedRegionsByRegionId(regionId);
}

// =============================================================================
// Objects
// =============================================================================

/** The objects the reader has marked visited, optionally of one kind. */
export async function fetchVisitedExperienceIds(kindId?: number): Promise<VisitedExperienceIds> {
  return getUsersMeVisitedExperiencesIds(kindId ? { kindId } : undefined);
}

/** Mark an object as visited, or renew its visit. */
export async function markExperienceVisited(experienceId: number): Promise<ExperienceVisitMarked> {
  return postUsersMeVisitedExperiencesByExperienceId(experienceId, {});
}

/** Unmark an object as visited. */
export async function unmarkExperienceVisited(experienceId: number): Promise<ExperienceVisitUnmarked> {
  return deleteUsersMeVisitedExperiencesByExperienceId(experienceId);
}

/** How far through an object's places the reader is, place by place. */
export async function fetchExperienceVisitedStatus(experienceId: number): Promise<ExperienceVisitedStatusResponse> {
  return getUsersMeExperiencesByIdVisitedStatus(experienceId);
}

// =============================================================================
// Places
// =============================================================================

/** The places the reader has marked visited, optionally of one object. */
export async function fetchVisitedLocationIds(experienceId?: number): Promise<VisitedLocationIds> {
  return getUsersMeVisitedLocationsIds(experienceId ? { experienceId } : undefined);
}

/** Mark a place as visited, or renew its visit. */
export async function markLocationVisited(locationId: number): Promise<LocationVisitMarked> {
  return postUsersMeVisitedLocationsByLocationId(locationId, {});
}

/** Unmark a place as visited. */
export async function unmarkLocationVisited(locationId: number): Promise<LocationVisitUnmarked> {
  return deleteUsersMeVisitedLocationsByLocationId(locationId);
}

/** Mark every place of an object as visited, or only those in a region. */
export async function markAllLocationsVisited(experienceId: number, regionId?: number): Promise<AllLocationsMarked> {
  return postUsersMeExperiencesByExperienceIdMarkAllLocations(experienceId, regionId ? { regionId } : undefined);
}

/** Unmark every place of an object as visited, or only those in a region. */
export async function unmarkAllLocationsVisited(
  experienceId: number, regionId?: number,
): Promise<AllLocationsUnmarked> {
  return deleteUsersMeExperiencesByExperienceIdMarkAllLocations(experienceId, regionId ? { regionId } : undefined);
}

// =============================================================================
// Works
// =============================================================================

/** The works the reader has marked seen, optionally of one museum. */
export async function fetchViewedTreasureIds(experienceId?: number): Promise<ViewedTreasureIds> {
  return getUsersMeViewedTreasuresIds(experienceId ? { experienceId } : undefined);
}

/** Mark a work as seen, and the museum it was seen at as visited where one is named. */
export async function markTreasureViewed(treasureId: number, experienceId?: number): Promise<TreasureViewMarked> {
  return postUsersMeViewedTreasuresByTreasureId(treasureId, { experienceId });
}

/** Unmark a work as seen. */
export async function unmarkTreasureViewed(treasureId: number): Promise<TreasureViewUnmarked> {
  return deleteUsersMeViewedTreasuresByTreasureId(treasureId);
}
