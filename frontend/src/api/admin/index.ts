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
} from '../client.generated';
import {
  deleteAdminCuratorsByAssignmentId, deleteAdminSyncSourcesBySourceIdCache, getAdminCurators,
  getAdminCuratorsByUserIdActivity, getAdminExperiencesAssignRegionsStatus, getAdminExperiencesCountsByRegion,
  getAdminImageProxy,
  getAdminSyncLogs, getAdminSyncLogsByLogId, getAdminSyncLogsByLogIdChanges, getAdminSyncSources,
  getAdminSyncSourcesBySourceIdCache, getAdminSyncSourcesBySourceIdStatus, getAdminUsersSearch, postAdminCurators,
  postAdminExperiencesAssignRegions, postAdminExperiencesAssignRegionsCancel, postAdminSyncSourcesBySourceIdCancel,
  postAdminSyncSourcesBySourceIdFixImages, postAdminSyncSourcesBySourceIdStart,
  postExperiencesSourcesBySourceIdPublishWaiting, putAdminSyncSourcesBySourceIdCacheByKindTtl,
  putAdminSyncSourcesBySourceIdCurationGate, putAdminSyncSourcesBySourceIdLine, putAdminSyncSourcesReorder,
  type CreateCuratorAssignmentBody, type GetAdminSyncLogsByLogIdChangesParams, type SourceLineBody,
} from '../client.generated';

// What every call here answers is declared once, as a backend schema (ADR-0066),
// and generated into `client.generated.ts`. Passed on from here, so a component
// imports a call's answer from the module of the call.
export type {
  AssignmentCancelled, AssignmentStarted, AssignmentStatus, ChangedField, CuratorActivity, CuratorActivityEntry,
  CuratorAssignmentCreated, CuratorAssignmentRevoked, CuratorInfo, Curators, CuratorScope, CurationGateSet,
  ExperienceSource, ExperienceSources, PictureRepairStarted, PlacementCount, PlacementCounts,
  PublishedWaitingObject, PublishWaitingResult, RefusedWaitingObject, SourceLineSet, SourcesReordered,
  SyncCancelled, SyncChange, SyncChanges, SyncContentItem, SyncContentsDelta, SyncErrorDetail, SyncLastRun,
  SyncLog, SyncLogDetail, SyncLogs, SyncStarted, SyncStatus, UserSearchResult, UserSearchResults, WaitingCounts,
  WikidataCache, WikidataCacheCleared, WikidataCacheKind, WikidataCacheTtlSet,
} from '../client.generated';

// =============================================================================
// Types
// =============================================================================

/**
 * A source's fame line as the panel sends it: the main pair always, the finds
 * pair only for a source that has one. The route writes whichever keys the body
 * carries, so an absent finds pair leaves the row's own alone — and a finds pair
 * sent for a one-door source would give it a line no run of its would read.
 * The shape is the document's.
 */
export type { SourceLineBody } from '../client.generated';

// =============================================================================
// Sync API
// =============================================================================

/**
 * Get all experience sources
 */
export async function getSources(): Promise<ExperienceSources> {
  return getAdminSyncSources();
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
  return postAdminSyncSourcesBySourceIdStart(sourceId, {
    dryRun: options.dryRun ?? false,
    refreshCache: options.refreshCache ?? false,
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
  return postAdminSyncSourcesBySourceIdFixImages(sourceId);
}

/**
 * What we are keeping from the source, so an admin can see its age rather than
 * discover it while debugging an answer from last week.
 */
export async function getWikidataCache(sourceId: number): Promise<WikidataCache> {
  return getAdminSyncSourcesBySourceIdCache(sourceId);
}

/** Forget one kind, or everything when `kind` is absent. */
export async function clearWikidataCache(
  sourceId: number, kind?: string,
): Promise<WikidataCacheCleared> {
  return deleteAdminSyncSourcesBySourceIdCache(sourceId, kind ? { kind } : undefined);
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
  return putAdminSyncSourcesBySourceIdCacheByKindTtl(sourceId, kind, { hours });
}

/**
 * Get sync status for a source
 */
export async function getSyncStatus(sourceId: number): Promise<SyncStatus> {
  return getAdminSyncSourcesBySourceIdStatus(sourceId);
}

/**
 * Cancel sync for a source
 */
export async function cancelSync(sourceId: number): Promise<SyncCancelled> {
  return postAdminSyncSourcesBySourceIdCancel(sourceId);
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
  return putAdminSyncSourcesBySourceIdCurationGate(sourceId, { requiresCuration });
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
  return putAdminSyncSourcesBySourceIdLine(sourceId, line);
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
  return postExperiencesSourcesBySourceIdPublishWaiting(sourceId);
}

/**
 * Reorder experience sources (set display_priority)
 */
export async function reorderSources(sourceIds: number[]): Promise<SourcesReordered> {
  return putAdminSyncSourcesReorder({ sourceIds });
}

/**
 * Get sync logs
 */
export async function getSyncLogs(
  sourceId?: number,
  limit = 20,
  offset = 0
): Promise<SyncLogs> {
  return getAdminSyncLogs({ sourceId: sourceId || undefined, limit, offset });
}

/**
 * Get single sync log with details
 */
export async function getSyncLogDetails(logId: number): Promise<SyncLogDetail> {
  return getAdminSyncLogsByLogId(logId);
}

/**
 * Get what a run did, object by object.
 *
 * Rows that came through unchanged are not returned — they are a count on the
 * log itself.
 */
export async function getSyncLogChanges(
  logId: number,
  params: Omit<GetAdminSyncLogsByLogIdChangesParams, 'significantOnly'> & { significantOnly?: boolean } = {},
): Promise<SyncChanges> {
  // Each goes only when it is set, in this order.
  return getAdminSyncLogsByLogIdChanges(logId, {
    type: params.type || undefined,
    significance: params.significance || undefined,
    significantOnly: params.significantOnly ? 'true' : undefined,
    limit: params.limit,
    offset: params.offset,
  });
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
  return postAdminExperiencesAssignRegions({ worldViewId, sourceId });
}

/**
 * Get region assignment status
 */
export async function getAssignmentStatus(worldViewId: number): Promise<AssignmentStatus> {
  return getAdminExperiencesAssignRegionsStatus({ worldViewId });
}

/**
 * Cancel region assignment
 */
export async function cancelAssignment(worldViewId: number): Promise<AssignmentCancelled> {
  return postAdminExperiencesAssignRegionsCancel({ worldViewId });
}

/**
 * Get experience counts by region
 */
export async function getExperienceCountsByRegion(
  worldViewId: number,
  sourceId?: number
): Promise<PlacementCounts> {
  return getAdminExperiencesCountsByRegion({ worldViewId, sourceId: sourceId || undefined });
}

// =============================================================================
// Curator Management API
// =============================================================================

/**
 * List all curators with their scopes
 */
export async function listCurators(): Promise<Curators> {
  return getAdminCurators();
}

/**
 * Create a curator assignment
 */
export async function createCuratorAssignment(data: CreateCuratorAssignmentBody): Promise<CuratorAssignmentCreated> {
  return postAdminCurators(data);
}

/**
 * Revoke a curator assignment
 */
export async function revokeCuratorAssignment(
  assignmentId: number,
): Promise<CuratorAssignmentRevoked> {
  return deleteAdminCuratorsByAssignmentId(assignmentId);
}

/**
 * Get curator activity log
 */
export async function getCuratorActivity(
  userId: number,
  limit = 50,
  offset = 0,
): Promise<CuratorActivity> {
  return getAdminCuratorsByUserIdActivity(userId, { limit, offset });
}

/**
 * Search users (for curator promotion). Uses the general users list.
 */
export async function searchUsers(
  query: string,
): Promise<UserSearchResults> {
  return getAdminUsersSearch({ q: query });
}

// =============================================================================
// Image Proxy
// =============================================================================

/**
 * A picture fetched through the backend, so a canvas can read its pixels: a
 * Wikimedia file drawn straight from its host taints the canvas (CORS).
 */
export async function fetchImageViaProxy(url: string): Promise<Blob> {
  return getAdminImageProxy({ url });
}
