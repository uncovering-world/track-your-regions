/**
 * Admin WorldView Import API client
 *
 * Core types and basic import/match operations.
 * Specialized modules:
 *   - wvImportTreeOps.ts   — hierarchy mutations (handle-as-grouping, simplify, AI review children, etc.)
 *   - wvImportCoverage.ts  — GADM coverage analysis & gap resolution
 *   - wvImportCvMatch.ts   — CV color matching, water/cluster review, ICP adjustment, mapshape match
 */

import { authFetchJson } from '../fetchUtils';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

// =============================================================================
// Core Types
// =============================================================================

export interface ImportStatus {
  running: boolean;
  operationId?: string;
  status?: 'importing' | 'matching' | 'complete' | 'failed' | 'cancelled';
  statusMessage?: string;
  createdRegions?: number;
  totalRegions?: number;
  matchedRegions?: number;
  totalCountries?: number;
  countriesMatched?: number;
  subdivisionsDrilled?: number;
  noCandidates?: number;
  worldViewId?: number | null;
  /** Existing imported world views from DB (when no import is running) */
  importedWorldViews?: Array<{ id: number; name: string; sourceType: string; reviewComplete: boolean }>;
}

export interface MatchStats {
  auto_matched: string;
  children_matched: string;
  needs_review: string;
  needs_review_blocking: string;
  no_candidates: string;
  no_candidates_blocking: string;
  manual_matched: string;
  suggested: string;
  total_matched: string;
  total_leaves: string;
  total_regions: string;
  /** Count of regions whose hierarchy review surfaced unreviewed warnings (string for parity with the other counts) */
  hierarchy_warnings_count: string;
}

export interface MatchSuggestion {
  divisionId: number;
  name: string;
  path: string;
  score: number;
  geoSimilarity: number | null;
  conflict?: {
    type: 'direct' | 'split';
    donorRegionId: number;
    donorRegionName: string;
    donorDivisionId: number;
    donorDivisionName: string;
  };
}

export interface AssignedDivision {
  divisionId: number;
  name: string;
  path?: string;
  hasCustomGeom: boolean;
}

export interface AIMatchProgress {
  status: 'running' | 'complete' | 'failed' | 'cancelled' | 'idle';
  statusMessage?: string;
  totalLeaves?: number;
  processedLeaves?: number;
  improved?: number;
  totalCost?: number;
}

export interface MatchTreeNode {
  id: number;
  name: string;
  isLeaf: boolean;
  matchStatus: string | null;
  suggestions: MatchSuggestion[];
  sourceUrl: string | null;
  regionMapUrl: string | null;
  mapImageCandidates: string[];
  mapImageReviewed: boolean;
  needsManualFix: boolean;
  fixNote: string | null;
  wikidataId: string | null;
  memberCount: number;
  assignedDivisions: AssignedDivision[];
  geoAvailable: boolean | null;
  markerPoints: Array<{ name: string; lat: number; lon: number }> | null;
  /** Hierarchy-review warnings surfaced by AI/automated review (e.g., overlapping siblings, single-child branches) */
  hierarchyWarnings: string[];
  /** True once a curator has dismissed/acknowledged the warnings on this node */
  hierarchyReviewed: boolean;
  /** Workflow (per-country sign-off) flags — see wvImportWorkflow.ts */
  isWorkUnit: boolean;
  hierarchyConfirmed: boolean;
  signoffStatus: 'not_started' | 'in_progress' | 'signed_off';
  assignmentWaived: boolean;
  children: MatchTreeNode[];
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
): Promise<{ started: boolean; operationId: string }> {
  return authFetchJson(`${API_URL}/api/admin/wv-import/import`, {
    method: 'POST',
    body: JSON.stringify({ name, tree, matchingPolicy }),
  });
}

export async function getImportStatus(): Promise<ImportStatus> {
  return authFetchJson(`${API_URL}/api/admin/wv-import/import/status`);
}

export async function cancelImport(): Promise<{ cancelled: boolean }> {
  return authFetchJson(`${API_URL}/api/admin/wv-import/import/cancel`, {
    method: 'POST',
  });
}

// =============================================================================
// Basic Match Operations
// =============================================================================

export async function getMatchStats(worldViewId: number): Promise<MatchStats> {
  return authFetchJson(`${API_URL}/api/admin/wv-import/matches/${worldViewId}/stats`);
}

export async function acceptMatch(
  worldViewId: number,
  regionId: number,
  divisionId: number,
): Promise<{ accepted: boolean }> {
  return authFetchJson(`${API_URL}/api/admin/wv-import/matches/${worldViewId}/accept`, {
    method: 'POST',
    body: JSON.stringify({ regionId, divisionId }),
  });
}

export async function rejectSuggestion(
  worldViewId: number,
  regionId: number,
  divisionId: number,
): Promise<{ rejected: boolean }> {
  return authFetchJson(`${API_URL}/api/admin/wv-import/matches/${worldViewId}/reject`, {
    method: 'POST',
    body: JSON.stringify({ regionId, divisionId }),
  });
}

export async function acceptBatchMatches(
  worldViewId: number,
  assignments: Array<{ regionId: number; divisionId: number }>,
): Promise<{ accepted: number }> {
  return authFetchJson(`${API_URL}/api/admin/wv-import/matches/${worldViewId}/accept-batch`, {
    method: 'POST',
    body: JSON.stringify({ assignments }),
  });
}

export async function getMatchTree(worldViewId: number): Promise<MatchTreeNode[]> {
  return authFetchJson(`${API_URL}/api/admin/wv-import/matches/${worldViewId}/tree`);
}

export async function syncInstances(
  worldViewId: number,
  regionId: number,
): Promise<{ synced: number }> {
  return authFetchJson(`${API_URL}/api/admin/wv-import/matches/${worldViewId}/sync-instances`, {
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
): Promise<{ accepted: boolean; rejected: boolean }> {
  return authFetchJson(`${API_URL}/api/admin/wv-import/matches/${worldViewId}/accept-and-reject`, {
    method: 'POST',
    body: JSON.stringify({ regionId, divisionId }),
  });
}

export async function rejectRemaining(
  worldViewId: number,
  regionId: number,
): Promise<{ rejected: number }> {
  return authFetchJson(`${API_URL}/api/admin/wv-import/matches/${worldViewId}/reject-remaining`, {
    method: 'POST',
    body: JSON.stringify({ regionId }),
  });
}

export async function resetMatchRegion(
  worldViewId: number,
  regionId: number,
): Promise<{ reset: boolean }> {
  return authFetchJson(`${API_URL}/api/admin/wv-import/matches/${worldViewId}/reset-match`, {
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
): Promise<{ transferred: number; transferType: string }> {
  return authFetchJson(`${API_URL}/api/admin/wv-import/matches/${worldViewId}/accept-with-transfer`, {
    method: 'POST',
    body: JSON.stringify({ regionId, divisionIds, donorRegionId, donorDivisionId, transferType }),
  });
}

export async function getTransferPreview(
  worldViewId: number,
  donorDivisionId: number,
  movingDivisionIds: number[],
  wikidataId: string,
): Promise<GeoJSON.FeatureCollection> {
  return authFetchJson(`${API_URL}/api/admin/wv-import/matches/${worldViewId}/transfer-preview`, {
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
  clusterOverlayUrl,
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
