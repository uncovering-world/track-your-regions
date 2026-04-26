/**
 * Admin WorldView Import — Tree Operations
 *
 * Hierarchy mutations: handle-as-grouping, dismiss children, simplify (hierarchy
 * + children), undo, add/remove/rename region, AI review children, mark manual
 * fix, select map image, smart simplify (detect + apply).
 */

import { authFetchJson } from '../fetchUtils';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

// =============================================================================
// Handle-as-Grouping / Dismiss Children
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
// Undo
// =============================================================================

export async function undoLastOperation(
  worldViewId: number,
): Promise<{ undone: boolean; operation: string }> {
  return authFetchJson(`${API_URL}/api/admin/wv-import/matches/${worldViewId}/undo`, {
    method: 'POST',
  });
}

// =============================================================================
// Add / Remove / Rename Region
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
// AI Review / Suggest Children
// =============================================================================

export interface ReviewChildAction {
  type: 'add' | 'remove' | 'rename' | 'enrich';
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

/** Same shape as AIReviewChildrenResult — modern alias used by the suggest-children dialog */
export type AISuggestChildrenResult = AIReviewChildrenResult;

export async function aiReviewChildren(
  worldViewId: number,
  regionId: number,
): Promise<AIReviewChildrenResult> {
  return authFetchJson(`${API_URL}/api/admin/wv-import/matches/${worldViewId}/ai-suggest-children`, {
    method: 'POST',
    body: JSON.stringify({ regionId }),
  });
}

/** Modern alias for aiReviewChildren — same endpoint, different name in newer call sites */
export const aiSuggestChildren = aiReviewChildren;

// =============================================================================
// Mark Manual Fix / Select Map Image
// =============================================================================

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

export async function applySmartFlatten(
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

// Backward-compat alias for older call-sites
export const applySmartSimplifyMove = applySmartFlatten;

// =============================================================================
// Prune / Smart Flatten / Merge / Collapse / Auto-Resolve
// =============================================================================

export interface PruneResult {
  pruned: number;
  undoAvailable?: boolean;
}

export async function pruneToLeaves(
  worldViewId: number,
  regionId: number,
): Promise<PruneResult> {
  return authFetchJson(`${API_URL}/api/admin/wv-import/matches/${worldViewId}/prune-to-leaves`, {
    method: 'POST',
    body: JSON.stringify({ regionId }),
  });
}

export interface SmartFlattenResult {
  absorbed: number;
  divisions: number;
  unmatched?: Array<{ id: number; name: string }>;
  undoAvailable?: boolean;
}

export async function smartFlatten(
  worldViewId: number,
  regionId: number,
): Promise<SmartFlattenResult> {
  return authFetchJson(`${API_URL}/api/admin/wv-import/matches/${worldViewId}/smart-flatten`, {
    method: 'POST',
    body: JSON.stringify({ regionId }),
  });
}

export interface SmartFlattenPreviewResult {
  geometry?: GeoJSON.Geometry | null;
  regionMapUrl?: string | null;
  descendants?: number;
  divisions?: number;
  unmatched?: Array<{ id: number; name: string }>;
}

export async function smartFlattenPreview(
  worldViewId: number,
  regionId: number,
): Promise<SmartFlattenPreviewResult> {
  return authFetchJson(`${API_URL}/api/admin/wv-import/matches/${worldViewId}/smart-flatten/preview`, {
    method: 'POST',
    body: JSON.stringify({ regionId }),
  });
}

export async function mergeChildIntoParent(
  worldViewId: number,
  regionId: number,
): Promise<{ merged: boolean }> {
  return authFetchJson(`${API_URL}/api/admin/wv-import/matches/${worldViewId}/merge-child-into-parent`, {
    method: 'POST',
    body: JSON.stringify({ regionId }),
  });
}

export interface CollapseToParentResult {
  collapsed: number;
  parentSuggestions: number;
  undoAvailable?: boolean;
}

export async function collapseToParent(
  worldViewId: number,
  regionId: number,
): Promise<CollapseToParentResult> {
  return authFetchJson(`${API_URL}/api/admin/wv-import/matches/${worldViewId}/collapse-to-parent`, {
    method: 'POST',
    body: JSON.stringify({ regionId }),
  });
}

export interface AutoResolveChildrenResult {
  resolved: number;
  review: number;
  failed: Array<{ id: number; name: string }>;
  total: number;
  undoAvailable?: boolean;
}

export async function autoResolveChildren(
  worldViewId: number,
  regionId: number,
): Promise<AutoResolveChildrenResult> {
  return authFetchJson(`${API_URL}/api/admin/wv-import/matches/${worldViewId}/auto-resolve-children`, {
    method: 'POST',
    body: JSON.stringify({ regionId }),
  });
}

export async function reparentRegion(
  worldViewId: number,
  regionId: number,
  newParentId: number | null,
): Promise<{ reparented: boolean }> {
  return authFetchJson(`${API_URL}/api/admin/wv-import/matches/${worldViewId}/reparent-region`, {
    method: 'POST',
    body: JSON.stringify({ regionId, newParentId }),
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

export async function clearRegionMembers(
  worldViewId: number,
  regionId: number,
): Promise<{ cleared: number }> {
  return authFetchJson(`${API_URL}/api/admin/wv-import/matches/${worldViewId}/clear-region-members`, {
    method: 'POST',
    body: JSON.stringify({ regionId }),
  });
}

// =============================================================================
// Batch accept/reject
// =============================================================================

export async function acceptBatchAndRejectRest(
  worldViewId: number,
  regionId: number,
  divisionIds: number[],
): Promise<{ accepted: number; rejected: number }> {
  return authFetchJson(`${API_URL}/api/admin/wv-import/matches/${worldViewId}/accept-batch-and-reject-rest`, {
    method: 'POST',
    body: JSON.stringify({ regionId, divisionIds }),
  });
}

export async function rejectBatchSuggestions(
  worldViewId: number,
  regionId: number,
  divisionIds: number[],
): Promise<{ rejected: number }> {
  return authFetchJson(`${API_URL}/api/admin/wv-import/matches/${worldViewId}/reject-batch`, {
    method: 'POST',
    body: JSON.stringify({ regionId, divisionIds }),
  });
}

// =============================================================================
// Division Overlap Detection / Resolution
// =============================================================================

export interface DivisionOverlapResult {
  overlaps: Array<{
    divisionId: number;
    divisionName: string;
    /** GADM hierarchy path (e.g., "World > France > Île-de-France") for display */
    divisionPath: string;
    regions: Array<{
      regionId: number;
      regionName: string;
      viaDivisionId: number;
      viaDivisionName: string;
      /** True for direct (region's own member); false when this region holds the
       * division via a coarser ancestor (containment overlap). */
      isDirect: boolean;
    }>;
  }>;
}

export interface OverlapGadmChild {
  divisionId: number;
  name: string;
  areaKm2?: number;
  assignedToRegionId?: number;
}

export async function checkDivisionOverlap(
  worldViewId: number,
  parentRegionId: number,
): Promise<DivisionOverlapResult> {
  return authFetchJson(`${API_URL}/api/admin/wv-import/matches/${worldViewId}/check-division-overlap`, {
    method: 'POST',
    body: JSON.stringify({ parentRegionId }),
  });
}

export async function getOverlapDivisionChildren(
  worldViewId: number,
  divisionId: number,
  regionIds: number[],
): Promise<{ children: OverlapGadmChild[] }> {
  return authFetchJson(`${API_URL}/api/admin/wv-import/matches/${worldViewId}/overlap-division-children`, {
    method: 'POST',
    body: JSON.stringify({ divisionId, regionIds }),
  });
}

export type OverlapResolution =
  | { action: 'keep'; divisionId: number; keepInRegionId: number; removeFromRegionIds: number[] }
  | {
      action: 'split';
      divisionId: number;
      /** Region whose coarse parent division is being split into GADM children */
      splitRegionId: number;
      assignments: Array<{ gadmChildId: number; targetRegionId: number }>;
    };

export async function resolveOverlap(
  worldViewId: number,
  resolution: OverlapResolution,
): Promise<{ resolved: boolean }> {
  return authFetchJson(`${API_URL}/api/admin/wv-import/matches/${worldViewId}/resolve-overlap`, {
    method: 'POST',
    body: JSON.stringify(resolution),
  });
}
