/**
 * API Client for Track Your Regions
 *
 * Terminology:
 * - AdministrativeDivision: Official GADM boundary (Germany, Bavaria, Munich)
 * - WorldView: Custom hierarchy for organizing regions
 * - Region: User-defined grouping within a WorldView
 */

// Re-export types
export type {
  GeoJSONFeatureCollection,
  HullParams,
  ComputationStatus,
  ComputationStartResult,
  DisplayGeometryStatus,
  RegenerateDisplayGeometriesResult,
} from './types.js';

export { DEFAULT_HULL_PARAMS } from './types.js';

// Re-export World Views API
export {
  fetchWorldViews,
  createWorldView,
  updateWorldView,
  deleteWorldView,
} from './worldViews.js';

// Re-export Divisions API
export {
  fetchRootDivisions,
  fetchDivision,
  fetchSubdivisions,
  fetchDivisionAncestors,
  fetchDivisionSiblings,
  fetchDivisionGeometry,
  fetchSubdivisionGeometries,
  fetchRootDivisionGeometries,
  searchDivisions,
} from './divisions.js';

// Re-export Views API
export {
  fetchViews,
  fetchViewDivisions,
} from './views.js';

// Re-export Regions API
export {
  searchRegions,
  type RegionSearchResult,
  fetchRegions,
  fetchRootRegions,
  fetchLeafRegions,
  fetchSubregions,
  fetchRegionAncestors,
  createRegion,
  updateRegion,
  updateRegionGeometry,
  deleteRegion,
  fetchRegionGeometry,
  fetchRegionMembers,
  fetchRegionMemberGeometries,
  fetchDescendantMemberGeometries,
  addDivisionsToRegion,
  removeDivisionsFromRegion,
  moveMemberToRegion,
  addChildDivisionsAsSubregions,
  flattenSubregion,
  expandToSubregions,
  fetchDivisionUsageCounts,
  fetchRootRegionGeometries,
  fetchSubregionGeometries,
} from './regions.js';

// Re-export Geometry API
export {
  computeRegionGeometry,
  computeRegionGeometryWithProgress,
  resetRegionToGADM,
  startWorldViewGeometryComputation,
  fetchWorldViewComputationStatus,
  cancelWorldViewGeometryComputation,
  fetchDisplayGeometryStatus,
  regenerateDisplayGeometries,
  previewHull,
  saveHull,
  fetchSavedHullParams,
  type ComputeProgressEvent,
} from './geometry.js';

// Visited regions
export {
  fetchVisitedRegions,
  fetchVisitedRegionsByWorldView,
  markRegionVisited,
  unmarkRegionVisited,
  type VisitedRegion,
} from './visited.js';

// URL exports
export { MARTIN_URL } from './fetchUtils.js';

// AI-assisted features
export {
  checkAIStatus,
  suggestGroupForRegion,
  suggestGroupsForMultipleRegions,
  generateGroupDescriptions,
  getAIModels,
  setAIModel,
  setWebSearchModel,
  type EscalationLevel,
  type GroupSuggestion,
  type AIStatusResponse,
  type AIModel,
  type TokenUsage,
  type BatchSuggestionResult,
} from './ai.js';

// Authentication
export {
  login,
  register,
  logout,
  refreshTokens,
  getCurrentUser,
  getGoogleAuthUrl,
  getAppleAuthUrl,
  getLastUsedEmail,
  setLastUsedEmail,
  clearLastUsedEmail,
  getLastGoogleEmail,
  setLastGoogleEmail,
  clearLastGoogleEmail,
} from './auth.js';

