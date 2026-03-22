/**
 * Admin Routes
 *
 * All routes require admin authentication.
 * Handles sync operations, geometry computation, and other admin tasks.
 */

import { Router, Response } from 'express';
import type { AuthenticatedRequest } from '../middleware/auth.js';
import { pool } from '../db/index.js';
import { validate } from '../middleware/errorHandler.js';
import { z } from 'zod';
import {
  categoryIdParamSchema,
  logIdParamSchema,
  assignmentIdParamSchema,
  userIdParamSchema,
  startSyncBodySchema,
  reorderCategoriesBodySchema,
  startRegionAssignmentBodySchema,
  regionAssignmentStatusQuerySchema,
  experienceCountsQuerySchema,
  syncLogsQuerySchema,
  createCuratorAssignmentBodySchema,
  curatorActivityQuerySchema,
  adminUserSearchQuerySchema,
  worldViewIdParamSchema,
  worldViewRegionIdParamSchema,
  wvExtractStartSchema,
  wvExtractAnswerSchema,
  wvImportBodySchema,
  wvImportAcceptMatchSchema,
  wvImportAcceptBatchSchema,
  wvImportUnionGeometrySchema,
  wvImportSplitDeeperSchema,
  wvImportVisionMatchSchema,
  wvImportColorMatchSchema,
  wvImportRegionIdSchema,
  wvImportSelectMapImageSchema,
  wvImportMarkManualFixSchema,
  wikidataIdParamSchema,
  divisionIdBodySchema,
  wvImportApproveCoverageSchema,
  wvImportAddChildSchema,
  wvImportRemoveRegionSchema,
  wvImportRenameRegionSchema,
  wvImportReparentRegionSchema,
  coverageSSEQuerySchema,
  childrenCoverageQuerySchema,
} from '../types/index.js';
import {
  startSync,
  getSyncStatus,
  cancelSync,
  fixImages,
  getSyncLogs,
  getSyncLogDetails,
  getCategories,
  reorderCategories,
  startRegionAssignment,
  getRegionAssignmentStatus,
  cancelRegionAssignment,
  getExperienceCounts,
} from '../controllers/admin/syncController.js';
import {
  listCurators,
  createCuratorAssignment,
  revokeCuratorAssignment,
  getCuratorActivity,
} from '../controllers/admin/curatorController.js';
import {
  startWorldViewImport,
  getWorldViewImportStatus,
  cancelWorldViewImport,
  getGeoshape,
} from '../controllers/admin/wvImportLifecycleController.js';
import {
  getMatchStats,
  getMatchTree,
  acceptMatch,
  rejectMatch,
  rejectRemaining,
  clearMembers,
  acceptAndRejectRest,
  acceptBatchMatches,
  selectMapImage,
  markManualFix,
  getUnionGeometry,
  splitDivisionsDeeper,
  visionMatchDivisions,
  colorMatchDivisionsSSE,
  resolveWaterReview,
  getWaterCropImage,
  resolveParkReview,
  getParkCropImage,
  resolveClusterReview,
  getClusterPreviewImage,
  getClusterHighlightImage,
} from '../controllers/admin/wvImportMatchController.js';
import {
  startAIMatch,
  getAIMatchStatus,
  cancelAIMatchEndpoint,
  dbSearchOneRegion,
  geocodeMatch,
  geoshapeMatch,
  pointMatch,
  resetMatch,
  aiMatchOneRegion,
  aiSuggestChildren,
  aiSuggestClusterRegions,
} from '../controllers/admin/wvImportAIController.js';
import {
  mergeChildIntoParent,
  removeRegionFromImport,
  dismissChildren,
  pruneToLeaves,
} from '../controllers/admin/wvImportTreeOpsController.js';
import {
  collapseToParent,
  smartFlattenPreview,
  smartFlatten,
  syncInstances,
  handleAsGrouping,
} from '../controllers/admin/wvImportFlattenController.js';
import {
  undoLastOperation,
  autoResolveChildrenPreview,
  autoResolveChildren,
} from '../controllers/admin/wvImportHierarchyController.js';
import {
  getCoverage,
  getCoverageSSE,
  geoSuggestGap,
  dismissCoverageGap,
  undismissCoverageGap,
  approveCoverageSuggestion,
  finalizeReview,
  rematchWorldView,
  getRematchStatus,
  addChildRegion,
  dismissHierarchyWarnings,
} from '../controllers/admin/wvImportCoverageController.js';
import {
  getChildrenCoverage,
  getCoverageGeometry,
  analyzeCoverageGaps,
  getChildrenRegionGeometry,
} from '../controllers/admin/wvImportCoverageCompareController.js';
import { mapshapeMatchDivisions } from '../controllers/admin/wvImportMapshapeController.js';
import {
  startWikivoyageExtraction,
  getWikivoyageExtractionStatus,
  cancelWikivoyageExtraction,
  answerExtractionQuestion,
  deleteCacheFile,
} from '../controllers/admin/wikivoyageExtractController.js';
import {
  getAISettings,
  updateAISetting,
  getAIUsage,
  updatePricing,
  getLearnedRules,
  addLearnedRule,
  deleteLearnedRule,
  reviewLearnedRules,
  applyRuleReviewSuggestion,
} from '../controllers/admin/aiController.js';
import {
  renameRegion,
  reparentRegion,
} from '../controllers/admin/wvImportRenameController.js';
import { hierarchyReview } from '../controllers/admin/aiHierarchyReviewController.js';

const router = Router();

// =============================================================================
// Sync Routes
// =============================================================================

// List all experience sources
router.get('/sync/categories', getCategories);

// Reorder experience sources (set display_priority)
router.put('/sync/categories/reorder', validate(reorderCategoriesBodySchema), reorderCategories);

// Start sync for a source
router.post('/sync/categories/:categoryId/start', validate(categoryIdParamSchema, 'params'), validate(startSyncBodySchema), startSync);

// Get sync status for a source (poll this endpoint)
router.get('/sync/categories/:categoryId/status', validate(categoryIdParamSchema, 'params'), getSyncStatus);

// Cancel sync for a source
router.post('/sync/categories/:categoryId/cancel', validate(categoryIdParamSchema, 'params'), cancelSync);

// Fix missing images for a source
router.post('/sync/categories/:categoryId/fix-images', validate(categoryIdParamSchema, 'params'), fixImages);

// Get sync history/logs
router.get('/sync/logs', validate(syncLogsQuerySchema, 'query'), getSyncLogs);

// Get single sync log with error details
router.get('/sync/logs/:logId', validate(logIdParamSchema, 'params'), getSyncLogDetails);

// =============================================================================
// Experience Region Assignment Routes
// =============================================================================

// Start region assignment for a world view
router.post('/experiences/assign-regions', validate(startRegionAssignmentBodySchema), startRegionAssignment);

// Get region assignment status
router.get('/experiences/assign-regions/status', validate(regionAssignmentStatusQuerySchema, 'query'), getRegionAssignmentStatus);

// Cancel region assignment
router.post('/experiences/assign-regions/cancel', validate(startRegionAssignmentBodySchema), cancelRegionAssignment);

// Get experience counts by region
router.get('/experiences/counts-by-region', validate(experienceCountsQuerySchema, 'query'), getExperienceCounts);

// =============================================================================
// Curator Management Routes
// =============================================================================

// List all curators with scopes
router.get('/curators', listCurators);

// Create a curator assignment (promote user + assign scope)
router.post('/curators', validate(createCuratorAssignmentBodySchema), createCuratorAssignment);

// Revoke a curator assignment (and potentially demote role)
router.delete('/curators/:assignmentId', validate(assignmentIdParamSchema, 'params'), revokeCuratorAssignment);

// Get curator activity log
router.get('/curators/:userId/activity', validate(userIdParamSchema, 'params'), validate(curatorActivityQuerySchema, 'query'), getCuratorActivity);

// =============================================================================
// User Search (for curator promotion)
// =============================================================================

router.get('/users/search', validate(adminUserSearchQuerySchema, 'query'), async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const { q } = req.query as unknown as { q: string };

  const result = await pool.query(`
    SELECT id, display_name, email, role
    FROM users
    WHERE display_name ILIKE $1 OR email ILIKE $1
    ORDER BY display_name
    LIMIT 20
  `, [`%${q}%`]);

  res.json(result.rows);
});

// =============================================================================
// Wikivoyage Extraction Routes
// =============================================================================

// Start extraction from Wikivoyage
router.post('/wv-extract/start', validate(wvExtractStartSchema), startWikivoyageExtraction);

// Poll extraction progress
router.get('/wv-extract/status', getWikivoyageExtractionStatus);

// Cancel extraction
router.post('/wv-extract/cancel', cancelWikivoyageExtraction);

// Answer a pending AI question during extraction
router.post('/wv-extract/answer', validate(wvExtractAnswerSchema), answerExtractionQuestion);

// Delete a cache file
router.delete('/wv-extract/caches/:name', deleteCacheFile);

// =============================================================================
// WorldView Import Routes
// =============================================================================

// Start import from JSON body
router.post('/wv-import/import', validate(wvImportBodySchema), startWorldViewImport);

// Poll import progress
router.get('/wv-import/import/status', getWorldViewImportStatus);

// Cancel import
router.post('/wv-import/import/cancel', cancelWorldViewImport);

// Get match statistics for a world view
router.get('/wv-import/matches/:worldViewId/stats', validate(worldViewIdParamSchema, 'params'), getMatchStats);

// Get hierarchical match tree for a world view
router.get('/wv-import/matches/:worldViewId/tree', validate(worldViewIdParamSchema, 'params'), getMatchTree);

// Accept a single match
router.post('/wv-import/matches/:worldViewId/accept', validate(worldViewIdParamSchema, 'params'), validate(wvImportAcceptMatchSchema), acceptMatch);

// Reject (dismiss) a single suggestion
router.post('/wv-import/matches/:worldViewId/reject', validate(worldViewIdParamSchema, 'params'), validate(wvImportAcceptMatchSchema), rejectMatch);
router.post('/wv-import/matches/:worldViewId/reject-remaining', validate(worldViewIdParamSchema, 'params'), validate(wvImportRegionIdSchema), rejectRemaining);

// Accept a match and reject all remaining suggestions in one transaction
router.post('/wv-import/matches/:worldViewId/accept-and-reject', validate(worldViewIdParamSchema, 'params'), validate(wvImportAcceptMatchSchema), acceptAndRejectRest);

// Clear all assigned divisions from a region (keep suggestions)
router.post('/wv-import/matches/:worldViewId/clear-members', validate(worldViewIdParamSchema, 'params'), validate(wvImportRegionIdSchema), clearMembers);

// Accept a batch of matches
router.post('/wv-import/matches/:worldViewId/accept-batch', validate(worldViewIdParamSchema, 'params'), validate(wvImportAcceptBatchSchema), acceptBatchMatches);

// Union geometry for multi-select preview
router.post('/wv-import/matches/:worldViewId/union-geometry', validate(worldViewIdParamSchema, 'params'), validate(wvImportUnionGeometrySchema), getUnionGeometry);

// Split divisions deeper: replace divisions with their GADM children that intersect geoshape
router.post('/wv-import/matches/:worldViewId/split-deeper', validate(worldViewIdParamSchema, 'params'), validate(wvImportSplitDeeperSchema), splitDivisionsDeeper);

// AI vision-based division matching
router.post('/wv-import/matches/:worldViewId/vision-match', validate(worldViewIdParamSchema, 'params'), validate(wvImportVisionMatchSchema), visionMatchDivisions);

// Local CV color-based division matching (SSE stream)
router.get('/wv-import/matches/:worldViewId/color-match-stream', validate(worldViewIdParamSchema, 'params'), validate(wvImportColorMatchSchema, 'query'), colorMatchDivisionsSSE);

// Water review callback (user approves/rejects/mixes water components during CV match)
router.post('/wv-import/water-review/:reviewId', (req: AuthenticatedRequest, res: Response) => {
  const reviewId = String(req.params.reviewId);
  const approvedIds: number[] = Array.isArray(req.body?.approvedIds) ? req.body.approvedIds.map(Number) : [];
  const mixDecisions: Array<{ componentId: number; approvedSubClusters: number[] }> = Array.isArray(req.body?.mixDecisions)
    ? req.body.mixDecisions.map((m: { componentId?: number; approvedSubClusters?: number[] }) => ({
        componentId: Number(m.componentId),
        approvedSubClusters: Array.isArray(m.approvedSubClusters) ? m.approvedSubClusters.map(Number) : [],
      }))
    : [];
  console.log(`  [Water POST] reviewId=${reviewId} approved=[${approvedIds}] mix=[${mixDecisions.map(m => `${m.componentId}:[${m.approvedSubClusters}]`)}]`);
  const found = resolveWaterReview(reviewId, { approvedIds, mixDecisions });
  console.log(`  [Water POST] found=${found}`);
  if (found) {
    res.json({ ok: true });
  } else {
    res.status(404).json({ error: 'Review not found or expired' });
  }
});

// Water crop image (served from memory to avoid SSE stalling)
router.get('/wv-import/water-crop/:reviewId/:componentId/:subCluster', (req: AuthenticatedRequest, res: Response) => {
  const { reviewId, componentId, subCluster } = req.params;
  const dataUrl = getWaterCropImage(String(reviewId), Number(componentId), Number(subCluster));
  if (!dataUrl) {
    res.status(404).json({ error: 'Crop not found' });
    return;
  }
  // Parse data URL and send as binary image
  const match = dataUrl.match(/^data:image\/(\w+);base64,(.+)$/);
  if (match) {
    const buffer = Buffer.from(match[2], 'base64');
    res.setHeader('Content-Type', `image/${match[1]}`);
    res.setHeader('Cache-Control', 'private, max-age=300');
    // Override Helmet's same-origin policy so cross-origin <img> tags work
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.send(buffer);
  } else {
    res.status(500).json({ error: 'Invalid crop data' });
  }
});

// Park review callback (user confirms/rejects park overlay blobs during CV match)
router.post('/wv-import/park-review/:reviewId', (req: AuthenticatedRequest, res: Response) => {
  const reviewId = String(req.params.reviewId);
  const confirmedIds: number[] = Array.isArray(req.body?.confirmedIds) ? req.body.confirmedIds.map(Number) : [];
  console.log(`  [Park POST] reviewId=${reviewId} confirmed=[${confirmedIds}]`);
  const found = resolveParkReview(reviewId, { confirmedIds });
  console.log(`  [Park POST] found=${found}`);
  if (found) {
    res.json({ ok: true });
  } else {
    res.status(404).json({ error: 'Review not found or expired' });
  }
});

// Park crop image (served from memory)
router.get('/wv-import/park-crop/:reviewId/:componentId', (req: AuthenticatedRequest, res: Response) => {
  const { reviewId, componentId } = req.params;
  const dataUrl = getParkCropImage(String(reviewId), Number(componentId));
  if (!dataUrl) {
    res.status(404).json({ error: 'Crop not found' });
    return;
  }
  const match = dataUrl.match(/^data:image\/(\w+);base64,(.+)$/);
  if (match) {
    const buffer = Buffer.from(match[2], 'base64');
    res.setHeader('Content-Type', `image/${match[1]}`);
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.send(buffer);
  } else {
    res.status(500).json({ error: 'Invalid crop data' });
  }
});

// Cluster preview image (served from memory — same pattern as water/park crops)
router.get('/wv-import/cluster-preview/:reviewId', (req: AuthenticatedRequest, res: Response) => {
  const dataUrl = getClusterPreviewImage(String(req.params.reviewId));
  if (!dataUrl) {
    res.status(404).json({ error: 'Preview not found' });
    return;
  }
  const match = dataUrl.match(/^data:image\/(\w+);base64,(.+)$/);
  if (match) {
    const buffer = Buffer.from(match[2], 'base64');
    res.setHeader('Content-Type', `image/${match[1]}`);
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.send(buffer);
  } else {
    res.status(500).json({ error: 'Invalid preview data' });
  }
});

// Per-cluster highlight image (red outline overlay for selected cluster)
router.get('/wv-import/cluster-highlight/:reviewId/:label', (req: AuthenticatedRequest, res: Response) => {
  const png = getClusterHighlightImage(String(req.params.reviewId), parseInt(String(req.params.label)));
  if (!png) {
    res.status(404).json({ error: 'Highlight not found' });
    return;
  }
  res.setHeader('Content-Type', 'image/png');
  res.setHeader('Cache-Control', 'private, max-age=300');
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  res.send(png);
});

// Cluster review callback (user merges small artifact clusters during CV match)
router.post('/wv-import/cluster-review/:reviewId', (req: AuthenticatedRequest, res: Response) => {
  const reviewId = String(req.params.reviewId);
  const merges: Record<number, number> = {};
  if (req.body?.merges && typeof req.body.merges === 'object') {
    for (const [from, to] of Object.entries(req.body.merges)) {
      merges[Number(from)] = Number(to);
    }
  }
  const excludes: number[] = Array.isArray(req.body?.excludes) ? req.body.excludes.map(Number) : [];
  const split: number[] = Array.isArray(req.body?.split) ? req.body.split.map(Number) : [];
  const validPresets = new Set(['more_clusters', 'different_seed', 'boost_chroma', 'remove_roads', 'fill_holes', 'clean_light', 'clean_heavy']);
  const rawPreset = req.body?.recluster?.preset;
  const recluster = typeof rawPreset === 'string' && validPresets.has(rawPreset)
    ? { preset: rawPreset as 'more_clusters' | 'different_seed' | 'boost_chroma' | 'remove_roads' | 'fill_holes' | 'clean_light' | 'clean_heavy' }
    : undefined;
  console.log(`  [Cluster Review POST] reviewId=${reviewId} merges=${JSON.stringify(merges)} excludes=[${excludes}]${split.length ? ` split=[${split}]` : ''}${recluster ? ` recluster=${recluster.preset}` : ''}`);
  const found = resolveClusterReview(reviewId, { merges, excludes, recluster, split: split.length > 0 ? split : undefined });
  if (found) {
    res.json({ ok: true });
  } else {
    res.status(404).json({ error: 'Review not found or expired' });
  }
});

// Mapshape-based division matching (Kartographer map regions)
router.post('/wv-import/matches/:worldViewId/mapshape-match', validate(worldViewIdParamSchema, 'params'), validate(wvImportRegionIdSchema), mapshapeMatchDivisions);

// AI-assisted re-matching
router.post('/wv-import/matches/:worldViewId/ai-match', validate(worldViewIdParamSchema, 'params'), startAIMatch);
router.get('/wv-import/matches/:worldViewId/ai-match/status', validate(worldViewIdParamSchema, 'params'), getAIMatchStatus);
router.post('/wv-import/matches/:worldViewId/ai-match/cancel', validate(worldViewIdParamSchema, 'params'), cancelAIMatchEndpoint);
router.post('/wv-import/matches/:worldViewId/db-search-one', validate(worldViewIdParamSchema, 'params'), validate(wvImportRegionIdSchema), dbSearchOneRegion);
router.post('/wv-import/matches/:worldViewId/geocode-match', validate(worldViewIdParamSchema, 'params'), validate(wvImportRegionIdSchema), geocodeMatch);
router.post('/wv-import/matches/:worldViewId/geoshape-match', validate(worldViewIdParamSchema, 'params'), validate(wvImportRegionIdSchema), geoshapeMatch);
router.post('/wv-import/matches/:worldViewId/point-match', validate(worldViewIdParamSchema, 'params'), validate(wvImportRegionIdSchema), pointMatch);
router.post('/wv-import/matches/:worldViewId/reset-match', validate(worldViewIdParamSchema, 'params'), validate(wvImportRegionIdSchema), resetMatch);
router.post('/wv-import/matches/:worldViewId/ai-match-one', validate(worldViewIdParamSchema, 'params'), validate(wvImportRegionIdSchema), aiMatchOneRegion);

// Dismiss subregions (make parent a leaf)
router.post('/wv-import/matches/:worldViewId/dismiss-children', validate(worldViewIdParamSchema, 'params'), validate(wvImportRegionIdSchema), dismissChildren);

// Prune to leaves: keep direct children, remove grandchildren+
router.post('/wv-import/matches/:worldViewId/prune-to-leaves', validate(worldViewIdParamSchema, 'params'), validate(wvImportRegionIdSchema), pruneToLeaves);

// Collapse to parent: clear children's data, generate suggestions for parent
router.post('/wv-import/matches/:worldViewId/collapse-to-parent', validate(worldViewIdParamSchema, 'params'), validate(wvImportRegionIdSchema), collapseToParent);

// Smart flatten: auto-match children, absorb divisions into parent, delete descendants
router.post('/wv-import/matches/:worldViewId/smart-flatten', validate(worldViewIdParamSchema, 'params'), validate(wvImportRegionIdSchema), smartFlatten);
router.post('/wv-import/matches/:worldViewId/smart-flatten/preview', validate(worldViewIdParamSchema, 'params'), validate(wvImportRegionIdSchema), smartFlattenPreview);

// Auto-resolve children: batch-match all unmatched leaf descendants
router.post('/wv-import/matches/:worldViewId/auto-resolve-children/preview', validate(worldViewIdParamSchema, 'params'), validate(wvImportRegionIdSchema), autoResolveChildrenPreview);
router.post('/wv-import/matches/:worldViewId/auto-resolve-children', validate(worldViewIdParamSchema, 'params'), validate(wvImportRegionIdSchema), autoResolveChildren);

// Handle region as sub-continental grouping (match children as countries)
router.post('/wv-import/matches/:worldViewId/handle-as-grouping', validate(worldViewIdParamSchema, 'params'), validate(wvImportRegionIdSchema), handleAsGrouping);

// Select map image from candidates
router.post('/wv-import/matches/:worldViewId/select-map-image', validate(worldViewIdParamSchema, 'params'), validate(wvImportSelectMapImageSchema), selectMapImage);

// Mark/unmark region as needing manual fixes
router.post('/wv-import/matches/:worldViewId/mark-manual-fix', validate(worldViewIdParamSchema, 'params'), validate(wvImportMarkManualFixSchema), markManualFix);

// Merge single-child parent's only child into the parent
router.post('/wv-import/matches/:worldViewId/merge-child', validate(worldViewIdParamSchema, 'params'), validate(wvImportRegionIdSchema), mergeChildIntoParent);

// Remove a region from the import tree (optionally reparenting children)
router.post('/wv-import/matches/:worldViewId/remove-region', validate(worldViewIdParamSchema, 'params'), validate(wvImportRemoveRegionSchema), removeRegionFromImport);

// Rename a region
router.post('/wv-import/matches/:worldViewId/rename-region', validate(worldViewIdParamSchema, 'params'), validate(wvImportRenameRegionSchema), renameRegion);

// Move a region to a new parent
router.post('/wv-import/matches/:worldViewId/reparent-region', validate(worldViewIdParamSchema, 'params'), validate(wvImportReparentRegionSchema), reparentRegion);

// Undo last dismiss-children or handle-as-grouping operation
router.post('/wv-import/matches/:worldViewId/undo', validate(worldViewIdParamSchema, 'params'), undoLastOperation);

// Sync match decisions to other instances of same region
router.post('/wv-import/matches/:worldViewId/sync-instances', validate(worldViewIdParamSchema, 'params'), validate(wvImportRegionIdSchema), syncInstances);

// Hierarchy review
router.post('/wv-import/matches/:worldViewId/add-child-region', validate(worldViewIdParamSchema, 'params'), validate(wvImportAddChildSchema), addChildRegion);
router.post('/wv-import/matches/:worldViewId/dismiss-hierarchy-warnings', validate(worldViewIdParamSchema, 'params'), validate(wvImportRegionIdSchema), dismissHierarchyWarnings);

// AI suggest children for a region (Wikivoyage page + AI analysis)
router.post('/wv-import/matches/:worldViewId/ai-suggest-children', validate(worldViewIdParamSchema, 'params'), validate(wvImportRegionIdSchema), aiSuggestChildren);

// AI suggest cluster-to-region mapping (CV match pipeline)
router.post('/wv-import/matches/:worldViewId/ai-suggest-clusters', validate(worldViewIdParamSchema, 'params'), aiSuggestClusterRegions);

// Children coverage % (how much of parent's geometry children cover)
router.get('/wv-import/matches/:worldViewId/children-coverage', validate(worldViewIdParamSchema, 'params'), validate(childrenCoverageQuerySchema, 'query'), getChildrenCoverage);
router.get('/wv-import/matches/:worldViewId/coverage-geometry/:regionId', validate(worldViewRegionIdParamSchema, 'params'), getCoverageGeometry);
router.get('/wv-import/matches/:worldViewId/children-geometry/:regionId', validate(worldViewRegionIdParamSchema, 'params'), getChildrenRegionGeometry);
router.post('/wv-import/matches/:worldViewId/coverage-gap-analysis/:regionId', validate(worldViewRegionIdParamSchema, 'params'), analyzeCoverageGaps);

// Check GADM coverage — find uncovered root divisions
router.get('/wv-import/matches/:worldViewId/coverage', validate(worldViewIdParamSchema, 'params'), getCoverage);

// Check GADM coverage with SSE streaming progress
router.get('/wv-import/matches/:worldViewId/coverage-stream', validate(worldViewIdParamSchema, 'params'), validate(coverageSSEQuerySchema, 'query'), getCoverageSSE);

// Geographic suggestion for a single gap (centroid vs region anchor_points)
router.post('/wv-import/matches/:worldViewId/geo-suggest-gap', validate(worldViewIdParamSchema, 'params'), validate(divisionIdBodySchema), geoSuggestGap);

// Dismiss/undismiss coverage gaps
router.post('/wv-import/matches/:worldViewId/dismiss-gap', validate(worldViewIdParamSchema, 'params'), validate(divisionIdBodySchema), dismissCoverageGap);
router.post('/wv-import/matches/:worldViewId/undismiss-gap', validate(worldViewIdParamSchema, 'params'), validate(divisionIdBodySchema), undismissCoverageGap);

// Approve coverage suggestion (add to existing region or create new)
router.post('/wv-import/matches/:worldViewId/approve-coverage', validate(worldViewIdParamSchema, 'params'), validate(wvImportApproveCoverageSchema), approveCoverageSuggestion);

// Finalize review — mark world view as done
router.post('/wv-import/matches/:worldViewId/finalize', validate(worldViewIdParamSchema, 'params'), finalizeReview);

// Re-run matching from scratch
router.post('/wv-import/matches/:worldViewId/rematch', validate(worldViewIdParamSchema, 'params'), rematchWorldView);
router.get('/wv-import/matches/:worldViewId/rematch/status', validate(worldViewIdParamSchema, 'params'), getRematchStatus);

// Geoshape proxy (Wikidata → Wikimedia maps)
router.get('/wv-import/geoshape/:wikidataId', validate(wikidataIdParamSchema, 'params'), getGeoshape);

// =============================================================================
// AI Settings & Usage Routes
// =============================================================================

router.get('/ai/settings', getAISettings);
router.put('/ai/settings/:key', validate(z.object({ key: z.string() }), 'params'), validate(z.object({ value: z.string() })), updateAISetting);
router.get('/ai/usage', getAIUsage);
router.post('/ai/update-pricing', updatePricing);
router.get('/ai/rules', getLearnedRules);
router.post('/ai/rules', validate(z.object({ feature: z.string(), ruleText: z.string(), context: z.string().optional() })), addLearnedRule);
router.delete('/ai/rules/:id', validate(z.object({ id: z.coerce.number().int().positive() }), 'params'), deleteLearnedRule);
router.post('/ai/rules/review', reviewLearnedRules);
router.post('/ai/rules/apply-review', validate(z.object({
  keepId: z.number().int().positive(),
  deleteIds: z.array(z.number().int().positive()),
  replacementText: z.string().nullable().optional(),
})), applyRuleReviewSuggestion);

// AI hierarchy review
router.post('/ai/hierarchy-review/:worldViewId', validate(worldViewIdParamSchema, 'params'), validate(z.object({
  regionId: z.number().int().positive().optional(),
})), hierarchyReview);

// =============================================================================
// Image proxy (for CORS-blocked Wikimedia images used as map overlays)
// =============================================================================

const imageProxyQuerySchema = z.object({
  url: z.string().url().refine(
    (u) => {
      try {
        const host = new URL(u).hostname;
        return host.endsWith('.wikimedia.org') || host.endsWith('.wikipedia.org');
      } catch { return false; }
    },
    { message: 'Only Wikimedia/Wikipedia URLs are allowed' }
  ),
});

router.get('/image-proxy', validate(imageProxyQuerySchema, 'query'), async (req: AuthenticatedRequest, res: Response) => {
  const { url } = req.query as { url: string };
  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'TrackYourRegions/1.0 (admin image proxy)' },
      redirect: 'follow',
    });
    if (!response.ok) {
      res.status(response.status).json({ error: 'Upstream image fetch failed' });
      return;
    }
    const contentType = response.headers.get('content-type') || 'image/png';
    if (!contentType.startsWith('image/')) {
      res.status(400).json({ error: 'URL did not return an image' });
      return;
    }
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    const buffer = Buffer.from(await response.arrayBuffer());
    res.send(buffer);
  } catch (err) {
    console.error('Image proxy error:', err);
    res.status(502).json({ error: 'Failed to fetch image' });
  }
});

// =============================================================================
// Geometry Routes (to be moved from worldViewRoutes in future)
// =============================================================================
// TODO: Move geometry computation endpoints here from worldViewRoutes
// POST /geometry/world-views/:id/compute
// GET /geometry/world-views/:id/status

export default router;
