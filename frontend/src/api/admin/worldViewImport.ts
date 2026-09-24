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
import { authFetchJson } from '../fetchUtils';

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

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

// =============================================================================
// Import Lifecycle
// =============================================================================

export async function startWorldViewImport(
  name: string,
  tree: unknown,
  matchingPolicy: 'country-based' | 'none' = 'country-based',
): Promise<ImportStarted> {
  return authFetchJson<ImportStarted>(`${API_URL}/api/admin/wv-import/import`, {
    method: 'POST',
    body: JSON.stringify({ name, tree, matchingPolicy }),
  });
}

export interface BaseLayerImportRequest {
  name: string;
  providerLabel: string;
  maxDepth: number;
}

/**
 * Start an import mirroring the administrative base layer.
 * Progress, review and finalize all run through the shared import endpoints.
 */
export async function startBaseLayerImport(
  request: BaseLayerImportRequest,
): Promise<ImportStarted> {
  return authFetchJson<ImportStarted>(`${API_URL}/api/admin/wv-import/base-layer`, {
    method: 'POST',
    body: JSON.stringify(request),
  });
}

export async function getImportStatus(): Promise<ImportStatus> {
  return authFetchJson<ImportStatus>(`${API_URL}/api/admin/wv-import/import/status`);
}

export async function cancelImport(): Promise<ImportCancelled> {
  return authFetchJson<ImportCancelled>(`${API_URL}/api/admin/wv-import/import/cancel`, {
    method: 'POST',
  });
}

// =============================================================================
// Basic Match Operations
// =============================================================================

export async function getMatchStats(worldViewId: number): Promise<MatchStats> {
  return authFetchJson<MatchStats>(`${API_URL}/api/admin/wv-import/matches/${worldViewId}/stats`);
}

export async function acceptMatch(
  worldViewId: number,
  regionId: number,
  divisionId: number,
): Promise<MatchAccepted> {
  return authFetchJson<MatchAccepted>(`${API_URL}/api/admin/wv-import/matches/${worldViewId}/accept`, {
    method: 'POST',
    body: JSON.stringify({ regionId, divisionId }),
  });
}

export async function rejectSuggestion(
  worldViewId: number,
  regionId: number,
  divisionId: number,
): Promise<SuggestionRejected> {
  return authFetchJson<SuggestionRejected>(`${API_URL}/api/admin/wv-import/matches/${worldViewId}/reject`, {
    method: 'POST',
    body: JSON.stringify({ regionId, divisionId }),
  });
}

export async function acceptBatchMatches(
  worldViewId: number,
  assignments: Array<{ regionId: number; divisionId: number }>,
): Promise<MatchesAccepted> {
  return authFetchJson<MatchesAccepted>(`${API_URL}/api/admin/wv-import/matches/${worldViewId}/accept-batch`, {
    method: 'POST',
    body: JSON.stringify({ assignments }),
  });
}

export async function getMatchTree(worldViewId: number): Promise<MatchTree> {
  return authFetchJson<MatchTree>(`${API_URL}/api/admin/wv-import/matches/${worldViewId}/tree`);
}

export async function syncInstances(
  worldViewId: number,
  regionId: number,
): Promise<InstancesSynced> {
  return authFetchJson<InstancesSynced>(`${API_URL}/api/admin/wv-import/matches/${worldViewId}/sync-instances`, {
    method: 'POST',
    body: JSON.stringify({ regionId }),
  });
}

export async function geocodeMatchRegion(
  worldViewId: number,
  regionId: number,
): Promise<GeocodeMatchResult> {
  return authFetchJson<GeocodeMatchResult>(`${API_URL}/api/admin/wv-import/matches/${worldViewId}/geocode-match`, {
    method: 'POST',
    body: JSON.stringify({ regionId }),
  });
}

export async function geoshapeMatchRegion(
  worldViewId: number,
  regionId: number,
  scopeAncestorId?: number,
): Promise<CoveringMatchResult> {
  return authFetchJson<CoveringMatchResult>(`${API_URL}/api/admin/wv-import/matches/${worldViewId}/geoshape-match`, {
    method: 'POST',
    body: JSON.stringify({ regionId, ...(scopeAncestorId != null ? { scopeAncestorId } : {}) }),
  });
}

export async function pointMatchRegion(
  worldViewId: number,
  regionId: number,
  scopeAncestorId?: number,
): Promise<CoveringMatchResult> {
  return authFetchJson<CoveringMatchResult>(`${API_URL}/api/admin/wv-import/matches/${worldViewId}/point-match`, {
    method: 'POST',
    body: JSON.stringify({ regionId, ...(scopeAncestorId != null ? { scopeAncestorId } : {}) }),
  });
}

export async function acceptAndRejectRest(
  worldViewId: number,
  regionId: number,
  divisionId: number,
): Promise<MatchAcceptedRestRejected> {
  return authFetchJson<MatchAcceptedRestRejected>(`${API_URL}/api/admin/wv-import/matches/${worldViewId}/accept-and-reject`, {
    method: 'POST',
    body: JSON.stringify({ regionId, divisionId }),
  });
}

export async function rejectRemaining(
  worldViewId: number,
  regionId: number,
): Promise<RemainingRejected> {
  return authFetchJson<RemainingRejected>(`${API_URL}/api/admin/wv-import/matches/${worldViewId}/reject-remaining`, {
    method: 'POST',
    body: JSON.stringify({ regionId }),
  });
}

export async function resetMatchRegion(
  worldViewId: number,
  regionId: number,
): Promise<MatchReset> {
  return authFetchJson<MatchReset>(`${API_URL}/api/admin/wv-import/matches/${worldViewId}/reset-match`, {
    method: 'POST',
    body: JSON.stringify({ regionId }),
  });
}

export async function dbSearchOneRegion(
  worldViewId: number,
  regionId: number,
): Promise<DbSearchResult> {
  return authFetchJson<DbSearchResult>(`${API_URL}/api/admin/wv-import/matches/${worldViewId}/db-search-one`, {
    method: 'POST',
    body: JSON.stringify({ regionId }),
  });
}

export async function aiMatchOneRegion(
  worldViewId: number,
  regionId: number,
): Promise<AIMatchOneResult> {
  return authFetchJson<AIMatchOneResult>(`${API_URL}/api/admin/wv-import/matches/${worldViewId}/ai-match-one`, {
    method: 'POST',
    body: JSON.stringify({ regionId }),
  });
}

// =============================================================================
// Geoshape Fetch
// =============================================================================

export async function fetchGeoshape(wikidataId: string): Promise<Geoshape> {
  return authFetchJson<Geoshape>(`${API_URL}/api/admin/wv-import/geoshape/${wikidataId}`);
}

// =============================================================================
// Rematch
// =============================================================================

export async function startRematch(
  worldViewId: number,
): Promise<RematchStarted> {
  return authFetchJson<RematchStarted>(`${API_URL}/api/admin/wv-import/matches/${worldViewId}/rematch`, {
    method: 'POST',
  });
}

export async function getRematchStatus(worldViewId: number): Promise<RematchStatus> {
  return authFetchJson<RematchStatus>(`${API_URL}/api/admin/wv-import/matches/${worldViewId}/rematch/status`);
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
  return authFetchJson<TransferAccepted>(`${API_URL}/api/admin/wv-import/matches/${worldViewId}/accept-with-transfer`, {
    method: 'POST',
    body: JSON.stringify({ regionId, divisionIds, donorRegionId, donorDivisionId, transferType }),
  });
}

export async function getTransferPreview(
  worldViewId: number,
  donorDivisionId: number,
  movingDivisionIds: number[],
  wikidataId: string,
): Promise<TransferPreview> {
  return authFetchJson<TransferPreview>(`${API_URL}/api/admin/wv-import/matches/${worldViewId}/transfer-preview`, {
    method: 'POST',
    body: JSON.stringify({ donorDivisionId, movingDivisionIds, wikidataId }),
  });
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
