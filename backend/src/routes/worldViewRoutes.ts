/**
 * World view routes, mounted at /api/world-views (ADR-0071).
 *
 * The reads are `optional`: an admin sees a hidden world view where everyone
 * else gets 404, which each read that names one says in its `scope`. Every
 * write is `admin`.
 */
import { defineRoute, NO_BODY, stream } from '../api/route.js';
import {
  ComputationCancelled,
  ComputationStartResult,
  ComputationStatus,
  ComputeProgressEvent,
  DisplayGeometryStatus,
  HullPreview,
  HullSaved,
  RegenerateDisplayGeometriesResult,
  RegionReset,
  SavedHullParams,
} from '../api/responses/geometry.js';
import {
  ChildDivisionsAdded,
  DescendantMemberGeometries,
  DivisionsAdded,
  DivisionsRemoved,
  DivisionUsageCounts,
  MemberGeometries,
  MemberMoved,
  Region,
  RegionGeometry,
  RegionMembers,
  Regions,
  RegionSearchResults,
  RegionUpdated,
  SubregionFlattened,
  SubregionsExpanded,
} from '../api/responses/regions.js';
import { DeleteImpact, WorldView, WorldViews } from '../api/responses/worldViews.js';
import {
  getWorldViews,
  createWorldView,
  updateWorldView,
  getDeleteImpact,
  deleteWorldView,
  getRegions,
  getRootRegions,
  getSubregions,
  getRegionAncestors,
  searchRegions,
  createRegion,
  updateRegion,
  deleteRegion,
  getRegionMembers,
  getRegionMemberGeometries,
  getDescendantMemberGeometries,
  addDivisionsToRegion,
  removeDivisionsFromRegion,
  moveMemberToRegion,
  addChildDivisionsAsSubregions,
  flattenSubregion,
  expandToSubregions,
  getDivisionUsageCounts,
  getDisplayGeometryStatus,
  regenerateDisplayGeometries,
  getRegionGeometry,
  updateRegionGeometry,
  resetRegionToGADM,
  computeSingleRegionGeometrySSE,
  computeWorldViewGeometries,
  getComputationStatus,
  cancelComputation,
  previewHullGeometry,
  saveHullGeometry,
  getSavedHullParams,
} from '../controllers/worldView/index.js';
import { publicReadLimiter } from '../middleware/rateLimiter.js';
import {
  worldViewIdParamSchema,
  regionIdParamSchema,
  regionDivisionParamSchema,
  flattenParamSchema,
  createWorldViewBodySchema,
  updateWorldViewBodySchema,
  createRegionBodySchema,
  updateRegionBodySchema,
  deleteRegionQuerySchema,
  regionSearchQuerySchema,
  addDivisionsToRegionBodySchema,
  removeDivisionsFromRegionBodySchema,
  moveMemberBodySchema,
  addChildDivisionsBodySchema,
  expandToSubregionsBodySchema,
  divisionUsageBodySchema,
  hullPreviewBodySchema,
  hullSaveBodySchema,
  updateGeometryBodySchema,
  computeGeometryQuerySchema,
  computeSSEQuerySchema,
  regenerateDisplayQuerySchema,
  regionGeometryDetailQuerySchema,
} from '../types/index.js';

export const worldViewRoutes = [
  // ===========================================================================
  // World View CRUD
  // ===========================================================================
  // The list is shaped by its caller: an admin's includes the hidden ones.
  defineRoute({
    method: 'get', path: '/', access: 'optional', cache: 'revalidate', limiter: publicReadLimiter,
    summary: 'List the active world views, including hidden ones for an admin',
    response: WorldViews,
    handler: getWorldViews,
  }),
  defineRoute({
    method: 'post', path: '/', access: 'admin', cache: 'no-store', status: 201,
    summary: 'Create a world view, hidden until it is published',
    body: createWorldViewBodySchema,
    response: WorldView,
    handler: createWorldView,
  }),
  defineRoute({
    method: 'put', path: '/:worldViewId', access: 'admin', cache: 'no-store',
    summary: 'Update the name, description, source or visibility of a world view',
    params: worldViewIdParamSchema,
    body: updateWorldViewBodySchema,
    response: WorldView,
    handler: updateWorldView,
  }),
  defineRoute({
    method: 'get', path: '/:worldViewId/delete-impact', access: 'admin', cache: 'no-store',
    summary: 'Count the regions, experience assignments and visits that deleting a world view removes',
    params: worldViewIdParamSchema,
    response: DeleteImpact,
    handler: getDeleteImpact,
  }),
  defineRoute({
    method: 'delete', path: '/:worldViewId', access: 'admin', cache: 'no-store',
    summary: 'Delete a world view with its regions and their visits; the GADM default is refused',
    params: worldViewIdParamSchema,
    response: NO_BODY,
    noContent: true,
    handler: deleteWorldView,
  }),

  // ===========================================================================
  // Regions within a World View (user-defined groupings)
  // ===========================================================================
  defineRoute({
    method: 'get', path: '/:worldViewId/regions', access: 'optional', cache: 'revalidate', limiter: publicReadLimiter,
    summary: 'List every region of a world view as one flat list, sorted by name',
    params: worldViewIdParamSchema,
    scope: ({ params }) => ({ worldViewId: params.worldViewId }),
    response: Regions,
    handler: getRegions,
  }),
  defineRoute({
    method: 'get', path: '/:worldViewId/regions/root', access: 'optional', cache: 'revalidate', limiter: publicReadLimiter,
    summary: 'List the top-level regions of a world view',
    params: worldViewIdParamSchema,
    scope: ({ params }) => ({ worldViewId: params.worldViewId }),
    response: Regions,
    handler: getRootRegions,
  }),
  defineRoute({
    method: 'get', path: '/:worldViewId/regions/search', access: 'optional', cache: 'revalidate', limiter: publicReadLimiter,
    summary: 'Search the regions of a world view by name, tolerating accents and typos',
    params: worldViewIdParamSchema,
    query: regionSearchQuerySchema,
    scope: ({ params }) => ({ worldViewId: params.worldViewId }),
    response: RegionSearchResults,
    handler: searchRegions,
  }),
  defineRoute({
    method: 'post', path: '/:worldViewId/regions', access: 'admin', cache: 'no-store', status: 201,
    summary: 'Create a region in a world view, optionally with a hand-drawn boundary',
    params: worldViewIdParamSchema,
    body: createRegionBodySchema,
    response: Region,
    handler: createRegion,
  }),

  // ===========================================================================
  // World View geometry operations
  // ===========================================================================
  defineRoute({
    method: 'post', path: '/:worldViewId/compute-geometries', access: 'admin', cache: 'no-store',
    summary: 'Start computing the region geometries of a world view in the background',
    params: worldViewIdParamSchema,
    query: computeGeometryQuerySchema,
    response: ComputationStartResult,
    handler: computeWorldViewGeometries,
  }),
  defineRoute({
    method: 'get', path: '/:worldViewId/compute-geometries/status', access: 'optional', cache: 'revalidate', limiter: publicReadLimiter,
    summary: 'Get the progress of the background geometry computation of a world view',
    params: worldViewIdParamSchema,
    scope: ({ params }) => ({ worldViewId: params.worldViewId }),
    response: ComputationStatus,
    handler: getComputationStatus,
  }),
  defineRoute({
    method: 'post', path: '/:worldViewId/compute-geometries/cancel', access: 'admin', cache: 'no-store',
    summary: 'Ask the running geometry computation of a world view to stop',
    params: worldViewIdParamSchema,
    response: ComputationCancelled,
    handler: cancelComputation,
  }),
  // A read sent as a POST, since the division ids it asks about can be many.
  defineRoute({
    method: 'post', path: '/:worldViewId/division-usage', access: 'optional', cache: 'revalidate', limiter: publicReadLimiter,
    summary: 'Count how many regions of a world view hold each of the given divisions',
    params: worldViewIdParamSchema,
    body: divisionUsageBodySchema,
    scope: ({ params }) => ({ worldViewId: params.worldViewId }),
    response: DivisionUsageCounts,
    handler: getDivisionUsageCounts,
  }),

  // Display geometry operations (for zoom-based rendering)
  defineRoute({
    method: 'get', path: '/:worldViewId/display-geometry-status', access: 'optional', cache: 'revalidate', limiter: publicReadLimiter,
    summary: 'Count the regions of a world view that have a geometry, an anchor point and a hull',
    params: worldViewIdParamSchema,
    scope: ({ params }) => ({ worldViewId: params.worldViewId }),
    response: DisplayGeometryStatus,
    handler: getDisplayGeometryStatus,
  }),
  defineRoute({
    method: 'post', path: '/:worldViewId/regenerate-display-geometries', access: 'admin', cache: 'no-store',
    summary: 'Recompute area, anchor point and map frame for the regions of a world view or one branch',
    params: worldViewIdParamSchema,
    query: regenerateDisplayQuerySchema,
    response: RegenerateDisplayGeometriesResult,
    handler: regenerateDisplayGeometries,
  }),

  // ===========================================================================
  // Individual Region operations
  // ===========================================================================
  defineRoute({
    method: 'get', path: '/regions/:regionId/ancestors', access: 'optional', cache: 'revalidate', limiter: publicReadLimiter,
    summary: 'List the ancestors of a region, from the root down to the region itself',
    params: regionIdParamSchema,
    scope: ({ params }) => ({ regionId: params.regionId }),
    response: Regions,
    handler: getRegionAncestors,
  }),
  defineRoute({
    method: 'get', path: '/regions/:regionId/subregions', access: 'optional', cache: 'revalidate', limiter: publicReadLimiter,
    summary: 'List the direct subregions of a region',
    params: regionIdParamSchema,
    scope: ({ params }) => ({ regionId: params.regionId }),
    response: Regions,
    handler: getSubregions,
  }),
  defineRoute({
    method: 'put', path: '/regions/:regionId', access: 'admin', cache: 'no-store',
    summary: 'Update the name, description, parent, color or hull choice of a region',
    params: regionIdParamSchema,
    body: updateRegionBodySchema,
    response: RegionUpdated,
    handler: updateRegion,
  }),
  defineRoute({
    method: 'delete', path: '/regions/:regionId', access: 'admin', cache: 'no-store',
    summary: 'Delete a region with its subregions, or move them to its parent; refused while visited',
    params: regionIdParamSchema,
    query: deleteRegionQuerySchema,
    response: NO_BODY,
    noContent: true,
    handler: deleteRegion,
  }),

  // ===========================================================================
  // Region members (administrative divisions and subregions)
  // ===========================================================================
  defineRoute({
    method: 'get', path: '/regions/:regionId/members', access: 'optional', cache: 'revalidate', limiter: publicReadLimiter,
    summary: 'List the members of a region: its subregions and its GADM divisions with their paths',
    params: regionIdParamSchema,
    scope: ({ params }) => ({ regionId: params.regionId }),
    response: RegionMembers,
    handler: getRegionMembers,
  }),
  defineRoute({
    method: 'get', path: '/regions/:regionId/members/geometries', access: 'optional', cache: 'revalidate', limiter: publicReadLimiter,
    summary: 'Get the outlines of the divisions in a region as GeoJSON, cut parts included',
    params: regionIdParamSchema,
    scope: ({ params }) => ({ regionId: params.regionId }),
    response: MemberGeometries,
    handler: getRegionMemberGeometries,
  }),
  defineRoute({
    method: 'get', path: '/regions/:regionId/members/descendant-geometries', access: 'optional', cache: 'revalidate', limiter: publicReadLimiter,
    summary: 'Get simplified outlines of the divisions in every subregion below a region, as GeoJSON',
    params: regionIdParamSchema,
    scope: ({ params }) => ({ regionId: params.regionId }),
    response: DescendantMemberGeometries,
    handler: getDescendantMemberGeometries,
  }),
  defineRoute({
    method: 'post', path: '/regions/:regionId/members', access: 'admin', cache: 'no-store', status: 201,
    summary: 'Add GADM divisions to a region, optionally each as a new subregion',
    params: regionIdParamSchema,
    body: addDivisionsToRegionBodySchema,
    response: DivisionsAdded,
    handler: addDivisionsToRegion,
  }),
  defineRoute({
    method: 'delete', path: '/regions/:regionId/members', access: 'admin', cache: 'no-store',
    summary: 'Remove whole divisions or individual cut parts from a region',
    params: regionIdParamSchema,
    body: removeDivisionsFromRegionBodySchema,
    response: DivisionsRemoved,
    handler: removeDivisionsFromRegion,
  }),
  defineRoute({
    method: 'post', path: '/regions/:regionId/members/move', access: 'admin', cache: 'no-store',
    summary: 'Move one member of a region, a cut part with its shape, to another region',
    params: regionIdParamSchema,
    body: moveMemberBodySchema,
    response: MemberMoved,
    handler: moveMemberToRegion,
  }),
  defineRoute({
    method: 'post', path: '/regions/:regionId/members/:divisionId/add-children', access: 'admin', cache: 'no-store', status: 201,
    summary: 'Replace a member division of a region with its GADM subdivisions, or add them beside it when asked',
    params: regionDivisionParamSchema,
    body: addChildDivisionsBodySchema,
    response: ChildDivisionsAdded,
    handler: addChildDivisionsAsSubregions,
  }),
  defineRoute({
    method: 'post', path: '/regions/:parentRegionId/flatten/:subregionId', access: 'admin', cache: 'no-store',
    summary: 'Fold a subregion and its descendants into the parent, moving their members up; refused while visited',
    params: flattenParamSchema,
    response: SubregionFlattened,
    handler: flattenSubregion,
  }),
  defineRoute({
    method: 'post', path: '/regions/:regionId/expand', access: 'admin', cache: 'no-store',
    summary: 'Turn each member of a region into a subregion of its own holding that member',
    params: regionIdParamSchema,
    body: expandToSubregionsBodySchema,
    response: SubregionsExpanded,
    handler: expandToSubregions,
  }),

  // ===========================================================================
  // Region geometry
  // ===========================================================================
  defineRoute({
    method: 'get', path: '/regions/:regionId/geometry', access: 'optional', cache: 'revalidate', limiter: publicReadLimiter,
    summary: 'Get the stored outline of a region, or its hull; no content while none is computed',
    params: regionIdParamSchema,
    query: regionGeometryDetailQuerySchema,
    scope: ({ params }) => ({ regionId: params.regionId }),
    response: RegionGeometry,
    noContent: true,
    handler: getRegionGeometry,
  }),
  defineRoute({
    method: 'put', path: '/regions/:regionId/geometry', access: 'admin', cache: 'no-store',
    summary: 'Save an outline for a region, optionally with its hull, marking whether it is hand-drawn',
    params: regionIdParamSchema,
    body: updateGeometryBodySchema,
    response: NO_BODY,
    noContent: true,
    handler: updateRegionGeometry,
  }),
  // A stream `EventSource` opens, so its token rides in the query string, which
  // the schema names for that reason; `revalidate` keeps it `private`, since the
  // request carries no Authorization for a shared cache to see.
  defineRoute({
    method: 'get', path: '/regions/:regionId/geometry/compute-stream', access: 'admin', cache: 'revalidate',
    summary: 'Compute the outline of one region from its members, streaming progress as server-sent events',
    params: regionIdParamSchema,
    query: computeSSEQuerySchema,
    response: stream(ComputeProgressEvent),
    handler: computeSingleRegionGeometrySSE,
  }),
  defineRoute({
    method: 'post', path: '/regions/:regionId/geometry/reset', access: 'admin', cache: 'no-store',
    summary: 'Drop the hand-drawn outline and hull of a region and rebuild it from its members',
    params: regionIdParamSchema,
    response: RegionReset,
    handler: resetRegionToGADM,
  }),

  // Hull preview and save (with custom parameters)
  defineRoute({
    method: 'post', path: '/regions/:regionId/hull/preview', access: 'admin', cache: 'no-store',
    summary: 'Preview a hull for a region with the given parameters, without saving it',
    params: regionIdParamSchema,
    body: hullPreviewBodySchema,
    response: HullPreview,
    handler: previewHullGeometry,
  }),
  defineRoute({
    method: 'post', path: '/regions/:regionId/hull/save', access: 'admin', cache: 'no-store',
    summary: 'Generate and save the hull of a region with the given parameters',
    params: regionIdParamSchema,
    body: hullSaveBodySchema,
    response: HullSaved,
    handler: saveHullGeometry,
  }),
  defineRoute({
    method: 'get', path: '/regions/:regionId/hull/params', access: 'optional', cache: 'revalidate', limiter: publicReadLimiter,
    summary: 'Get the hull parameters last saved for a region',
    params: regionIdParamSchema,
    scope: ({ params }) => ({ regionId: params.regionId }),
    response: SavedHullParams,
    handler: getSavedHullParams,
  }),
];

