/**
 * Admin WorldView Import Controller
 *
 * Pure barrel — re-exports all public handlers from domain-split files.
 * See ADR-0009 for the domain-split rationale.
 */

// =============================================================================
// Domain-split barrel (see ADR-0009)
// =============================================================================
export { getGeoshape, startWorldViewImport, getWorldViewImportStatus, cancelWorldViewImport } from './wvImportLifecycleController.js';
export { getMatchStats, acceptMatch, rejectMatch, rejectRemaining, acceptAndRejectRest, clearMembers, acceptBatchMatches, acceptWithTransfer, getTransferPreview, getMatchTree, selectMapImage, markManualFix, getUnionGeometry, splitDivisionsDeeper, visionMatchDivisions, colorMatchDivisionsSSE, resolveWaterReview, getWaterCropImage, resolveClusterReview, getClusterPreviewImage, getClusterHighlightImage, resolveIcpAdjustment } from './wvImportMatchController.js';
export { getChildrenCoverage, getCoverageGeometry, analyzeCoverageGaps, getChildrenRegionGeometry } from './wvImportCoverageCompareController.js';
export { mergeChildIntoParent, removeRegionFromImport, dismissChildren, pruneToLeaves, simplifyHierarchy, simplifyChildren, detectSmartSimplify, applySmartSimplifyMove, checkDivisionOverlap, getOverlapDivisionChildren, resolveOverlap } from './wvImportTreeOpsController.js';
export { collapseToParent, smartFlattenPreview, smartFlatten, syncInstances, handleAsGrouping } from './wvImportFlattenController.js';
export { undoLastOperation, autoResolveChildrenPreview, autoResolveChildren } from './wvImportHierarchyController.js';
export { startAIMatch, getAIMatchStatus, cancelAIMatchEndpoint, dbSearchOneRegion, geocodeMatch, geoshapeMatch, pointMatch, resetMatch, aiMatchOneRegion, aiSuggestChildren, aiSuggestClusterRegions } from './wvImportAIController.js';
export { getCoverage, getCoverageSSE, geoSuggestGap, dismissCoverageGap, undismissCoverageGap, approveCoverageSuggestion } from './wvImportCoverageController.js';
export { rematchWorldView, getRematchStatus } from './wvImportRematchController.js';
export { finalizeReview, addChildRegion, dismissHierarchyWarnings } from './wvImportFinalizeController.js';
export { mapshapeMatchDivisions } from './wvImportMapshapeController.js';
export { renameRegion, reparentRegion } from './wvImportRenameController.js';
export {
  getWorkUnitVerification, signOffWorkUnit, reopenWorkUnit,
  setWorkUnitFlag, confirmHierarchy, confirmSkeleton, setReferenceTerritory,
} from './wvImportWorkflowController.js';
