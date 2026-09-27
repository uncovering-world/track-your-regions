/**
 * Every route the API serves, by the prefix it is mounted under (ADR-0071).
 *
 * `routes/index.ts` builds the Express router from this list and
 * `api/generateOpenApi.ts` builds the OpenAPI document from it, so the two
 * cannot name different routes. It imports only route declarations, so
 * reading it starts nothing: no client, no connection.
 */

import type { Route } from '../api/route.js';
import { adminDeclaredRoutes } from './adminDeclaredRoutes.js';
import { aiRoutes } from './aiRoutes.js';
import { authRoutes } from './authRoutes.js';
import { divisionRoutes } from './divisionRoutes.js';
import { experienceCurationRoutes, experienceReadRoutes } from './experienceRoutes.js';
import { geocodeRoutes } from './geocodeRoutes.js';
import { healthRoutes } from './healthRoutes.js';
import { userRoutes } from './userRoutes.js';
import { worldViewRoutes } from './worldViewRoutes.js';

export interface Mount {
  /** Where the routes are mounted; `/` for the health check at the root. */
  readonly prefix: string;
  readonly routes: readonly Route[];
}

export const MOUNTS: readonly Mount[] = [
  { prefix: '/', routes: healthRoutes },
  { prefix: '/api/auth', routes: authRoutes },
  { prefix: '/api/divisions', routes: divisionRoutes },
  { prefix: '/api/world-views', routes: worldViewRoutes },
  { prefix: '/api/users', routes: userRoutes },
  { prefix: '/api/ai', routes: aiRoutes },
  { prefix: '/api/admin', routes: adminDeclaredRoutes },
  // The reads first: none of them is a route of a method and a shape a
  // curation route shares, and `routerOf` refuses any order in which one would
  // answer for another.
  { prefix: '/api/experiences', routes: [...experienceReadRoutes, ...experienceCurationRoutes] },
  { prefix: '/api/geocode', routes: geocodeRoutes },
];
