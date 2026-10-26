/**
 * The world-view import's colour-match run as a reviewer sees it: the stream
 * the run reports on, the reviewer's answers to the questions it waits on,
 * the images its review screen draws and the coverage stream (ADR-0071).
 * Spread into `adminDeclaredRoutes`.
 */

import { defineRoute, IMAGE, stream } from '../api/route.js';
import { ColorMatchEvent, ReviewAnswered } from '../api/responses/wvImportCvMatch.js';
import { CoverageEvent } from '../api/responses/wvImportCoverage.js';
import { getCoverageSSE } from '../controllers/admin/wvImportCoverageController.js';
import {
  answerClusterReview, answerIcpAdjustment, answerWaterReview, clusterHighlightImage, clusterPreviewImage, waterCropImage,
} from '../controllers/admin/wvImportReviewAnswers.js';
import {
  coverageSSEQuerySchema, reviewIdParamSchema, worldViewIdParamSchema,
  wvImportClusterHighlightParamSchema, wvImportClusterReviewAnswerSchema, wvImportColorMatchSchema,
  wvImportIcpAdjustmentBodySchema, wvImportWaterCropParamSchema, wvImportWaterReviewBodySchema,
} from '../types/index.js';

const ADMIN = { access: 'admin', cache: 'no-store' } as const;

export const adminImportReviewRoutes = [
  // The run itself: local CV colour matching, reporting as it goes. Its module
  // loads the OpenCV pipeline, so it is imported when a run starts rather than
  // when these declarations are read.
  defineRoute({
    method: 'get', path: '/wv-import/matches/:worldViewId/color-match-stream', access: 'admin', cache: 'revalidate',
    summary: 'Match the map image of a region to its GADM divisions by colour, as a server-sent event stream',
    params: worldViewIdParamSchema,
    query: wvImportColorMatchSchema,
    response: stream(ColorMatchEvent),
    handler: async (input, exchange) =>
      (await import('../controllers/admin/wvImportMatchPipeline.js')).colorMatchDivisionsSSE(input, exchange),
  }),
  defineRoute({
    ...ADMIN, method: 'post', path: '/wv-import/water-review/:reviewId',
    summary: 'Answer the water review a colour match waits on: which detected areas are water',
    params: reviewIdParamSchema,
    body: wvImportWaterReviewBodySchema,
    response: ReviewAnswered,
    handler: answerWaterReview,
  }),
  defineRoute({
    ...ADMIN, method: 'post', path: '/wv-import/cluster-review/:reviewId',
    summary: 'Answer the cluster review a colour match waits on: merge, split, drop, re-run or repaint',
    params: reviewIdParamSchema,
    body: wvImportClusterReviewAnswerSchema,
    response: ReviewAnswered,
    handler: answerClusterReview,
  }),
  defineRoute({
    ...ADMIN, method: 'post', path: '/wv-import/icp-adjustment/:reviewId',
    summary: 'Answer whether a colour match should realign without the outlying divisions that inflate its frame',
    params: reviewIdParamSchema,
    body: wvImportIcpAdjustmentBodySchema,
    response: ReviewAnswered,
    handler: answerIcpAdjustment,
  }),
  // The review screen's images, served from memory so the stream is not held
  // up by their payloads. The web fetches them with the session's token in
  // its header, and the reviewer's browser keeps them five minutes.
  defineRoute({
    method: 'get', path: '/wv-import/water-crop/:reviewId/:componentId/:subCluster', access: 'admin', cache: { maxAge: 300 },
    summary: 'Serve the image of one detected water area, or one of its parts, for the water review',
    params: wvImportWaterCropParamSchema,
    response: IMAGE,
    handler: waterCropImage,
  }),
  defineRoute({
    method: 'get', path: '/wv-import/cluster-preview/:reviewId', access: 'admin', cache: { maxAge: 300 },
    summary: 'Serve the preview image of the colour clusters for the cluster review',
    params: reviewIdParamSchema,
    response: IMAGE,
    handler: clusterPreviewImage,
  }),
  defineRoute({
    method: 'get', path: '/wv-import/cluster-highlight/:reviewId/:label', access: 'admin', cache: { maxAge: 300 },
    summary: 'Serve an image with one colour cluster outlined, for the cluster review',
    params: wvImportClusterHighlightParamSchema,
    response: IMAGE,
    handler: clusterHighlightImage,
  }),
  // GADM coverage, reporting as it goes.
  defineRoute({
    method: 'get', path: '/wv-import/matches/:worldViewId/coverage-stream', access: 'admin', cache: 'revalidate',
    summary: 'Find GADM divisions a world view leaves uncovered, with suggestions, as a server-sent event stream',
    params: worldViewIdParamSchema,
    query: coverageSSEQuerySchema,
    response: stream(CoverageEvent),
    handler: getCoverageSSE,
  }),
];
