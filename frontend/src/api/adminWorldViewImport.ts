/**
 * Admin WorldView Import API client
 *
 * Handles import and match review operations.
 */

import { authFetchJson, ensureFreshToken, getAccessToken } from './fetchUtils';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

// =============================================================================
// Types
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

// =============================================================================
// API Functions
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

export async function handleAsGrouping(
  worldViewId: number,
  regionId: number,
): Promise<{ matched: number; total: number; undoAvailable?: boolean }> {
  return authFetchJson(`${API_URL}/api/admin/wv-import/matches/${worldViewId}/handle-as-grouping`, {
    method: 'POST',
    body: JSON.stringify({ regionId }),
  });
}

export async function dismissChildren(
  worldViewId: number,
  regionId: number,
): Promise<{ dismissed: number; undoAvailable?: boolean }> {
  return authFetchJson(`${API_URL}/api/admin/wv-import/matches/${worldViewId}/dismiss-children`, {
    method: 'POST',
    body: JSON.stringify({ regionId }),
  });
}

export async function pruneToLeaves(
  worldViewId: number,
  regionId: number,
): Promise<{ pruned: number; undoAvailable?: boolean }> {
  return authFetchJson(`${API_URL}/api/admin/wv-import/matches/${worldViewId}/prune-to-leaves`, {
    method: 'POST',
    body: JSON.stringify({ regionId }),
  });
}

export async function smartFlatten(
  worldViewId: number,
  regionId: number,
): Promise<{
  absorbed?: number;
  divisions?: number;
  undoAvailable?: boolean;
  error?: string;
  unmatched?: Array<{ id: number; name: string }>;
}> {
  // Use raw fetch (not authFetchJson) so 400 responses return structured data
  // instead of throwing. But we still need token refresh for auth.
  await ensureFreshToken();
  const token = getAccessToken();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const resp = await fetch(`${API_URL}/api/admin/wv-import/matches/${worldViewId}/smart-flatten`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ regionId }),
  });
  const data = await resp.json();
  // 400 with unmatched list → return structured data for the UI to show
  if (resp.status === 400 && data.unmatched) {
    return data;
  }
  // Any other non-2xx → throw so mutation goes to onError
  if (!resp.ok) {
    throw new Error(data.error || `HTTP ${resp.status}`);
  }
  return data;
}

export interface SmartFlattenPreviewResult {
  geometry?: GeoJSON.Geometry;
  regionMapUrl?: string | null;
  descendants?: number;
  divisions?: number;
  unmatched?: Array<{ id: number; name: string }>;
}

export async function smartFlattenPreview(
  worldViewId: number,
  regionId: number,
): Promise<SmartFlattenPreviewResult> {
  await ensureFreshToken();
  const token = getAccessToken();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const resp = await fetch(`${API_URL}/api/admin/wv-import/matches/${worldViewId}/smart-flatten/preview`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ regionId }),
  });
  const data = await resp.json();
  if (resp.status === 400 && data.unmatched) return data;
  if (!resp.ok) throw new Error(data.error || `HTTP ${resp.status}`);
  return data;
}

export async function undoLastOperation(
  worldViewId: number,
): Promise<{ undone: boolean; operation: string }> {
  return authFetchJson(`${API_URL}/api/admin/wv-import/matches/${worldViewId}/undo`, {
    method: 'POST',
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

export interface DBSearchOneResult {
  found: number;
  suggestions: MatchSuggestion[];
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

export interface AIMatchOneResult {
  improved: boolean;
  suggestion?: MatchSuggestion;
  reasoning?: string;
  cost: number;
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

export interface SubtreeNode {
  id: number;
  name: string;
  children: SubtreeNode[];
}

export interface CoverageGap {
  id: number;
  name: string;
  parentName: string | null;
  suggestion: {
    action: 'add_member' | 'create_region';
    targetRegionId: number;
    targetRegionName: string;
  } | null;
  /** GADM descendant tree for non-leaf gaps (helps admin understand what's underneath) */
  subtree?: SubtreeNode[];
}

export interface CoverageResult {
  gaps: CoverageGap[];
  dismissedCount: number;
  dismissedGaps: Array<{ id: number; name: string; parentName: string | null }>;
}

export async function getCoverage(worldViewId: number): Promise<CoverageResult> {
  return authFetchJson(`${API_URL}/api/admin/wv-import/matches/${worldViewId}/coverage`);
}

export interface CoverageProgressEvent {
  type: 'progress' | 'complete' | 'error';
  step?: string;
  elapsed?: number;
  message?: string;
  data?: CoverageResult;
}

/**
 * Check GADM coverage with SSE streaming for progress updates.
 * Mirrors computeRegionGeometryWithProgress from geometry.ts.
 */
export function getCoverageWithProgress(
  worldViewId: number,
  onProgress: (event: CoverageProgressEvent) => void,
): Promise<CoverageResult> {
  return new Promise((resolve, reject) => {
    ensureFreshToken().then(token => {
      const params = new URLSearchParams();
      if (token) params.append('token', token);
      const query = params.toString();
      const url = `${API_URL}/api/admin/wv-import/matches/${worldViewId}/coverage-stream${query ? '?' + query : ''}`;

      const eventSource = new EventSource(url);

      eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data) as CoverageProgressEvent;
          onProgress(data);

          if (data.type === 'complete' || data.type === 'error') {
            eventSource.close();
            if (data.type === 'error') {
              reject(new Error(data.message || 'Coverage check failed'));
            } else {
              resolve(data.data!);
            }
          }
        } catch (e) {
          console.error('Failed to parse SSE event:', e);
        }
      };

      eventSource.onerror = (e) => {
        console.error('Coverage SSE error:', e);
        eventSource.close();
        reject(new Error('Connection to server lost'));
      };
    }).catch(reject);
  });
}

/** Nested tree node for geo-suggest hierarchy selection */
export interface RegionContextNode {
  id: number;
  name: string;
  children: RegionContextNode[];
  isSuggested: boolean;
}

export interface GeoSuggestResult {
  suggestion: {
    action: 'add_member' | 'create_region';
    targetRegionId: number;
    targetRegionName: string;
  } | null;
  suggestionDivisionId?: number;
  suggestionDivisionName?: string;
  gapCenter?: [number, number];
  suggestionCenter?: [number, number];
  /** Distance from gap centroid to nearest boundary of neighbor polygon (km) */
  distanceKm?: number;
  /** Nested hierarchy tree: root → ... → suggested region (with children) */
  contextTree?: RegionContextNode;
}

export async function geoSuggestGap(
  worldViewId: number,
  divisionId: number,
): Promise<GeoSuggestResult> {
  return authFetchJson(`${API_URL}/api/admin/wv-import/matches/${worldViewId}/geo-suggest-gap`, {
    method: 'POST',
    body: JSON.stringify({ divisionId }),
  });
}

export async function dismissCoverageGap(
  worldViewId: number,
  divisionId: number,
): Promise<{ dismissed: boolean }> {
  return authFetchJson(`${API_URL}/api/admin/wv-import/matches/${worldViewId}/dismiss-gap`, {
    method: 'POST',
    body: JSON.stringify({ divisionId }),
  });
}

export async function approveCoverageSuggestion(
  worldViewId: number,
  divisionId: number,
  regionId: number,
  action: 'add_member' | 'create_region',
  gapName?: string,
): Promise<{ approved: boolean; regionId: number }> {
  return authFetchJson(`${API_URL}/api/admin/wv-import/matches/${worldViewId}/approve-coverage`, {
    method: 'POST',
    body: JSON.stringify({ divisionId, regionId, action, gapName }),
  });
}

export async function undismissCoverageGap(
  worldViewId: number,
  divisionId: number,
): Promise<{ undismissed: boolean }> {
  return authFetchJson(`${API_URL}/api/admin/wv-import/matches/${worldViewId}/undismiss-gap`, {
    method: 'POST',
    body: JSON.stringify({ divisionId }),
  });
}

export async function finalizeReview(
  worldViewId: number,
): Promise<{ finalized: boolean; worldViewId: number }> {
  return authFetchJson(`${API_URL}/api/admin/wv-import/matches/${worldViewId}/finalize`, {
    method: 'POST',
  });
}

export interface RematchStatus {
  status: 'matching' | 'complete' | 'failed' | 'idle';
  statusMessage?: string;
  countriesMatched?: number;
  totalCountries?: number;
  noCandidates?: number;
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

export async function markManualFix(
  worldViewId: number,
  regionId: number,
  needsManualFix: boolean,
  fixNote?: string,
): Promise<{ updated: boolean }> {
  return authFetchJson(`${API_URL}/api/admin/wv-import/matches/${worldViewId}/mark-manual-fix`, {
    method: 'POST',
    body: JSON.stringify({ regionId, needsManualFix, fixNote }),
  });
}

export async function mergeChildIntoParent(
  worldViewId: number,
  regionId: number,
): Promise<{ merged: boolean; childId: number; childName: string }> {
  return authFetchJson(`${API_URL}/api/admin/wv-import/matches/${worldViewId}/merge-child`, {
    method: 'POST',
    body: JSON.stringify({ regionId }),
  });
}

export async function selectMapImage(
  worldViewId: number,
  regionId: number,
  imageUrl: string | null,
): Promise<{ selected: boolean }> {
  return authFetchJson(`${API_URL}/api/admin/wv-import/matches/${worldViewId}/select-map-image`, {
    method: 'POST',
    body: JSON.stringify({ regionId, imageUrl }),
  });
}

// =============================================================================
// Hierarchy Review
// =============================================================================

export async function addChildRegion(
  worldViewId: number,
  parentRegionId: number,
  name: string,
): Promise<{ created: boolean; regionId: number }> {
  return authFetchJson(`${API_URL}/api/admin/wv-import/matches/${worldViewId}/add-child-region`, {
    method: 'POST',
    body: JSON.stringify({ parentRegionId, name }),
  });
}

export async function dismissHierarchyWarnings(
  worldViewId: number,
  regionId: number,
): Promise<{ dismissed: boolean }> {
  return authFetchJson(`${API_URL}/api/admin/wv-import/matches/${worldViewId}/dismiss-hierarchy-warnings`, {
    method: 'POST',
    body: JSON.stringify({ regionId }),
  });
}

export async function removeRegionFromImport(
  worldViewId: number,
  regionId: number,
  reparentChildren: boolean,
  reparentDivisions?: boolean,
): Promise<{ removed: boolean; regionName: string }> {
  return authFetchJson(`${API_URL}/api/admin/wv-import/matches/${worldViewId}/remove-region`, {
    method: 'POST',
    body: JSON.stringify({ regionId, reparentChildren, reparentDivisions }),
  });
}

export async function collapseToParent(
  worldViewId: number,
  regionId: number,
): Promise<{ collapsed: number; parentSuggestions: number; undoAvailable?: boolean }> {
  return authFetchJson(`${API_URL}/api/admin/wv-import/matches/${worldViewId}/collapse-to-parent`, {
    method: 'POST',
    body: JSON.stringify({ regionId }),
  });
}

// =============================================================================
// Rename & Reparent
// =============================================================================

export async function renameRegion(
  worldViewId: number,
  regionId: number,
  name: string,
): Promise<{ renamed: boolean; regionId: number; oldName: string; newName: string }> {
  return authFetchJson(`${API_URL}/api/admin/wv-import/matches/${worldViewId}/rename-region`, {
    method: 'POST',
    body: JSON.stringify({ regionId, name }),
  });
}

export async function reparentRegion(
  worldViewId: number,
  regionId: number,
  newParentId: number | null,
): Promise<{ reparented: boolean; regionId: number; oldParentId: number | null; newParentId: number | null }> {
  return authFetchJson(`${API_URL}/api/admin/wv-import/matches/${worldViewId}/reparent-region`, {
    method: 'POST',
    body: JSON.stringify({ regionId, newParentId }),
  });
}

// =============================================================================
// Auto-Resolve Children
// =============================================================================

export interface AutoResolvePreviewMatch {
  regionId: number;
  regionName: string;
  divisionId: number;
  divisionName: string;
  similarity: number;
  geoSimilarity: number | null;
  action: 'auto_matched' | 'needs_review';
}

export interface AutoResolvePreviewResult {
  autoMatched: AutoResolvePreviewMatch[];
  needsReview: AutoResolvePreviewMatch[];
  unmatched: Array<{ id: number; name: string }>;
  parentMembers: {
    kept: Array<{ divisionId: number; name: string }>;
    redundant: Array<{ divisionId: number; name: string; coverage: number }>;
  };
  total: number;
}

export async function autoResolveChildrenPreview(
  worldViewId: number,
  regionId: number,
): Promise<AutoResolvePreviewResult> {
  return authFetchJson(`${API_URL}/api/admin/wv-import/matches/${worldViewId}/auto-resolve-children/preview`, {
    method: 'POST',
    body: JSON.stringify({ regionId }),
  });
}

export interface AutoResolveResult {
  resolved: number;
  review: number;
  total: number;
  failed: Array<{ id: number; name: string }>;
  parentMembersKept: number;
  parentMembersRemoved: number;
  undoAvailable: boolean;
}

export async function autoResolveChildren(
  worldViewId: number,
  regionId: number,
): Promise<AutoResolveResult> {
  return authFetchJson(`${API_URL}/api/admin/wv-import/matches/${worldViewId}/auto-resolve-children`, {
    method: 'POST',
    body: JSON.stringify({ regionId }),
  });
}

export async function fetchGeoshape(wikidataId: string): Promise<GeoJSON.FeatureCollection> {
  return authFetchJson(`${API_URL}/api/admin/wv-import/geoshape/${wikidataId}`);
}

// =============================================================================
// AI Suggest Children
// =============================================================================

export interface AISuggestChildrenResult {
  suggestions: Array<{ name: string; reason: string }>;
  analysis: string;
  stats: { inputTokens: number; outputTokens: number; cost: number } | null;
}

export async function aiSuggestChildren(
  worldViewId: number,
  regionId: number,
): Promise<AISuggestChildrenResult> {
  return authFetchJson(`${API_URL}/api/admin/wv-import/matches/${worldViewId}/ai-suggest-children`, {
    method: 'POST',
    body: JSON.stringify({ regionId }),
  });
}

// =============================================================================
// Children Coverage
// =============================================================================

export interface ChildrenCoverageResult {
  coverage: Record<string, number>;
  geoshapeCoverage: Record<string, number>;
}

export async function getChildrenCoverage(
  worldViewId: number,
  regionId?: number,
  onlyId?: number,
): Promise<ChildrenCoverageResult> {
  const searchParams = new URLSearchParams();
  if (regionId != null) searchParams.set('regionId', String(regionId));
  if (onlyId != null) searchParams.set('onlyId', String(onlyId));
  const qs = searchParams.toString();
  return authFetchJson(`${API_URL}/api/admin/wv-import/matches/${worldViewId}/children-coverage${qs ? `?${qs}` : ''}`);
}

export async function getUnionGeometry(
  worldViewId: number,
  divisionIds: number[],
  regionId?: number,
): Promise<{ geometry: GeoJSON.FeatureCollection }> {
  return authFetchJson(`${API_URL}/api/admin/wv-import/matches/${worldViewId}/union-geometry`, {
    method: 'POST',
    body: JSON.stringify({ divisionIds, ...(regionId != null ? { regionId } : {}) }),
  });
}

export interface SplitDeeperDivision {
  divisionId: number;
  name: string;
  path: string;
  parentId: number | null;
  coverage: number | null;
  hasPoints: boolean;
  assignedTo: string | null;
}

export interface SplitDeeperResult {
  divisions: SplitDeeperDivision[];
  geometry: GeoJSON.FeatureCollection | null;
  points?: Array<{ name: string; lat: number; lon: number }>;
}

export async function splitDivisionsDeeper(
  worldViewId: number,
  divisionIds: number[],
  wikidataId: string,
  regionId: number,
): Promise<SplitDeeperResult> {
  return authFetchJson(`${API_URL}/api/admin/wv-import/matches/${worldViewId}/split-deeper`, {
    method: 'POST',
    body: JSON.stringify({ divisionIds, wikidataId, regionId }),
  });
}

export interface VisionMatchResult {
  suggestedIds: number[];
  rejectedIds: number[];
  unclearIds: number[];
  reasoning: string;
  cost: number;
  debugImages?: {
    regionMap: string;
    divisionsMap: string;
  };
}

export async function visionMatchDivisions(
  worldViewId: number,
  divisionIds: number[],
  regionId: number,
  imageUrl: string,
): Promise<VisionMatchResult> {
  return authFetchJson(`${API_URL}/api/admin/wv-import/matches/${worldViewId}/vision-match`, {
    method: 'POST',
    body: JSON.stringify({ divisionIds, regionId, imageUrl }),
  });
}

export interface ColorMatchCluster {
  clusterId: number;
  color: string;
  pixelShare: number;
  suggestedRegion: { id: number; name: string } | null;
  divisions: Array<{ id: number; name: string; confidence: number; depth: number; parentDivisionId?: number }>;
  unsplittable: Array<{ id: number; name: string; confidence: number; splitClusters: Array<{ clusterId: number; share: number }> }>;
}

export interface DebugImage {
  label: string;
  dataUrl: string;
}

/** Cluster info for interactive map preview */
export interface ClusterGeoInfo {
  clusterId: number;
  color: string;
  regionId: number | null;
  regionName: string | null;
}

export interface ColorMatchResult {
  clusters: ColorMatchCluster[];
  childRegions?: Array<{ id: number; name: string }>;
  /** Divisions whose centroids fall outside the source map coverage */
  outOfBounds?: Array<{ id: number; name: string }>;
  debugImages?: DebugImage[];
  /** Interactive map preview — GeoJSON FeatureCollection with cluster assignment properties */
  geoPreview?: {
    featureCollection: GeoJSON.FeatureCollection;
    clusterInfos: ClusterGeoInfo[];
  };
  stats?: {
    totalDivisions: number;
    assignedDivisions: number;
    cvClusters?: number;
    cvAssignedDivisions?: number;
    cvUnsplittable?: number;
    cvOutOfBounds?: number;
    countryName?: string;
  };
}

export interface WaterSubCluster {
  idx: number;
  pct: number;
  cropDataUrl: string;
}

export interface WaterComponent {
  id: number;
  pct: number;
  cropDataUrl: string;
  subClusters: WaterSubCluster[];
}

export interface WaterReviewDecision {
  approvedIds: number[];
  mixDecisions: Array<{ componentId: number; approvedSubClusters: number[] }>;
}

// =============================================================================
// Cluster Review (merge small artifact clusters into real ones)
// =============================================================================

export interface ClusterReviewCluster {
  label: number;
  color: string;
  pct: number;
  isSmall: boolean;
}

export interface ClusterReviewDecision {
  merges: Record<number, number>;
  excludes?: number[];
}

/** URL for cluster preview image (served from backend memory, like water/park crops) */
export function clusterPreviewUrl(reviewId: string): string {
  const token = getAccessToken();
  const base = `${API_URL}/api/admin/wv-import/cluster-preview/${reviewId}`;
  return token ? `${base}?token=${token}` : base;
}

/** Respond to cluster review during CV match */
export async function respondToClusterReview(reviewId: string, decision: ClusterReviewDecision): Promise<void> {
  await authFetchJson(`${API_URL}/api/admin/wv-import/cluster-review/${reviewId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(decision),
  });
}

export interface ColorMatchSSEEvent {
  type: 'progress' | 'debug_image' | 'complete' | 'error' | 'water_review' | 'park_review' | 'cluster_review';
  step?: string;
  elapsed?: number;
  debugImage?: DebugImage;
  data?: ColorMatchResult & {
    parkCount?: number; totalParkPct?: number; components?: ParkComponent[];
    clusters?: ClusterReviewCluster[];
  };
  message?: string;
  reviewId?: string;
  waterMaskImage?: string;
  waterPxPercent?: number;
  waterComponents?: WaterComponent[];
}

/** Build URL for a water crop image served by the backend (includes JWT for auth) */
export function waterCropUrl(reviewId: string, componentId: number, subCluster: number): string {
  const token = getAccessToken();
  const base = `${API_URL}/api/admin/wv-import/water-crop/${reviewId}/${componentId}/${subCluster}`;
  return token ? `${base}?token=${token}` : base;
}

// =============================================================================
// Park Review (national park overlay detection)
// =============================================================================

export interface ParkComponent {
  id: number;
  pct: number;
}

export interface ParkReviewDecision {
  confirmedIds: number[];
}

/** Build URL for a park crop image served by the backend */
export function parkCropUrl(reviewId: string, componentId: number): string {
  const token = getAccessToken();
  const base = `${API_URL}/api/admin/wv-import/park-crop/${reviewId}/${componentId}`;
  return token ? `${base}?token=${token}` : base;
}

/** Respond to park review during CV match */
export async function respondToParkReview(reviewId: string, decision: ParkReviewDecision): Promise<void> {
  await authFetchJson(`${API_URL}/api/admin/wv-import/park-review/${reviewId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(decision),
  });
}

/** Respond to a per-component water review during CV match */
export async function respondToWaterReview(reviewId: string, decision: WaterReviewDecision): Promise<void> {
  await authFetchJson(`${API_URL}/api/admin/wv-import/water-review/${reviewId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(decision),
  });
}

/**
 * CV color match with SSE streaming for progress updates.
 * Sends progress events, debug images as they're generated, and final result.
 */
export function colorMatchWithProgress(
  worldViewId: number,
  regionId: number,
  onEvent: (event: ColorMatchSSEEvent) => void,
): Promise<ColorMatchResult> {
  return new Promise((resolve, reject) => {
    ensureFreshToken().then(token => {
      const params = new URLSearchParams({ regionId: String(regionId) });
      if (token) params.append('token', token);
      const url = `${API_URL}/api/admin/wv-import/matches/${worldViewId}/color-match-stream?${params}`;

      const eventSource = new EventSource(url);

      eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data) as ColorMatchSSEEvent;
          onEvent(data);

          if (data.type === 'complete' || data.type === 'error') {
            eventSource.close();
            if (data.type === 'error') {
              reject(new Error(data.message || 'CV match failed'));
            } else {
              resolve(data.data!);
            }
          }
        } catch (e) {
          console.error('Failed to parse CV match SSE event:', e);
        }
      };

      eventSource.onerror = () => {
        eventSource.close();
        reject(new Error('Connection to server lost'));
      };
    }).catch(reject);
  });
}

// =============================================================================
// Guided CV Match (seed-based)
// =============================================================================

export interface GuidedMatchPoint { x: number; y: number }
export interface GuidedMatchRegionSeed extends GuidedMatchPoint { regionId: number }
export interface GuidedMatchSeeds {
  waterPoints: GuidedMatchPoint[];
  parkPoints: GuidedMatchPoint[];
  regionSeeds: GuidedMatchRegionSeed[];
}

export async function prepareGuidedMatch(
  worldViewId: number,
  regionId: number,
  seeds: GuidedMatchSeeds,
): Promise<string> {
  const result = await authFetchJson<{ sessionId: string }>(
    `${API_URL}/api/admin/wv-import/matches/${worldViewId}/guided-match-prepare`,
    { method: 'POST', body: JSON.stringify({ regionId, seeds }) },
  );
  return result.sessionId;
}

export function guidedMatchWithProgress(
  worldViewId: number,
  sessionId: string,
  onEvent: (event: ColorMatchSSEEvent) => void,
): Promise<ColorMatchResult> {
  return new Promise((resolve, reject) => {
    ensureFreshToken().then(token => {
      const params = new URLSearchParams({ sessionId });
      if (token) params.append('token', token);
      const url = `${API_URL}/api/admin/wv-import/matches/${worldViewId}/guided-match-stream?${params}`;

      const eventSource = new EventSource(url);

      eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data) as ColorMatchSSEEvent;
          onEvent(data);

          if (data.type === 'complete' || data.type === 'error') {
            eventSource.close();
            if (data.type === 'error') {
              reject(new Error(data.message || 'Guided match failed'));
            } else {
              resolve(data.data!);
            }
          }
        } catch (e) {
          console.error('Failed to parse guided match SSE event:', e);
        }
      };

      eventSource.onerror = () => {
        eventSource.close();
        reject(new Error('Connection to server lost'));
      };
    }).catch(reject);
  });
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

// Mapshape match result
export interface MapshapeMatchResult {
  found: boolean;
  message?: string;
  mapshapes?: Array<{
    title: string;
    color: string;
    wikidataIds: string[];
    matchedRegion: { id: number; name: string } | null;
    divisions: Array<{ id: number; name: string; coverage: number }>;
  }>;
  childRegions?: Array<{ id: number; name: string }>;
  geoPreview?: {
    featureCollection: GeoJSON.FeatureCollection;
    clusterInfos: ClusterGeoInfo[];
  };
  /** Wikivoyage mapshape geoshape boundaries for side-by-side comparison */
  wikivoyagePreview?: GeoJSON.FeatureCollection;
  stats?: {
    totalMapshapes: number;
    matchedMapshapes: number;
    totalDivisions: number;
  };
}

export async function mapshapeMatch(
  worldViewId: number,
  regionId: number,
): Promise<MapshapeMatchResult> {
  return authFetchJson(`${API_URL}/api/admin/wv-import/matches/${worldViewId}/mapshape-match`, {
    method: 'POST',
    body: JSON.stringify({ regionId }),
  });
}

export interface CoverageGeometryResult {
  parentGeometry: GeoJSON.Geometry | null;
  childrenGeometry: GeoJSON.Geometry | null;
  geoshapeGeometry?: GeoJSON.Geometry | null;
}

export async function getCoverageGeometry(
  worldViewId: number,
  regionId: number,
): Promise<CoverageGeometryResult> {
  return authFetchJson(`${API_URL}/api/admin/wv-import/matches/${worldViewId}/coverage-geometry/${regionId}`);
}

// Coverage gap analysis
export interface CoverageGapDivision {
  divisionId: number;
  gadmParentId: number | null;
  name: string;
  path: string;
  level: number;
  areaKm2: number;
  overlapWithGap: number;
  geometry: GeoJSON.Geometry | null;
  suggestedTarget: { regionId: number; regionName: string } | null;
}

export interface SiblingRegionGeometry {
  regionId: number;
  name: string;
  geometry: GeoJSON.Geometry;
}

export interface CoverageGapAnalysisResult {
  gapDivisions: CoverageGapDivision[];
  siblingRegions: SiblingRegionGeometry[];
  message?: string;
}

export async function analyzeCoverageGaps(
  worldViewId: number,
  regionId: number,
): Promise<CoverageGapAnalysisResult> {
  return authFetchJson(`${API_URL}/api/admin/wv-import/matches/${worldViewId}/coverage-gap-analysis/${regionId}`, {
    method: 'POST',
  });
}

/** Get per-child region geometries for drill-down on the gap context map */
export async function getChildrenRegionGeometry(
  worldViewId: number,
  regionId: number,
): Promise<{ childRegions: SiblingRegionGeometry[] }> {
  return authFetchJson(`${API_URL}/api/admin/wv-import/matches/${worldViewId}/children-geometry/${regionId}`);
}
