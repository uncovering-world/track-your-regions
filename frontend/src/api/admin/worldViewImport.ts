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
  ImportCancelled, ImportStarted, ImportStatus, InstancesSynced, MatchAccepted, MatchAcceptedRestRejected,
  MatchesAccepted, MatchReset, MatchStats, MatchSuggestion, MatchTree, RemainingRejected, SuggestionRejected,
  TransferAccepted, TransferPreview,
} from '@tyr/shared/api';
import { authFetchJson } from '../fetchUtils';

// What the migrated calls here answer is declared once, as a backend schema
// (ADR-0066), and generated into `@tyr/shared/api`. Passed on from here, so a
// component imports a call's answer from the module of the call.
export type {
  AssignedDivision, ImportCancelled, ImportStarted, ImportStatus, InstancesSynced, MarkerPoint, MatchAccepted,
  MatchAcceptedRestRejected, MatchesAccepted, MatchReset, MatchStats, MatchStatus, MatchSuggestion, MatchTree,
  MatchTreeNode, RemainingRejected, SuggestionRejected, TransferAccepted, TransferPreview,
} from '@tyr/shared/api';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

// =============================================================================
// Core Types
// =============================================================================

export interface AIMatchProgress {
  status: 'running' | 'complete' | 'failed' | 'cancelled' | 'idle';
  statusMessage?: string;
  totalLeaves?: number;
  processedLeaves?: number;
  improved?: number;
  totalCost?: number;
}

export interface DBSearchOneResult {
  found: number;
  suggestions: MatchSuggestion[];
}

export interface AIMatchOneResult {
  improved: boolean;
  suggestion?: MatchSuggestion;
  reasoning?: string;
  cost: number;
}

export interface GeoshapeMatchResult {
  found: number;
  suggestions: MatchSuggestion[];
  totalCoverage?: number;
  scopeAncestorName?: string;
  nextScope?: { ancestorId: number; ancestorName: string };
}

export interface RematchStatus {
  status: 'matching' | 'complete' | 'failed' | 'idle';
  statusMessage?: string;
  countriesMatched?: number;
  totalCountries?: number;
  noCandidates?: number;
}

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
): Promise<{ found: number; suggestions: MatchSuggestion[]; geocodedName?: string; searchRadiusKm?: number }> {
  return authFetchJson(`${API_URL}/api/admin/wv-import/matches/${worldViewId}/geocode-match`, {
    method: 'POST',
    body: JSON.stringify({ regionId }),
  });
}

export async function geoshapeMatchRegion(
  worldViewId: number,
  regionId: number,
  scopeAncestorId?: number,
): Promise<GeoshapeMatchResult> {
  return authFetchJson(`${API_URL}/api/admin/wv-import/matches/${worldViewId}/geoshape-match`, {
    method: 'POST',
    body: JSON.stringify({ regionId, ...(scopeAncestorId != null ? { scopeAncestorId } : {}) }),
  });
}

export async function pointMatchRegion(
  worldViewId: number,
  regionId: number,
  scopeAncestorId?: number,
): Promise<GeoshapeMatchResult> {
  return authFetchJson(`${API_URL}/api/admin/wv-import/matches/${worldViewId}/point-match`, {
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
): Promise<DBSearchOneResult> {
  return authFetchJson(`${API_URL}/api/admin/wv-import/matches/${worldViewId}/db-search-one`, {
    method: 'POST',
    body: JSON.stringify({ regionId }),
  });
}

export async function aiMatchOneRegion(
  worldViewId: number,
  regionId: number,
): Promise<AIMatchOneResult> {
  return authFetchJson(`${API_URL}/api/admin/wv-import/matches/${worldViewId}/ai-match-one`, {
    method: 'POST',
    body: JSON.stringify({ regionId }),
  });
}

// =============================================================================
// Bulk AI Match
// =============================================================================

export async function startAIMatch(worldViewId: number): Promise<AIMatchProgress> {
  return authFetchJson(`${API_URL}/api/admin/wv-import/matches/${worldViewId}/ai-match`, {
    method: 'POST',
  });
}

export async function getAIMatchStatus(worldViewId: number): Promise<AIMatchProgress> {
  return authFetchJson(`${API_URL}/api/admin/wv-import/matches/${worldViewId}/ai-match/status`);
}

export async function cancelAIMatch(worldViewId: number): Promise<{ cancelled: boolean }> {
  return authFetchJson(`${API_URL}/api/admin/wv-import/matches/${worldViewId}/ai-match/cancel`, {
    method: 'POST',
  });
}

// =============================================================================
// Geoshape Fetch
// =============================================================================

export async function fetchGeoshape(wikidataId: string): Promise<GeoJSON.FeatureCollection> {
  return authFetchJson(`${API_URL}/api/admin/wv-import/geoshape/${wikidataId}`);
}

// =============================================================================
// Rematch
// =============================================================================

export async function startRematch(
  worldViewId: number,
): Promise<{ started: boolean }> {
  return authFetchJson(`${API_URL}/api/admin/wv-import/matches/${worldViewId}/rematch`, {
    method: 'POST',
  });
}

export async function getRematchStatus(worldViewId: number): Promise<RematchStatus> {
  return authFetchJson(`${API_URL}/api/admin/wv-import/matches/${worldViewId}/rematch/status`);
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
  SimplifyHierarchyResult,
  SimplifyChildrenResult,
  ReviewChildAction,
  AIReviewChildrenResult,
  AISuggestChildrenResult,
  SmartSimplifyDivision,
  SmartSimplifyMove,
  SpatialAnomalyDivision,
  SpatialAnomaly,
  SmartSimplifyResult,
  ApplySmartSimplifyResult,
  PruneResult,
  SmartFlattenResult,
  SmartFlattenPreviewResult,
  CollapseToParentResult,
  AutoResolveChildrenResult,
  DivisionOverlapResult,
  OverlapGadmChild,
  OverlapResolution,
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
  SubtreeNode,
  CoverageGap,
  CoverageResult,
  CoverageProgressEvent,
  RegionContextNode,
  GeoSuggestResult,
  SiblingRegionGeometry,
  ChildrenCoverageResult,
  CoverageGeometryResult,
  CoverageGapDivision,
  AnalyzeCoverageGapsResult,
  UnionGeometryResult,
  SplitDeeperResult,
  VisionMatchDivisionsResult,
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
  ClusterGeoInfo,
  ColorMatchCluster,
  AdjacencyEdge,
  DebugImage,
  ColorMatchResult,
  WaterSubCluster,
  WaterComponent,
  WaterReviewDecision,
  BorderPath,
  ClusterReviewCluster,
  ClusterReviewDecision,
  IcpAdjustmentDecision,
  ColorMatchSSEEvent,
  MapshapeMatchResult,
  ManualClusterResponse,
  AISuggestClusterRegionsCluster,
  AISuggestClusterRegionsResult,
} from './wvImportCvMatch';
