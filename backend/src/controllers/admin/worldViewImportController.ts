/**
 * Admin WorldView Import Controller
 *
 * Pure barrel — re-exports all public handlers from domain-split files.
 * See ADR-0009 for the domain-split rationale.
 */

// =============================================================================
// Domain-split barrel (see ADR-0009)
// =============================================================================
export {
  getGeoshape,
  startWorldViewImport,
  getWorldViewImportStatus,
  cancelWorldViewImport,
} from './wvImportLifecycleController.js';
export {
  getMatchStats,
  acceptMatch,
  rejectMatch,
  rejectRemaining,
  acceptAndRejectRest,
  acceptBatchMatches,
  getMatchTree,
  selectMapImage,
  markManualFix,
} from './wvImportMatchController.js';
export {
  getCoverage,
  getCoverageSSE,
  geoSuggestGap,
  dismissCoverageGap,
  undismissCoverageGap,
  approveCoverageSuggestion,
} from './wvImportCoverageController.js';
export {
  startAIMatch,
  getAIMatchStatus,
  cancelAIMatchEndpoint,
  dbSearchOneRegion,
  geocodeMatch,
  resetMatch,
  aiMatchOneRegion,
} from './wvImportAIController.js';
export { dismissChildren, simplifyHierarchy, simplifyChildren } from './wvImportTreeOpsController.js';
export { undoLastOperation } from './wvImportHierarchyController.js';
export { syncInstances, handleAsGrouping } from './wvImportFlattenController.js';
export { finalizeReview } from './wvImportFinalizeController.js';
export { rematchWorldView, getRematchStatus } from './wvImportRematchController.js';
