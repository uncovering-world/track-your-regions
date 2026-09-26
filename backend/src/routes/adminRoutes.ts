/**
 * Admin Routes
 *
 * All routes require admin authentication.
 * Handles sync operations, geometry computation, and other admin tasks.
 */

import { Response } from 'express';
import type { AuthenticatedRequest } from '../middleware/auth.js';
import { respond } from '../api/respond.js';
import { routerOf } from '../api/route.js';
import { adminDeclaredRoutes } from './adminDeclaredRoutes.js';
import { ReviewAnswered } from '../api/responses/wvImportCvMatch.js';
import { validate } from '../middleware/errorHandler.js';
import { expensiveAdminLimiter } from '../middleware/rateLimiter.js';
import { z } from 'zod/v4';
import {
  worldViewIdParamSchema,
  worldViewRegionIdParamSchema,
  wvExtractStartSchema,
  wvExtractAnswerSchema,
  wvCacheNameParamSchema,
  wvImportBodySchema,
  baseLayerImportBodySchema,
  wvImportAcceptMatchSchema,
  wvImportAcceptBatchSchema,
  wvImportDecideBatchSchema,
  wvImportAiSuggestClustersSchema,
  wvImportUnionGeometrySchema,
  wvImportSplitDeeperSchema,
  wvImportVisionMatchSchema,
  wvImportColorMatchSchema,
  reviewIdParamSchema,
  wvImportWaterCropParamSchema,
  wvImportClusterHighlightParamSchema,
  wvImportWaterReviewBodySchema,
  wvImportClusterReviewBodySchema,
  wvImportIcpAdjustmentBodySchema,
  wvImportRegionIdSchema,
  wvImportRematchBodySchema,
  wvImportGeoshapeMatchSchema,
  wvImportAcceptTransferSchema,
  wvImportTransferPreviewSchema,
  wvImportSelectMapImageSchema,
  wvImportMarkManualFixSchema,
  wikidataIdParamSchema,
  divisionIdBodySchema,
  wvImportApproveCoverageSchema,
  wvImportManualClusterReviewBodySchema,
  wvImportAddChildSchema,
  wvImportRemoveRegionSchema,
  wvImportRenameRegionSchema,
  wvImportReparentRegionSchema,
  wvImportSmartSimplifySchema,
  wvImportSmartSimplifyApplySchema,
  wvImportOverlapChildrenSchema,
  wvImportResolveOverlapSchema,
  coverageSSEQuerySchema,
  childrenCoverageQuerySchema,
} from '../types/index.js';
import { acceptBatchAndRejectRest, rejectBatchSuggestions } from '../controllers/admin/wvImportMatchDecisions.js';
import {
  // Lifecycle
  startWorldViewImport, getWorldViewImportStatus, cancelWorldViewImport, getGeoshape,
  // Match
  getMatchStats, getMatchTree, acceptMatch, rejectMatch, rejectRemaining, clearMembers,
  acceptAndRejectRest, acceptBatchMatches, acceptWithTransfer, getTransferPreview, selectMapImage, markManualFix,
  getUnionGeometry, splitDivisionsDeeper, visionMatchDivisions, colorMatchDivisionsSSE,
  resolveWaterReview, getWaterCropImage,
  resolveClusterReview, getClusterPreviewImage, getClusterHighlightImage, resolveIcpAdjustment,
  // AI
  startAIMatch, getAIMatchStatus, cancelAIMatchEndpoint, dbSearchOneRegion,
  geocodeMatch, geoshapeMatch, pointMatch, resetMatch, aiMatchOneRegion,
  aiSuggestChildren, aiSuggestClusterRegions,
  // Tree ops
  mergeChildIntoParent, removeRegionFromImport, dismissChildren, pruneToLeaves, simplifyHierarchy, simplifyChildren, detectSmartSimplify, applySmartSimplifyMove, checkDivisionOverlap, getOverlapDivisionChildren, resolveOverlap,
  // Flatten
  collapseToParent, smartFlattenPreview, smartFlatten, syncInstances, handleAsGrouping,
  // Hierarchy
  undoLastOperation, autoResolveChildrenPreview, autoResolveChildren,
  // Coverage
  getCoverage, getCoverageSSE, geoSuggestGap, dismissCoverageGap,
  undismissCoverageGap, approveCoverageSuggestion,
  // Rematch
  rematchWorldView, getRematchStatus,
  // Finalize
  finalizeReview, addChildRegion, dismissHierarchyWarnings,
  // Coverage compare
  getChildrenCoverage, getCoverageGeometry, analyzeCoverageGaps, getChildrenRegionGeometry,
  // Mapshape + rename + guided match
  mapshapeMatchDivisions, renameRegion, reparentRegion,
} from '../controllers/admin/worldViewImportController.js';
import {
  startWikivoyageExtraction,
  getWikivoyageExtractionStatus,
  cancelWikivoyageExtraction,
  answerExtractionQuestion,
  deleteCacheFile,
} from '../controllers/admin/wikivoyageExtractController.js';
import { startBaseLayerImportEndpoint } from '../controllers/admin/baseLayerImportController.js';
import { pictureFetchUrl, PICTURE_FETCH_URL_MESSAGE } from '../types/urlSafety.js';
import { fetchPicture } from '../services/pictureFetch.js';

// The routes below still list their middleware by hand (#793), on the router
// the declared ones are built into. They are all under `/wv-import`,
// `/wv-extract` or `/image-proxy`, where no declared route has a path.
const router = routerOf(adminDeclaredRoutes);

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
router.delete('/wv-extract/caches/:name', validate(wvCacheNameParamSchema, 'params'), deleteCacheFile);

// =============================================================================
// WorldView Import Routes
// =============================================================================

// Start import from JSON body
router.post('/wv-import/import', validate(wvImportBodySchema), startWorldViewImport);

// Start a base layer mirror import (progress via /wv-import/import/status)
router.post('/wv-import/base-layer', validate(baseLayerImportBodySchema), startBaseLayerImportEndpoint);

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

// The review's selection toolbar: the same two verdicts for several of a region's suggestions at once
router.post('/wv-import/matches/:worldViewId/accept-batch-and-reject-rest', validate(worldViewIdParamSchema, 'params'), validate(wvImportDecideBatchSchema), acceptBatchAndRejectRest);
router.post('/wv-import/matches/:worldViewId/reject-batch', validate(worldViewIdParamSchema, 'params'), validate(wvImportDecideBatchSchema), rejectBatchSuggestions);

// Clear all assigned divisions from a region (keep suggestions)
router.post('/wv-import/matches/:worldViewId/clear-members', validate(worldViewIdParamSchema, 'params'), validate(wvImportRegionIdSchema), clearMembers);

// Accept a batch of matches
router.post('/wv-import/matches/:worldViewId/accept-batch', validate(worldViewIdParamSchema, 'params'), validate(wvImportAcceptBatchSchema), acceptBatchMatches);

// Accept with transfer: atomically move divisions from donor region to target
router.post('/wv-import/matches/:worldViewId/accept-with-transfer', validate(worldViewIdParamSchema, 'params'), validate(wvImportAcceptTransferSchema), acceptWithTransfer);

// Transfer preview: 3-layer GeoJSON for visualising a proposed transfer operation
router.post('/wv-import/matches/:worldViewId/transfer-preview', validate(worldViewIdParamSchema, 'params'), validate(wvImportTransferPreviewSchema), getTransferPreview);

// Union geometry for multi-select preview
router.post('/wv-import/matches/:worldViewId/union-geometry', validate(worldViewIdParamSchema, 'params'), validate(wvImportUnionGeometrySchema), getUnionGeometry);

// Split divisions deeper: replace divisions with their GADM children that intersect geoshape
router.post('/wv-import/matches/:worldViewId/split-deeper', validate(worldViewIdParamSchema, 'params'), validate(wvImportSplitDeeperSchema), splitDivisionsDeeper);

// AI vision-based division matching
router.post('/wv-import/matches/:worldViewId/vision-match', validate(worldViewIdParamSchema, 'params'), validate(wvImportVisionMatchSchema), visionMatchDivisions);

// Local CV color-based division matching (SSE stream)
router.get('/wv-import/matches/:worldViewId/color-match-stream', validate(worldViewIdParamSchema, 'params'), validate(wvImportColorMatchSchema, 'query'), colorMatchDivisionsSSE);

// Helper: parse "data:image/<type>;base64,<payload>" and stream as image response.
function sendDataUrlAsImage(res: Response, dataUrl: string): void {
  const match = dataUrl.match(/^data:image\/(\w+);base64,(.+)$/);
  if (!match) {
    res.status(500).json({ error: 'Invalid crop data' });
    return;
  }
  const buffer = Buffer.from(match[2], 'base64');
  res.type(`image/${match[1]}`);
  res.setHeader('Cache-Control', 'private, max-age=300');
  // Allow cross-origin <img> loading (different CDN host) while keeping auth via cookie/header.
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  res.end(buffer);
}

// Water review callback (user approves/rejects/mixes water components during CV match)
router.post(
  '/wv-import/water-review/:reviewId',
  validate(reviewIdParamSchema, 'params'),
  validate(wvImportWaterReviewBodySchema),
  async (req: AuthenticatedRequest, res: Response) => {
    const { reviewId } = req.params as unknown as { reviewId: string };
    const body = req.body as { approvedIds: number[]; mixDecisions: Array<{ componentId: number; approvedSubClusters: number[] }> };

    // Python-originated reviews go through the pythonReviewBridge: the
    // Python worker thread is blocked waiting on /pipeline/respond. The
    // forwarding to Python happens inside the onReview callback in
    // wvImportMatchPythonBranch.ts.
    const { isPythonReviewId, resolvePythonReview } = await import('../services/cv/pythonReviewBridge.js');
    if (isPythonReviewId(reviewId)) {
      const forwarded = resolvePythonReview(reviewId, body);
      if (forwarded) {
        respond(res, ReviewAnswered, { ok: true });
      } else {
        res.status(404).json({ error: 'Review not found or expired' });
      }
      return;
    }

    const { approvedIds, mixDecisions } = body;
    const found = resolveWaterReview(reviewId, { approvedIds, mixDecisions });
    if (found) {
      respond(res, ReviewAnswered, { ok: true });
    } else {
      res.status(404).json({ error: 'Review not found or expired' });
    }
  },
);

// Water crop image (served from memory to avoid SSE stalling)
router.get(
  '/wv-import/water-crop/:reviewId/:componentId/:subCluster',
  validate(wvImportWaterCropParamSchema, 'params'),
  (req: AuthenticatedRequest, res: Response) => {
    const { reviewId, componentId, subCluster } = req.params as unknown as { reviewId: string; componentId: number; subCluster: number };
    const dataUrl = getWaterCropImage(reviewId, componentId, subCluster);
    if (!dataUrl) {
      res.status(404).json({ error: 'Crop not found' });
      return;
    }
    sendDataUrlAsImage(res, dataUrl);
  },
);

// Cluster preview image (served from memory — same pattern as water crops)
router.get(
  '/wv-import/cluster-preview/:reviewId',
  validate(reviewIdParamSchema, 'params'),
  (req: AuthenticatedRequest, res: Response) => {
    const { reviewId } = req.params as unknown as { reviewId: string };
    const dataUrl = getClusterPreviewImage(reviewId);
    if (!dataUrl) {
      res.status(404).json({ error: 'Preview not found' });
      return;
    }
    sendDataUrlAsImage(res, dataUrl);
  },
);

// Per-cluster highlight image (red outline overlay for selected cluster)
router.get(
  '/wv-import/cluster-highlight/:reviewId/:label',
  validate(wvImportClusterHighlightParamSchema, 'params'),
  (req: AuthenticatedRequest, res: Response) => {
    const { reviewId, label } = req.params as unknown as { reviewId: string; label: number };
    const png = getClusterHighlightImage(reviewId, label);
    if (!png) {
      res.status(404).json({ error: 'Highlight not found' });
      return;
    }
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.send(png);
  },
);

// Cluster review callback — normal merges/excludes/splits, or manual_clusters painted overlay
router.post(
  '/wv-import/cluster-review/:reviewId',
  validate(reviewIdParamSchema, 'params'),
  (req: AuthenticatedRequest, res: Response) => {
    const { reviewId } = req.params as unknown as { reviewId: string };

    // manual_clusters: painted overlay replaces automated clustering
    if (req.body?.type === 'manual_clusters') {
      const parsedManual = wvImportManualClusterReviewBodySchema.safeParse(req.body);
      if (!parsedManual.success) {
        res.status(400).json({ error: 'Invalid manual_clusters body', details: parsedManual.error.format() });
        return;
      }
      const { overlayPng, palette } = parsedManual.data;
      console.log(`  [Cluster Review POST] reviewId=${reviewId} type=manual_clusters palette=${palette.length} colors`);
      const found = resolveClusterReview(reviewId, { type: 'manual_clusters', overlayPng, palette });
      if (found) { respond(res, ReviewAnswered, { ok: true }); } else { res.status(404).json({ error: 'Review not found or expired' }); }
      return;
    }

    // Normal cluster review decision — validate with Zod schema
    const parsed = wvImportClusterReviewBodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid cluster review body', details: parsed.error.format() });
      return;
    }
    const body = parsed.data;
    // merges use stringified keys in JSON; convert to numeric keys.
    const merges: Record<number, number> = {};
    if (body.merges) {
      for (const [from, to] of Object.entries(body.merges)) {
        merges[Number(from)] = to;
      }
    }
    const excludes = body.excludes ?? [];
    const split = body.split ?? [];
    const found = resolveClusterReview(reviewId, {
      merges,
      excludes,
      recluster: body.recluster,
      split: split.length > 0 ? split : undefined,
    });
    if (found) {
      respond(res, ReviewAnswered, { ok: true });
    } else {
      res.status(404).json({ error: 'Review not found or expired' });
    }
  },
);

// ICP adjustment callback (user approves/skips ICP realignment during CV match)
router.post(
  '/wv-import/icp-adjustment/:reviewId',
  validate(reviewIdParamSchema, 'params'),
  validate(wvImportIcpAdjustmentBodySchema),
  (req: AuthenticatedRequest, res: Response) => {
    const { reviewId } = req.params as unknown as { reviewId: string };
    const { action } = req.body as { action: 'adjust' | 'continue' };
    const found = resolveIcpAdjustment(reviewId, { action });
    if (found) {
      respond(res, ReviewAnswered, { ok: true });
    } else {
      res.status(404).json({ error: 'Review not found or expired' });
    }
  },
);

// Mapshape-based division matching (Kartographer map regions)
router.post('/wv-import/matches/:worldViewId/mapshape-match', validate(worldViewIdParamSchema, 'params'), validate(wvImportRegionIdSchema), mapshapeMatchDivisions);

// AI-assisted re-matching
router.post('/wv-import/matches/:worldViewId/ai-match', validate(worldViewIdParamSchema, 'params'), startAIMatch);
router.get('/wv-import/matches/:worldViewId/ai-match/status', validate(worldViewIdParamSchema, 'params'), getAIMatchStatus);
router.post('/wv-import/matches/:worldViewId/ai-match/cancel', validate(worldViewIdParamSchema, 'params'), cancelAIMatchEndpoint);
router.post('/wv-import/matches/:worldViewId/db-search-one', validate(worldViewIdParamSchema, 'params'), validate(wvImportRegionIdSchema), dbSearchOneRegion);
router.post('/wv-import/matches/:worldViewId/geocode-match', validate(worldViewIdParamSchema, 'params'), validate(wvImportRegionIdSchema), geocodeMatch);
router.post('/wv-import/matches/:worldViewId/geoshape-match', validate(worldViewIdParamSchema, 'params'), validate(wvImportGeoshapeMatchSchema), geoshapeMatch);
router.post('/wv-import/matches/:worldViewId/point-match', validate(worldViewIdParamSchema, 'params'), validate(wvImportGeoshapeMatchSchema), pointMatch);
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

// Simplify hierarchy: replace single-child chains with direct parent→grandchild links
router.post('/wv-import/matches/:worldViewId/simplify-hierarchy', validate(worldViewIdParamSchema, 'params'), validate(wvImportRegionIdSchema), simplifyHierarchy);

// Simplify children: simplify all child regions one by one
router.post('/wv-import/matches/:worldViewId/simplify-children', validate(worldViewIdParamSchema, 'params'), validate(wvImportRegionIdSchema), simplifyChildren);

// Smart simplify: detect cross-sibling division moves for simplification
router.post('/wv-import/matches/:worldViewId/smart-simplify', validate(worldViewIdParamSchema, 'params'), validate(wvImportSmartSimplifySchema), detectSmartSimplify);

// Smart simplify: apply a single move (reassign divisions + simplify)
router.post('/wv-import/matches/:worldViewId/smart-simplify/apply-move', validate(worldViewIdParamSchema, 'params'), validate(wvImportSmartSimplifyApplySchema), applySmartSimplifyMove);

// Check division overlaps among children (shared/contained divisions)
router.post('/wv-import/matches/:worldViewId/check-overlap', validate(worldViewIdParamSchema, 'params'), validate(wvImportSmartSimplifySchema), checkDivisionOverlap);

// Overlap resolution: get GADM children for split preview
router.post('/wv-import/matches/:worldViewId/overlap-children', validate(worldViewIdParamSchema, 'params'), validate(wvImportOverlapChildrenSchema), getOverlapDivisionChildren);

// Overlap resolution: apply keep or split
router.post('/wv-import/matches/:worldViewId/resolve-overlap', validate(worldViewIdParamSchema, 'params'), validate(wvImportResolveOverlapSchema), resolveOverlap);

// Remove a region from the import tree (optionally reparenting children)
router.post('/wv-import/matches/:worldViewId/remove-region', validate(worldViewIdParamSchema, 'params'), validate(wvImportRemoveRegionSchema), removeRegionFromImport);

// Rename a region
router.post('/wv-import/matches/:worldViewId/rename-region', validate(worldViewIdParamSchema, 'params'), validate(wvImportRenameRegionSchema), renameRegion);

// Move a region to a new parent
router.post('/wv-import/matches/:worldViewId/reparent-region', validate(worldViewIdParamSchema, 'params'), validate(wvImportReparentRegionSchema), reparentRegion);

// Undo the last undoable tree operation — one of six, see undoLastOperation
router.post('/wv-import/matches/:worldViewId/undo', validate(worldViewIdParamSchema, 'params'), undoLastOperation);

// Sync match decisions to other instances of same region
router.post('/wv-import/matches/:worldViewId/sync-instances', validate(worldViewIdParamSchema, 'params'), validate(wvImportRegionIdSchema), syncInstances);

// Hierarchy review
router.post('/wv-import/matches/:worldViewId/add-child-region', validate(worldViewIdParamSchema, 'params'), validate(wvImportAddChildSchema), addChildRegion);
router.post('/wv-import/matches/:worldViewId/dismiss-hierarchy-warnings', validate(worldViewIdParamSchema, 'params'), validate(wvImportRegionIdSchema), dismissHierarchyWarnings);

// AI suggest children for a region (Wikivoyage page + AI analysis)
router.post('/wv-import/matches/:worldViewId/ai-suggest-children', validate(worldViewIdParamSchema, 'params'), validate(wvImportRegionIdSchema), aiSuggestChildren);

// AI suggest cluster-to-region mapping (CV match pipeline)
router.post('/wv-import/matches/:worldViewId/ai-suggest-clusters', validate(worldViewIdParamSchema, 'params'), validate(wvImportAiSuggestClustersSchema), aiSuggestClusterRegions);

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
router.post('/wv-import/matches/:worldViewId/rematch', expensiveAdminLimiter, validate(worldViewIdParamSchema, 'params'), validate(wvImportRematchBodySchema), rematchWorldView);
router.get('/wv-import/matches/:worldViewId/rematch/status', validate(worldViewIdParamSchema, 'params'), getRematchStatus);

// Geoshape proxy (Wikidata → Wikimedia maps)
router.get('/wv-import/geoshape/:wikidataId', validate(wikidataIdParamSchema, 'params'), getGeoshape);

// =============================================================================
// Image proxy (for CORS-blocked Wikimedia images used as map overlays)
// =============================================================================

// The proxy fetches on an admin's word from a query string, so the host rule
// is the one every server-side picture fetch shares (`pictureFetchUrl`,
// #706): the two Commons hosts, matched exactly — a suffix match would admit
// any `*.wikimedia.org` / `*.wikipedia.org` host. The schema answers a
// refused first address with 400; `fetchPicture` holds every hop after it.
const imageProxyQuerySchema = z.object({
  url: z.string().refine((value) => pictureFetchUrl(value) !== null, { message: PICTURE_FETCH_URL_MESSAGE }),
});

router.get('/image-proxy', validate(imageProxyQuerySchema, 'query'), async (req: AuthenticatedRequest, res: Response) => {
  const { url } = req.query as { url: string };
  try {
    const response = await fetchPicture(url, 'admin image proxy');
    if (!response) {
      res.status(502).json({ error: 'Upstream redirected off Wikimedia Commons' });
      return;
    }
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
    // eslint-disable-next-line no-restricted-syntax -- the proxy returns a Wikimedia Commons picture unchanged: public data with no caller in it, and the one response here fetched with an Authorization header, so RFC 9111 § 3.5 governs it and `public` is the deliberate opt-in
    res.setHeader('Cache-Control', 'public, max-age=86400');
    const buffer = Buffer.from(await response.arrayBuffer());
    res.send(buffer);
  } catch (err) {
    console.error('Image proxy error:', err);
    res.status(502).json({ error: 'Failed to fetch image' });
  }
});

export default router;
