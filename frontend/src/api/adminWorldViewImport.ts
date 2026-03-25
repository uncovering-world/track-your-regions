/**
 * Admin WorldView Import API client
 *
 * Core types and basic import/match operations.
 * Specialized modules:
 *   - adminWvImportTreeOps.ts   — hierarchy mutations (flatten, prune, rename, etc.)
 *   - adminWvImportCoverage.ts  — GADM coverage analysis & gap resolution
 *   - adminWvImportCvMatch.ts   — CV color matching & guided match pipeline
 */

import { authFetchJson } from './fetchUtils';

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
  hierarchy_warnings_count: string;
}

export interface MatchSuggestion {
  divisionId: number;
  name: string;
  path: string;
  score: number;
  geoSimilarity: number | null;
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
  hierarchyWarnings: string[];
  hierarchyReviewed: boolean;
  geoAvailable: boolean | null;
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
): Promise<{ found: number; suggestions: MatchSuggestion[]; totalCoverage?: number }> {
  return authFetchJson(`${API_URL}/api/admin/wv-import/matches/${worldViewId}/geoshape-match`, {
    method: 'POST',
    body: JSON.stringify({ regionId }),
  });
}

export async function pointMatchRegion(
  worldViewId: number,
  regionId: number,
): Promise<{ found: number; suggestions: MatchSuggestion[] }> {
  return authFetchJson(`${API_URL}/api/admin/wv-import/matches/${worldViewId}/point-match`, {
    method: 'POST',
    body: JSON.stringify({ regionId }),
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

export async function clearRegionMembers(
  worldViewId: number,
  regionId: number,
): Promise<{ cleared: number }> {
  return authFetchJson(`${API_URL}/api/admin/wv-import/matches/${worldViewId}/clear-members`, {
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

export async function fetchGeoshape(wikidataId: string): Promise<GeoJSON.FeatureCollection> {
  return authFetchJson(`${API_URL}/api/admin/wv-import/geoshape/${wikidataId}`);
}

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

export async function acceptBatchAndRejectRest(
  worldViewId: number,
  regionId: number,
  divisionIds: number[],
): Promise<void> {
  await acceptBatchMatches(worldViewId, divisionIds.map(d => ({ regionId, divisionId: d })));
  await rejectRemaining(worldViewId, regionId);
}

export async function rejectBatchSuggestions(
  worldViewId: number,
  regionId: number,
  divisionIds: number[],
): Promise<void> {
  await Promise.all(divisionIds.map(d => rejectSuggestion(worldViewId, regionId, d)));
}

// =============================================================================
// Re-exports for backward compatibility
// =============================================================================

export {
  // Tree operations
  smartFlatten,
  smartFlattenPreview,
  handleAsGrouping,
  dismissChildren,
  pruneToLeaves,
  collapseToParent,
  undoLastOperation,
  mergeChildIntoParent,
  markManualFix,
  selectMapImage,
  addChildRegion,
  dismissHierarchyWarnings,
  removeRegionFromImport,
  renameRegion,
  reparentRegion,
  autoResolveChildrenPreview,
  autoResolveChildren,
  aiSuggestChildren,
  aiSuggestClusterRegions,
  simplifyHierarchy,
  detectSmartSimplify,
  applySmartSimplifyMove,
} from './adminWvImportTreeOps';
export type {
  SmartFlattenPreviewResult,
  AutoResolvePreviewMatch,
  AutoResolvePreviewResult,
  AutoResolveResult,
  AISuggestChildrenResult,
  SimplifyHierarchyResult,
  SmartSimplifyDivision,
  SmartSimplifyMove,
  SmartSimplifyResult,
  ApplySmartSimplifyResult,
} from './adminWvImportTreeOps';

export {
  // Coverage
  getCoverage,
  getCoverageWithProgress,
  geoSuggestGap,
  dismissCoverageGap,
  approveCoverageSuggestion,
  undismissCoverageGap,
  finalizeReview,
  getChildrenCoverage,
  getUnionGeometry,
  splitDivisionsDeeper,
  getCoverageGeometry,
  analyzeCoverageGaps,
  getChildrenRegionGeometry,
} from './adminWvImportCoverage';
export type {
  SubtreeNode,
  CoverageGap,
  CoverageResult,
  CoverageProgressEvent,
  RegionContextNode,
  GeoSuggestResult,
  ChildrenCoverageResult,
  SplitDeeperDivision,
  SplitDeeperResult,
  SiblingRegionGeometry,
  CoverageGeometryResult,
  CoverageGapDivision,
  CoverageGapAnalysisResult,
} from './adminWvImportCoverage';

export {
  // CV Match
  visionMatchDivisions,
  mapshapeMatch,
  clusterPreviewUrl,
  clusterHighlightUrl,
  respondToClusterReview,
  waterCropUrl,
  parkCropUrl,
  respondToParkReview,
  respondToWaterReview,
  colorMatchWithProgress,
  prepareGuidedMatch,
  guidedMatchWithProgress,
} from './adminWvImportCvMatch';
export type {
  ClusterGeoInfo,
  ColorMatchCluster,
  DebugImage,
  ColorMatchResult,
  WaterSubCluster,
  WaterComponent,
  WaterReviewDecision,
  ClusterReviewCluster,
  ClusterReviewDecision,
  ParkComponent,
  ParkReviewDecision,
  ColorMatchSSEEvent,
  VisionMatchResult,
  MapshapeMatchResult,
  GuidedMatchPoint,
  GuidedMatchRegionSeed,
  GuidedMatchSeeds,
} from './adminWvImportCvMatch';
