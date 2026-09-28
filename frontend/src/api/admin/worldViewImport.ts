/**
 * Admin WorldView Import API client
 *
 * Core types and basic import/match operations.
 * Specialized modules:
 *   - wvImportTreeOps.ts   — hierarchy mutations (handle-as-grouping, simplify, AI review children, etc.)
 *   - wvImportCoverage.ts  — GADM coverage analysis & gap resolution
 *   - wvImportCvMatch.ts   — CV color matching, water/cluster review, ICP adjustment, mapshape match
 */

import type {
  AIMatchOneResult, CoveringMatchResult, DbSearchResult, GeocodeMatchResult, Geoshape, ImportCancelled,
  ImportStarted, ImportStatus, InstancesSynced, MatchAccepted, MatchAcceptedRestRejected, MatchesAccepted,
  MatchReset, MatchStats, MatchTree, RematchStarted, RematchStatus, RemainingRejected, SuggestionRejected,
  TransferAccepted, TransferPreview,
} from '@tyr/shared/api';
import {
  getAdminWvImportGeoshapeByWikidataId, getAdminWvImportImportStatus,
  getAdminWvImportMatchesByWorldViewIdRematchStatus, getAdminWvImportMatchesByWorldViewIdStats,
  getAdminWvImportMatchesByWorldViewIdTree, postAdminWvImportBaseLayer, postAdminWvImportImport,
  postAdminWvImportImportCancel, postAdminWvImportMatchesByWorldViewIdAccept,
  postAdminWvImportMatchesByWorldViewIdAcceptAndReject, postAdminWvImportMatchesByWorldViewIdAcceptBatch,
  postAdminWvImportMatchesByWorldViewIdAcceptWithTransfer, postAdminWvImportMatchesByWorldViewIdAiMatchOne,
  postAdminWvImportMatchesByWorldViewIdDbSearchOne, postAdminWvImportMatchesByWorldViewIdGeocodeMatch,
  postAdminWvImportMatchesByWorldViewIdGeoshapeMatch, postAdminWvImportMatchesByWorldViewIdPointMatch,
  postAdminWvImportMatchesByWorldViewIdReject, postAdminWvImportMatchesByWorldViewIdRejectRemaining,
  postAdminWvImportMatchesByWorldViewIdRematch, postAdminWvImportMatchesByWorldViewIdResetMatch,
  postAdminWvImportMatchesByWorldViewIdSyncInstances, postAdminWvImportMatchesByWorldViewIdTransferPreview,
  type ImportTreeNode,
  type BaseLayerImportBody,
} from '../client.generated';

// What the migrated calls here answer is declared once, as a backend schema
// (ADR-0066), and generated into `@tyr/shared/api`. Passed on from here, so a
// component imports a call's answer from the module of the call.
export type {
  AIMatchOneResult, AssignedDivision, CoveringMatchResult, DbSearchResult, FoundSuggestion, GeocodeMatchResult,
  Geoshape, ImportCancelled, ImportStarted, ImportStatus, InstancesSynced, MarkerPoint, MatchAccepted,
  MatchAcceptedRestRejected, MatchesAccepted, MatchReset, MatchStats, MatchStatus, MatchSuggestion, MatchTree,
  MatchTreeNode, RematchStarted, RematchStatus, RemainingRejected, SuggestionConflict, SuggestionRejected,
  TransferAccepted, TransferPreview,
} from '@tyr/shared/api';


// =============================================================================
// Import Lifecycle
// =============================================================================

export async function startWorldViewImport(
  name: string,
  tree: unknown,
  matchingPolicy: 'country-based' | 'none' = 'country-based',
): Promise<ImportStarted> {
  // The tree is a file the admin uploaded, whose shape the server checks; it is
  // passed on as the document's type without being checked here.
  return postAdminWvImportImport({ name, tree: tree as ImportTreeNode, matchingPolicy });
}

export type BaseLayerImportRequest = BaseLayerImportBody;

/**
 * Start an import mirroring the administrative base layer.
 * Progress, review and finalize all run through the shared import endpoints.
 */
export async function startBaseLayerImport(
  request: BaseLayerImportRequest,
): Promise<ImportStarted> {
  return postAdminWvImportBaseLayer(request);
}

export async function getImportStatus(): Promise<ImportStatus> {
  return getAdminWvImportImportStatus();
}

export async function cancelImport(): Promise<ImportCancelled> {
  return postAdminWvImportImportCancel();
}

// =============================================================================
// Basic Match Operations
// =============================================================================

export async function getMatchStats(worldViewId: number): Promise<MatchStats> {
  return getAdminWvImportMatchesByWorldViewIdStats(worldViewId);
}

export async function acceptMatch(
  worldViewId: number,
  regionId: number,
  divisionId: number,
): Promise<MatchAccepted> {
  return postAdminWvImportMatchesByWorldViewIdAccept(worldViewId, { regionId, divisionId });
}

export async function rejectSuggestion(
  worldViewId: number,
  regionId: number,
  divisionId: number,
): Promise<SuggestionRejected> {
  return postAdminWvImportMatchesByWorldViewIdReject(worldViewId, { regionId, divisionId });
}

export async function acceptBatchMatches(
  worldViewId: number,
  assignments: Array<{ regionId: number; divisionId: number }>,
): Promise<MatchesAccepted> {
  return postAdminWvImportMatchesByWorldViewIdAcceptBatch(worldViewId, { assignments });
}

export async function getMatchTree(worldViewId: number): Promise<MatchTree> {
  return getAdminWvImportMatchesByWorldViewIdTree(worldViewId);
}

export async function syncInstances(
  worldViewId: number,
  regionId: number,
): Promise<InstancesSynced> {
  return postAdminWvImportMatchesByWorldViewIdSyncInstances(worldViewId, { regionId });
}

export async function geocodeMatchRegion(
  worldViewId: number,
  regionId: number,
): Promise<GeocodeMatchResult> {
  return postAdminWvImportMatchesByWorldViewIdGeocodeMatch(worldViewId, { regionId });
}

export async function geoshapeMatchRegion(
  worldViewId: number,
  regionId: number,
  scopeAncestorId?: number,
): Promise<CoveringMatchResult> {
  return postAdminWvImportMatchesByWorldViewIdGeoshapeMatch(worldViewId, { regionId, ...(scopeAncestorId != null ? { scopeAncestorId } : {}) });
}

export async function pointMatchRegion(
  worldViewId: number,
  regionId: number,
  scopeAncestorId?: number,
): Promise<CoveringMatchResult> {
  return postAdminWvImportMatchesByWorldViewIdPointMatch(worldViewId, { regionId, ...(scopeAncestorId != null ? { scopeAncestorId } : {}) });
}

export async function acceptAndRejectRest(
  worldViewId: number,
  regionId: number,
  divisionId: number,
): Promise<MatchAcceptedRestRejected> {
  return postAdminWvImportMatchesByWorldViewIdAcceptAndReject(worldViewId, { regionId, divisionId });
}

export async function rejectRemaining(
  worldViewId: number,
  regionId: number,
): Promise<RemainingRejected> {
  return postAdminWvImportMatchesByWorldViewIdRejectRemaining(worldViewId, { regionId });
}

export async function resetMatchRegion(
  worldViewId: number,
  regionId: number,
): Promise<MatchReset> {
  return postAdminWvImportMatchesByWorldViewIdResetMatch(worldViewId, { regionId });
}

export async function dbSearchOneRegion(
  worldViewId: number,
  regionId: number,
): Promise<DbSearchResult> {
  return postAdminWvImportMatchesByWorldViewIdDbSearchOne(worldViewId, { regionId });
}

export async function aiMatchOneRegion(
  worldViewId: number,
  regionId: number,
): Promise<AIMatchOneResult> {
  return postAdminWvImportMatchesByWorldViewIdAiMatchOne(worldViewId, { regionId });
}

// =============================================================================
// Geoshape Fetch
// =============================================================================

export async function fetchGeoshape(wikidataId: string): Promise<Geoshape> {
  return getAdminWvImportGeoshapeByWikidataId(wikidataId);
}

// =============================================================================
// Rematch
// =============================================================================

export async function startRematch(
  worldViewId: number,
): Promise<RematchStarted> {
  return postAdminWvImportMatchesByWorldViewIdRematch(worldViewId, {});
}

export async function getRematchStatus(worldViewId: number): Promise<RematchStatus> {
  return getAdminWvImportMatchesByWorldViewIdRematchStatus(worldViewId);
}

// =============================================================================
// Transfer operations (scope fallback — ADR-0012)
// =============================================================================

export async function acceptWithTransfer(
  worldViewId: number,
  regionId: number,
  divisionIds: number[],
  donorRegionId: number,
  donorDivisionId: number,
  transferType: 'direct' | 'split',
): Promise<TransferAccepted> {
  return postAdminWvImportMatchesByWorldViewIdAcceptWithTransfer(worldViewId, { regionId, divisionIds, donorRegionId, donorDivisionId, transferType });
}

export async function getTransferPreview(
  worldViewId: number,
  donorDivisionId: number,
  movingDivisionIds: number[],
  wikidataId: string,
): Promise<TransferPreview> {
  return postAdminWvImportMatchesByWorldViewIdTransferPreview(worldViewId, { donorDivisionId, movingDivisionIds, wikidataId });
}

// =============================================================================
// Re-exports for backward compatibility
// =============================================================================

export {
  // Tree operations
  handleAsGrouping,
  dismissChildren,
  simplifyHierarchy,
  simplifyChildren,
  undoLastOperation,
  addChildRegion,
  removeRegionFromImport,
  renameRegion,
  aiReviewChildren,
  aiSuggestChildren,
  markManualFix,
  selectMapImage,
  detectSmartSimplify,
  applySmartSimplifyMove,
  applySmartFlatten,
  pruneToLeaves,
  smartFlatten,
  smartFlattenPreview,
  mergeChildIntoParent,
  collapseToParent,
  autoResolveChildren,
  reparentRegion,
  dismissHierarchyWarnings,
  clearRegionMembers,
  acceptBatchAndRejectRest,
  rejectBatchSuggestions,
  checkDivisionOverlap,
  getOverlapDivisionChildren,
  resolveOverlap,
} from './wvImportTreeOps';
export type {
  // Requests
  OverlapResolution,
  // Answers
  ChildAction,
  ChildMerged,
  ChildRegionAdded,
  ChildrenAutoResolved,
  ChildrenCollapsed,
  ChildrenDismissed,
  ChildrenGrouped,
  ChildrenReviewed,
  ChildrenSimplified,
  DescendantsPruned,
  DivisionOverlap,
  DivisionOverlaps,
  FlattenBlocked,
  FlattenDone,
  FlattenPreview,
  FlattenPreviewResult,
  HierarchySimplified,
  HierarchyWarningsDismissed,
  ManualFixMarked,
  MapImageSelected,
  MembersCleared,
  OperationUndone,
  OverlapChildren,
  OverlapGadmChild,
  OverlapKept,
  OverlapResolved,
  OverlapSplit,
  RegionRemoved,
  RegionRenamed,
  RegionReparented,
  SimplifyReplacement,
  SmartFlattenResult,
  SmartSimplifyApplied,
  SmartSimplifyMove,
  SmartSimplifyMoves,
  SpatialAnomaly,
  SpatialAnomalyDivision,
  UndoOperation,
} from './wvImportTreeOps';

export {
  // Coverage
  getCoverage,
  getCoverageWithProgress,
  geoSuggestGap,
  dismissCoverageGap,
  approveCoverageSuggestion,
  undismissCoverageGap,
  finalizeReview,
  getChildrenRegionGeometry,
  getChildrenCoverage,
  getCoverageGeometry,
  analyzeCoverageGaps,
  getUnionGeometry,
  splitDivisionsDeeper,
  visionMatchDivisions,
} from './wvImportCoverage';
export type {
  CoverageApproved,
  CoverageComplete,
  CoverageEvent,
  CoverageFailed,
  CoverageGap,
  CoverageProgress,
  CoverageResult,
  CoverageSuggestion,
  DismissedGap,
  GapDismissed,
  GapSubtreeNode,
  GapUndismissed,
  GeoSuggestResult,
  RegionContextNode,
  ReviewFinalized,
  SiblingRegionGeometry,
  ChildRegionGeometries,
  ChildrenCoverage,
  CoverageGapAnalysis,
  CoverageGapDivision,
  CoverageGeometry,
  DivisionPreview,
  DivisionShapeFeature,
  MarkerPointFeature,
  SplitDeeperResult,
  UnionGeometryResult,
  VisionMatchResult,
} from './wvImportCoverage';

export {
  // CV Match
  mapshapeMatch,
  clusterPreviewUrl,
  clusterHighlightUrl,
  respondToClusterReview,
  waterCropUrl,
  respondToWaterReview,
  respondToIcpAdjustment,
  colorMatchWithProgress,
  aiSuggestClusterRegions,
} from './wvImportCvMatch';
export type {
  // Requests
  AISuggestClusterRegionsCluster,
  ClusterReviewDecision,
  IcpAdjustmentDecision,
  ManualClusterResponse,
  WaterReviewDecision,
  // Answers and stream events
  AdjacencyEdge,
  BorderPath,
  ChildRegionRef,
  ClusterGeoInfo,
  ClusterRegionMatch,
  ClusterRegionSuggestions,
  ClusterReviewCluster,
  ClusterReviewRequested,
  ColorMatchCluster,
  ColorMatchComplete,
  ColorMatchDebugImage,
  ColorMatchEvent,
  ColorMatchFailed,
  ColorMatchProgress,
  ColorMatchResult,
  CvPreviewFeature,
  DebugImage,
  IcpAdjustmentOffered,
  MapshapeDivision,
  MapshapeGroup,
  MapshapeMatchResult,
  MapshapePreviewFeature,
  MapshapesFound,
  MapshapesNotFound,
  NamedDivision,
  ReviewAnswered,
  WaterComponent,
  WaterReviewRequested,
  WikivoyageShapeFeature,
} from './wvImportCvMatch';
