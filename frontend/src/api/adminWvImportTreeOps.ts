/**
 * Admin WorldView Import — Tree Operations
 *
 * Hierarchy mutations: smart-flatten, prune, dismiss, collapse, merge,
 * rename, reparent, auto-resolve, add/remove child regions.
 */

import { authFetchJson, ensureFreshToken, getAccessToken } from './fetchUtils';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

// =============================================================================
// Smart Flatten
// =============================================================================

export interface SmartFlattenPreviewResult {
  geometry?: GeoJSON.Geometry;
  regionMapUrl?: string | null;
  descendants?: number;
  divisions?: number;
  unmatched?: Array<{ id: number; name: string }>;
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
  // 400 with unmatched list -> return structured data for the UI to show
  if (resp.status === 400 && data.unmatched) {
    return data;
  }
  // Any other non-2xx -> throw so mutation goes to onError
  if (!resp.ok) {
    throw new Error(data.error || `HTTP ${resp.status}`);
  }
  return data;
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

// =============================================================================
// Dismiss / Prune / Collapse / Handle-as-Grouping
// =============================================================================

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

export async function collapseToParent(
  worldViewId: number,
  regionId: number,
): Promise<{ collapsed: number; parentSuggestions: number; undoAvailable?: boolean }> {
  return authFetchJson(`${API_URL}/api/admin/wv-import/matches/${worldViewId}/collapse-to-parent`, {
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

// =============================================================================
// Merge / Mark / Map Image
// =============================================================================

export async function mergeChildIntoParent(
  worldViewId: number,
  regionId: number,
): Promise<{ merged: boolean; childId: number; childName: string }> {
  return authFetchJson(`${API_URL}/api/admin/wv-import/matches/${worldViewId}/merge-child`, {
    method: 'POST',
    body: JSON.stringify({ regionId }),
  });
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

// =============================================================================
// Hierarchy Review — Add / Remove / Rename / Reparent
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

export interface AISuggestChildrenResult {
  actions: ReviewChildAction[];
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
// AI Suggest Cluster-to-Region Mapping
// =============================================================================

export async function aiSuggestClusterRegions(
  worldViewId: number,
  clusters: Array<{ clusterId: number; color: string; pixelShare: number; divisionNames: string[] }>,
  childRegions: Array<{ id: number; name: string }>,
  modelOverride?: string,
): Promise<{ matches: Array<{ clusterId: number; regionId: number | null; regionName: string | null }>; stats: { model: string; promptTokens: number; completionTokens: number; cost: number; durationMs: number } }> {
  return authFetchJson(`${API_URL}/api/admin/wv-import/matches/${worldViewId}/ai-suggest-clusters`, {
    method: 'POST',
    body: JSON.stringify({ clusters, childRegions, ...(modelOverride ? { model: modelOverride } : {}) }),
  });
}

// =============================================================================
// Simplify Hierarchy
// =============================================================================

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

// =============================================================================
// Simplify Children
// =============================================================================

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

export async function detectSmartSimplify(
  worldViewId: number,
  parentRegionId: number,
): Promise<SmartSimplifyResult> {
  return authFetchJson(
    `${API_URL}/api/admin/wv-import/matches/${worldViewId}/smart-simplify`,
    { method: 'POST', body: JSON.stringify({ parentRegionId }) },
  );
}

export interface ApplySmartSimplifyResult {
  moved: number;
  simplification: SimplifyHierarchyResult;
}

export async function applySmartSimplifyMove(
  worldViewId: number,
  parentRegionId: number,
  ownerRegionId: number,
  memberRowIds: number[],
  skipSimplify?: boolean,
): Promise<ApplySmartSimplifyResult> {
  return authFetchJson(
    `${API_URL}/api/admin/wv-import/matches/${worldViewId}/smart-simplify/apply-move`,
    { method: 'POST', body: JSON.stringify({ parentRegionId, ownerRegionId, memberRowIds, skipSimplify }) },
  );
}
