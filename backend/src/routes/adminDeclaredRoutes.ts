/**
 * Every route under `/api/admin` (ADR-0071), mounted by `routes/mounts.ts`. A
 * handler's spec answers through these routes without building the whole
 * router. The world-view import's routes live in `routes/adminImportRoutes.ts`
 * and its review screen's in `routes/adminImportReviewRoutes.ts`; both are
 * spread in at the end. Nothing here loads the OpenCV pipeline: the
 * colour-match stream imports it when a run starts.
 */

import { defineRoute, IMAGE } from '../api/route.js';
import {
  AssignmentCancelled, AssignmentStarted, AssignmentStatus, CuratorActivity, CuratorAssignmentCreated, EqualItemMerges,
  CuratorAssignmentRevoked, Curators, CurationGateSet, ExperienceSources, PictureRepairStarted, PlacementCounts,
  SourceLineSet, SourcesReordered, SyncCancelled, SyncChanges, SyncLogDetail, SyncLogs, SyncStarted, SyncStatus,
  UserSearchResults, WikidataCache, WikidataCacheCleared, WikidataCacheTtlSet,
} from '../api/responses/admin.js';
import {
  AISettings, AISettingSaved, AIUsageSummary, HierarchyReviewResult, LearnedRule, LearnedRuleDeleted, LearnedRules,
  PricingUpdated, ReviewSuggestionApplied, RuleReviewResult,
} from '../api/responses/adminAi.js';
import { DataAssertion, DataAssertionReport } from '../api/responses/dataAssertions.js';
import {
  startSync, getSyncStatus, cancelSync, fixImages, getSyncLogs, getWikidataCache, clearWikidataCache,
  setWikidataCacheTtl, getSyncLogDetails, getSyncLogChanges, getSources, reorderSources, startRegionAssignment,
  getRegionAssignmentStatus, cancelRegionAssignment, getExperienceCounts,
} from '../controllers/admin/syncController.js';
import { setCurationGate } from '../controllers/admin/curationGateController.js';
import { setSourceLine } from '../controllers/admin/sourceLineController.js';
import { mergePlacesSharingAnItem } from '../controllers/admin/equalItemMergeController.js';
import { acceptDataAssertion, getDataAssertions } from '../controllers/admin/dataAssertionsController.js';
import {
  listCurators, createCuratorAssignment, revokeCuratorAssignment, getCuratorActivity,
} from '../controllers/admin/curatorController.js';
import { searchUsers } from '../controllers/admin/userSearchController.js';
import {
  getAISettings, updateAISetting, getAIUsage, updatePricing, getLearnedRules, addLearnedRule, deleteLearnedRule,
  reviewLearnedRules, applyRuleReviewSuggestion,
} from '../controllers/admin/aiController.js';
import { hierarchyReview } from '../controllers/admin/aiHierarchyReviewController.js';
import { authenticatedLimiter, expensiveAdminLimiter } from '../middleware/rateLimiter.js';
import {
  addLearnedRuleBodySchema, adminUserSearchQuerySchema, aiRuleIdParamSchema, aiSettingKeyParamSchema,
  aiSettingValueBodySchema, applyRuleReviewBodySchema, assignmentIdParamSchema, cacheKindParamSchema,
  cacheTtlBodySchema, clearCacheQuerySchema, createCuratorAssignmentBodySchema, curationGateBodySchema,
  curatorActivityQuerySchema, dataAssertionAcceptBodySchema, experienceCountsQuerySchema, hierarchyReviewBodySchema,
  logIdParamSchema, regionAssignmentStatusQuerySchema, reorderSourcesBodySchema, sourceIdParamSchema,
  sourceLineBodySchema, startRegionAssignmentBodySchema, startSyncBodySchema, syncChangesQuerySchema,
  syncLogsQuerySchema, userIdParamSchema, worldViewIdParamSchema,
} from '../types/index.js';
import { adminImportRoutes } from './adminImportRoutes.js';
import { adminImportReviewRoutes } from './adminImportReviewRoutes.js';
import { proxyImage } from '../controllers/admin/imageProxyController.js';
import { imageProxyQuerySchema } from '../types/index.js';

// Every route here is the admin's, and each establishes its caller itself: the
// `/api/admin` mount in `routes/index.ts` puts no guard of its own in front.
const ADMIN = { access: 'admin', cache: 'no-store' } as const;

export const adminDeclaredRoutes = [
  // ===========================================================================
  // Sync
  // ===========================================================================
  // List all experience sources
  defineRoute({
    ...ADMIN, method: 'get', path: '/sync/sources',
    summary: 'List the active experience sources with their gate, fame line and waiting counts',
    response: ExperienceSources,
    handler: getSources,
  }),
  // Reorder experience sources (set display_priority)
  defineRoute({
    ...ADMIN, method: 'put', path: '/sync/sources/reorder',
    summary: 'Set the order the experience sources are displayed in',
    body: reorderSourcesBodySchema,
    response: SourcesReordered,
    handler: reorderSources,
  }),
  // Whether this source holds new and changed content for a curator
  // (ADR-0025). The gate is a property of the source: a curator answers what a
  // gated run leaves waiting, while deciding that a source needs answering at
  // all is the admin's.
  defineRoute({
    ...ADMIN, method: 'put', path: '/sync/sources/:sourceId/curation-gate',
    summary: 'Hold new and changed content from a source for curator review, or stop holding it',
    params: sourceIdParamSchema,
    body: curationGateBodySchema,
    response: CurationGateSet,
    handler: setCurationGate,
  }),
  // A source's fame line (ADR-0023, ADR-0052): how many sitelinks a row needs
  // to enter the world tier and how few it may fall to before the tier lets it
  // go. A property of the source rather than of any object — the same reason
  // the gate switch sits here.
  defineRoute({
    ...ADMIN, method: 'put', path: '/sync/sources/:sourceId/line',
    summary: 'Set how many sitelinks a place from a source needs to enter and stay in the world tier',
    params: sourceIdParamSchema,
    body: sourceLineBodySchema,
    response: SourceLineSet,
    handler: setSourceLine,
  }),
  // Start sync for a source
  defineRoute({
    ...ADMIN, method: 'post', path: '/sync/sources/:sourceId/start',
    summary: 'Start a sync that fills the catalogue from one source, optionally as a dry run',
    params: sourceIdParamSchema,
    body: startSyncBodySchema,
    response: SyncStarted,
    handler: startSync,
  }),
  // Get sync status for a source (poll this endpoint)
  defineRoute({
    ...ADMIN, method: 'get', path: '/sync/sources/:sourceId/status',
    summary: 'Report progress of the sync or picture repair running for a source, or how the last sync ended',
    params: sourceIdParamSchema,
    response: SyncStatus,
    handler: getSyncStatus,
  }),
  // Cancel sync for a source
  defineRoute({
    ...ADMIN, method: 'post', path: '/sync/sources/:sourceId/cancel',
    summary: 'Ask the sync or picture repair running for a source to stop, while it still can',
    params: sourceIdParamSchema,
    response: SyncCancelled,
    handler: cancelSync,
  }),
  // Fix missing images for a source. Behind the expensive-action limiter like
  // a rematch is: the route reads the source and the run table before it
  // starts, and a repair is a run over every row of a source — CodeQL's
  // js/missing-rate-limiting is the same point.
  defineRoute({
    ...ADMIN, method: 'post', path: '/sync/sources/:sourceId/fix-images', limiter: expensiveAdminLimiter,
    summary: 'Start a run that repairs missing or unshowable pictures of a source from Commons',
    params: sourceIdParamSchema,
    response: PictureRepairStarted,
    handler: fixImages,
  }),
  // What we are keeping from the source, per kind of question, with its age
  // and expiry — and the button that forgets it. Read and delete rather than a
  // mutation of the cache's own rules: an admin's only two questions here are
  // "how old is this" and "ask again".
  defineRoute({
    ...ADMIN, method: 'get', path: '/sync/sources/:sourceId/cache',
    summary: 'List what a source keeps cached between runs, per kind, with its age and expiry',
    params: sourceIdParamSchema,
    response: WikidataCache,
    handler: getWikidataCache,
  }),
  defineRoute({
    ...ADMIN, method: 'delete', path: '/sync/sources/:sourceId/cache',
    summary: 'Clear the cached answers of a source, all kinds or one, so the next run asks again',
    params: sourceIdParamSchema,
    query: clearCacheQuerySchema,
    response: WikidataCacheCleared,
    handler: clearWikidataCache,
  }),
  // Changing a lifetime re-stamps what is already kept, so the panel and the
  // reader cannot disagree about when an answer stops being used.
  defineRoute({
    ...ADMIN, method: 'put', path: '/sync/sources/:sourceId/cache/:kind/ttl',
    summary: 'Set how long one kind of cached answer stays fresh for a source, re-stamping kept ones',
    params: cacheKindParamSchema,
    body: cacheTtlBodySchema,
    response: WikidataCacheTtlSet,
    handler: setWikidataCacheTtl,
  }),
  // Get sync history/logs
  defineRoute({
    ...ADMIN, method: 'get', path: '/sync/logs',
    summary: 'List past sync runs, newest first, optionally for one source',
    query: syncLogsQuerySchema,
    response: SyncLogs,
    handler: getSyncLogs,
  }),
  // Get single sync log with error details
  defineRoute({
    ...ADMIN, method: 'get', path: '/sync/logs/:logId',
    summary: 'Read one sync run with its counts and error details',
    params: logIdParamSchema,
    response: SyncLogDetail,
    handler: getSyncLogDetails,
  }),
  // Per-object breakdown of what a run did
  defineRoute({
    ...ADMIN, method: 'get', path: '/sync/logs/:logId/changes',
    summary: 'List what a sync run changed, object by object, most significant first',
    params: logIdParamSchema,
    query: syncChangesQuerySchema,
    response: SyncChanges,
    handler: getSyncLogChanges,
  }),

  // ===========================================================================
  // Experience Region Assignment
  // ===========================================================================
  // Start region assignment for a world view
  defineRoute({
    ...ADMIN, method: 'post', path: '/experiences/assign-regions',
    summary: 'Start assigning experiences to the regions of a world view that contain them',
    body: startRegionAssignmentBodySchema,
    response: AssignmentStarted,
    handler: startRegionAssignment,
  }),
  // Get region assignment status
  defineRoute({
    ...ADMIN, method: 'get', path: '/experiences/assign-regions/status',
    summary: 'Report the progress of the region assignment running for a world view',
    query: regionAssignmentStatusQuerySchema,
    response: AssignmentStatus,
    handler: getRegionAssignmentStatus,
  }),
  // Cancel region assignment
  defineRoute({
    ...ADMIN, method: 'post', path: '/experiences/assign-regions/cancel',
    summary: 'Cancel the region assignment running for a world view',
    body: startRegionAssignmentBodySchema,
    response: AssignmentCancelled,
    handler: cancelRegionAssignment,
  }),
  // Get experience counts by region
  defineRoute({
    ...ADMIN, method: 'get', path: '/experiences/counts-by-region',
    summary: 'Count the experiences placed in each region of a world view, optionally by source',
    query: experienceCountsQuerySchema,
    response: PlacementCounts,
    handler: getExperienceCounts,
  }),

  // ===========================================================================
  // Places that are one place (ADR-0046, ADR-0086)
  // ===========================================================================
  // The one pass over the catalogue as it stands: every place sharing a
  // Wikidata item with another merged into one. Rate-limited with the other
  // expensive admin work: it walks every shared item, one transaction each.
  defineRoute({
    ...ADMIN, method: 'post', path: '/places/merge-equal-items', limiter: expensiveAdminLimiter,
    summary: 'Merge every place that shares a Wikidata item with another into one place',
    response: EqualItemMerges,
    handler: mergePlacesSharingAnItem,
  }),
  // ===========================================================================
  // Catalogue Data Assertions
  // ===========================================================================
  // What the catalogue's own rows say about themselves, and what has been
  // accepted as the debt it carries. A statement per assertion over the whole
  // catalogue, so it is rate-limited with the other expensive admin work and
  // read when a person opens the section rather than polled.
  defineRoute({
    ...ADMIN, method: 'get', path: '/data-assertions', limiter: expensiveAdminLimiter,
    summary: 'Run every catalogue check and report what each finds and what was accepted',
    response: DataAssertionReport,
    handler: getDataAssertions,
  }),
  // Accept what one assertion currently finds. The body names the assertion
  // only: the number is measured on the server as it records it, since an
  // accepted figure that a browser supplied would be a claim rather than a
  // measurement.
  //
  // `authenticatedLimiter` and not the expensive one, by the rule in
  // `docs/tech/rate-limiting.md`: 5/min is a ceiling on the *person*, and the
  // state this screen exists for is a database where nobody has answered for
  // anything — a press per invariant, one after another, which five a minute
  // would refuse halfway through. One accept re-runs a single assertion and
  // inserts one row. That one statement is not always cheap — the rung rule
  // reads a full-resolution geometry column and takes eight seconds (#685) — so
  // the order the two buckets were in has inverted: 60 presses a minute is up
  // to eight minutes of database work per minute from one address, against the
  // report bucket's five scans of about eleven seconds. What holds is not the
  // ratio but what each is a ceiling on: the report is a whole scan any caller
  // can repeat, while an accept is a person answering for one rule and runs out
  // of rules to answer for.
  defineRoute({
    ...ADMIN, method: 'post', path: '/data-assertions/accept', limiter: authenticatedLimiter,
    summary: 'Accept what one catalogue check finds now as known debt, measured on the server',
    body: dataAssertionAcceptBodySchema,
    response: DataAssertion,
    handler: acceptDataAssertion,
  }),

  // ===========================================================================
  // Curator Management
  // ===========================================================================
  // List all curators with scopes
  defineRoute({
    ...ADMIN, method: 'get', path: '/curators',
    summary: 'List the curators and admins with the scopes each one is assigned',
    response: Curators,
    handler: listCurators,
  }),
  // Create a curator assignment (promote user + assign scope)
  defineRoute({
    ...ADMIN, method: 'post', path: '/curators', status: 201,
    summary: 'Assign a curator scope to a user, promoting them to curator if needed',
    body: createCuratorAssignmentBodySchema,
    response: CuratorAssignmentCreated,
    handler: createCuratorAssignment,
  }),
  // Revoke a curator assignment (and potentially demote role)
  defineRoute({
    ...ADMIN, method: 'delete', path: '/curators/:assignmentId',
    summary: 'Revoke a curator assignment, demoting the user when it was their last',
    params: assignmentIdParamSchema,
    response: CuratorAssignmentRevoked,
    handler: revokeCuratorAssignment,
  }),
  // Get curator activity log
  defineRoute({
    ...ADMIN, method: 'get', path: '/curators/:userId/activity',
    summary: 'List the curation actions one user has taken, newest first',
    params: userIdParamSchema,
    query: curatorActivityQuerySchema,
    response: CuratorActivity,
    handler: getCuratorActivity,
  }),
  // Find an account to promote to curator
  defineRoute({
    ...ADMIN, method: 'get', path: '/users/search',
    summary: 'Search accounts by display name or email to find one to make a curator',
    query: adminUserSearchQuerySchema,
    response: UserSearchResults,
    handler: searchUsers,
  }),

  // ===========================================================================
  // AI Settings & Usage
  // ===========================================================================
  defineRoute({
    ...ADMIN, method: 'get', path: '/ai/settings',
    summary: 'Read the AI settings and the models available with their prices',
    response: AISettings,
    handler: getAISettings,
  }),
  defineRoute({
    ...ADMIN, method: 'put', path: '/ai/settings/:key',
    summary: 'Save the value of one AI setting by its key',
    params: aiSettingKeyParamSchema,
    body: aiSettingValueBodySchema,
    response: AISettingSaved,
    handler: updateAISetting,
  }),
  defineRoute({
    ...ADMIN, method: 'get', path: '/ai/usage',
    summary: 'Summarise AI spending today, this month and overall, by feature and model',
    response: AIUsageSummary,
    handler: getAIUsage,
  }),
  defineRoute({
    ...ADMIN, method: 'post', path: '/ai/update-pricing',
    summary: 'Refresh the AI model prices from the public LiteLLM price list',
    response: PricingUpdated,
    handler: updatePricing,
  }),
  defineRoute({
    ...ADMIN, method: 'get', path: '/ai/rules',
    summary: 'List the learned AI rules alongside the built-in ones',
    response: LearnedRules,
    handler: getLearnedRules,
  }),
  defineRoute({
    ...ADMIN, method: 'post', path: '/ai/rules', status: 201,
    summary: 'Add a learned rule that future AI prompts for a feature will include',
    body: addLearnedRuleBodySchema,
    response: LearnedRule,
    handler: addLearnedRule,
  }),
  defineRoute({
    ...ADMIN, method: 'delete', path: '/ai/rules/:id',
    summary: 'Delete one learned AI rule',
    params: aiRuleIdParamSchema,
    response: LearnedRuleDeleted,
    handler: deleteLearnedRule,
  }),
  defineRoute({
    ...ADMIN, method: 'post', path: '/ai/rules/review',
    summary: 'Ask the AI to find duplicate, conflicting or obsolete learned rules',
    response: RuleReviewResult,
    handler: reviewLearnedRules,
  }),
  defineRoute({
    ...ADMIN, method: 'post', path: '/ai/rules/apply-review',
    summary: 'Apply one rule review suggestion: reword the kept rule and delete the others',
    body: applyRuleReviewBodySchema,
    response: ReviewSuggestionApplied,
    handler: applyRuleReviewSuggestion,
  }),
  // AI hierarchy review
  defineRoute({
    ...ADMIN, method: 'post', path: '/ai/hierarchy-review/:worldViewId',
    summary: 'Ask the AI to review the region tree of a world view, or one subtree, as a travel expert',
    params: worldViewIdParamSchema,
    body: hierarchyReviewBodySchema,
    response: HierarchyReviewResult,
    handler: hierarchyReview,
  }),
  // A Wikimedia Commons picture the editor draws as a map overlay, fetched
  // through the backend for the headers a canvas needs. What it returns is
  // the picture unchanged — the same bytes whoever asks — so any cache may keep
  // it a day, and the declaration says why.
  defineRoute({
    method: 'get', path: '/image-proxy', access: 'admin',
    summary: 'Fetch a Wikimedia Commons picture unchanged so the editor can draw it on a canvas',
    cache: { maxAge: 86400, shared: 'a Wikimedia Commons picture, unchanged: public data with no caller in it' },
    query: imageProxyQuerySchema,
    response: IMAGE,
    handler: proxyImage,
  }),
  // The import's routes (`routes/adminImportRoutes.ts`) and its review
  // screen's (`routes/adminImportReviewRoutes.ts`).
  ...adminImportRoutes,
  ...adminImportReviewRoutes,
];
