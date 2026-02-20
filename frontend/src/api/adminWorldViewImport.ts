/**
 * Admin WorldView Import API client
 *
 * Handles import and match review operations.
 */

import { authFetchJson, ensureFreshToken } from './fetchUtils';

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
