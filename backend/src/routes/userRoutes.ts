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

import { defineRoute, NO_BODY, routerOf } from '../api/route.js';
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
    response: MyAccount,
    handler: getMyAccount,
  }),

  // =============================================================================
  // Visited Regions
  // =============================================================================

  defineRoute({
    ...OWN, method: 'get', path: '/me/visited-regions',
    response: VisitedRegions,
    handler: getVisitedRegions,
  }),
  defineRoute({
    ...OWN, method: 'get', path: '/me/visited-regions/by-world-view/:worldViewId',
    params: worldViewIdParamSchema,
    response: VisitedRegions,
    handler: getVisitedRegionsInWorldView,
  }),
  defineRoute({
    ...OWN, method: 'post', path: '/me/visited-regions/:regionId',
    params: regionIdParamSchema,
    body: visitedRegionBodySchema,
    response: VisitedRegion,
    handler: markRegionVisited,
  }),
  defineRoute({
    ...OWN, method: 'delete', path: '/me/visited-regions/:regionId',
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
    query: visitedIdsQuerySchema,
    response: VisitedExperienceIds,
    handler: getVisitedIds,
  }),
  defineRoute({
    ...OWN, method: 'post', path: '/me/visited-experiences/:experienceId',
    params: experienceIdParamSchema,
    body: markVisitedBodySchema,
    response: ExperienceVisitMarked,
    handler: markVisited,
  }),
  defineRoute({
    ...OWN, method: 'delete', path: '/me/visited-experiences/:experienceId',
    params: experienceIdParamSchema,
    response: ExperienceVisitUnmarked,
    handler: unmarkVisited,
  }),

  // =============================================================================
  // Visited Locations (multi-location support)
  // =============================================================================

  defineRoute({
    ...OWN, method: 'get', path: '/me/visited-locations/ids',
    query: visitedLocationIdsQuerySchema,
    response: VisitedLocationIds,
    handler: getVisitedLocationIds,
  }),
  defineRoute({
    ...OWN, method: 'post', path: '/me/visited-locations/:locationId',
    params: locationIdParamSchema,
    body: markLocationVisitedBodySchema,
    response: LocationVisitMarked,
    handler: markLocationVisited,
  }),
  defineRoute({
    ...OWN, method: 'delete', path: '/me/visited-locations/:locationId',
    params: locationIdParamSchema,
    response: LocationVisitUnmarked,
    handler: unmarkLocationVisited,
  }),
  // An experience's visited status with its locations broken down
  defineRoute({
    ...OWN, method: 'get', path: '/me/experiences/:id/visited-status',
    params: idParamSchema,
    response: ExperienceVisitedStatusResponse,
    handler: getExperienceVisitedStatus,
  }),
  // Mark every location of an experience visited (or only those in a region)
  defineRoute({
    ...OWN, method: 'post', path: '/me/experiences/:experienceId/mark-all-locations',
    params: experienceIdParamSchema,
    query: markAllLocationsQuerySchema,
    response: AllLocationsMarked,
    handler: markAllLocationsVisited,
  }),
  defineRoute({
    ...OWN, method: 'delete', path: '/me/experiences/:experienceId/mark-all-locations',
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
    query: viewedTreasureIdsQuerySchema,
    response: ViewedTreasureIds,
    handler: getViewedTreasureIds,
  }),
  // Mark a treasure viewed (auto-marks the venue it was seen in as visited)
  defineRoute({
    ...OWN, method: 'post', path: '/me/viewed-treasures/:treasureId',
    params: treasureIdParamSchema,
    body: markTreasureViewedBodySchema,
    response: TreasureViewMarked,
    handler: markTreasureViewed,
  }),
  // Unmark a treasure viewed (does NOT unvisit the venue)
  defineRoute({
    ...OWN, method: 'delete', path: '/me/viewed-treasures/:treasureId',
    params: treasureIdParamSchema,
    response: TreasureViewUnmarked,
    handler: unmarkTreasureViewed,
  }),
];

export default routerOf(userRoutes);
