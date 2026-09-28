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
    summary: 'Start extracting the region tree of a world view from Wikivoyage in the background',
    body: wvExtractStartSchema,
    response: ExtractionStarted,
    handler: startWikivoyageExtraction,
  }),
  // Poll extraction progress
  defineRoute({
    ...ADMIN, method: 'get', path: '/wv-extract/status',
    summary: 'Report Wikivoyage extraction progress, pending questions, imported world views and caches',
    response: ExtractionStatus,
    handler: getWikivoyageExtractionStatus,
  }),
  // Cancel extraction
  defineRoute({
    ...ADMIN, method: 'post', path: '/wv-extract/cancel',
    summary: 'Cancel the running Wikivoyage extraction',
    response: ExtractionCancelled,
    handler: cancelWikivoyageExtraction,
  }),
  // Answer a pending AI question during extraction
  defineRoute({
    ...ADMIN, method: 'post', path: '/wv-extract/answer',
    summary: 'Answer, accept or skip a question the extraction raised, or delete a learned rule',
    body: wvExtractAnswerSchema,
    response: ExtractionAnswer,
    handler: answerExtractionQuestion,
  }),
  // Delete a cache file
  defineRoute({
    ...ADMIN, method: 'delete', path: '/wv-extract/caches/:name',
    summary: 'Delete a saved Wikivoyage page cache file',
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
    summary: 'Start importing a world view from an uploaded region tree and matching it to divisions',
    body: wvImportBodySchema,
    response: ImportStarted,
    handler: startWorldViewImport,
  }),
  // Start a base layer mirror import (progress via /wv-import/import/status)
  defineRoute({
    ...ADMIN, method: 'post', path: '/wv-import/base-layer',
    summary: 'Start importing a world view that mirrors the administrative divisions to a given depth',
    body: baseLayerImportBodySchema,
    response: ImportStarted,
    handler: startBaseLayerImportEndpoint,
  }),
  // Poll import progress
  defineRoute({
    ...ADMIN, method: 'get', path: '/wv-import/import/status',
    summary: 'Report import progress and list the imported world views',
    response: ImportStatus,
    handler: getWorldViewImportStatus,
  }),
  // Cancel import
  defineRoute({
    ...ADMIN, method: 'post', path: '/wv-import/import/cancel',
    summary: 'Cancel the running world view import',
    response: ImportCancelled,
    handler: cancelWorldViewImport,
  }),
  // Get match statistics for a world view
  defineRoute({
    ...ADMIN, method: 'get', path: '/wv-import/matches/:worldViewId/stats',
    summary: 'Count the regions of a world view by match status, with what still blocks finalizing',
    params: worldViewIdParamSchema,
    response: MatchStats,
    handler: getMatchStats,
  }),
  // Get hierarchical match tree for a world view
  defineRoute({
    ...ADMIN, method: 'get', path: '/wv-import/matches/:worldViewId/tree',
    summary: 'Get the region tree of a world view with the match status, suggestions and divisions of each region',
    params: worldViewIdParamSchema,
    response: MatchTree,
    handler: getMatchTree,
  }),
  // Accept a single match
  defineRoute({
    ...ADMIN, method: 'post', path: '/wv-import/matches/:worldViewId/accept',
    summary: 'Accept one suggested division for a region and keep its other suggestions open',
    params: worldViewIdParamSchema,
    body: wvImportAcceptMatchSchema,
    response: MatchAccepted,
    handler: acceptMatch,
  }),
  // Reject (dismiss) a single suggestion
  defineRoute({
    ...ADMIN, method: 'post', path: '/wv-import/matches/:worldViewId/reject',
    summary: 'Reject one suggested division for a region and unassign it if it was assigned',
    params: worldViewIdParamSchema,
    body: wvImportAcceptMatchSchema,
    response: SuggestionRejected,
    handler: rejectMatch,
  }),
  defineRoute({
    ...ADMIN, method: 'post', path: '/wv-import/matches/:worldViewId/reject-remaining',
    summary: 'Reject every open suggestion of a region',
    params: worldViewIdParamSchema,
    body: wvImportRegionIdSchema,
    response: RemainingRejected,
    handler: rejectRemaining,
  }),
  // Accept a match and reject all remaining suggestions in one transaction
  defineRoute({
    ...ADMIN, method: 'post', path: '/wv-import/matches/:worldViewId/accept-and-reject',
    summary: 'Accept one suggested division for a region and reject its other suggestions',
    params: worldViewIdParamSchema,
    body: wvImportAcceptMatchSchema,
    response: MatchAcceptedRestRejected,
    handler: acceptAndRejectRest,
  }),
  // The review's selection toolbar: the same two verdicts for several of a region's suggestions at once
  defineRoute({
    ...ADMIN, method: 'post', path: '/wv-import/matches/:worldViewId/accept-batch-and-reject-rest',
    summary: 'Accept several suggested divisions of one region and reject the rest',
    params: worldViewIdParamSchema,
    body: wvImportDecideBatchSchema,
    response: SelectionAccepted,
    handler: acceptBatchAndRejectRest,
  }),
  defineRoute({
    ...ADMIN, method: 'post', path: '/wv-import/matches/:worldViewId/reject-batch',
    summary: 'Reject several suggested divisions of one region at once',
    params: worldViewIdParamSchema,
    body: wvImportDecideBatchSchema,
    response: SelectionRejected,
    handler: rejectBatchSuggestions,
  }),
  // Clear all assigned divisions from a region (keep suggestions)
  defineRoute({
    ...ADMIN, method: 'post', path: '/wv-import/matches/:worldViewId/clear-members',
    summary: 'Remove every division assigned to a region and keep its suggestions',
    params: worldViewIdParamSchema,
    body: wvImportRegionIdSchema,
    response: MembersCleared,
    handler: clearMembers,
  }),
  // Accept a batch of matches
  defineRoute({
    ...ADMIN, method: 'post', path: '/wv-import/matches/:worldViewId/accept-batch',
    summary: 'Accept a batch of suggested divisions across several regions',
    params: worldViewIdParamSchema,
    body: wvImportAcceptBatchSchema,
    response: MatchesAccepted,
    handler: acceptBatchMatches,
  }),
  // Accept with transfer: atomically move divisions from donor region to target
  defineRoute({
    ...ADMIN, method: 'post', path: '/wv-import/matches/:worldViewId/accept-with-transfer',
    summary: 'Accept divisions for a region by taking them from another region, splitting a division if needed',
    params: worldViewIdParamSchema,
    body: wvImportAcceptTransferSchema,
    response: TransferAccepted,
    handler: acceptWithTransfer,
  }),
  // Transfer preview: 3-layer GeoJSON for visualising a proposed transfer operation
  defineRoute({
    ...ADMIN, method: 'post', path: '/wv-import/matches/:worldViewId/transfer-preview',
    summary: 'Preview a transfer between regions as the donor, the moving divisions and the target outline',
    params: worldViewIdParamSchema,
    body: wvImportTransferPreviewSchema,
    response: TransferPreview,
    handler: getTransferPreview,
  }),
  // Union geometry for multi-select preview
  defineRoute({
    ...ADMIN, method: 'post', path: '/wv-import/matches/:worldViewId/union-geometry',
    summary: 'Draw a set of divisions with the region already holding each, and optionally the markers of one region',
    params: worldViewIdParamSchema,
    body: wvImportUnionGeometrySchema,
    response: UnionGeometryResult,
    handler: getUnionGeometry,
  }),
  // Split divisions deeper: replace divisions with their GADM children that intersect geoshape
  defineRoute({
    ...ADMIN, method: 'post', path: '/wv-import/matches/:worldViewId/split-deeper',
    summary: 'Propose the GADM children of given divisions that lie within the shape or markers of a region',
    params: worldViewIdParamSchema,
    body: wvImportSplitDeeperSchema,
    response: SplitDeeperResult,
    handler: splitDivisionsDeeper,
  }),
  // AI vision-based division matching
  defineRoute({
    ...ADMIN, method: 'post', path: '/wv-import/matches/:worldViewId/vision-match',
    summary: 'Ask a vision model which candidate divisions the map image of a region shows',
    params: worldViewIdParamSchema,
    body: wvImportVisionMatchSchema,
    response: VisionMatchResult,
    handler: visionMatchDivisions,
  }),
  // Mapshape-based division matching (Kartographer map regions)
  defineRoute({
    ...ADMIN, method: 'post', path: '/wv-import/matches/:worldViewId/mapshape-match',
    summary: 'Propose divisions for the children of a region from the mapshapes on its Wikivoyage page',
    params: worldViewIdParamSchema,
    body: wvImportRegionIdSchema,
    response: MapshapeMatchResult,
    handler: mapshapeMatchDivisions,
  }),
  // AI-assisted re-matching
  defineRoute({
    ...ADMIN, method: 'post', path: '/wv-import/matches/:worldViewId/ai-match',
    summary: 'Start AI matching of every unresolved leaf region in a world view',
    params: worldViewIdParamSchema,
    response: AIMatchStarted,
    handler: startAIMatch,
  }),
  defineRoute({
    ...ADMIN, method: 'get', path: '/wv-import/matches/:worldViewId/ai-match/status',
    summary: 'Report the progress of AI matching in a world view',
    params: worldViewIdParamSchema,
    response: AIMatchStatus,
    handler: getAIMatchStatus,
  }),
  defineRoute({
    ...ADMIN, method: 'post', path: '/wv-import/matches/:worldViewId/ai-match/cancel',
    summary: 'Cancel AI matching in a world view',
    params: worldViewIdParamSchema,
    response: AIMatchCancelled,
    handler: cancelAIMatchEndpoint,
  }),
  defineRoute({
    ...ADMIN, method: 'post', path: '/wv-import/matches/:worldViewId/db-search-one',
    summary: 'Search divisions by name for one region and store what is found as suggestions',
    params: worldViewIdParamSchema,
    body: wvImportRegionIdSchema,
    response: DbSearchResult,
    handler: dbSearchOneRegion,
  }),
  defineRoute({
    ...ADMIN, method: 'post', path: '/wv-import/matches/:worldViewId/geocode-match',
    summary: 'Geocode one region by name and suggest the divisions that contain the point',
    params: worldViewIdParamSchema,
    body: wvImportRegionIdSchema,
    response: GeocodeMatchResult,
    handler: geocodeMatch,
  }),
  defineRoute({
    ...ADMIN, method: 'post', path: '/wv-import/matches/:worldViewId/geoshape-match',
    summary: 'Suggest divisions for one region by comparing them with its Wikidata shape',
    params: worldViewIdParamSchema,
    body: wvImportGeoshapeMatchSchema,
    response: CoveringMatchResult,
    handler: geoshapeMatch,
  }),
  defineRoute({
    ...ADMIN, method: 'post', path: '/wv-import/matches/:worldViewId/point-match',
    summary: 'Suggest divisions for one region from the Wikivoyage markers they contain',
    params: worldViewIdParamSchema,
    body: wvImportGeoshapeMatchSchema,
    response: CoveringMatchResult,
    handler: pointMatch,
  }),
  defineRoute({
    ...ADMIN, method: 'post', path: '/wv-import/matches/:worldViewId/reset-match',
    summary: 'Clear the divisions and all suggestions of one region, rejected ones included',
    params: worldViewIdParamSchema,
    body: wvImportRegionIdSchema,
    response: MatchReset,
    handler: resetMatch,
  }),
  defineRoute({
    ...ADMIN, method: 'post', path: '/wv-import/matches/:worldViewId/ai-match-one',
    summary: 'Ask a model to suggest a better division match for one region',
    params: worldViewIdParamSchema,
    body: wvImportRegionIdSchema,
    response: AIMatchOneResult,
    handler: aiMatchOneRegion,
  }),
  // Dismiss subregions (make parent a leaf)
  defineRoute({
    ...ADMIN, method: 'post', path: '/wv-import/matches/:worldViewId/dismiss-children',
    summary: 'Delete all descendants of a region and make it a leaf, with undo',
    params: worldViewIdParamSchema,
    body: wvImportRegionIdSchema,
    response: ChildrenDismissed,
    handler: dismissChildren,
  }),
  // Prune to leaves: keep direct children, remove grandchildren+
  defineRoute({
    ...ADMIN, method: 'post', path: '/wv-import/matches/:worldViewId/prune-to-leaves',
    summary: 'Delete the grandchildren and deeper descendants of a region, keeping its children',
    params: worldViewIdParamSchema,
    body: wvImportRegionIdSchema,
    response: DescendantsPruned,
    handler: pruneToLeaves,
  }),
  // Collapse to parent: clear children's data, generate suggestions for parent
  defineRoute({
    ...ADMIN, method: 'post', path: '/wv-import/matches/:worldViewId/collapse-to-parent',
    summary: 'Clear the matches of all descendants of a region and suggest divisions for it instead',
    params: worldViewIdParamSchema,
    body: wvImportRegionIdSchema,
    response: ChildrenCollapsed,
    handler: collapseToParent,
  }),
  // Smart flatten: auto-match children, absorb divisions into parent, delete descendants
  defineRoute({
    ...ADMIN, method: 'post', path: '/wv-import/matches/:worldViewId/smart-flatten',
    summary: 'Auto-match the descendants of a region, move their divisions into it and delete them',
    params: worldViewIdParamSchema,
    body: wvImportRegionIdSchema,
    response: SmartFlattenResult,
    handler: smartFlatten,
  }),
  defineRoute({
    ...ADMIN, method: 'post', path: '/wv-import/matches/:worldViewId/smart-flatten/preview',
    summary: 'Preview the shape a flatten of a region would give, with the matches it would make for its descendants, storing nothing',
    params: worldViewIdParamSchema,
    body: wvImportRegionIdSchema,
    response: FlattenPreviewResult,
    handler: smartFlattenPreview,
  }),
  // Auto-resolve children: batch-match all unmatched leaf descendants
  defineRoute({
    ...ADMIN, method: 'post', path: '/wv-import/matches/:worldViewId/auto-resolve-children/preview',
    summary: 'Preview how the unmatched leaf descendants of a region would be auto-resolved',
    params: worldViewIdParamSchema,
    body: wvImportRegionIdSchema,
    response: AutoResolvePreview,
    handler: autoResolveChildrenPreview,
  }),
  defineRoute({
    ...ADMIN, method: 'post', path: '/wv-import/matches/:worldViewId/auto-resolve-children',
    summary: 'Match the unmatched leaf descendants of a region automatically, with undo',
    params: worldViewIdParamSchema,
    body: wvImportRegionIdSchema,
    response: ChildrenAutoResolved,
    handler: autoResolveChildren,
  }),
  // Handle region as sub-continental grouping (match children as countries)
  defineRoute({
    ...ADMIN, method: 'post', path: '/wv-import/matches/:worldViewId/handle-as-grouping',
    summary: 'Treat a region as a grouping: clear its own match and match each child separately',
    params: worldViewIdParamSchema,
    body: wvImportRegionIdSchema,
    response: ChildrenGrouped,
    handler: handleAsGrouping,
  }),
  // Select map image from candidates
  defineRoute({
    ...ADMIN, method: 'post', path: '/wv-import/matches/:worldViewId/select-map-image',
    summary: 'Pick the map image of a region from its candidates, or clear it',
    params: worldViewIdParamSchema,
    body: wvImportSelectMapImageSchema,
    response: MapImageSelected,
    handler: selectMapImage,
  }),
  // Mark/unmark region as needing manual fixes
  defineRoute({
    ...ADMIN, method: 'post', path: '/wv-import/matches/:worldViewId/mark-manual-fix',
    summary: 'Flag or unflag a region as needing a manual fix, with an optional note',
    params: worldViewIdParamSchema,
    body: wvImportMarkManualFixSchema,
    response: ManualFixMarked,
    handler: markManualFix,
  }),
  // Merge single-child parent's only child into the parent
  defineRoute({
    ...ADMIN, method: 'post', path: '/wv-import/matches/:worldViewId/merge-child',
    summary: 'Merge the only child of a region into it',
    params: worldViewIdParamSchema,
    body: wvImportRegionIdSchema,
    response: ChildMerged,
    handler: mergeChildIntoParent,
  }),
  // Simplify hierarchy: replace single-child chains with direct parent→grandchild links
  defineRoute({
    ...ADMIN, method: 'post', path: '/wv-import/matches/:worldViewId/simplify-hierarchy',
    summary: 'Replace complete sets of sibling divisions in a region with their parent division',
    params: worldViewIdParamSchema,
    body: wvImportRegionIdSchema,
    response: HierarchySimplified,
    handler: simplifyHierarchy,
  }),
  // Simplify children: simplify all child regions one by one
  defineRoute({
    ...ADMIN, method: 'post', path: '/wv-import/matches/:worldViewId/simplify-children',
    summary: 'Replace complete sets of sibling divisions with their parent in each child of a region',
    params: worldViewIdParamSchema,
    body: wvImportRegionIdSchema,
    response: ChildrenSimplified,
    handler: simplifyChildren,
  }),
  // Smart simplify: detect cross-sibling division moves for simplification
  defineRoute({
    ...ADMIN, method: 'post', path: '/wv-import/matches/:worldViewId/smart-simplify',
    summary: 'Find division moves between sibling regions that would let a parent division replace them',
    params: worldViewIdParamSchema,
    body: wvImportSmartSimplifySchema,
    response: SmartSimplifyMoves,
    handler: detectSmartSimplify,
  }),
  // Smart simplify: apply a single move (reassign divisions + simplify)
  defineRoute({
    ...ADMIN, method: 'post', path: '/wv-import/matches/:worldViewId/smart-simplify/apply-move',
    summary: 'Move divisions to one sibling region and simplify its divisions',
    params: worldViewIdParamSchema,
    body: wvImportSmartSimplifyApplySchema,
    response: SmartSimplifyApplied,
    handler: applySmartSimplifyMove,
  }),
  // Check division overlaps among children (shared/contained divisions)
  defineRoute({
    ...ADMIN, method: 'post', path: '/wv-import/matches/:worldViewId/check-overlap',
    summary: 'List the divisions that more than one child of a region covers',
    params: worldViewIdParamSchema,
    body: wvImportSmartSimplifySchema,
    response: DivisionOverlaps,
    handler: checkDivisionOverlap,
  }),
  // Overlap resolution: get GADM children for split preview
  defineRoute({
    ...ADMIN, method: 'post', path: '/wv-import/matches/:worldViewId/overlap-children',
    summary: 'List the GADM children of an overlapping division and the child region holding each',
    params: worldViewIdParamSchema,
    body: wvImportOverlapChildrenSchema,
    response: OverlapChildren,
    handler: getOverlapDivisionChildren,
  }),
  // Overlap resolution: apply keep or split
  defineRoute({
    ...ADMIN, method: 'post', path: '/wv-import/matches/:worldViewId/resolve-overlap',
    summary: 'Resolve an overlapping division by keeping it in one region or splitting it among several',
    params: worldViewIdParamSchema,
    body: wvImportResolveOverlapSchema,
    response: OverlapResolved,
    handler: resolveOverlap,
  }),
  // Remove a region from the import tree (optionally reparenting children)
  defineRoute({
    ...ADMIN, method: 'post', path: '/wv-import/matches/:worldViewId/remove-region',
    summary: 'Remove a region from the import, deleting or reparenting its children',
    params: worldViewIdParamSchema,
    body: wvImportRemoveRegionSchema,
    response: RegionRemoved,
    handler: removeRegionFromImport,
  }),
  // Rename a region
  defineRoute({
    ...ADMIN, method: 'post', path: '/wv-import/matches/:worldViewId/rename-region',
    summary: 'Rename a region and optionally update its Wikivoyage and Wikidata source',
    params: worldViewIdParamSchema,
    body: wvImportRenameRegionSchema,
    response: RegionRenamed,
    handler: renameRegion,
  }),
  // Move a region to a new parent
  defineRoute({
    ...ADMIN, method: 'post', path: '/wv-import/matches/:worldViewId/reparent-region',
    summary: 'Move a region under another parent, or to the root',
    params: worldViewIdParamSchema,
    body: wvImportReparentRegionSchema,
    response: RegionReparented,
    handler: reparentRegion,
  }),
  // Undo the last undoable tree operation — one of six, see undoLastOperation
  defineRoute({
    ...ADMIN, method: 'post', path: '/wv-import/matches/:worldViewId/undo',
    summary: 'Undo the last undoable tree operation in a world view',
    params: worldViewIdParamSchema,
    response: OperationUndone,
    handler: undoLastOperation,
  }),
  // Sync match decisions to other instances of same region
  defineRoute({
    ...ADMIN, method: 'post', path: '/wv-import/matches/:worldViewId/sync-instances',
    summary: 'Copy the match of a region to every other region imported from the same page',
    params: worldViewIdParamSchema,
    body: wvImportRegionIdSchema,
    response: InstancesSynced,
    handler: syncInstances,
  }),
  // Hierarchy review
  defineRoute({
    ...ADMIN, method: 'post', path: '/wv-import/matches/:worldViewId/add-child-region',
    summary: 'Add a new child region under a region during hierarchy review',
    params: worldViewIdParamSchema,
    body: wvImportAddChildSchema,
    response: ChildRegionAdded,
    handler: addChildRegion,
  }),
  defineRoute({
    ...ADMIN, method: 'post', path: '/wv-import/matches/:worldViewId/dismiss-hierarchy-warnings',
    summary: 'Mark the hierarchy warnings of a region as reviewed',
    params: worldViewIdParamSchema,
    body: wvImportRegionIdSchema,
    response: HierarchyWarningsDismissed,
    handler: dismissHierarchyWarnings,
  }),
  // AI suggest children for a region (Wikivoyage page + AI analysis)
  defineRoute({
    ...ADMIN, method: 'post', path: '/wv-import/matches/:worldViewId/ai-suggest-children',
    summary: 'Ask a model to review the children of a region against its Wikivoyage page',
    params: worldViewIdParamSchema,
    body: wvImportRegionIdSchema,
    response: ChildrenReviewed,
    handler: aiSuggestChildren,
  }),
  // AI suggest cluster-to-region mapping (CV match pipeline)
  defineRoute({
    ...ADMIN, method: 'post', path: '/wv-import/matches/:worldViewId/ai-suggest-clusters',
    summary: 'Ask a model to match colour clusters of divisions on a map to child regions',
    params: worldViewIdParamSchema,
    body: wvImportAiSuggestClustersSchema,
    response: ClusterRegionSuggestions,
    handler: aiSuggestClusterRegions,
  }),
  // Children coverage % (how much of parent's geometry children cover)
  defineRoute({
    ...ADMIN, method: 'get', path: '/wv-import/matches/:worldViewId/children-coverage',
    summary: 'Measure how much of each parent region the divisions of its children cover',
    params: worldViewIdParamSchema,
    query: childrenCoverageQuerySchema,
    response: ChildrenCoverage,
    handler: getChildrenCoverage,
  }),
  defineRoute({
    ...ADMIN, method: 'get', path: '/wv-import/matches/:worldViewId/coverage-geometry/:regionId',
    summary: 'Draw the divisions of a region beside those of its descendants, to compare coverage',
    params: worldViewRegionIdParamSchema,
    response: CoverageGeometry,
    handler: getCoverageGeometry,
  }),
  defineRoute({
    ...ADMIN, method: 'get', path: '/wv-import/matches/:worldViewId/children-geometry/:regionId',
    summary: 'Draw each child of a region as its own shape',
    params: worldViewRegionIdParamSchema,
    response: ChildRegionGeometries,
    handler: getChildrenRegionGeometry,
  }),
  defineRoute({
    ...ADMIN, method: 'post', path: '/wv-import/matches/:worldViewId/coverage-gap-analysis/:regionId',
    summary: 'Find divisions in the gap between a region and its children and suggest a child for each',
    params: worldViewRegionIdParamSchema,
    response: CoverageGapAnalysis,
    handler: analyzeCoverageGaps,
  }),
  // Check GADM coverage — find uncovered root divisions
  defineRoute({
    ...ADMIN, method: 'get', path: '/wv-import/matches/:worldViewId/coverage',
    summary: 'List the divisions no region of a world view covers, with a suggested home for each',
    params: worldViewIdParamSchema,
    response: CoverageResult,
    handler: getCoverage,
  }),
  // Geographic suggestion for a single gap (centroid vs region anchor_points)
  defineRoute({
    ...ADMIN, method: 'post', path: '/wv-import/matches/:worldViewId/geo-suggest-gap',
    summary: 'Suggest the nearest region for one uncovered division',
    params: worldViewIdParamSchema,
    body: divisionIdBodySchema,
    response: GeoSuggestResult,
    handler: geoSuggestGap,
  }),
  // Dismiss/undismiss coverage gaps
  defineRoute({
    ...ADMIN, method: 'post', path: '/wv-import/matches/:worldViewId/dismiss-gap',
    summary: 'Dismiss an uncovered division so coverage checks ignore it',
    params: worldViewIdParamSchema,
    body: divisionIdBodySchema,
    response: GapDismissed,
    handler: dismissCoverageGap,
  }),
  defineRoute({
    ...ADMIN, method: 'post', path: '/wv-import/matches/:worldViewId/undismiss-gap',
    summary: 'Restore a dismissed division to the coverage gaps',
    params: worldViewIdParamSchema,
    body: divisionIdBodySchema,
    response: GapUndismissed,
    handler: undismissCoverageGap,
  }),
  // Approve coverage suggestion (add to existing region or create new)
  defineRoute({
    ...ADMIN, method: 'post', path: '/wv-import/matches/:worldViewId/approve-coverage',
    summary: 'Cover a gap division by adding it to a region or to a new child region',
    params: worldViewIdParamSchema,
    body: wvImportApproveCoverageSchema,
    response: CoverageApproved,
    handler: approveCoverageSuggestion,
  }),
  // Finalize review — mark world view as done
  defineRoute({
    ...ADMIN, method: 'post', path: '/wv-import/matches/:worldViewId/finalize',
    summary: 'Mark the import review of a world view done once no region needs review',
    params: worldViewIdParamSchema,
    response: ReviewFinalized,
    handler: finalizeReview,
  }),
  // Re-run matching from scratch
  defineRoute({
    ...ADMIN, method: 'post', path: '/wv-import/matches/:worldViewId/rematch', limiter: expensiveAdminLimiter,
    summary: 'Clear all matches of a world view, accepted ones included, and rerun the matcher',
    params: worldViewIdParamSchema,
    body: wvImportRematchBodySchema,
    response: RematchStarted,
    handler: rematchWorldView,
  }),
  defineRoute({
    ...ADMIN, method: 'get', path: '/wv-import/matches/:worldViewId/rematch/status',
    summary: 'Report the progress of a world view rematch',
    params: worldViewIdParamSchema,
    response: RematchStatus,
    handler: getRematchStatus,
  }),
];
