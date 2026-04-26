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
  acceptWithTransfer,
  getTransferPreview,
  getMatchTree,
  selectMapImage,
  markManualFix,
  resolveIcpAdjustment,
  resolveClusterReview,
  getClusterPreviewImage,
  getClusterHighlightImage,
  getClusterOverlayImage,
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
  geoshapeMatch,
  pointMatch,
  resetMatch,
  aiMatchOneRegion,
  aiSuggestChildren,
} from './wvImportAIController.js';
export { removeRegionFromImport, renameRegion, dismissChildren, simplifyHierarchy, simplifyChildren } from './wvImportTreeOpsController.js';
export { finalizeReview, addChildRegion } from './wvImportFinalizeController.js';
export { undoLastOperation } from './wvImportHierarchyController.js';
export { syncInstances, handleAsGrouping } from './wvImportFlattenController.js';
export { rematchWorldView, getRematchStatus } from './wvImportRematchController.js';
export { detectSmartSimplify, applySmartSimplifyMove } from './wvImportSmartSimplifyController.js';
export { getChildrenRegionGeometry } from './wvImportCoverageController.js';
