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
import { z } from 'zod/v4';
import {
  worldViewIdParamSchema,
  wvImportColorMatchSchema,
  reviewIdParamSchema,
  wvImportWaterCropParamSchema,
  wvImportClusterHighlightParamSchema,
  wvImportWaterReviewBodySchema,
  wvImportClusterReviewBodySchema,
  wvImportIcpAdjustmentBodySchema,
  wikidataIdParamSchema,
  wvImportManualClusterReviewBodySchema,
  coverageSSEQuerySchema,
} from '../types/index.js';
import { getCoverageSSE } from '../controllers/admin/wvImportCoverageController.js';
import { getGeoshape } from '../controllers/admin/wvImportLifecycleController.js';
import { colorMatchDivisionsSSE } from '../controllers/admin/wvImportMatchPipeline.js';
import { getClusterHighlightImage, getClusterPreviewImage, getWaterCropImage, resolveClusterReview, resolveIcpAdjustment, resolveWaterReview } from '../controllers/admin/wvImportMatchReview.js';
import { pictureFetchUrl, PICTURE_FETCH_URL_MESSAGE } from '../types/urlSafety.js';
import { fetchPicture } from '../services/pictureFetch.js';

// The routes below still list their middleware by hand (#793), on the router
// the declared ones are built into: the import's two streams, its images and
// review callbacks, the geoshape proxy and the image proxy. No declared route
// of the same method has a path one of them could shadow, or be shadowed by.
const router = routerOf(adminDeclaredRoutes);

// =============================================================================
// WorldView Import Routes
// =============================================================================

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

// Check GADM coverage with SSE streaming progress
router.get('/wv-import/matches/:worldViewId/coverage-stream', validate(worldViewIdParamSchema, 'params'), validate(coverageSSEQuerySchema, 'query'), getCoverageSSE);

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
