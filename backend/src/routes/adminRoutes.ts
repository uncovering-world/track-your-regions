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
  wvExtractStartSchema,
  wvImportBodySchema,
  wvImportAcceptMatchSchema,
  wvImportAcceptBatchSchema,
  wvImportRegionIdSchema,
  wvImportSelectMapImageSchema,
  wvImportMarkManualFixSchema,
  wikidataIdParamSchema,
  divisionIdBodySchema,
  wvImportApproveCoverageSchema,
  coverageSSEQuerySchema,
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
  getMatchStats,
  getMatchTree,
  acceptMatch,
  rejectMatch,
  acceptBatchMatches,
  startAIMatch,
  getAIMatchStatus,
  cancelAIMatchEndpoint,
  dbSearchOneRegion,
  geocodeMatch,
  resetMatch,
  rejectRemaining,
  aiMatchOneRegion,
  dismissChildren,
  syncInstances,
  handleAsGrouping,
  undoLastOperation,
  selectMapImage,
  markManualFix,
  acceptAndRejectRest,
  getCoverage,
  getCoverageSSE,
  geoSuggestGap,
  dismissCoverageGap,
  undismissCoverageGap,
  approveCoverageSuggestion,
  finalizeReview,
  rematchWorldView,
  getRematchStatus,
  getGeoshape,
} from '../controllers/admin/worldViewImportController.js';
import {
  startWikivoyageExtraction,
  getWikivoyageExtractionStatus,
  cancelWikivoyageExtraction,
} from '../controllers/admin/wikivoyageExtractController.js';

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

// Accept a batch of matches
router.post('/wv-import/matches/:worldViewId/accept-batch', validate(worldViewIdParamSchema, 'params'), validate(wvImportAcceptBatchSchema), acceptBatchMatches);

// AI-assisted re-matching
router.post('/wv-import/matches/:worldViewId/ai-match', validate(worldViewIdParamSchema, 'params'), startAIMatch);
router.get('/wv-import/matches/:worldViewId/ai-match/status', validate(worldViewIdParamSchema, 'params'), getAIMatchStatus);
router.post('/wv-import/matches/:worldViewId/ai-match/cancel', validate(worldViewIdParamSchema, 'params'), cancelAIMatchEndpoint);
router.post('/wv-import/matches/:worldViewId/db-search-one', validate(worldViewIdParamSchema, 'params'), validate(wvImportRegionIdSchema), dbSearchOneRegion);
router.post('/wv-import/matches/:worldViewId/geocode-match', validate(worldViewIdParamSchema, 'params'), validate(wvImportRegionIdSchema), geocodeMatch);
router.post('/wv-import/matches/:worldViewId/reset-match', validate(worldViewIdParamSchema, 'params'), validate(wvImportRegionIdSchema), resetMatch);
router.post('/wv-import/matches/:worldViewId/ai-match-one', validate(worldViewIdParamSchema, 'params'), validate(wvImportRegionIdSchema), aiMatchOneRegion);

// Dismiss subregions (make parent a leaf)
router.post('/wv-import/matches/:worldViewId/dismiss-children', validate(worldViewIdParamSchema, 'params'), validate(wvImportRegionIdSchema), dismissChildren);

// Handle region as sub-continental grouping (match children as countries)
router.post('/wv-import/matches/:worldViewId/handle-as-grouping', validate(worldViewIdParamSchema, 'params'), validate(wvImportRegionIdSchema), handleAsGrouping);

// Select map image from candidates
router.post('/wv-import/matches/:worldViewId/select-map-image', validate(worldViewIdParamSchema, 'params'), validate(wvImportSelectMapImageSchema), selectMapImage);

// Mark/unmark region as needing manual fixes
router.post('/wv-import/matches/:worldViewId/mark-manual-fix', validate(worldViewIdParamSchema, 'params'), validate(wvImportMarkManualFixSchema), markManualFix);

// Undo last dismiss-children or handle-as-grouping operation
router.post('/wv-import/matches/:worldViewId/undo', validate(worldViewIdParamSchema, 'params'), undoLastOperation);

// Sync match decisions to other instances of same region
router.post('/wv-import/matches/:worldViewId/sync-instances', validate(worldViewIdParamSchema, 'params'), validate(wvImportRegionIdSchema), syncInstances);

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
// Image proxy (for CORS-blocked Wikimedia images used as map overlays)
// =============================================================================
import { z } from 'zod';

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
