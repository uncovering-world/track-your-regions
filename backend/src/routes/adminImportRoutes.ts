/**
 * The declared routes of the world-view import and the Wikivoyage extraction
 * under `/api/admin` (ADR-0071), kept apart from `routes/adminDeclaredRoutes.ts`
 * for size; that list spreads these into its own, so `routerOf` still builds
 * one list. Every route is the admin's.
 */

import { defineRoute } from '../api/route.js';
import { expensiveAdminLimiter } from '../middleware/rateLimiter.js';
import {
  baseLayerImportBodySchema, childrenCoverageQuerySchema, divisionIdBodySchema, worldViewIdParamSchema,
  worldViewRegionIdParamSchema, wvCacheNameParamSchema, wvExtractAnswerSchema, wvExtractStartSchema,
  wvImportAcceptBatchSchema, wvImportAcceptMatchSchema, wvImportAcceptTransferSchema, wvImportAddChildSchema,
  wvImportAiSuggestClustersSchema, wvImportApproveCoverageSchema, wvImportBodySchema, wvImportDecideBatchSchema,
  wvImportGeoshapeMatchSchema, wvImportMarkManualFixSchema, wvImportOverlapChildrenSchema, wvImportRegionIdSchema,
  wvImportRematchBodySchema, wvImportRemoveRegionSchema, wvImportRenameRegionSchema, wvImportReparentRegionSchema,
  wvImportResolveOverlapSchema, wvImportSelectMapImageSchema, wvImportSmartSimplifyApplySchema,
  wvImportSmartSimplifySchema, wvImportSplitDeeperSchema, wvImportTransferPreviewSchema, wvImportUnionGeometrySchema,
  wvImportVisionMatchSchema,
} from '../types/index.js';
import {
  ExtractionAnswer, ExtractionCancelled, ExtractionStarted, ExtractionStatus, WikivoyageCacheDeleted,
} from '../api/responses/wikivoyageExtract.js';
import {
  AIMatchCancelled, AIMatchOneResult, AIMatchStarted, AIMatchStatus, CoveringMatchResult, DbSearchResult,
  GeocodeMatchResult, ImportCancelled, ImportStarted, ImportStatus, InstancesSynced, MatchAccepted,
  MatchAcceptedRestRejected, MatchesAccepted, MatchReset, MatchStats, MatchTree, RemainingRejected, RematchStarted,
  RematchStatus, SuggestionRejected, TransferAccepted, TransferPreview,
} from '../api/responses/worldViewImport.js';
import {
  AutoResolvePreview, ChildMerged, ChildRegionAdded, ChildrenAutoResolved, ChildrenCollapsed, ChildrenDismissed,
  ChildrenGrouped, ChildrenReviewed, ChildrenSimplified, DescendantsPruned, DivisionOverlaps, FlattenPreviewResult,
  HierarchySimplified, HierarchyWarningsDismissed, ManualFixMarked, MapImageSelected, MembersCleared, OperationUndone,
  OverlapChildren, OverlapResolved, RegionRemoved, RegionRenamed, RegionReparented, SelectionAccepted,
  SelectionRejected, SmartFlattenResult, SmartSimplifyApplied, SmartSimplifyMoves,
} from '../api/responses/wvImportTreeOps.js';
import {
  ChildRegionGeometries, ChildrenCoverage, CoverageApproved, CoverageGapAnalysis, CoverageGeometry, CoverageResult,
  GapDismissed, GapUndismissed, GeoSuggestResult, ReviewFinalized, SplitDeeperResult, UnionGeometryResult,
  VisionMatchResult,
} from '../api/responses/wvImportCoverage.js';
import { ClusterRegionSuggestions, MapshapeMatchResult } from '../api/responses/wvImportCvMatch.js';
import {
  answerExtractionQuestion, cancelWikivoyageExtraction, deleteCacheFile, getWikivoyageExtractionStatus,
  startWikivoyageExtraction,
} from '../controllers/admin/wikivoyageExtractController.js';
import {
  cancelWorldViewImport, getWorldViewImportStatus, startWorldViewImport,
} from '../controllers/admin/wvImportLifecycleController.js';
import { startBaseLayerImportEndpoint } from '../controllers/admin/baseLayerImportController.js';
import {
  acceptAndRejectRest, acceptBatchMatches, acceptMatch, clearMembers, getMatchStats, getMatchTree, markManualFix,
  rejectMatch, rejectRemaining, selectMapImage,
} from '../controllers/admin/wvImportMatchController.js';
import { acceptBatchAndRejectRest, rejectBatchSuggestions } from '../controllers/admin/wvImportMatchDecisions.js';
import { acceptWithTransfer, getTransferPreview } from '../controllers/admin/wvImportMatchTransfer.js';
import {
  getUnionGeometry, splitDivisionsDeeper, visionMatchDivisions,
} from '../controllers/admin/wvImportMatchGeometryController.js';
import { mapshapeMatchDivisions } from '../controllers/admin/wvImportMapshapeController.js';
import {
  aiMatchOneRegion, aiSuggestChildren, aiSuggestClusterRegions, cancelAIMatchEndpoint, dbSearchOneRegion,
  geocodeMatch, geoshapeMatch, getAIMatchStatus, pointMatch, resetMatch, startAIMatch,
} from '../controllers/admin/wvImportAIController.js';
import {
  dismissChildren, mergeChildIntoParent, pruneToLeaves, removeRegionFromImport, simplifyChildren, simplifyHierarchy,
} from '../controllers/admin/wvImportTreeOpsController.js';
import {
  collapseToParent, handleAsGrouping, smartFlatten, smartFlattenPreview, syncInstances,
} from '../controllers/admin/wvImportFlattenController.js';
import {
  autoResolveChildren, autoResolveChildrenPreview, undoLastOperation,
} from '../controllers/admin/wvImportHierarchyController.js';
import { applySmartSimplifyMove, detectSmartSimplify } from '../controllers/admin/wvImportSmartSimplifyController.js';
import {
  checkDivisionOverlap, getOverlapDivisionChildren, resolveOverlap,
} from '../controllers/admin/wvImportOverlapController.js';
import { renameRegion, reparentRegion } from '../controllers/admin/wvImportRenameController.js';
import {
  addChildRegion, dismissHierarchyWarnings, finalizeReview,
} from '../controllers/admin/wvImportFinalizeController.js';
import {
  analyzeCoverageGaps, getChildrenCoverage, getChildrenRegionGeometry, getCoverageGeometry,
} from '../controllers/admin/wvImportCoverageCompareController.js';
import {
  approveCoverageSuggestion, dismissCoverageGap, geoSuggestGap, getCoverage, undismissCoverageGap,
} from '../controllers/admin/wvImportCoverageController.js';
import { getRematchStatus, rematchWorldView } from '../controllers/admin/wvImportRematchController.js';

const ADMIN = { access: 'admin', cache: 'no-store' } as const;

export const adminImportRoutes = [
  // ===========================================================================
  // Wikivoyage extraction
  // ===========================================================================
  // Start extraction from Wikivoyage
  defineRoute({
    ...ADMIN, method: 'post', path: '/wv-extract/start',
    body: wvExtractStartSchema,
    response: ExtractionStarted,
    handler: startWikivoyageExtraction,
  }),
  // Poll extraction progress
  defineRoute({
    ...ADMIN, method: 'get', path: '/wv-extract/status',
    response: ExtractionStatus,
    handler: getWikivoyageExtractionStatus,
  }),
  // Cancel extraction
  defineRoute({
    ...ADMIN, method: 'post', path: '/wv-extract/cancel',
    response: ExtractionCancelled,
    handler: cancelWikivoyageExtraction,
  }),
  // Answer a pending AI question during extraction
  defineRoute({
    ...ADMIN, method: 'post', path: '/wv-extract/answer',
    body: wvExtractAnswerSchema,
    response: ExtractionAnswer,
    handler: answerExtractionQuestion,
  }),
  // Delete a cache file
  defineRoute({
    ...ADMIN, method: 'delete', path: '/wv-extract/caches/:name',
    params: wvCacheNameParamSchema,
    response: WikivoyageCacheDeleted,
    handler: deleteCacheFile,
  }),
  // ===========================================================================
  // World view import
  // ===========================================================================
  // Start import from JSON body
  defineRoute({
    ...ADMIN, method: 'post', path: '/wv-import/import',
    body: wvImportBodySchema,
    response: ImportStarted,
    handler: startWorldViewImport,
  }),
  // Start a base layer mirror import (progress via /wv-import/import/status)
  defineRoute({
    ...ADMIN, method: 'post', path: '/wv-import/base-layer',
    body: baseLayerImportBodySchema,
    response: ImportStarted,
    handler: startBaseLayerImportEndpoint,
  }),
  // Poll import progress
  defineRoute({
    ...ADMIN, method: 'get', path: '/wv-import/import/status',
    response: ImportStatus,
    handler: getWorldViewImportStatus,
  }),
  // Cancel import
  defineRoute({
    ...ADMIN, method: 'post', path: '/wv-import/import/cancel',
    response: ImportCancelled,
    handler: cancelWorldViewImport,
  }),
  // Get match statistics for a world view
  defineRoute({
    ...ADMIN, method: 'get', path: '/wv-import/matches/:worldViewId/stats',
    params: worldViewIdParamSchema,
    response: MatchStats,
    handler: getMatchStats,
  }),
  // Get hierarchical match tree for a world view
  defineRoute({
    ...ADMIN, method: 'get', path: '/wv-import/matches/:worldViewId/tree',
    params: worldViewIdParamSchema,
    response: MatchTree,
    handler: getMatchTree,
  }),
  // Accept a single match
  defineRoute({
    ...ADMIN, method: 'post', path: '/wv-import/matches/:worldViewId/accept',
    params: worldViewIdParamSchema,
    body: wvImportAcceptMatchSchema,
    response: MatchAccepted,
    handler: acceptMatch,
  }),
  // Reject (dismiss) a single suggestion
  defineRoute({
    ...ADMIN, method: 'post', path: '/wv-import/matches/:worldViewId/reject',
    params: worldViewIdParamSchema,
    body: wvImportAcceptMatchSchema,
    response: SuggestionRejected,
    handler: rejectMatch,
  }),
  defineRoute({
    ...ADMIN, method: 'post', path: '/wv-import/matches/:worldViewId/reject-remaining',
    params: worldViewIdParamSchema,
    body: wvImportRegionIdSchema,
    response: RemainingRejected,
    handler: rejectRemaining,
  }),
  // Accept a match and reject all remaining suggestions in one transaction
  defineRoute({
    ...ADMIN, method: 'post', path: '/wv-import/matches/:worldViewId/accept-and-reject',
    params: worldViewIdParamSchema,
    body: wvImportAcceptMatchSchema,
    response: MatchAcceptedRestRejected,
    handler: acceptAndRejectRest,
  }),
  // The review's selection toolbar: the same two verdicts for several of a region's suggestions at once
  defineRoute({
    ...ADMIN, method: 'post', path: '/wv-import/matches/:worldViewId/accept-batch-and-reject-rest',
    params: worldViewIdParamSchema,
    body: wvImportDecideBatchSchema,
    response: SelectionAccepted,
    handler: acceptBatchAndRejectRest,
  }),
  defineRoute({
    ...ADMIN, method: 'post', path: '/wv-import/matches/:worldViewId/reject-batch',
    params: worldViewIdParamSchema,
    body: wvImportDecideBatchSchema,
    response: SelectionRejected,
    handler: rejectBatchSuggestions,
  }),
  // Clear all assigned divisions from a region (keep suggestions)
  defineRoute({
    ...ADMIN, method: 'post', path: '/wv-import/matches/:worldViewId/clear-members',
    params: worldViewIdParamSchema,
    body: wvImportRegionIdSchema,
    response: MembersCleared,
    handler: clearMembers,
  }),
  // Accept a batch of matches
  defineRoute({
    ...ADMIN, method: 'post', path: '/wv-import/matches/:worldViewId/accept-batch',
    params: worldViewIdParamSchema,
    body: wvImportAcceptBatchSchema,
    response: MatchesAccepted,
    handler: acceptBatchMatches,
  }),
  // Accept with transfer: atomically move divisions from donor region to target
  defineRoute({
    ...ADMIN, method: 'post', path: '/wv-import/matches/:worldViewId/accept-with-transfer',
    params: worldViewIdParamSchema,
    body: wvImportAcceptTransferSchema,
    response: TransferAccepted,
    handler: acceptWithTransfer,
  }),
  // Transfer preview: 3-layer GeoJSON for visualising a proposed transfer operation
  defineRoute({
    ...ADMIN, method: 'post', path: '/wv-import/matches/:worldViewId/transfer-preview',
    params: worldViewIdParamSchema,
    body: wvImportTransferPreviewSchema,
    response: TransferPreview,
    handler: getTransferPreview,
  }),
  // Union geometry for multi-select preview
  defineRoute({
    ...ADMIN, method: 'post', path: '/wv-import/matches/:worldViewId/union-geometry',
    params: worldViewIdParamSchema,
    body: wvImportUnionGeometrySchema,
    response: UnionGeometryResult,
    handler: getUnionGeometry,
  }),
  // Split divisions deeper: replace divisions with their GADM children that intersect geoshape
  defineRoute({
    ...ADMIN, method: 'post', path: '/wv-import/matches/:worldViewId/split-deeper',
    params: worldViewIdParamSchema,
    body: wvImportSplitDeeperSchema,
    response: SplitDeeperResult,
    handler: splitDivisionsDeeper,
  }),
  // AI vision-based division matching
  defineRoute({
    ...ADMIN, method: 'post', path: '/wv-import/matches/:worldViewId/vision-match',
    params: worldViewIdParamSchema,
    body: wvImportVisionMatchSchema,
    response: VisionMatchResult,
    handler: visionMatchDivisions,
  }),
  // Mapshape-based division matching (Kartographer map regions)
  defineRoute({
    ...ADMIN, method: 'post', path: '/wv-import/matches/:worldViewId/mapshape-match',
    params: worldViewIdParamSchema,
    body: wvImportRegionIdSchema,
    response: MapshapeMatchResult,
    handler: mapshapeMatchDivisions,
  }),
  // AI-assisted re-matching
  defineRoute({
    ...ADMIN, method: 'post', path: '/wv-import/matches/:worldViewId/ai-match',
    params: worldViewIdParamSchema,
    response: AIMatchStarted,
    handler: startAIMatch,
  }),
  defineRoute({
    ...ADMIN, method: 'get', path: '/wv-import/matches/:worldViewId/ai-match/status',
    params: worldViewIdParamSchema,
    response: AIMatchStatus,
    handler: getAIMatchStatus,
  }),
  defineRoute({
    ...ADMIN, method: 'post', path: '/wv-import/matches/:worldViewId/ai-match/cancel',
    params: worldViewIdParamSchema,
    response: AIMatchCancelled,
    handler: cancelAIMatchEndpoint,
  }),
  defineRoute({
    ...ADMIN, method: 'post', path: '/wv-import/matches/:worldViewId/db-search-one',
    params: worldViewIdParamSchema,
    body: wvImportRegionIdSchema,
    response: DbSearchResult,
    handler: dbSearchOneRegion,
  }),
  defineRoute({
    ...ADMIN, method: 'post', path: '/wv-import/matches/:worldViewId/geocode-match',
    params: worldViewIdParamSchema,
    body: wvImportRegionIdSchema,
    response: GeocodeMatchResult,
    handler: geocodeMatch,
  }),
  defineRoute({
    ...ADMIN, method: 'post', path: '/wv-import/matches/:worldViewId/geoshape-match',
    params: worldViewIdParamSchema,
    body: wvImportGeoshapeMatchSchema,
    response: CoveringMatchResult,
    handler: geoshapeMatch,
  }),
  defineRoute({
    ...ADMIN, method: 'post', path: '/wv-import/matches/:worldViewId/point-match',
    params: worldViewIdParamSchema,
    body: wvImportGeoshapeMatchSchema,
    response: CoveringMatchResult,
    handler: pointMatch,
  }),
  defineRoute({
    ...ADMIN, method: 'post', path: '/wv-import/matches/:worldViewId/reset-match',
    params: worldViewIdParamSchema,
    body: wvImportRegionIdSchema,
    response: MatchReset,
    handler: resetMatch,
  }),
  defineRoute({
    ...ADMIN, method: 'post', path: '/wv-import/matches/:worldViewId/ai-match-one',
    params: worldViewIdParamSchema,
    body: wvImportRegionIdSchema,
    response: AIMatchOneResult,
    handler: aiMatchOneRegion,
  }),
  // Dismiss subregions (make parent a leaf)
  defineRoute({
    ...ADMIN, method: 'post', path: '/wv-import/matches/:worldViewId/dismiss-children',
    params: worldViewIdParamSchema,
    body: wvImportRegionIdSchema,
    response: ChildrenDismissed,
    handler: dismissChildren,
  }),
  // Prune to leaves: keep direct children, remove grandchildren+
  defineRoute({
    ...ADMIN, method: 'post', path: '/wv-import/matches/:worldViewId/prune-to-leaves',
    params: worldViewIdParamSchema,
    body: wvImportRegionIdSchema,
    response: DescendantsPruned,
    handler: pruneToLeaves,
  }),
  // Collapse to parent: clear children's data, generate suggestions for parent
  defineRoute({
    ...ADMIN, method: 'post', path: '/wv-import/matches/:worldViewId/collapse-to-parent',
    params: worldViewIdParamSchema,
    body: wvImportRegionIdSchema,
    response: ChildrenCollapsed,
    handler: collapseToParent,
  }),
  // Smart flatten: auto-match children, absorb divisions into parent, delete descendants
  defineRoute({
    ...ADMIN, method: 'post', path: '/wv-import/matches/:worldViewId/smart-flatten',
    params: worldViewIdParamSchema,
    body: wvImportRegionIdSchema,
    response: SmartFlattenResult,
    handler: smartFlatten,
  }),
  defineRoute({
    ...ADMIN, method: 'post', path: '/wv-import/matches/:worldViewId/smart-flatten/preview',
    params: worldViewIdParamSchema,
    body: wvImportRegionIdSchema,
    response: FlattenPreviewResult,
    handler: smartFlattenPreview,
  }),
  // Auto-resolve children: batch-match all unmatched leaf descendants
  defineRoute({
    ...ADMIN, method: 'post', path: '/wv-import/matches/:worldViewId/auto-resolve-children/preview',
    params: worldViewIdParamSchema,
    body: wvImportRegionIdSchema,
    response: AutoResolvePreview,
    handler: autoResolveChildrenPreview,
  }),
  defineRoute({
    ...ADMIN, method: 'post', path: '/wv-import/matches/:worldViewId/auto-resolve-children',
    params: worldViewIdParamSchema,
    body: wvImportRegionIdSchema,
    response: ChildrenAutoResolved,
    handler: autoResolveChildren,
  }),
  // Handle region as sub-continental grouping (match children as countries)
  defineRoute({
    ...ADMIN, method: 'post', path: '/wv-import/matches/:worldViewId/handle-as-grouping',
    params: worldViewIdParamSchema,
    body: wvImportRegionIdSchema,
    response: ChildrenGrouped,
    handler: handleAsGrouping,
  }),
  // Select map image from candidates
  defineRoute({
    ...ADMIN, method: 'post', path: '/wv-import/matches/:worldViewId/select-map-image',
    params: worldViewIdParamSchema,
    body: wvImportSelectMapImageSchema,
    response: MapImageSelected,
    handler: selectMapImage,
  }),
  // Mark/unmark region as needing manual fixes
  defineRoute({
    ...ADMIN, method: 'post', path: '/wv-import/matches/:worldViewId/mark-manual-fix',
    params: worldViewIdParamSchema,
    body: wvImportMarkManualFixSchema,
    response: ManualFixMarked,
    handler: markManualFix,
  }),
  // Merge single-child parent's only child into the parent
  defineRoute({
    ...ADMIN, method: 'post', path: '/wv-import/matches/:worldViewId/merge-child',
    params: worldViewIdParamSchema,
    body: wvImportRegionIdSchema,
    response: ChildMerged,
    handler: mergeChildIntoParent,
  }),
  // Simplify hierarchy: replace single-child chains with direct parent→grandchild links
  defineRoute({
    ...ADMIN, method: 'post', path: '/wv-import/matches/:worldViewId/simplify-hierarchy',
    params: worldViewIdParamSchema,
    body: wvImportRegionIdSchema,
    response: HierarchySimplified,
    handler: simplifyHierarchy,
  }),
  // Simplify children: simplify all child regions one by one
  defineRoute({
    ...ADMIN, method: 'post', path: '/wv-import/matches/:worldViewId/simplify-children',
    params: worldViewIdParamSchema,
    body: wvImportRegionIdSchema,
    response: ChildrenSimplified,
    handler: simplifyChildren,
  }),
  // Smart simplify: detect cross-sibling division moves for simplification
  defineRoute({
    ...ADMIN, method: 'post', path: '/wv-import/matches/:worldViewId/smart-simplify',
    params: worldViewIdParamSchema,
    body: wvImportSmartSimplifySchema,
    response: SmartSimplifyMoves,
    handler: detectSmartSimplify,
  }),
  // Smart simplify: apply a single move (reassign divisions + simplify)
  defineRoute({
    ...ADMIN, method: 'post', path: '/wv-import/matches/:worldViewId/smart-simplify/apply-move',
    params: worldViewIdParamSchema,
    body: wvImportSmartSimplifyApplySchema,
    response: SmartSimplifyApplied,
    handler: applySmartSimplifyMove,
  }),
  // Check division overlaps among children (shared/contained divisions)
  defineRoute({
    ...ADMIN, method: 'post', path: '/wv-import/matches/:worldViewId/check-overlap',
    params: worldViewIdParamSchema,
    body: wvImportSmartSimplifySchema,
    response: DivisionOverlaps,
    handler: checkDivisionOverlap,
  }),
  // Overlap resolution: get GADM children for split preview
  defineRoute({
    ...ADMIN, method: 'post', path: '/wv-import/matches/:worldViewId/overlap-children',
    params: worldViewIdParamSchema,
    body: wvImportOverlapChildrenSchema,
    response: OverlapChildren,
    handler: getOverlapDivisionChildren,
  }),
  // Overlap resolution: apply keep or split
  defineRoute({
    ...ADMIN, method: 'post', path: '/wv-import/matches/:worldViewId/resolve-overlap',
    params: worldViewIdParamSchema,
    body: wvImportResolveOverlapSchema,
    response: OverlapResolved,
    handler: resolveOverlap,
  }),
  // Remove a region from the import tree (optionally reparenting children)
  defineRoute({
    ...ADMIN, method: 'post', path: '/wv-import/matches/:worldViewId/remove-region',
    params: worldViewIdParamSchema,
    body: wvImportRemoveRegionSchema,
    response: RegionRemoved,
    handler: removeRegionFromImport,
  }),
  // Rename a region
  defineRoute({
    ...ADMIN, method: 'post', path: '/wv-import/matches/:worldViewId/rename-region',
    params: worldViewIdParamSchema,
    body: wvImportRenameRegionSchema,
    response: RegionRenamed,
    handler: renameRegion,
  }),
  // Move a region to a new parent
  defineRoute({
    ...ADMIN, method: 'post', path: '/wv-import/matches/:worldViewId/reparent-region',
    params: worldViewIdParamSchema,
    body: wvImportReparentRegionSchema,
    response: RegionReparented,
    handler: reparentRegion,
  }),
  // Undo the last undoable tree operation — one of six, see undoLastOperation
  defineRoute({
    ...ADMIN, method: 'post', path: '/wv-import/matches/:worldViewId/undo',
    params: worldViewIdParamSchema,
    response: OperationUndone,
    handler: undoLastOperation,
  }),
  // Sync match decisions to other instances of same region
  defineRoute({
    ...ADMIN, method: 'post', path: '/wv-import/matches/:worldViewId/sync-instances',
    params: worldViewIdParamSchema,
    body: wvImportRegionIdSchema,
    response: InstancesSynced,
    handler: syncInstances,
  }),
  // Hierarchy review
  defineRoute({
    ...ADMIN, method: 'post', path: '/wv-import/matches/:worldViewId/add-child-region',
    params: worldViewIdParamSchema,
    body: wvImportAddChildSchema,
    response: ChildRegionAdded,
    handler: addChildRegion,
  }),
  defineRoute({
    ...ADMIN, method: 'post', path: '/wv-import/matches/:worldViewId/dismiss-hierarchy-warnings',
    params: worldViewIdParamSchema,
    body: wvImportRegionIdSchema,
    response: HierarchyWarningsDismissed,
    handler: dismissHierarchyWarnings,
  }),
  // AI suggest children for a region (Wikivoyage page + AI analysis)
  defineRoute({
    ...ADMIN, method: 'post', path: '/wv-import/matches/:worldViewId/ai-suggest-children',
    params: worldViewIdParamSchema,
    body: wvImportRegionIdSchema,
    response: ChildrenReviewed,
    handler: aiSuggestChildren,
  }),
  // AI suggest cluster-to-region mapping (CV match pipeline)
  defineRoute({
    ...ADMIN, method: 'post', path: '/wv-import/matches/:worldViewId/ai-suggest-clusters',
    params: worldViewIdParamSchema,
    body: wvImportAiSuggestClustersSchema,
    response: ClusterRegionSuggestions,
    handler: aiSuggestClusterRegions,
  }),
  // Children coverage % (how much of parent's geometry children cover)
  defineRoute({
    ...ADMIN, method: 'get', path: '/wv-import/matches/:worldViewId/children-coverage',
    params: worldViewIdParamSchema,
    query: childrenCoverageQuerySchema,
    response: ChildrenCoverage,
    handler: getChildrenCoverage,
  }),
  defineRoute({
    ...ADMIN, method: 'get', path: '/wv-import/matches/:worldViewId/coverage-geometry/:regionId',
    params: worldViewRegionIdParamSchema,
    response: CoverageGeometry,
    handler: getCoverageGeometry,
  }),
  defineRoute({
    ...ADMIN, method: 'get', path: '/wv-import/matches/:worldViewId/children-geometry/:regionId',
    params: worldViewRegionIdParamSchema,
    response: ChildRegionGeometries,
    handler: getChildrenRegionGeometry,
  }),
  defineRoute({
    ...ADMIN, method: 'post', path: '/wv-import/matches/:worldViewId/coverage-gap-analysis/:regionId',
    params: worldViewRegionIdParamSchema,
    response: CoverageGapAnalysis,
    handler: analyzeCoverageGaps,
  }),
  // Check GADM coverage — find uncovered root divisions
  defineRoute({
    ...ADMIN, method: 'get', path: '/wv-import/matches/:worldViewId/coverage',
    params: worldViewIdParamSchema,
    response: CoverageResult,
    handler: getCoverage,
  }),
  // Geographic suggestion for a single gap (centroid vs region anchor_points)
  defineRoute({
    ...ADMIN, method: 'post', path: '/wv-import/matches/:worldViewId/geo-suggest-gap',
    params: worldViewIdParamSchema,
    body: divisionIdBodySchema,
    response: GeoSuggestResult,
    handler: geoSuggestGap,
  }),
  // Dismiss/undismiss coverage gaps
  defineRoute({
    ...ADMIN, method: 'post', path: '/wv-import/matches/:worldViewId/dismiss-gap',
    params: worldViewIdParamSchema,
    body: divisionIdBodySchema,
    response: GapDismissed,
    handler: dismissCoverageGap,
  }),
  defineRoute({
    ...ADMIN, method: 'post', path: '/wv-import/matches/:worldViewId/undismiss-gap',
    params: worldViewIdParamSchema,
    body: divisionIdBodySchema,
    response: GapUndismissed,
    handler: undismissCoverageGap,
  }),
  // Approve coverage suggestion (add to existing region or create new)
  defineRoute({
    ...ADMIN, method: 'post', path: '/wv-import/matches/:worldViewId/approve-coverage',
    params: worldViewIdParamSchema,
    body: wvImportApproveCoverageSchema,
    response: CoverageApproved,
    handler: approveCoverageSuggestion,
  }),
  // Finalize review — mark world view as done
  defineRoute({
    ...ADMIN, method: 'post', path: '/wv-import/matches/:worldViewId/finalize',
    params: worldViewIdParamSchema,
    response: ReviewFinalized,
    handler: finalizeReview,
  }),
  // Re-run matching from scratch
  defineRoute({
    ...ADMIN, method: 'post', path: '/wv-import/matches/:worldViewId/rematch', limiter: expensiveAdminLimiter,
    params: worldViewIdParamSchema,
    body: wvImportRematchBodySchema,
    response: RematchStarted,
    handler: rematchWorldView,
  }),
  defineRoute({
    ...ADMIN, method: 'get', path: '/wv-import/matches/:worldViewId/rematch/status',
    params: worldViewIdParamSchema,
    response: RematchStatus,
    handler: getRematchStatus,
  }),
];
