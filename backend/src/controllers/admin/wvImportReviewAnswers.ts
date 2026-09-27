/**
 * A reviewer's answers to a colour-match run that is waiting on them, and the
 * images the review screen draws (ADR-0071).
 *
 * The run holds its questions in memory (`wvImportMatchReview.ts`), or, for a
 * run in the Python worker, behind the bridge that forwards the answer to it.
 * An answer to a question nobody holds any more is a 404.
 */

import type { z } from 'zod/v4';
import type { ImageBody } from '../../api/route.js';
import type { ReviewAnswered } from '../../api/responses/wvImportCvMatch.js';
import { failure, notFound } from '../../middleware/errorHandler.js';
import type {
  reviewIdParamSchema,
  wvImportClusterHighlightParamSchema,
  wvImportClusterReviewAnswerSchema,
  wvImportIcpAdjustmentBodySchema,
  wvImportWaterCropParamSchema,
  wvImportWaterReviewBodySchema,
} from '../../types/index.js';
import {
  getClusterHighlightImage,
  getClusterPreviewImage,
  getWaterCropImage,
  resolveClusterReview,
  resolveIcpAdjustment,
  resolveWaterReview,
} from './wvImportMatchReview.js';

type ReviewParams = z.output<typeof reviewIdParamSchema>;

const REVIEW_GONE = 'Review not found or expired';

function answered(found: boolean): ReviewAnswered {
  if (!found) throw notFound(REVIEW_GONE);
  return { ok: true };
}

/** POST /wv-import/water-review/:reviewId — approve, reject or mix water components. */
export async function answerWaterReview(
  { params: { reviewId }, body }: { params: ReviewParams; body: z.output<typeof wvImportWaterReviewBodySchema> },
): Promise<ReviewAnswered> {
  // A run in the Python worker is blocked on /pipeline/respond; the bridge
  // forwards the answer to it (`wvImportMatchPythonBranch.ts`).
  const { isPythonReviewId, resolvePythonReview } = await import('../../services/cv/pythonReviewBridge.js');
  if (isPythonReviewId(reviewId)) return answered(resolvePythonReview(reviewId, body));

  const { approvedIds, mixDecisions } = body;
  return answered(resolveWaterReview(reviewId, { approvedIds, mixDecisions }));
}

/** POST /wv-import/cluster-review/:reviewId — the ordinary decisions, or a painted overlay. */
export async function answerClusterReview(
  { params: { reviewId }, body }: { params: ReviewParams; body: z.output<typeof wvImportClusterReviewAnswerSchema> },
): Promise<ReviewAnswered> {
  if (body.type === 'manual_clusters') {
    const { overlayPng, palette } = body;
    console.log('  [Cluster Review POST] reviewId=%s type=manual_clusters palette=%d colors', reviewId, palette.length);
    return answered(resolveClusterReview(reviewId, { type: 'manual_clusters', overlayPng, palette }));
  }

  // merges use stringified keys in JSON; convert to numeric keys.
  const merges: Record<number, number> = {};
  for (const [from, to] of Object.entries(body.merges ?? {})) {
    merges[Number(from)] = to;
  }
  const split = body.split ?? [];
  return answered(resolveClusterReview(reviewId, {
    merges,
    excludes: body.excludes ?? [],
    recluster: body.recluster,
    split: split.length > 0 ? split : undefined,
  }));
}

/** POST /wv-import/icp-adjustment/:reviewId — accept or skip the ICP realignment. */
export async function answerIcpAdjustment(
  { params: { reviewId }, body: { action } }: {
    params: ReviewParams;
    body: z.output<typeof wvImportIcpAdjustmentBodySchema>;
  },
): Promise<ReviewAnswered> {
  return answered(resolveIcpAdjustment(reviewId, { action }));
}

/** An image the run keeps as a `data:image/<type>;base64,…` URL, answered as its bytes. */
function imageOfDataUrl(dataUrl: string): ImageBody {
  const match = dataUrl.match(/^data:image\/(\w+);base64,(.+)$/);
  if (!match) throw failure('Invalid crop data', 500);
  return { contentType: `image/${match[1]}`, bytes: Buffer.from(match[2], 'base64'), crossOrigin: true };
}

/**
 * GET /wv-import/water-crop/:reviewId/:componentId/:subCluster — served from
 * memory so the stream is not held up by image payloads.
 */
export async function waterCropImage(
  { params: { reviewId, componentId, subCluster } }: { params: z.output<typeof wvImportWaterCropParamSchema> },
): Promise<ImageBody> {
  const dataUrl = getWaterCropImage(reviewId, componentId, subCluster);
  if (!dataUrl) throw notFound('Crop not found');
  return imageOfDataUrl(dataUrl);
}

/** GET /wv-import/cluster-preview/:reviewId — the same pattern as a water crop. */
export async function clusterPreviewImage({ params: { reviewId } }: { params: ReviewParams }): Promise<ImageBody> {
  const dataUrl = getClusterPreviewImage(reviewId);
  if (!dataUrl) throw notFound('Preview not found');
  return imageOfDataUrl(dataUrl);
}

/** GET /wv-import/cluster-highlight/:reviewId/:label — the selected cluster outlined in red. */
export async function clusterHighlightImage(
  { params: { reviewId, label } }: { params: z.output<typeof wvImportClusterHighlightParamSchema> },
): Promise<ImageBody> {
  const png = getClusterHighlightImage(reviewId, label);
  if (!png) throw notFound('Highlight not found');
  return { contentType: 'image/png', bytes: png, crossOrigin: true };
}
