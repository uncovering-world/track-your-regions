/**
 * The declared half of `/api/admin` (ADR-0071), in a module of its own so a
 * handler's spec can answer through these routes without importing
 * `routes/adminRoutes.ts`, whose hand-written import routes pull in the OpenCV
 * pipeline. `routes/adminRoutes.ts` builds its router from this list and adds
 * the hand-written routes below it.
 */

import { defineRoute } from '../api/route.js';
import {
  AssignmentCancelled, AssignmentStarted, AssignmentStatus, CuratorActivity, CuratorAssignmentCreated,
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
  addLearnedRuleBodySchema, adminUserSearchQuerySchema, aiRuleIdParamSchema, aiSettingKeyParamSchema, aiSettingValueBodySchema, applyRuleReviewBodySchema, assignmentIdParamSchema, baseLayerImportBodySchema, cacheKindParamSchema, cacheTtlBodySchema, clearCacheQuerySchema, createCuratorAssignmentBodySchema, curationGateBodySchema, curatorActivityQuerySchema, dataAssertionAcceptBodySchema, experienceCountsQuerySchema, hierarchyReviewBodySchema, logIdParamSchema, regionAssignmentStatusQuerySchema, reorderSourcesBodySchema, sourceIdParamSchema, sourceLineBodySchema, startRegionAssignmentBodySchema, startSyncBodySchema, syncChangesQuerySchema, syncLogsQuerySchema, userIdParamSchema, worldViewIdParamSchema, wvCacheNameParamSchema, wvExtractAnswerSchema, wvExtractStartSchema, wvImportAcceptBatchSchema, wvImportAcceptMatchSchema, wvImportAcceptTransferSchema, wvImportBodySchema, wvImportDecideBatchSchema, wvImportGeoshapeMatchSchema, wvImportMarkManualFixSchema, wvImportRegionIdSchema, wvImportSelectMapImageSchema, wvImportSplitDeeperSchema, wvImportTransferPreviewSchema, wvImportUnionGeometrySchema, wvImportVisionMatchSchema,
} from '../types/index.js';
import {
  ExtractionAnswer, ExtractionCancelled, ExtractionStarted, ExtractionStatus, WikivoyageCacheDeleted,
} from '../api/responses/wikivoyageExtract.js';
import {
  AIMatchCancelled, AIMatchOneResult, AIMatchStarted, AIMatchStatus, CoveringMatchResult, DbSearchResult, GeocodeMatchResult, ImportCancelled, ImportStarted, ImportStatus, MatchAccepted, MatchAcceptedRestRejected, MatchReset, MatchStats, MatchTree, MatchesAccepted, RemainingRejected, SuggestionRejected, TransferAccepted, TransferPreview,
} from '../api/responses/worldViewImport.js';
import {
  AutoResolvePreview, ChildMerged, ChildrenAutoResolved, ChildrenCollapsed, ChildrenDismissed, ChildrenGrouped, ChildrenSimplified, DescendantsPruned, FlattenPreviewResult, HierarchySimplified, ManualFixMarked, MapImageSelected, MembersCleared, SelectionAccepted, SelectionRejected, SmartFlattenResult,
} from '../api/responses/wvImportTreeOps.js';
import {
  SplitDeeperResult, UnionGeometryResult, VisionMatchResult,
} from '../api/responses/wvImportCoverage.js';
import {
  MapshapeMatchResult,
} from '../api/responses/wvImportCvMatch.js';
import {
  answerExtractionQuestion, cancelWikivoyageExtraction, deleteCacheFile, getWikivoyageExtractionStatus, startWikivoyageExtraction,
} from '../controllers/admin/wikivoyageExtractController.js';
import {
  cancelWorldViewImport, getWorldViewImportStatus, startWorldViewImport,
} from '../controllers/admin/wvImportLifecycleController.js';
import {
  startBaseLayerImportEndpoint,
} from '../controllers/admin/baseLayerImportController.js';
import {
  acceptAndRejectRest, acceptBatchMatches, acceptMatch, clearMembers, getMatchStats, getMatchTree, markManualFix, rejectMatch, rejectRemaining, selectMapImage,
} from '../controllers/admin/wvImportMatchController.js';
import {
  acceptBatchAndRejectRest, rejectBatchSuggestions,
} from '../controllers/admin/wvImportMatchDecisions.js';
import {
  acceptWithTransfer, getTransferPreview,
} from '../controllers/admin/wvImportMatchTransfer.js';
import {
  getUnionGeometry, splitDivisionsDeeper, visionMatchDivisions,
} from '../controllers/admin/wvImportMatchGeometryController.js';
import {
  mapshapeMatchDivisions,
} from '../controllers/admin/wvImportMapshapeController.js';
import {
  aiMatchOneRegion, cancelAIMatchEndpoint, dbSearchOneRegion, geocodeMatch, geoshapeMatch, getAIMatchStatus, pointMatch, resetMatch, startAIMatch,
} from '../controllers/admin/wvImportAIController.js';
import {
  dismissChildren, mergeChildIntoParent, pruneToLeaves, simplifyChildren, simplifyHierarchy,
} from '../controllers/admin/wvImportTreeOpsController.js';
import {
  collapseToParent, handleAsGrouping, smartFlatten, smartFlattenPreview,
} from '../controllers/admin/wvImportFlattenController.js';
import {
  autoResolveChildren, autoResolveChildrenPreview,
} from '../controllers/admin/wvImportHierarchyController.js';

// Every route here is the admin's. The `/api/admin` mount in `routes/index.ts`
// also puts `requireAuth, requireAdmin` in front of the whole router, for the
// hand-written routes below; a declared route establishes its caller itself,
// so for these the token is checked twice until the last of them is declared.
const ADMIN = { access: 'admin', cache: 'no-store' } as const;

export const adminDeclaredRoutes = [
  // ===========================================================================
  // Sync
  // ===========================================================================
  // List all experience sources
  defineRoute({
    ...ADMIN, method: 'get', path: '/sync/sources',
    response: ExperienceSources,
    handler: getSources,
  }),
  // Reorder experience sources (set display_priority)
  defineRoute({
    ...ADMIN, method: 'put', path: '/sync/sources/reorder',
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
    params: sourceIdParamSchema,
    body: sourceLineBodySchema,
    response: SourceLineSet,
    handler: setSourceLine,
  }),
  // Start sync for a source
  defineRoute({
    ...ADMIN, method: 'post', path: '/sync/sources/:sourceId/start',
    params: sourceIdParamSchema,
    body: startSyncBodySchema,
    response: SyncStarted,
    handler: startSync,
  }),
  // Get sync status for a source (poll this endpoint)
  defineRoute({
    ...ADMIN, method: 'get', path: '/sync/sources/:sourceId/status',
    params: sourceIdParamSchema,
    response: SyncStatus,
    handler: getSyncStatus,
  }),
  // Cancel sync for a source
  defineRoute({
    ...ADMIN, method: 'post', path: '/sync/sources/:sourceId/cancel',
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
    params: sourceIdParamSchema,
    response: WikidataCache,
    handler: getWikidataCache,
  }),
  defineRoute({
    ...ADMIN, method: 'delete', path: '/sync/sources/:sourceId/cache',
    params: sourceIdParamSchema,
    query: clearCacheQuerySchema,
    response: WikidataCacheCleared,
    handler: clearWikidataCache,
  }),
  // Changing a lifetime re-stamps what is already kept, so the panel and the
  // reader cannot disagree about when an answer stops being used.
  defineRoute({
    ...ADMIN, method: 'put', path: '/sync/sources/:sourceId/cache/:kind/ttl',
    params: cacheKindParamSchema,
    body: cacheTtlBodySchema,
    response: WikidataCacheTtlSet,
    handler: setWikidataCacheTtl,
  }),
  // Get sync history/logs
  defineRoute({
    ...ADMIN, method: 'get', path: '/sync/logs',
    query: syncLogsQuerySchema,
    response: SyncLogs,
    handler: getSyncLogs,
  }),
  // Get single sync log with error details
  defineRoute({
    ...ADMIN, method: 'get', path: '/sync/logs/:logId',
    params: logIdParamSchema,
    response: SyncLogDetail,
    handler: getSyncLogDetails,
  }),
  // Per-object breakdown of what a run did
  defineRoute({
    ...ADMIN, method: 'get', path: '/sync/logs/:logId/changes',
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
    body: startRegionAssignmentBodySchema,
    response: AssignmentStarted,
    handler: startRegionAssignment,
  }),
  // Get region assignment status
  defineRoute({
    ...ADMIN, method: 'get', path: '/experiences/assign-regions/status',
    query: regionAssignmentStatusQuerySchema,
    response: AssignmentStatus,
    handler: getRegionAssignmentStatus,
  }),
  // Cancel region assignment
  defineRoute({
    ...ADMIN, method: 'post', path: '/experiences/assign-regions/cancel',
    body: startRegionAssignmentBodySchema,
    response: AssignmentCancelled,
    handler: cancelRegionAssignment,
  }),
  // Get experience counts by region
  defineRoute({
    ...ADMIN, method: 'get', path: '/experiences/counts-by-region',
    query: experienceCountsQuerySchema,
    response: PlacementCounts,
    handler: getExperienceCounts,
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
    response: Curators,
    handler: listCurators,
  }),
  // Create a curator assignment (promote user + assign scope)
  defineRoute({
    ...ADMIN, method: 'post', path: '/curators', status: 201,
    body: createCuratorAssignmentBodySchema,
    response: CuratorAssignmentCreated,
    handler: createCuratorAssignment,
  }),
  // Revoke a curator assignment (and potentially demote role)
  defineRoute({
    ...ADMIN, method: 'delete', path: '/curators/:assignmentId',
    params: assignmentIdParamSchema,
    response: CuratorAssignmentRevoked,
    handler: revokeCuratorAssignment,
  }),
  // Get curator activity log
  defineRoute({
    ...ADMIN, method: 'get', path: '/curators/:userId/activity',
    params: userIdParamSchema,
    query: curatorActivityQuerySchema,
    response: CuratorActivity,
    handler: getCuratorActivity,
  }),
  // Find an account to promote to curator
  defineRoute({
    ...ADMIN, method: 'get', path: '/users/search',
    query: adminUserSearchQuerySchema,
    response: UserSearchResults,
    handler: searchUsers,
  }),

  // ===========================================================================
  // AI Settings & Usage
  // ===========================================================================
  defineRoute({
    ...ADMIN, method: 'get', path: '/ai/settings',
    response: AISettings,
    handler: getAISettings,
  }),
  defineRoute({
    ...ADMIN, method: 'put', path: '/ai/settings/:key',
    params: aiSettingKeyParamSchema,
    body: aiSettingValueBodySchema,
    response: AISettingSaved,
    handler: updateAISetting,
  }),
  defineRoute({
    ...ADMIN, method: 'get', path: '/ai/usage',
    response: AIUsageSummary,
    handler: getAIUsage,
  }),
  defineRoute({
    ...ADMIN, method: 'post', path: '/ai/update-pricing',
    response: PricingUpdated,
    handler: updatePricing,
  }),
  defineRoute({
    ...ADMIN, method: 'get', path: '/ai/rules',
    response: LearnedRules,
    handler: getLearnedRules,
  }),
  defineRoute({
    ...ADMIN, method: 'post', path: '/ai/rules', status: 201,
    body: addLearnedRuleBodySchema,
    response: LearnedRule,
    handler: addLearnedRule,
  }),
  defineRoute({
    ...ADMIN, method: 'delete', path: '/ai/rules/:id',
    params: aiRuleIdParamSchema,
    response: LearnedRuleDeleted,
    handler: deleteLearnedRule,
  }),
  defineRoute({
    ...ADMIN, method: 'post', path: '/ai/rules/review',
    response: RuleReviewResult,
    handler: reviewLearnedRules,
  }),
  defineRoute({
    ...ADMIN, method: 'post', path: '/ai/rules/apply-review',
    body: applyRuleReviewBodySchema,
    response: ReviewSuggestionApplied,
    handler: applyRuleReviewSuggestion,
  }),
  // AI hierarchy review
  defineRoute({
    ...ADMIN, method: 'post', path: '/ai/hierarchy-review/:worldViewId',
    params: worldViewIdParamSchema,
    body: hierarchyReviewBodySchema,
    response: HierarchyReviewResult,
    handler: hierarchyReview,
  }),
  // ===========================================================================
  // Wikivoyage extraction
  // ===========================================================================
  // Start extraction from Wikivoyage
  defineRoute({
    ...ADMIN, method: 'post', path: '/wv-extract/start',
    body: wvExtractStartSchema,
    response: ExtractionStarted,
    handler: startWikivoyageExtraction,
  }),
  // Poll extraction progress
  defineRoute({
    ...ADMIN, method: 'get', path: '/wv-extract/status',
    response: ExtractionStatus,
    handler: getWikivoyageExtractionStatus,
  }),
  // Cancel extraction
  defineRoute({
    ...ADMIN, method: 'post', path: '/wv-extract/cancel',
    response: ExtractionCancelled,
    handler: cancelWikivoyageExtraction,
  }),
  // Answer a pending AI question during extraction
  defineRoute({
    ...ADMIN, method: 'post', path: '/wv-extract/answer',
    body: wvExtractAnswerSchema,
    response: ExtractionAnswer,
    handler: answerExtractionQuestion,
  }),
  // Delete a cache file
  defineRoute({
    ...ADMIN, method: 'delete', path: '/wv-extract/caches/:name',
    params: wvCacheNameParamSchema,
    response: WikivoyageCacheDeleted,
    handler: deleteCacheFile,
  }),
  // ===========================================================================
  // World view import
  // ===========================================================================
  // Start import from JSON body
  defineRoute({
    ...ADMIN, method: 'post', path: '/wv-import/import',
    body: wvImportBodySchema,
    response: ImportStarted,
    handler: startWorldViewImport,
  }),
  // Start a base layer mirror import (progress via /wv-import/import/status)
  defineRoute({
    ...ADMIN, method: 'post', path: '/wv-import/base-layer',
    body: baseLayerImportBodySchema,
    response: ImportStarted,
    handler: startBaseLayerImportEndpoint,
  }),
  // Poll import progress
  defineRoute({
    ...ADMIN, method: 'get', path: '/wv-import/import/status',
    response: ImportStatus,
    handler: getWorldViewImportStatus,
  }),
  // Cancel import
  defineRoute({
    ...ADMIN, method: 'post', path: '/wv-import/import/cancel',
    response: ImportCancelled,
    handler: cancelWorldViewImport,
  }),
  // Get match statistics for a world view
  defineRoute({
    ...ADMIN, method: 'get', path: '/wv-import/matches/:worldViewId/stats',
    params: worldViewIdParamSchema,
    response: MatchStats,
    handler: getMatchStats,
  }),
  // Get hierarchical match tree for a world view
  defineRoute({
    ...ADMIN, method: 'get', path: '/wv-import/matches/:worldViewId/tree',
    params: worldViewIdParamSchema,
    response: MatchTree,
    handler: getMatchTree,
  }),
  // Accept a single match
  defineRoute({
    ...ADMIN, method: 'post', path: '/wv-import/matches/:worldViewId/accept',
    params: worldViewIdParamSchema,
    body: wvImportAcceptMatchSchema,
    response: MatchAccepted,
    handler: acceptMatch,
  }),
  // Reject (dismiss) a single suggestion
  defineRoute({
    ...ADMIN, method: 'post', path: '/wv-import/matches/:worldViewId/reject',
    params: worldViewIdParamSchema,
    body: wvImportAcceptMatchSchema,
    response: SuggestionRejected,
    handler: rejectMatch,
  }),
  defineRoute({
    ...ADMIN, method: 'post', path: '/wv-import/matches/:worldViewId/reject-remaining',
    params: worldViewIdParamSchema,
    body: wvImportRegionIdSchema,
    response: RemainingRejected,
    handler: rejectRemaining,
  }),
  // Accept a match and reject all remaining suggestions in one transaction
  defineRoute({
    ...ADMIN, method: 'post', path: '/wv-import/matches/:worldViewId/accept-and-reject',
    params: worldViewIdParamSchema,
    body: wvImportAcceptMatchSchema,
    response: MatchAcceptedRestRejected,
    handler: acceptAndRejectRest,
  }),
  // The review's selection toolbar: the same two verdicts for several of a region's suggestions at once
  defineRoute({
    ...ADMIN, method: 'post', path: '/wv-import/matches/:worldViewId/accept-batch-and-reject-rest',
    params: worldViewIdParamSchema,
    body: wvImportDecideBatchSchema,
    response: SelectionAccepted,
    handler: acceptBatchAndRejectRest,
  }),
  defineRoute({
    ...ADMIN, method: 'post', path: '/wv-import/matches/:worldViewId/reject-batch',
    params: worldViewIdParamSchema,
    body: wvImportDecideBatchSchema,
    response: SelectionRejected,
    handler: rejectBatchSuggestions,
  }),
  // Clear all assigned divisions from a region (keep suggestions)
  defineRoute({
    ...ADMIN, method: 'post', path: '/wv-import/matches/:worldViewId/clear-members',
    params: worldViewIdParamSchema,
    body: wvImportRegionIdSchema,
    response: MembersCleared,
    handler: clearMembers,
  }),
  // Accept a batch of matches
  defineRoute({
    ...ADMIN, method: 'post', path: '/wv-import/matches/:worldViewId/accept-batch',
    params: worldViewIdParamSchema,
    body: wvImportAcceptBatchSchema,
    response: MatchesAccepted,
    handler: acceptBatchMatches,
  }),
  // Accept with transfer: atomically move divisions from donor region to target
  defineRoute({
    ...ADMIN, method: 'post', path: '/wv-import/matches/:worldViewId/accept-with-transfer',
    params: worldViewIdParamSchema,
    body: wvImportAcceptTransferSchema,
    response: TransferAccepted,
    handler: acceptWithTransfer,
  }),
  // Transfer preview: 3-layer GeoJSON for visualising a proposed transfer operation
  defineRoute({
    ...ADMIN, method: 'post', path: '/wv-import/matches/:worldViewId/transfer-preview',
    params: worldViewIdParamSchema,
    body: wvImportTransferPreviewSchema,
    response: TransferPreview,
    handler: getTransferPreview,
  }),
  // Union geometry for multi-select preview
  defineRoute({
    ...ADMIN, method: 'post', path: '/wv-import/matches/:worldViewId/union-geometry',
    params: worldViewIdParamSchema,
    body: wvImportUnionGeometrySchema,
    response: UnionGeometryResult,
    handler: getUnionGeometry,
  }),
  // Split divisions deeper: replace divisions with their GADM children that intersect geoshape
  defineRoute({
    ...ADMIN, method: 'post', path: '/wv-import/matches/:worldViewId/split-deeper',
    params: worldViewIdParamSchema,
    body: wvImportSplitDeeperSchema,
    response: SplitDeeperResult,
    handler: splitDivisionsDeeper,
  }),
  // AI vision-based division matching
  defineRoute({
    ...ADMIN, method: 'post', path: '/wv-import/matches/:worldViewId/vision-match',
    params: worldViewIdParamSchema,
    body: wvImportVisionMatchSchema,
    response: VisionMatchResult,
    handler: visionMatchDivisions,
  }),
  // Mapshape-based division matching (Kartographer map regions)
  defineRoute({
    ...ADMIN, method: 'post', path: '/wv-import/matches/:worldViewId/mapshape-match',
    params: worldViewIdParamSchema,
    body: wvImportRegionIdSchema,
    response: MapshapeMatchResult,
    handler: mapshapeMatchDivisions,
  }),
  // AI-assisted re-matching
  defineRoute({
    ...ADMIN, method: 'post', path: '/wv-import/matches/:worldViewId/ai-match',
    params: worldViewIdParamSchema,
    response: AIMatchStarted,
    handler: startAIMatch,
  }),
  defineRoute({
    ...ADMIN, method: 'get', path: '/wv-import/matches/:worldViewId/ai-match/status',
    params: worldViewIdParamSchema,
    response: AIMatchStatus,
    handler: getAIMatchStatus,
  }),
  defineRoute({
    ...ADMIN, method: 'post', path: '/wv-import/matches/:worldViewId/ai-match/cancel',
    params: worldViewIdParamSchema,
    response: AIMatchCancelled,
    handler: cancelAIMatchEndpoint,
  }),
  defineRoute({
    ...ADMIN, method: 'post', path: '/wv-import/matches/:worldViewId/db-search-one',
    params: worldViewIdParamSchema,
    body: wvImportRegionIdSchema,
    response: DbSearchResult,
    handler: dbSearchOneRegion,
  }),
  defineRoute({
    ...ADMIN, method: 'post', path: '/wv-import/matches/:worldViewId/geocode-match',
    params: worldViewIdParamSchema,
    body: wvImportRegionIdSchema,
    response: GeocodeMatchResult,
    handler: geocodeMatch,
  }),
  defineRoute({
    ...ADMIN, method: 'post', path: '/wv-import/matches/:worldViewId/geoshape-match',
    params: worldViewIdParamSchema,
    body: wvImportGeoshapeMatchSchema,
    response: CoveringMatchResult,
    handler: geoshapeMatch,
  }),
  defineRoute({
    ...ADMIN, method: 'post', path: '/wv-import/matches/:worldViewId/point-match',
    params: worldViewIdParamSchema,
    body: wvImportGeoshapeMatchSchema,
    response: CoveringMatchResult,
    handler: pointMatch,
  }),
  defineRoute({
    ...ADMIN, method: 'post', path: '/wv-import/matches/:worldViewId/reset-match',
    params: worldViewIdParamSchema,
    body: wvImportRegionIdSchema,
    response: MatchReset,
    handler: resetMatch,
  }),
  defineRoute({
    ...ADMIN, method: 'post', path: '/wv-import/matches/:worldViewId/ai-match-one',
    params: worldViewIdParamSchema,
    body: wvImportRegionIdSchema,
    response: AIMatchOneResult,
    handler: aiMatchOneRegion,
  }),
  // Dismiss subregions (make parent a leaf)
  defineRoute({
    ...ADMIN, method: 'post', path: '/wv-import/matches/:worldViewId/dismiss-children',
    params: worldViewIdParamSchema,
    body: wvImportRegionIdSchema,
    response: ChildrenDismissed,
    handler: dismissChildren,
  }),
  // Prune to leaves: keep direct children, remove grandchildren+
  defineRoute({
    ...ADMIN, method: 'post', path: '/wv-import/matches/:worldViewId/prune-to-leaves',
    params: worldViewIdParamSchema,
    body: wvImportRegionIdSchema,
    response: DescendantsPruned,
    handler: pruneToLeaves,
  }),
  // Collapse to parent: clear children's data, generate suggestions for parent
  defineRoute({
    ...ADMIN, method: 'post', path: '/wv-import/matches/:worldViewId/collapse-to-parent',
    params: worldViewIdParamSchema,
    body: wvImportRegionIdSchema,
    response: ChildrenCollapsed,
    handler: collapseToParent,
  }),
  // Smart flatten: auto-match children, absorb divisions into parent, delete descendants
  defineRoute({
    ...ADMIN, method: 'post', path: '/wv-import/matches/:worldViewId/smart-flatten',
    params: worldViewIdParamSchema,
    body: wvImportRegionIdSchema,
    response: SmartFlattenResult,
    handler: smartFlatten,
  }),
  defineRoute({
    ...ADMIN, method: 'post', path: '/wv-import/matches/:worldViewId/smart-flatten/preview',
    params: worldViewIdParamSchema,
    body: wvImportRegionIdSchema,
    response: FlattenPreviewResult,
    handler: smartFlattenPreview,
  }),
  // Auto-resolve children: batch-match all unmatched leaf descendants
  defineRoute({
    ...ADMIN, method: 'post', path: '/wv-import/matches/:worldViewId/auto-resolve-children/preview',
    params: worldViewIdParamSchema,
    body: wvImportRegionIdSchema,
    response: AutoResolvePreview,
    handler: autoResolveChildrenPreview,
  }),
  defineRoute({
    ...ADMIN, method: 'post', path: '/wv-import/matches/:worldViewId/auto-resolve-children',
    params: worldViewIdParamSchema,
    body: wvImportRegionIdSchema,
    response: ChildrenAutoResolved,
    handler: autoResolveChildren,
  }),
  // Handle region as sub-continental grouping (match children as countries)
  defineRoute({
    ...ADMIN, method: 'post', path: '/wv-import/matches/:worldViewId/handle-as-grouping',
    params: worldViewIdParamSchema,
    body: wvImportRegionIdSchema,
    response: ChildrenGrouped,
    handler: handleAsGrouping,
  }),
  // Select map image from candidates
  defineRoute({
    ...ADMIN, method: 'post', path: '/wv-import/matches/:worldViewId/select-map-image',
    params: worldViewIdParamSchema,
    body: wvImportSelectMapImageSchema,
    response: MapImageSelected,
    handler: selectMapImage,
  }),
  // Mark/unmark region as needing manual fixes
  defineRoute({
    ...ADMIN, method: 'post', path: '/wv-import/matches/:worldViewId/mark-manual-fix',
    params: worldViewIdParamSchema,
    body: wvImportMarkManualFixSchema,
    response: ManualFixMarked,
    handler: markManualFix,
  }),
  // Merge single-child parent's only child into the parent
  defineRoute({
    ...ADMIN, method: 'post', path: '/wv-import/matches/:worldViewId/merge-child',
    params: worldViewIdParamSchema,
    body: wvImportRegionIdSchema,
    response: ChildMerged,
    handler: mergeChildIntoParent,
  }),
  // Simplify hierarchy: replace single-child chains with direct parent→grandchild links
  defineRoute({
    ...ADMIN, method: 'post', path: '/wv-import/matches/:worldViewId/simplify-hierarchy',
    params: worldViewIdParamSchema,
    body: wvImportRegionIdSchema,
    response: HierarchySimplified,
    handler: simplifyHierarchy,
  }),
  // Simplify children: simplify all child regions one by one
  defineRoute({
    ...ADMIN, method: 'post', path: '/wv-import/matches/:worldViewId/simplify-children',
    params: worldViewIdParamSchema,
    body: wvImportRegionIdSchema,
    response: ChildrenSimplified,
    handler: simplifyChildren,
  }),
];
