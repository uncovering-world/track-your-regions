/**
 * Admin WorldView Import API client
 *
 * Handles import and match review operations.
 */

import { authFetchJson, ensureFreshToken, getAccessToken } from '../fetchUtils';

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

export interface SimplifyHierarchyResult {
  replacements: Array<{ parentName: string; parentPath: string; replacedCount: number }>;
  totalReduced: number;
}

export async function simplifyHierarchy(
  worldViewId: number,
  regionId: number,
): Promise<SimplifyHierarchyResult> {
  return authFetchJson(
    `${API_URL}/api/admin/wv-import/matches/${worldViewId}/simplify-hierarchy`,
    { method: 'POST', body: JSON.stringify({ regionId }) },
  );
}

export interface SimplifyChildrenResult {
  results: Array<{ regionId: number; regionName: string; replacements: Array<{ parentName: string; parentPath: string; replacedCount: number }>; totalReduced: number }>;
  totalSimplified: number;
}

export async function simplifyChildren(
  worldViewId: number,
  parentRegionId: number,
): Promise<SimplifyChildrenResult> {
  return authFetchJson(
    `${API_URL}/api/admin/wv-import/matches/${worldViewId}/simplify-children`,
    { method: 'POST', body: JSON.stringify({ regionId: parentRegionId }) },
  );
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

export interface GeoshapeMatchResult {
  found: number;
  suggestions: MatchSuggestion[];
  totalCoverage?: number;
  scopeAncestorName?: string;
  nextScope?: { ancestorId: number; ancestorName: string };
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

// =============================================================================
// Add / Remove / Rename region
// =============================================================================

export async function addChildRegion(
  worldViewId: number,
  parentRegionId: number,
  name: string,
  sourceUrl?: string,
  sourceExternalId?: string,
): Promise<{ created: boolean; regionId: number }> {
  return authFetchJson(`${API_URL}/api/admin/wv-import/matches/${worldViewId}/add-child-region`, {
    method: 'POST',
    body: JSON.stringify({ parentRegionId, name, sourceUrl, sourceExternalId }),
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

export async function renameRegion(
  worldViewId: number,
  regionId: number,
  name: string,
  sourceUrl?: string,
  sourceExternalId?: string,
): Promise<{ renamed: boolean; regionId: number; oldName: string; newName: string }> {
  return authFetchJson(`${API_URL}/api/admin/wv-import/matches/${worldViewId}/rename-region`, {
    method: 'POST',
    body: JSON.stringify({ regionId, name, sourceUrl, sourceExternalId }),
  });
}

// =============================================================================
// AI Review Children
// =============================================================================

export interface ReviewChildAction {
  type: 'add' | 'remove' | 'rename';
  name: string;
  newName?: string;
  reason: string;
  sourceUrl?: string | null;
  sourceExternalId?: string | null;
  verified: boolean;
}

export interface AIReviewChildrenResult {
  actions: ReviewChildAction[];
  analysis: string;
  stats: { inputTokens: number; outputTokens: number; cost: number } | null;
}

export async function aiReviewChildren(
  worldViewId: number,
  regionId: number,
): Promise<AIReviewChildrenResult> {
  return authFetchJson(`${API_URL}/api/admin/wv-import/matches/${worldViewId}/ai-suggest-children`, {
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

export async function fetchGeoshape(wikidataId: string): Promise<GeoJSON.FeatureCollection> {
  return authFetchJson(`${API_URL}/api/admin/wv-import/geoshape/${wikidataId}`);
}

// =============================================================================
// Smart Simplify
// =============================================================================

export interface SmartSimplifyDivision {
  divisionId: number;
  name: string;
  fromRegionId: number;
  fromRegionName: string;
  memberRowId: number;
}

export interface SmartSimplifyMove {
  gadmParentId: number;
  gadmParentName: string;
  gadmParentPath: string;
  totalChildren: number;
  ownerRegionId: number;
  ownerRegionName: string;
  divisions: SmartSimplifyDivision[];
}

export interface SpatialAnomalyDivision {
  divisionId: number;
  name: string;
  memberRowId: number | null;
  sourceRegionId: number;
  sourceRegionName: string;
}

export interface SpatialAnomaly {
  divisions: SpatialAnomalyDivision[];
  suggestedTargetRegionId: number;
  suggestedTargetRegionName: string;
  fragmentSize: number;
  totalRegionSize: number;
  score: number;
}

export interface SmartSimplifyResult {
  moves: SmartSimplifyMove[];
  spatialAnomalies: SpatialAnomaly[];
}

export interface ApplySmartSimplifyResult {
  moved: number;
}

export async function detectSmartSimplify(
  worldViewId: number,
  parentRegionId: number,
): Promise<SmartSimplifyResult> {
  return authFetchJson(`${API_URL}/api/admin/wv-import/matches/${worldViewId}/smart-simplify`, {
    method: 'POST',
    body: JSON.stringify({ parentRegionId }),
  });
}

export async function applySmartSimplifyMove(
  worldViewId: number,
  parentRegionId: number,
  ownerRegionId: number,
  memberRowIds: number[],
): Promise<ApplySmartSimplifyResult> {
  return authFetchJson(`${API_URL}/api/admin/wv-import/matches/${worldViewId}/smart-simplify/apply-move`, {
    method: 'POST',
    body: JSON.stringify({ parentRegionId, ownerRegionId, memberRowIds }),
  });
}

// =============================================================================
// Children Region Geometry (used by SmartSimplifyDialog)
// =============================================================================

export interface SiblingRegionGeometry {
  regionId: number;
  name: string;
  geometry: GeoJSON.Geometry;
}

export async function getChildrenRegionGeometry(
  worldViewId: number,
  regionId: number,
): Promise<{ childRegions: SiblingRegionGeometry[] }> {
  return authFetchJson(
    `${API_URL}/api/admin/wv-import/matches/${worldViewId}/children-geometry/${regionId}`,
  );
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
// Color Match SSE Types
// =============================================================================

/** Cluster info for interactive map preview */
export interface ClusterGeoInfo {
  clusterId: number;
  color: string;
  regionId: number | null;
  regionName: string | null;
}

export interface ColorMatchCluster {
  clusterId: number;
  color: string;
  pixelShare: number;
  suggestedRegion: { id: number; name: string } | null;
  divisions: Array<{ id: number; name: string; confidence: number; depth: number; parentDivisionId?: number }>;
  unsplittable: Array<{ id: number; name: string; confidence: number; splitClusters: Array<{ clusterId: number; share: number }> }>;
}

export interface AdjacencyEdge {
  divA: number;
  divB: number;
}

export interface DebugImage {
  label: string;
  dataUrl: string;
}

export interface ColorMatchResult {
  clusters: ColorMatchCluster[];
  childRegions?: Array<{ id: number; name: string }>;
  /** Divisions whose centroids fall outside the source map coverage */
  outOfBounds?: Array<{ id: number; name: string }>;
  debugImages?: DebugImage[];
  /** Interactive map preview -- GeoJSON FeatureCollection with cluster assignment properties */
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
  spatialAnomalies?: SpatialAnomaly[];
  adjacencyEdges?: AdjacencyEdge[];
}

// =============================================================================
// Water Review Types
// =============================================================================

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
// Cluster Review Types + URLs
// =============================================================================

/**
 * A single vector border path extracted from the cluster label map via
 * OpenCV findContours. Transferred to the frontend as part of the cluster
 * review SSE event so the paint editor can render an SVG overlay.
 */
export interface BorderPath {
  id: string;
  points: Array<[number, number]>;
  type: 'internal' | 'external';
  clusters: [number, number];
}

/** Cluster info for interactive cluster review (used by CvClusterReviewSection) */
export interface ClusterReviewCluster {
  label: number;
  color: string;
  pct: number;
  isSmall: boolean;
  componentCount: number;
}

/** Normal cluster review decision — merges, excludes, recluster, or split */
export interface ClusterReviewDecision {
  merges: Record<number, number>;
  excludes?: number[];
  recluster?: { preset: 'more_clusters' | 'different_seed' | 'boost_chroma' | 'remove_roads' | 'fill_holes' | 'clean_light' | 'clean_heavy' };
  split?: number[];
}

/** Manual cluster painting response — sent when admin uses the paint editor */
export interface ManualClusterResponse {
  type: 'manual_clusters';
  /** Base64 data URL of the painted cluster overlay PNG */
  overlayPng: string;
  palette: Array<{ label: number; color: [number, number, number] }>;
}

// These URLs are used as `<img src>` (and also passed to `new Image().src` in the
// canvas editor), where browsers will not attach the `Authorization` header.
// `requireAuth` accepts `?token=` as a fallback for exactly this case.
function withTokenQuery(path: string): string {
  const token = getAccessToken();
  return token ? `${path}?token=${token}` : path;
}

/** URL for cluster preview image served from backend memory */
export function clusterPreviewUrl(reviewId: string): string {
  return withTokenQuery(`${API_URL}/api/admin/wv-import/cluster-preview/${reviewId}`);
}

/** URL for per-cluster highlight image (red-outline overlay for selected cluster) */
export function clusterHighlightUrl(reviewId: string, label: number): string {
  return withTokenQuery(`${API_URL}/api/admin/wv-import/cluster-highlight/${reviewId}/${label}`);
}

/** URL for cluster overlay image (RGBA, all clusters in their colors on transparent bg) */
export function clusterOverlayUrl(reviewId: string): string {
  return withTokenQuery(`${API_URL}/api/admin/wv-import/cluster-overlay/${reviewId}`);
}

/** Respond to cluster review during CV match */
export async function respondToClusterReview(
  reviewId: string,
  decision: ClusterReviewDecision | ManualClusterResponse,
): Promise<void> {
  await authFetchJson(`${API_URL}/api/admin/wv-import/cluster-review/${reviewId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(decision),
  });
}

// =============================================================================
// ICP Adaptive Alignment (ADR-0011)
// =============================================================================

export interface IcpAdjustmentDecision {
  action: 'adjust' | 'continue';
}

/**
 * Respond to an ICP adjustment suggestion during CV match.
 * Called when the user clicks "Adjust alignment" or "Continue anyway".
 * POST /api/admin/wv-import/icp-adjustment/:reviewId
 */
export async function respondToIcpAdjustment(
  reviewId: string,
  decision: IcpAdjustmentDecision,
): Promise<void> {
  await authFetchJson(`${API_URL}/api/admin/wv-import/icp-adjustment/${reviewId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(decision),
  });
}

// =============================================================================
// Color Match SSE Streaming
// =============================================================================

export interface ColorMatchSSEEvent {
  type: 'progress' | 'debug_image' | 'complete' | 'error' | 'water_review' | 'cluster_review' | 'icp_adjustment_available';
  step?: string;
  elapsed?: number;
  debugImage?: DebugImage;
  data?: ColorMatchResult & {
    clusters?: ClusterReviewCluster[];
    borderPaths?: BorderPath[];
    pipelineSize?: { w: number; h: number };
  };
  message?: string;
  reviewId?: string;
  waterMaskImage?: string;
  waterPxPercent?: number;
  waterComponents?: WaterComponent[];
  metrics?: { overflow: number; error: number; icpOption: string };
}

/** URL for water crop image during water review (served from backend memory) */
export function waterCropUrl(reviewId: string, componentId: number, subCluster: number): string {
  return `${API_URL}/api/admin/wv-import/water-crop/${reviewId}/${componentId}/${subCluster}`;
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
 * Stream CV color match progress via SSE.
 * Calls onEvent for each event; resolves when complete, rejects on error.
 */
export function colorMatchWithProgress(
  worldViewId: number,
  regionId: number,
  onEvent: (event: ColorMatchSSEEvent) => void,
  signal?: AbortSignal,
): Promise<ColorMatchResult> {
  return new Promise((resolve, reject) => {
    ensureFreshToken().then(token => {
      const params = new URLSearchParams({ regionId: String(regionId) });
      if (token) params.append('token', token);
      const url = `${API_URL}/api/admin/wv-import/matches/${worldViewId}/color-match-stream?${params}`;

      if (signal?.aborted) {
        reject(new DOMException('Aborted', 'AbortError'));
        return;
      }

      const eventSource = new EventSource(url);

      const onAbort = () => {
        eventSource.close();
        reject(new DOMException('Aborted', 'AbortError'));
      };
      signal?.addEventListener('abort', onAbort, { once: true });

      eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data) as ColorMatchSSEEvent;
          onEvent(data);

          if (data.type === 'complete' || data.type === 'error') {
            signal?.removeEventListener('abort', onAbort);
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
        signal?.removeEventListener('abort', onAbort);
        eventSource.close();
        reject(new Error('Connection to server lost'));
      };
    }).catch(reject);
  });
}

// =============================================================================
// Mapshape Match
// =============================================================================

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
