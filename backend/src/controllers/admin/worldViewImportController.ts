/**
 * WorldView Import Controller — Barrel re-export
 *
 * All endpoints split into focused sub-files.
 * This barrel ensures adminRoutes.ts needs zero changes.
 */

export { getGeoshape, startWorldViewImport, getWorldViewImportStatus, cancelWorldViewImport } from './wvImportLifecycleController.js';
export { getMatchStats, acceptMatch, rejectMatch, rejectRemaining, acceptAndRejectRest, clearMembers, acceptBatchMatches, getMatchTree, selectMapImage, markManualFix, getUnionGeometry, splitDivisionsDeeper, visionMatchDivisions, colorMatchDivisionsSSE, resolveWaterReview, getWaterCropImage, resolveParkReview, getParkCropImage, resolveClusterReview, getClusterPreviewImage } from './wvImportMatchController.js';
export { getChildrenCoverage, getCoverageGeometry, analyzeCoverageGaps, getChildrenRegionGeometry } from './wvImportCoverageCompareController.js';
export { mergeChildIntoParent, removeRegionFromImport, dismissChildren, pruneToLeaves } from './wvImportTreeOpsController.js';
export { collapseToParent, smartFlattenPreview, smartFlatten, syncInstances, handleAsGrouping } from './wvImportFlattenController.js';
export { undoLastOperation, autoResolveChildrenPreview, autoResolveChildren } from './wvImportHierarchyController.js';
export { startAIMatch, getAIMatchStatus, cancelAIMatchEndpoint, dbSearchOneRegion, geocodeMatch, geoshapeMatch, pointMatch, resetMatch, aiMatchOneRegion, aiSuggestChildren } from './wvImportAIController.js';
export { getCoverage, getCoverageSSE, geoSuggestGap, dismissCoverageGap, undismissCoverageGap, approveCoverageSuggestion, finalizeReview, rematchWorldView, getRematchStatus, addChildRegion, dismissHierarchyWarnings } from './wvImportCoverageController.js';
export { mapshapeMatchDivisions } from './wvImportMapshapeController.js';
