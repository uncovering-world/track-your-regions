/**
 * User Routes — the signed-in reader's own account and records, mounted at
 * /api/users (ADR-0071).
 *
 * Every route is the caller's own data: `signed-in`, `no-store`, and limited as
 * an ordinary authenticated user action (`authenticatedLimiter`,
 * `docs/tech/rate-limiting.md`). The limiter is on each declared route, so a
 * path under /api/users that no route declares is a plain 404 that runs no
 * handler and passes no limiter.
 */

import { defineRoute, NO_BODY } from '../api/route.js';
import { MyAccount } from '../api/responses/auth.js';
import {
  AllLocationsMarked,
  AllLocationsUnmarked,
  ExperienceVisitedStatusResponse,
  ExperienceVisitMarked,
  ExperienceVisitUnmarked,
  LocationVisitMarked,
  LocationVisitUnmarked,
  TreasureViewMarked,
  TreasureViewUnmarked,
  ViewedTreasureIds,
  VisitedExperienceIds,
  VisitedLocationIds,
  VisitedRegion,
  VisitedRegions,
} from '../api/responses/visited.js';
import { authenticatedLimiter } from '../middleware/rateLimiter.js';
import {
  regionIdParamSchema,
  worldViewIdParamSchema,
  experienceIdParamSchema,
  locationIdParamSchema,
  treasureIdParamSchema,
  markTreasureViewedBodySchema,
  idParamSchema,
  visitedRegionBodySchema,
  markVisitedBodySchema,
  markLocationVisitedBodySchema,
  visitedIdsQuerySchema,
  visitedLocationIdsQuerySchema,
  viewedTreasureIdsQuerySchema,
  markAllLocationsQuerySchema,
} from '../types/index.js';
import { getMyAccount } from '../controllers/user/myAccount.js';
import {
  getVisitedRegions,
  getVisitedRegionsInWorldView,
  markRegionVisited,
  unmarkRegionVisited,
} from '../controllers/user/visitedRegions.js';
import {
  markVisited,
  unmarkVisited,
  getVisitedIds,
  getVisitedLocationIds,
  markLocationVisited,
  unmarkLocationVisited,
  getExperienceVisitedStatus,
  markAllLocationsVisited,
  unmarkAllLocationsVisited,
  getViewedTreasureIds,
  markTreasureViewed,
  unmarkTreasureViewed,
} from '../controllers/experience/index.js';

/** The fields every route here shares: the caller's own data. */
const OWN = { access: 'signed-in', cache: 'no-store', limiter: authenticatedLimiter } as const;

export const userRoutes = [
  // The caller's account (includes curatorScopes for curators and admins)
  defineRoute({
    ...OWN, method: 'get', path: '/me',
    summary: 'Get the signed-in account, with its curator scopes for a curator or an admin',
    response: MyAccount,
    handler: getMyAccount,
  }),

  // =============================================================================
  // Visited Regions
  // =============================================================================

  defineRoute({
    ...OWN, method: 'get', path: '/me/visited-regions',
    summary: 'List every region the caller has marked visited, most recent first',
    response: VisitedRegions,
    handler: getVisitedRegions,
  }),
  defineRoute({
    ...OWN, method: 'get', path: '/me/visited-regions/by-world-view/:worldViewId',
    summary: 'List the regions the caller has marked visited in one world view',
    params: worldViewIdParamSchema,
    response: VisitedRegions,
    handler: getVisitedRegionsInWorldView,
  }),
  defineRoute({
    ...OWN, method: 'post', path: '/me/visited-regions/:regionId',
    summary: 'Mark a region visited, or refresh the mark and replace its notes when given',
    params: regionIdParamSchema,
    body: visitedRegionBodySchema,
    response: VisitedRegion,
    handler: markRegionVisited,
  }),
  defineRoute({
    ...OWN, method: 'delete', path: '/me/visited-regions/:regionId',
    summary: 'Remove the visited mark from a region',
    params: regionIdParamSchema,
    response: NO_BODY,
    noContent: true,
    handler: unmarkRegionVisited,
  }),

  // =============================================================================
  // Visited Experiences
  // =============================================================================

  // Just the ids of visited experiences, for quick lookup
  defineRoute({
    ...OWN, method: 'get', path: '/me/visited-experiences/ids',
    summary: 'List the ids of experiences the caller has visited, optionally of one kind',
    query: visitedIdsQuerySchema,
    response: VisitedExperienceIds,
    handler: getVisitedIds,
  }),
  defineRoute({
    ...OWN, method: 'post', path: '/me/visited-experiences/:experienceId',
    summary: 'Mark an experience visited, with optional notes and rating',
    params: experienceIdParamSchema,
    body: markVisitedBodySchema,
    response: ExperienceVisitMarked,
    handler: markVisited,
  }),
  defineRoute({
    ...OWN, method: 'delete', path: '/me/visited-experiences/:experienceId',
    summary: 'Remove the visited mark from an experience, keeping its location visits',
    params: experienceIdParamSchema,
    response: ExperienceVisitUnmarked,
    handler: unmarkVisited,
  }),

  // =============================================================================
  // Visited Locations (multi-location support)
  // =============================================================================

  defineRoute({
    ...OWN, method: 'get', path: '/me/visited-locations/ids',
    summary: 'List the ids of offered locations the caller has visited, grouped by experience',
    query: visitedLocationIdsQuerySchema,
    response: VisitedLocationIds,
    handler: getVisitedLocationIds,
  }),
  defineRoute({
    ...OWN, method: 'post', path: '/me/visited-locations/:locationId',
    summary: 'Mark one location visited, which also marks its experience visited',
    params: locationIdParamSchema,
    body: markLocationVisitedBodySchema,
    response: LocationVisitMarked,
    handler: markLocationVisited,
  }),
  defineRoute({
    ...OWN, method: 'delete', path: '/me/visited-locations/:locationId',
    summary: 'Remove a location visit, and the experience visit when no visited location remains',
    params: locationIdParamSchema,
    response: LocationVisitUnmarked,
    handler: unmarkLocationVisited,
  }),
  // An experience's visited status with its locations broken down
  defineRoute({
    ...OWN, method: 'get', path: '/me/experiences/:id/visited-status',
    summary: 'Get how much of an experience the caller has visited, location by location',
    params: idParamSchema,
    response: ExperienceVisitedStatusResponse,
    handler: getExperienceVisitedStatus,
  }),
  // Mark every location of an experience visited (or only those in a region)
  defineRoute({
    ...OWN, method: 'post', path: '/me/experiences/:experienceId/mark-all-locations',
    summary: 'Mark every offered location of an experience visited, or only those in one region',
    params: experienceIdParamSchema,
    query: markAllLocationsQuerySchema,
    response: AllLocationsMarked,
    handler: markAllLocationsVisited,
  }),
  defineRoute({
    ...OWN, method: 'delete', path: '/me/experiences/:experienceId/mark-all-locations',
    summary: 'Unmark every location of an experience, or only those in one region',
    params: experienceIdParamSchema,
    query: markAllLocationsQuerySchema,
    response: AllLocationsUnmarked,
    handler: unmarkAllLocationsVisited,
  }),

  // =============================================================================
  // Viewed Treasures (artwork "seen" tracking)
  // =============================================================================

  defineRoute({
    ...OWN, method: 'get', path: '/me/viewed-treasures/ids',
    summary: 'List the ids of works the caller has viewed, optionally at one venue',
    query: viewedTreasureIdsQuerySchema,
    response: ViewedTreasureIds,
    handler: getViewedTreasureIds,
  }),
  // Mark a treasure viewed (auto-marks the venue it was seen in as visited)
  defineRoute({
    ...OWN, method: 'post', path: '/me/viewed-treasures/:treasureId',
    summary: 'Mark a work viewed; naming its venue also marks the venue and its locations visited',
    params: treasureIdParamSchema,
    body: markTreasureViewedBodySchema,
    response: TreasureViewMarked,
    handler: markTreasureViewed,
  }),
  // Unmark a treasure viewed (does NOT unvisit the venue)
  defineRoute({
    ...OWN, method: 'delete', path: '/me/viewed-treasures/:treasureId',
    summary: 'Remove the viewed mark from a work; its venue stays visited',
    params: treasureIdParamSchema,
    response: TreasureViewUnmarked,
    handler: unmarkTreasureViewed,
  }),
];

