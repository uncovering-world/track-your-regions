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
