import { Router } from 'express';
import {
  getWorldViews,
  createWorldView,
  updateWorldView,
  deleteWorldView,
  getRegions,
  getRootRegions,
  getSubregions,
  getLeafRegions,
  getRegionAncestors,
  searchRegions,
  createRegion,
  updateRegion,
  deleteRegion,
  getRegionMembers,
  getRegionMemberGeometries,
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
  computeSingleRegionGeometry,
  computeSingleRegionGeometrySSE,
  getRootRegionGeometries,
  getSubregionGeometries,
  computeWorldViewGeometries,
  getComputationStatus,
  cancelComputation,
  previewHullGeometry,
  saveHullGeometry,
  getSavedHullParams,
} from '../controllers/worldView/index.js';
import { requireAuth, requireAdmin, optionalAuth } from '../middleware/auth.js';
import { validate } from '../middleware/errorHandler.js';
import {
  worldViewIdParamSchema,
  regionIdParamSchema,
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
  subregionGeometriesQuerySchema,
  computeGeometryQuerySchema,
  computeSSEQuerySchema,
  regenerateDisplayQuerySchema,
  regionGeometryDetailQuerySchema,
} from '../types/index.js';

const router = Router();

// =============================================================================
// World View CRUD
// =============================================================================
// GET is public (optionalAuth), mutations require admin
router.get('/', optionalAuth, getWorldViews);
router.post('/', requireAuth, requireAdmin, validate(createWorldViewBodySchema), createWorldView);
router.put('/:worldViewId', validate(worldViewIdParamSchema, 'params'), requireAuth, requireAdmin, validate(updateWorldViewBodySchema), updateWorldView);
router.delete('/:worldViewId', validate(worldViewIdParamSchema, 'params'), requireAuth, requireAdmin, deleteWorldView);

// =============================================================================
// Regions within a World View (user-defined groupings)
// =============================================================================
// Read operations are public
router.get('/:worldViewId/regions', validate(worldViewIdParamSchema, 'params'), optionalAuth, getRegions);
router.get('/:worldViewId/regions/root', validate(worldViewIdParamSchema, 'params'), optionalAuth, getRootRegions);
router.get('/:worldViewId/regions/search', validate(worldViewIdParamSchema, 'params'), validate(regionSearchQuerySchema, 'query'), optionalAuth, searchRegions);
router.get('/:worldViewId/regions/leaf', validate(worldViewIdParamSchema, 'params'), optionalAuth, getLeafRegions);
// Write operations require admin
router.post('/:worldViewId/regions', validate(worldViewIdParamSchema, 'params'), requireAuth, requireAdmin, validate(createRegionBodySchema), createRegion);

// Legacy routes (groups -> regions)
router.get('/:worldViewId/groups', validate(worldViewIdParamSchema, 'params'), optionalAuth, getRegions);
router.get('/:worldViewId/groups/root', validate(worldViewIdParamSchema, 'params'), optionalAuth, getRootRegions);
router.post('/:worldViewId/groups', validate(worldViewIdParamSchema, 'params'), requireAuth, requireAdmin, validate(createRegionBodySchema), createRegion);

// =============================================================================
// World View geometry operations
// =============================================================================
router.get('/:worldViewId/regions/root/geometries', validate(worldViewIdParamSchema, 'params'), optionalAuth, getRootRegionGeometries);
router.get('/:worldViewId/groups/root/geometries', validate(worldViewIdParamSchema, 'params'), optionalAuth, getRootRegionGeometries);  // Legacy
router.post('/:worldViewId/compute-geometries', validate(worldViewIdParamSchema, 'params'), requireAuth, requireAdmin, computeWorldViewGeometries);
router.get('/:worldViewId/compute-geometries/status', validate(worldViewIdParamSchema, 'params'), optionalAuth, getComputationStatus);
router.post('/:worldViewId/compute-geometries/cancel', validate(worldViewIdParamSchema, 'params'), requireAuth, requireAdmin, cancelComputation);
router.post('/:worldViewId/division-usage', validate(worldViewIdParamSchema, 'params'), validate(divisionUsageBodySchema), optionalAuth, getDivisionUsageCounts);

// Display geometry operations (for zoom-based rendering)
router.get('/:worldViewId/display-geometry-status', validate(worldViewIdParamSchema, 'params'), optionalAuth, getDisplayGeometryStatus);
router.post('/:worldViewId/regenerate-display-geometries', validate(worldViewIdParamSchema, 'params'), validate(regenerateDisplayQuerySchema, 'query'), requireAuth, requireAdmin, regenerateDisplayGeometries);

// =============================================================================
// Individual Region operations
// =============================================================================
router.get('/regions/:regionId/ancestors', validate(regionIdParamSchema, 'params'), optionalAuth, getRegionAncestors);
router.get('/regions/:regionId/subregions', validate(regionIdParamSchema, 'params'), optionalAuth, getSubregions);
router.put('/regions/:regionId', validate(regionIdParamSchema, 'params'), requireAuth, requireAdmin, validate(updateRegionBodySchema), updateRegion);
router.delete('/regions/:regionId', validate(regionIdParamSchema, 'params'), validate(deleteRegionQuerySchema, 'query'), requireAuth, requireAdmin, deleteRegion);

// Legacy routes (groups -> regions)
router.get('/groups/:groupId/subgroups', optionalAuth, getSubregions);
router.put('/groups/:groupId', requireAuth, requireAdmin, validate(updateRegionBodySchema), updateRegion);
router.delete('/groups/:groupId', validate(deleteRegionQuerySchema, 'query'), requireAuth, requireAdmin, deleteRegion);

// =============================================================================
// Region members (administrative divisions and subregions)
// =============================================================================
router.get('/regions/:regionId/members', validate(regionIdParamSchema, 'params'), optionalAuth, getRegionMembers);
router.get('/regions/:regionId/members/geometries', validate(regionIdParamSchema, 'params'), optionalAuth, getRegionMemberGeometries);
router.post('/regions/:regionId/members', validate(regionIdParamSchema, 'params'), requireAuth, requireAdmin, validate(addDivisionsToRegionBodySchema), addDivisionsToRegion);
router.delete('/regions/:regionId/members', validate(regionIdParamSchema, 'params'), requireAuth, requireAdmin, validate(removeDivisionsFromRegionBodySchema), removeDivisionsFromRegion);
router.post('/regions/:regionId/members/move', validate(regionIdParamSchema, 'params'), requireAuth, requireAdmin, validate(moveMemberBodySchema), moveMemberToRegion);
router.post('/regions/:regionId/members/:divisionId/add-children', requireAuth, requireAdmin, validate(addChildDivisionsBodySchema), addChildDivisionsAsSubregions);
router.post('/regions/:parentRegionId/flatten/:subregionId', requireAuth, requireAdmin, flattenSubregion);
router.post('/regions/:regionId/expand', validate(regionIdParamSchema, 'params'), requireAuth, requireAdmin, validate(expandToSubregionsBodySchema), expandToSubregions);

// Legacy routes for members (groups -> regions)
router.get('/groups/:groupId/members', optionalAuth, getRegionMembers);
router.post('/groups/:groupId/members', requireAuth, requireAdmin, validate(addDivisionsToRegionBodySchema), addDivisionsToRegion);
router.delete('/groups/:groupId/members', requireAuth, requireAdmin, validate(removeDivisionsFromRegionBodySchema), removeDivisionsFromRegion);
router.post('/groups/:groupId/members/:regionId/add-children', requireAuth, requireAdmin, validate(addChildDivisionsBodySchema), addChildDivisionsAsSubregions);
router.post('/groups/:parentGroupId/flatten/:subgroupId', requireAuth, requireAdmin, flattenSubregion);
router.post('/groups/:groupId/expand', requireAuth, requireAdmin, validate(expandToSubregionsBodySchema), expandToSubregions);

// =============================================================================
// Region geometry
// =============================================================================
router.get('/regions/:regionId/geometry', validate(regionIdParamSchema, 'params'), validate(regionGeometryDetailQuerySchema, 'query'), optionalAuth, getRegionGeometry);
router.put('/regions/:regionId/geometry', validate(regionIdParamSchema, 'params'), requireAuth, requireAdmin, validate(updateGeometryBodySchema), updateRegionGeometry);
router.post('/regions/:regionId/geometry/compute', validate(regionIdParamSchema, 'params'), validate(computeGeometryQuerySchema, 'query'), requireAuth, requireAdmin, computeSingleRegionGeometry);
router.get('/regions/:regionId/geometry/compute-stream', validate(regionIdParamSchema, 'params'), validate(computeSSEQuerySchema, 'query'), requireAuth, requireAdmin, computeSingleRegionGeometrySSE);
router.post('/regions/:regionId/geometry/reset', validate(regionIdParamSchema, 'params'), requireAuth, requireAdmin, resetRegionToGADM);
router.get('/regions/:regionId/subregions/geometries', validate(regionIdParamSchema, 'params'), validate(subregionGeometriesQuerySchema, 'query'), optionalAuth, getSubregionGeometries);

// Hull preview and save (with custom parameters)
router.post('/regions/:regionId/hull/preview', validate(regionIdParamSchema, 'params'), requireAuth, requireAdmin, validate(hullPreviewBodySchema), previewHullGeometry);
router.post('/regions/:regionId/hull/save', validate(regionIdParamSchema, 'params'), requireAuth, requireAdmin, validate(hullSaveBodySchema), saveHullGeometry);
router.get('/regions/:regionId/hull/params', validate(regionIdParamSchema, 'params'), optionalAuth, getSavedHullParams);

// Legacy routes for geometry (groups -> regions)
router.get('/groups/:groupId/geometry', validate(regionGeometryDetailQuerySchema, 'query'), optionalAuth, getRegionGeometry);
router.put('/groups/:groupId/geometry', requireAuth, requireAdmin, validate(updateGeometryBodySchema), updateRegionGeometry);
router.post('/groups/:groupId/geometry/compute', validate(computeGeometryQuerySchema, 'query'), requireAuth, requireAdmin, computeSingleRegionGeometry);
router.get('/groups/:groupId/subgroups/geometries', validate(subregionGeometriesQuerySchema, 'query'), optionalAuth, getSubregionGeometries);

export default router;
