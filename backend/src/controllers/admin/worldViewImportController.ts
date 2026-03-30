/**
 * WorldView Import Controller — Barrel re-export
 *
 * All endpoints split into focused sub-files.
 * This barrel ensures adminRoutes.ts needs zero changes.
 */

export { getGeoshape, startWorldViewImport, getWorldViewImportStatus, cancelWorldViewImport } from './wvImportLifecycleController.js';
export { getMatchStats, acceptMatch, rejectMatch, rejectRemaining, acceptAndRejectRest, clearMembers, acceptBatchMatches, getMatchTree, selectMapImage, markManualFix, getUnionGeometry, splitDivisionsDeeper, visionMatchDivisions, colorMatchDivisionsSSE, resolveWaterReview, getWaterCropImage, resolveParkReview, getParkCropImage, resolveClusterReview, getClusterPreviewImage, getClusterHighlightImage, resolveIcpAdjustment } from './wvImportMatchController.js';
export { getChildrenCoverage, getCoverageGeometry, analyzeCoverageGaps, getChildrenRegionGeometry } from './wvImportCoverageCompareController.js';
export { mergeChildIntoParent, removeRegionFromImport, dismissChildren, pruneToLeaves, simplifyHierarchy, simplifyChildren, detectSmartSimplify, applySmartSimplifyMove } from './wvImportTreeOpsController.js';
export { collapseToParent, smartFlattenPreview, smartFlatten, syncInstances, handleAsGrouping } from './wvImportFlattenController.js';
export { undoLastOperation, autoResolveChildrenPreview, autoResolveChildren } from './wvImportHierarchyController.js';
export { startAIMatch, getAIMatchStatus, cancelAIMatchEndpoint, dbSearchOneRegion, geocodeMatch, geoshapeMatch, pointMatch, resetMatch, aiMatchOneRegion, aiSuggestChildren, aiSuggestClusterRegions } from './wvImportAIController.js';
export { getCoverage, getCoverageSSE, geoSuggestGap, dismissCoverageGap, undismissCoverageGap, approveCoverageSuggestion } from './wvImportCoverageController.js';
export { rematchWorldView, getRematchStatus } from './wvImportRematchController.js';
export { finalizeReview, addChildRegion, dismissHierarchyWarnings } from './wvImportFinalizeController.js';
export { mapshapeMatchDivisions } from './wvImportMapshapeController.js';
export { renameRegion, reparentRegion } from './wvImportRenameController.js';
