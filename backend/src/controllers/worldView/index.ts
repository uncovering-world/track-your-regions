/**
 * World View Controllers
 *
 * This module provides all controller functions for world views, regions,
 * and their geometries. Re-exports from submodules for backward compatibility.
 *
 * Terminology:
 * - World View: A custom hierarchy for organizing regions (stored as world_views)
 * - Region: A user-defined grouping within a World View (stored as regions)
 * - Administrative Division: Official GADM boundary (stored in regions table)
 * - Member: An administrative division assigned to a region (stored as region_members)
 */

// World Views CRUD
export {
  getWorldViews,
  createWorldView,
  updateWorldView,
  deleteWorldView,
} from './worldViewCrud.js';

// Regions CRUD
export {
  getRegions,
  getRootRegions,
  getSubregions,
  getLeafRegions,
  getRegionAncestors,
  searchRegions,
  createRegion,
  updateRegion,
  deleteRegion,
} from './regionCrud.js';

// Region Member Queries
export { getRegionMembers, getRegionMemberGeometries } from './regionMemberQueries.js';
// Region Member Mutations
export { addDivisionsToRegion, removeDivisionsFromRegion, moveMemberToRegion } from './regionMemberMutations.js';
// Region Member Operations
export { addChildDivisionsAsSubregions, flattenSubregion, expandToSubregions, getDivisionUsageCounts } from './regionMemberOperations.js';

// Geometry Read Operations
export {
  getDisplayGeometryStatus,
  getRegionGeometry,
  getRootRegionGeometries,
  getSubregionGeometries,
} from './geometryRead.js';

// Geometry Compute Operations
export {
  regenerateDisplayGeometries,
  updateRegionGeometry,
  resetRegionToGADM,
  computeSingleRegionGeometry,
} from './geometryCompute.js';

// Geometry Compute with SSE streaming
export { computeSingleRegionGeometrySSE } from './geometryComputeSSE.js';

// Computation Progress
export {
  getComputationStatus,
  cancelComputation,
  computeWorldViewGeometries,
} from './computationProgress.js';

// Hull Operations
export {
  previewHullGeometry,
  saveHullGeometry,
  getSavedHullParams,
} from './hullOperations.js';


// Types (for advanced use cases)
export type { ComputationProgress } from './types.js';
export { runningComputations } from './types.js';

// Helpers (for advanced use cases)
export { invalidateRegionGeometry, recomputeRegionGeometry } from './helpers.js';
