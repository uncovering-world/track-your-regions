/**
 * Admin API client
 *
 * All admin endpoints require authentication with admin role.
 */

import type {
  AssignmentCancelled, AssignmentStarted, AssignmentStatus, CuratorActivity, CuratorAssignmentCreated,
  CuratorAssignmentRevoked, Curators, CurationGateSet, ExperienceSources, PictureRepairStarted, PlacementCounts,
  PublishWaitingResult, SourceLineSet, SourcesReordered, SyncCancelled, SyncChanges, SyncLogDetail, SyncLogs,
  SyncStarted, SyncStatus, UserSearchResults, WikidataCache, WikidataCacheCleared, WikidataCacheTtlSet,
} from '@tyr/shared/api';
import { authFetchJson } from '../fetchUtils';

// What every call here answers is declared once, as a backend schema (ADR-0066),
// and generated into `@tyr/shared/api`. Passed on from here, so a component
// imports a call's answer from the module of the call.
export type {
  AssignmentCancelled, AssignmentStarted, AssignmentStatus, ChangedField, CuratorActivity, CuratorActivityEntry,
  CuratorAssignmentCreated, CuratorAssignmentRevoked, CuratorInfo, Curators, CuratorScope, CurationGateSet,
  ExperienceSource, ExperienceSources, PictureRepairStarted, PlacementCount, PlacementCounts,
  PublishedWaitingObject, PublishWaitingResult, RefusedWaitingObject, SourceLineSet, SourcesReordered,
  SyncCancelled, SyncChange, SyncChanges, SyncContentItem, SyncContentsDelta, SyncErrorDetail, SyncLog,
  SyncLogDetail, SyncLogs, SyncStarted, SyncStatus, UserSearchResult, UserSearchResults, WaitingCounts,
  WikidataCache, WikidataCacheCleared, WikidataCacheKind, WikidataCacheTtlSet,
} from '@tyr/shared/api';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

// =============================================================================
// Types
// =============================================================================

/**
 * A source's fame line as the panel sends it: the main pair always, the finds
 * pair only for a source that has one. The route writes whichever keys the body
 * carries, so an absent finds pair leaves the row's own alone — and a finds pair
 * sent for a one-door source would give it a line no run of its would read.
 */
export interface SourceLineBody {
  enterSitelinks: number;
  staySitelinks: number;
  findEnterSitelinks?: number;
  findStaySitelinks?: number;
}

// =============================================================================
// Sync API
// =============================================================================

/**
 * Get all experience sources
 */
export async function getSources(): Promise<ExperienceSources> {
  return authFetchJson<ExperienceSources>(`${API_URL}/api/admin/sync/sources`);
}

/**
 * Start sync for a source
 * @param sourceId - The source to sync
 * @param options - `dryRun` records the changeset without writing any
 *   experiences. A sync deletes nothing either way.
 */
export async function startSync(
  sourceId: number,
  options: { dryRun?: boolean; refreshCache?: boolean } = {},
): Promise<SyncStarted> {
  return authFetchJson<SyncStarted>(`${API_URL}/api/admin/sync/sources/${sourceId}/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      dryRun: options.dryRun ?? false,
      refreshCache: options.refreshCache ?? false,
    }),
  });
}

/**
 * Put right the pictures of one source, now.
 *
 * A repair rather than a sync: it writes straight to the rows instead of
 * proposing, because what it fixes is the catalogue rather than what the source
 * says. For museums it fills in a picture that was never found; for World
 * Heritage sites it replaces one this product may not show with a Commons file,
 * or takes it away where Wikidata states none (ADR-0043, #557). A picture a
 * curator owns is never touched. Reports through the same status endpoint a
 * sync does.
 */
export async function fixPictures(sourceId: number): Promise<PictureRepairStarted> {
  return authFetchJson<PictureRepairStarted>(`${API_URL}/api/admin/sync/sources/${sourceId}/fix-images`, {
    method: 'POST',
  });
}

/**
 * What we are keeping from the source, so an admin can see its age rather than
 * discover it while debugging an answer from last week.
 */
export async function getWikidataCache(sourceId: number): Promise<WikidataCache> {
  return authFetchJson<WikidataCache>(`${API_URL}/api/admin/sync/sources/${sourceId}/cache`);
}

/** Forget one kind, or everything when `kind` is absent. */
export async function clearWikidataCache(
  sourceId: number, kind?: string,
): Promise<WikidataCacheCleared> {
  const query = kind ? `?kind=${encodeURIComponent(kind)}` : '';
  return authFetchJson<WikidataCacheCleared>(
    `${API_URL}/api/admin/sync/sources/${sourceId}/cache${query}`, { method: 'DELETE' },
  );
}

/**
 * Change how long one kind stays fresh.
 *
 * Answers with how many kept answers were re-stamped: shortening a lifetime can
 * expire a whole kind at once, and the number is what says whether the next run
 * re-fetches five things or five hundred.
 */
export async function setWikidataCacheTtl(
  sourceId: number, kind: string, hours: number,
): Promise<WikidataCacheTtlSet> {
  return authFetchJson<WikidataCacheTtlSet>(`${API_URL}/api/admin/sync/sources/${sourceId}/cache/${encodeURIComponent(kind)}/ttl`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ hours }),
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
export async function cancelSync(sourceId: number): Promise<SyncCancelled> {
  return authFetchJson<SyncCancelled>(`${API_URL}/api/admin/sync/sources/${sourceId}/cancel`, {
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
  sourceId: number, requiresCuration: boolean,
): Promise<CurationGateSet> {
  return authFetchJson<CurationGateSet>(`${API_URL}/api/admin/sync/sources/${sourceId}/curation-gate`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ requiresCuration }),
  });
}

/**
 * Set the sitelinks line a source's own run reads: the Wikipedia-language count an
 * item needs to enter this kind, and the lower count it must keep to stay once in —
 * and the same pair for its finds, where the source has that second door.
 * 404 for a source that is not active or does not exist; 409 for a source whose row
 * carries no line at all — its threshold lives in code, not here.
 */
export async function setSourceLine(
  sourceId: number, line: SourceLineBody,
): Promise<SourceLineSet> {
  return authFetchJson<SourceLineSet>(`${API_URL}/api/admin/sync/sources/${sourceId}/line`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(line),
  });
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
export async function publishWaiting(sourceId: number): Promise<PublishWaitingResult> {
  return authFetchJson<PublishWaitingResult>(`${API_URL}/api/experiences/sources/${sourceId}/publish-waiting`, {
    method: 'POST',
  });
}

/**
 * Reorder experience sources (set display_priority)
 */
export async function reorderSources(sourceIds: number[]): Promise<SourcesReordered> {
  return authFetchJson<SourcesReordered>(`${API_URL}/api/admin/sync/sources/reorder`, {
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
): Promise<SyncLogs> {
  const params = new URLSearchParams();
  if (sourceId) params.set('sourceId', String(sourceId));
  params.set('limit', String(limit));
  params.set('offset', String(offset));

  return authFetchJson<SyncLogs>(`${API_URL}/api/admin/sync/logs?${params}`);
}

/**
 * Get single sync log with details
 */
export async function getSyncLogDetails(logId: number): Promise<SyncLogDetail> {
  return authFetchJson<SyncLogDetail>(`${API_URL}/api/admin/sync/logs/${logId}`);
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
): Promise<SyncChanges> {
  const search = new URLSearchParams();
  if (params.type) search.set('type', params.type);
  if (params.significance) search.set('significance', params.significance);
  if (params.significantOnly) search.set('significantOnly', 'true');
  if (params.limit !== undefined) search.set('limit', String(params.limit));
  if (params.offset !== undefined) search.set('offset', String(params.offset));

  return authFetchJson<SyncChanges>(
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
  sourceId?: number
): Promise<AssignmentStarted> {
  return authFetchJson<AssignmentStarted>(`${API_URL}/api/admin/experiences/assign-regions`, {
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
export async function cancelAssignment(worldViewId: number): Promise<AssignmentCancelled> {
  return authFetchJson<AssignmentCancelled>(`${API_URL}/api/admin/experiences/assign-regions/cancel`, {
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
): Promise<PlacementCounts> {
  const params = new URLSearchParams({ worldViewId: String(worldViewId) });
  if (sourceId) params.set('sourceId', String(sourceId));

  return authFetchJson<PlacementCounts>(`${API_URL}/api/admin/experiences/counts-by-region?${params}`);
}

// =============================================================================
// Curator Management API
// =============================================================================

/**
 * List all curators with their scopes
 */
export async function listCurators(): Promise<Curators> {
  return authFetchJson<Curators>(`${API_URL}/api/admin/curators`);
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
}): Promise<CuratorAssignmentCreated> {
  return authFetchJson<CuratorAssignmentCreated>(`${API_URL}/api/admin/curators`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

/**
 * Revoke a curator assignment
 */
export async function revokeCuratorAssignment(
  assignmentId: number,
): Promise<CuratorAssignmentRevoked> {
  return authFetchJson<CuratorAssignmentRevoked>(`${API_URL}/api/admin/curators/${assignmentId}`, {
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
): Promise<CuratorActivity> {
  return authFetchJson<CuratorActivity>(`${API_URL}/api/admin/curators/${userId}/activity?limit=${limit}&offset=${offset}`);
}

/**
 * Search users (for curator promotion). Uses the general users list.
 */
export async function searchUsers(
  query: string,
): Promise<UserSearchResults> {
  return authFetchJson<UserSearchResults>(`${API_URL}/api/admin/users/search?q=${encodeURIComponent(query)}`);
}
