/**
 * Administrative Divisions Routes
 *
 * GADM's administrative divisions (countries, states, cities, …), mounted at
 * /api/divisions. Every route is the editor's, so every one is `admin`.
 */
import { defineRoute } from '../api/route.js';
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
    summary: 'List the top-level GADM divisions, the ones with no parent',
    response: AdministrativeDivisions,
    handler: getRootDivisions,
  }),
  defineRoute({
    method: 'get', path: '/search', access: 'admin', cache: 'no-store',
    summary: 'Search GADM divisions by name, fuzzily, with their use in a world view',
    query: searchQuerySchema,
    response: DivisionSearchResults,
    handler: searchDivisions,
  }),
  defineRoute({
    method: 'get', path: '/:divisionId', access: 'admin', cache: 'no-store',
    summary: 'Read one GADM division with its framing box and anchor point',
    params: divisionIdParamSchema,
    response: AdministrativeDivision,
    handler: getDivisionById,
  }),
  defineRoute({
    method: 'get', path: '/:divisionId/subdivisions', access: 'admin', cache: 'no-store',
    summary: 'List the children of a division, or all its descendants, a page at a time',
    params: divisionIdParamSchema,
    query: getSubdivisionsQuerySchema,
    response: AdministrativeDivisions,
    handler: getSubdivisions,
  }),
  defineRoute({
    method: 'get', path: '/:divisionId/ancestors', access: 'admin', cache: 'no-store',
    summary: 'List the chain of divisions from the root down to this one',
    params: divisionIdParamSchema,
    response: AdministrativeDivisions,
    handler: getAncestors,
  }),
  defineRoute({
    method: 'get', path: '/:divisionId/siblings', access: 'admin', cache: 'no-store',
    summary: 'List the divisions that share the parent of this one, itself included',
    params: divisionIdParamSchema,
    response: AdministrativeDivisions,
    handler: getSiblings,
  }),
  // GADM's own boundary: the same shape for every caller, 2.8 MB of GeoJSON
  // for France at full resolution. Admin-gated because only the editor asks for
  // it, not because it is anyone's own, so the browser keeps it and
  // revalidates rather than fetching it whole on every dialog open
  // (`revalidate` in `api/route.ts` has the rule).
  defineRoute({
    method: 'get', path: '/:divisionId/geometry', access: 'admin', cache: 'revalidate',
    summary: 'Read the boundary of a division as GeoJSON at a chosen level of detail',
    params: divisionIdParamSchema,
    query: getGeometryQuerySchema,
    response: DivisionGeometry,
    noContent: true,
    handler: getGeometry,
  }),
];

