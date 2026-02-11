/**
 * Admin API client
 *
 * All admin endpoints require authentication with admin role.
 */

import { authFetchJson } from './fetchUtils';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

// =============================================================================
// Types
// =============================================================================

export interface ExperienceCategory {
  id: number;
  name: string;
  description: string | null;
  is_active: boolean;
  last_sync_at: string | null;
  last_sync_status: string | null;
  last_assignment_at: string | null;
  assignment_needed: boolean;
  display_priority: number;
  created_at: string;
}

export interface SyncStatus {
  running: boolean;
  status?: string;
  statusMessage?: string;
  progress?: number;
  total?: number;
  percent?: number;
  created?: number;
  updated?: number;
  errors?: number;
  currentItem?: string;
  logId?: number | null;
}

export interface SyncLog {
  id: number;
  category_id: number;
  category_name: string;
  started_at: string;
  completed_at: string | null;
  status: string;
  total_fetched: number;
  total_created: number;
  total_updated: number;
  total_errors: number;
  triggered_by: number | null;
  triggered_by_name: string | null;
}

export interface SyncLogsResponse {
  logs: SyncLog[];
  total: number;
  limit: number;
  offset: number;
}

export interface AssignmentStatus {
  running: boolean;
  status?: string;
  statusMessage?: string;
  directAssignments?: number;
  ancestorAssignments?: number;
  totalAssignments?: number;
  errors?: number;
}

// =============================================================================
// Sync API
// =============================================================================

/**
 * Get all experience categories
 */
export async function getCategories(): Promise<ExperienceCategory[]> {
  return authFetchJson<ExperienceCategory[]>(`${API_URL}/api/admin/sync/categories`);
}

/**
 * Start sync for a category
 * @param categoryId - The category to sync
 * @param force - If true, delete all existing data before syncing
 */
export async function startSync(categoryId: number, force: boolean = false): Promise<{ started: boolean; message: string; force?: boolean }> {
  return authFetchJson(`${API_URL}/api/admin/sync/categories/${categoryId}/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ force }),
  });
}

/**
 * Get sync status for a category
 */
export async function getSyncStatus(categoryId: number): Promise<SyncStatus> {
  return authFetchJson<SyncStatus>(`${API_URL}/api/admin/sync/categories/${categoryId}/status`);
}

/**
 * Cancel sync for a category
 */
export async function cancelSync(categoryId: number): Promise<{ cancelled: boolean }> {
  return authFetchJson(`${API_URL}/api/admin/sync/categories/${categoryId}/cancel`, {
    method: 'POST',
  });
}

/**
 * Fix missing images for a category
 */
export async function fixImages(categoryId: number): Promise<{ started: boolean; message: string }> {
  return authFetchJson(`${API_URL}/api/admin/sync/categories/${categoryId}/fix-images`, {
    method: 'POST',
  });
}

/**
 * Reorder experience categories (set display_priority)
 */
export async function reorderCategories(categoryIds: number[]): Promise<{ success: boolean }> {
  return authFetchJson(`${API_URL}/api/admin/sync/categories/reorder`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ categoryIds }),
  });
}

/**
 * Get sync logs
 */
export async function getSyncLogs(
  categoryId?: number,
  limit = 20,
  offset = 0
): Promise<SyncLogsResponse> {
  const params = new URLSearchParams();
  if (categoryId) params.set('categoryId', String(categoryId));
  params.set('limit', String(limit));
  params.set('offset', String(offset));

  return authFetchJson<SyncLogsResponse>(`${API_URL}/api/admin/sync/logs?${params}`);
}

/**
 * Get single sync log with details
 */
export async function getSyncLogDetails(logId: number): Promise<SyncLog & { error_details?: unknown[] }> {
  return authFetchJson(`${API_URL}/api/admin/sync/logs/${logId}`);
}

// =============================================================================
// Region Assignment API
// =============================================================================

/**
 * Start region assignment for a world view
 */
export async function startRegionAssignment(
  worldViewId: number,
  categoryId?: number
): Promise<{ started: boolean; message: string }> {
  return authFetchJson(`${API_URL}/api/admin/experiences/assign-regions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ worldViewId, categoryId }),
  });
}

/**
 * Get region assignment status
 */
export async function getAssignmentStatus(worldViewId: number): Promise<AssignmentStatus> {
  return authFetchJson<AssignmentStatus>(
    `${API_URL}/api/admin/experiences/assign-regions/status?worldViewId=${worldViewId}`
  );
}

/**
 * Cancel region assignment
 */
export async function cancelAssignment(worldViewId: number): Promise<{ cancelled: boolean }> {
  return authFetchJson(`${API_URL}/api/admin/experiences/assign-regions/cancel`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ worldViewId }),
  });
}

/**
 * Get experience counts by region
 */
export async function getExperienceCountsByRegion(
  worldViewId: number,
  categoryId?: number
): Promise<{ regionId: number; regionName: string; count: number }[]> {
  const params = new URLSearchParams({ worldViewId: String(worldViewId) });
  if (categoryId) params.set('categoryId', String(categoryId));

  return authFetchJson(`${API_URL}/api/admin/experiences/counts-by-region?${params}`);
}

// =============================================================================
// Curator Management API
// =============================================================================

export interface CuratorScope {
  id: number;
  scopeType: 'region' | 'category' | 'global';
  regionId: number | null;
  regionName: string | null;
  categoryId: number | null;
  categoryName: string | null;
  assignedAt: string;
  notes: string | null;
}

export interface CuratorInfo {
  user_id: number;
  display_name: string | null;
  email: string | null;
  role: string;
  avatar_url: string | null;
  scopes: CuratorScope[];
}

export interface CuratorActivityEntry {
  id: number;
  action: string;
  created_at: string;
  details: Record<string, unknown> | null;
  experience_id: number;
  experience_name: string;
  region_id: number | null;
  region_name: string | null;
}

/**
 * List all curators with their scopes
 */
export async function listCurators(): Promise<CuratorInfo[]> {
  return authFetchJson<CuratorInfo[]>(`${API_URL}/api/admin/curators`);
}

/**
 * Create a curator assignment
 */
export async function createCuratorAssignment(data: {
  userId: number;
  scopeType: 'region' | 'category' | 'global';
  regionId?: number;
  categoryId?: number;
  notes?: string;
}): Promise<{ id: number; userId: number; scopeType: string; rolePromoted: boolean }> {
  return authFetchJson(`${API_URL}/api/admin/curators`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

/**
 * Revoke a curator assignment
 */
export async function revokeCuratorAssignment(
  assignmentId: number,
): Promise<{ success: boolean; roleReverted: boolean; remainingAssignments: number }> {
  return authFetchJson(`${API_URL}/api/admin/curators/${assignmentId}`, {
    method: 'DELETE',
  });
}

/**
 * Get curator activity log
 */
export async function getCuratorActivity(
  userId: number,
  limit = 50,
  offset = 0,
): Promise<{ activity: CuratorActivityEntry[]; total: number }> {
  return authFetchJson(`${API_URL}/api/admin/curators/${userId}/activity?limit=${limit}&offset=${offset}`);
}

/**
 * Search users (for curator promotion). Uses the general users list.
 */
export async function searchUsers(
  query: string,
): Promise<{ id: number; display_name: string | null; email: string | null; role: string }[]> {
  return authFetchJson(`${API_URL}/api/admin/users/search?q=${encodeURIComponent(query)}`);
}
