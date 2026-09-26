/**
 * Administrative Divisions Routes
 *
 * GADM's administrative divisions (countries, states, cities, …), mounted at
 * /api/divisions. Every route is the editor's, so every one is `admin`.
 */
import { defineRoute, routerOf } from '../api/route.js';
import {
  AdministrativeDivision,
  AdministrativeDivisions,
  DivisionGeometry,
  DivisionSearchResults,
} from '../api/responses/divisions.js';
import {
  getRootDivisions,
  getDivisionById,
  getSubdivisions,
  getAncestors,
  getSiblings,
  getGeometry,
  searchDivisions,
} from '../controllers/division/index.js';
import {
  divisionIdParamSchema,
  getSubdivisionsQuerySchema,
  getGeometryQuerySchema,
  searchQuerySchema,
} from '../types/index.js';

export const divisionRoutes = [
  defineRoute({
    method: 'get', path: '/root', access: 'admin', cache: 'no-store',
    response: AdministrativeDivisions,
    handler: getRootDivisions,
  }),
  defineRoute({
    method: 'get', path: '/search', access: 'admin', cache: 'no-store',
    query: searchQuerySchema,
    response: DivisionSearchResults,
    handler: searchDivisions,
  }),
  defineRoute({
    method: 'get', path: '/:divisionId', access: 'admin', cache: 'no-store',
    params: divisionIdParamSchema,
    response: AdministrativeDivision,
    handler: getDivisionById,
  }),
  defineRoute({
    method: 'get', path: '/:divisionId/subdivisions', access: 'admin', cache: 'no-store',
    params: divisionIdParamSchema,
    query: getSubdivisionsQuerySchema,
    response: AdministrativeDivisions,
    handler: getSubdivisions,
  }),
  defineRoute({
    method: 'get', path: '/:divisionId/ancestors', access: 'admin', cache: 'no-store',
    params: divisionIdParamSchema,
    response: AdministrativeDivisions,
    handler: getAncestors,
  }),
  defineRoute({
    method: 'get', path: '/:divisionId/siblings', access: 'admin', cache: 'no-store',
    params: divisionIdParamSchema,
    response: AdministrativeDivisions,
    handler: getSiblings,
  }),
  // GADM's own boundary: the same shape for every caller, 2.8 MB of GeoJSON
  // for France at full resolution. Admin-gated because only the editor asks for
  // it, not because it is anyone's own, so the browser keeps it and
  // revalidates rather than fetching it whole on every dialog open
  // (`middleware/cacheHeaders.ts` has the rule).
  defineRoute({
    method: 'get', path: '/:divisionId/geometry', access: 'admin', cache: 'revalidate',
    params: divisionIdParamSchema,
    query: getGeometryQuerySchema,
    response: DivisionGeometry,
    noContent: true,
    handler: getGeometry,
  }),
];

export default routerOf(divisionRoutes);
