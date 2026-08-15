/**
 * Admin API client
 *
 * All admin endpoints require authentication with admin role.
 */

import { authFetchJson } from '../fetchUtils';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

// =============================================================================
// Types
// =============================================================================

/** What one source is holding, in the three kinds the review queue asks about. */
export interface WaitingCounts {
  /** Rows nobody has read yet. */
  arrivals: number;
  /** Visible rows holding a change the gate refused — answered per card, not in a batch. */
  held: number;
  /** Visible rows holding unread points or works. */
  contents: number;
}

export interface ExperienceCategory {
  id: number;
  name: string;
  description: string | null;
  is_active: boolean;
  /** Does a run from this source hold its new and changed content for review (ADR-0025)? */
  requires_curation: boolean;
  last_sync_at: string | null;
  last_sync_status: string | null;
  display_priority: number;
  created_at: string;
  /**
   * Three zeros for a source holding nothing — never an absent key, so a panel
   * deciding whether to show "nothing waiting" compares numbers — and `null` when the
   * server could not count. The counts are an addition to this endpoint and the source
   * list is what it is for, so a failed aggregate answers `null` beside intact sources
   * rather than failing the request; a panel that showed `null` as three zeros would
   * make a claim about the source that nothing checked.
   */
  waiting: WaitingCounts | null;
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
  unchanged?: number;
  missing?: number;
  curatedConflicts?: number;
  filtered?: number;
  errors?: number;
  currentItem?: string;
  logId?: number | null;
  /** A preview run: no experiences were written, so no assignment is due. */
  dryRun?: boolean;
  /** Whether a Cancel press would be acted on — the server's rule, not a copy. */
  cancellable?: boolean;
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
  /** Rows whose fields actually changed. Runs before migration 009 counted every row that passed through the upsert, so old logs are not comparable. */
  total_updated: number;
  total_unchanged: number;
  total_missing: number;
  total_curated_conflicts: number;
  total_filtered: number;
  total_errors: number;
  is_dry_run: boolean;
  detection_skipped_reason: string | null;
  /** False on runs that predate change provenance, whose counters mean something else. */
  has_changeset: boolean;
  triggered_by: number | null;
  triggered_by_name: string | null;
}

export interface SyncFieldChange {
  field: string;
  old: unknown;
  new: unknown;
  significance: 'major' | 'minor';
  /** A curator had claimed this field: the stored value won on purpose. */
  curatedConflict: boolean;
  /**
   * The category's gate kept this write out of a row readers can already see, so
   * `new` is a proposal waiting on a curator and `old` is what is live. Absent on
   * rows recorded before the flag existed, which is when nothing was ever held.
   */
  held?: boolean;
}

export interface SyncChange {
  id: number;
  experience_id: number | null;
  external_id: string;
  name_snapshot: string | null;
  change_type: 'created' | 'updated' | 'conflict' | 'held' | 'contents' | 'missing' | 'returned' | 'failed' | 'filtered';
  changed_fields: SyncFieldChange[] | null;
  /**
   * What the run did to what the object holds, by kind of contents (ADR-0026), or
   * `null` where it moved none. A `contents` row carries no `changed_fields` at all —
   * every field came through — so without this the row would name an object and say
   * nothing about why it is in the report.
   */
  contents: Partial<Record<'locations' | 'treasures', {
    added: Array<{ name: string | null; ref: string | null }>;
    withdrawn: Array<{ name: string | null; ref: string | null }>;
    returned: Array<{ name: string | null; ref: string | null }>;
  }>> | null;
  significance: 'major' | 'minor' | null;
  error: string | null;
}

export interface SyncChangesResponse {
  changes: SyncChange[];
  total: number;
  limit: number;
  offset: number;
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
 * @param options - `dryRun` records the changeset without writing any
 *   experiences. A sync deletes nothing either way.
 */
export async function startSync(
  categoryId: number,
  options: { dryRun?: boolean } = {},
): Promise<{ started: boolean; message: string; dryRun?: boolean }> {
  return authFetchJson(`${API_URL}/api/admin/sync/categories/${categoryId}/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dryRun: options.dryRun ?? false }),
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
 * Hold this source's new and changed content for review, or stop holding it.
 *
 * Answers with the state that is now stored rather than echoing the request, so a
 * switch that lost a race renders what is true. Turning the gate **on** publishes
 * nothing and hides nothing: rows the source already published stay visible.
 * Turning it **off** publishes nothing either, and what a backlog does afterwards
 * depends on its kind: unread objects and unread contents wait until someone releases
 * them (`publishWaiting`), while a change a run is holding is applied by that source's
 * next run — the hold only exists while the gate does.
 */
export async function setCurationGate(
  categoryId: number, requiresCuration: boolean,
): Promise<{ categoryId: number; name: string; requiresCuration: boolean }> {
  return authFetchJson(`${API_URL}/api/admin/sync/categories/${categoryId}/curation-gate`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ requiresCuration }),
  });
}

/** One object the batch released, and what came with it. */
export interface PublishedWaitingObject {
  id: number;
  name: string;
  locationsPublished: number;
  /**
   * Works released, from both axes, because either can be zero while a work was.
   *
   * A work reviewed in one venue and unread in another publishes as a link and not as a
   * row, so a consumer reading one number reports zero works for an object that
   * released one — which is why `publishOutcomeFor` takes the `Math.max` of the pair on
   * the single-object path, and why the batch's notice takes it per object too. Declared
   * here so the batch cannot be the form that reports fewer works than the card does for
   * the same act.
   */
  treasureLinksPublished: number;
  treasuresPublished: number;
  /**
   * Points a source replaced whose old pin this publication took off the map.
   *
   * The twin of `placementFailed`, and declared for the same reason: releasing a
   * visible row's unread points releases the withdrawals deferred behind them, so a
   * pin a reader could see yesterday is gone — and "40 objects published." says
   * nothing about it. The single-object notice has carried this sentence since the
   * publish endpoint landed; a batch that dropped it would be the one form of the
   * same act that stays silent about it.
   */
  withdrawalsReleased: number;
  /**
   * The publication landed and re-placing the object into its regions did not.
   *
   * Declared here because dropping it is how a publication with stale regions
   * reads as an unqualified success — and this is the only caller that could
   * report it. Rebuilding a world view is an admin's job, so the curator's one
   * useful act is naming the object and the world views to an admin.
   */
  placementFailed?: true;
  placementFailedWorldViews?: Array<{ id: number | null; name: string | null }>;
}

/**
 * Release everything this source is holding, except the changes it is holding.
 *
 * `heldLeftForReview` is what the caller's *own scope* still holds afterwards, and holds
 * *on purpose*: a held proposal changes a row a reader is already looking at, so it is
 * answered on its own card where the old and new values are visible. A caller that does
 * not show this number will look like it failed. It is not the panel's figure: the panel
 * counts the same kind for the same source but for nobody in particular, so a
 * region-scoped curator is shown a larger number there — by design, and the difference is
 * their scope rather than anything about how the two are counted. It is `null` when the server could not
 * count it — the publications had already committed by then, so the report is sent
 * with the count missing rather than replaced by a `0` nothing checked.
 */
export async function publishWaiting(categoryId: number): Promise<{
  categoryId: number;
  published: PublishedWaitingObject[];
  refused: Array<{ id: number; name: string; error: string }>;
  outOfScope: number;
  heldLeftForReview: number | null;
}> {
  return authFetchJson(`${API_URL}/api/experiences/categories/${categoryId}/publish-waiting`, {
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

/**
 * Get what a run did, object by object.
 *
 * Rows that came through unchanged are not returned — they are a count on the
 * log itself.
 */
export async function getSyncLogChanges(
  logId: number,
  params: {
    type?: string; significance?: string; significantOnly?: boolean;
    limit?: number; offset?: number;
  } = {},
): Promise<SyncChangesResponse> {
  const search = new URLSearchParams();
  if (params.type) search.set('type', params.type);
  if (params.significance) search.set('significance', params.significance);
  if (params.significantOnly) search.set('significantOnly', 'true');
  if (params.limit !== undefined) search.set('limit', String(params.limit));
  if (params.offset !== undefined) search.set('offset', String(params.offset));

  return authFetchJson<SyncChangesResponse>(
    `${API_URL}/api/admin/sync/logs/${logId}/changes?${search}`
  );
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
