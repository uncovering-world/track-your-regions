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

export interface ExperienceSource {
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
  source_id: number;
  source_name: string;
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
 * Get all experience sources
 */
export async function getSources(): Promise<ExperienceSource[]> {
  return authFetchJson<ExperienceSource[]>(`${API_URL}/api/admin/sync/sources`);
}

/**
 * Start sync for a source
 * @param sourceId - The source to sync
 * @param force - If true, delete all existing data before syncing
 */
export async function startSync(sourceId: number, force: boolean = false): Promise<{ started: boolean; message: string; force?: boolean }> {
  return authFetchJson(`${API_URL}/api/admin/sync/sources/${sourceId}/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ force }),
  });
}

/**
 * Get sync status for a source
 */
export async function getSyncStatus(sourceId: number): Promise<SyncStatus> {
  return authFetchJson<SyncStatus>(`${API_URL}/api/admin/sync/sources/${sourceId}/status`);
}

/**
 * Cancel sync for a source
 */
export async function cancelSync(sourceId: number): Promise<{ cancelled: boolean }> {
  return authFetchJson(`${API_URL}/api/admin/sync/sources/${sourceId}/cancel`, {
    method: 'POST',
  });
}

/**
 * Fix missing images for a source
 */
export async function fixImages(sourceId: number): Promise<{ started: boolean; message: string }> {
  return authFetchJson(`${API_URL}/api/admin/sync/sources/${sourceId}/fix-images`, {
    method: 'POST',
  });
}

/**
 * Reorder experience sources (set display_priority)
 */
export async function reorderSources(sourceIds: number[]): Promise<{ success: boolean }> {
  return authFetchJson(`${API_URL}/api/admin/sync/sources/reorder`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sourceIds }),
  });
}

/**
 * Get sync logs
 */
export async function getSyncLogs(
  sourceId?: number,
  limit = 20,
  offset = 0
): Promise<SyncLogsResponse> {
  const params = new URLSearchParams();
  if (sourceId) params.set('sourceId', String(sourceId));
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
  sourceId?: number
): Promise<{ started: boolean; message: string }> {
  return authFetchJson(`${API_URL}/api/admin/experiences/assign-regions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ worldViewId, sourceId }),
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
  sourceId?: number
): Promise<{ regionId: number; regionName: string; count: number }[]> {
  const params = new URLSearchParams({ worldViewId: String(worldViewId) });
  if (sourceId) params.set('sourceId', String(sourceId));

  return authFetchJson(`${API_URL}/api/admin/experiences/counts-by-region?${params}`);
}

// =============================================================================
// Curator Management API
// =============================================================================

export interface CuratorScope {
  id: number;
  scopeType: 'region' | 'source' | 'global';
  regionId: number | null;
  regionName: string | null;
  sourceId: number | null;
  sourceName: string | null;
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
  scopeType: 'region' | 'source' | 'global';
  regionId?: number;
  sourceId?: number;
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
