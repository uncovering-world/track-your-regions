/**
 * The world-view import's colour-match run as a reviewer sees it: the stream
 * the run reports on, the reviewer's answers to the questions it waits on,
 * the images its review screen draws, the coverage stream, and Wikimedia's
 * boundary for a Wikidata id (ADR-0071). Spread into `adminDeclaredRoutes`.
 */

import { defineRoute, IMAGE, stream } from '../api/route.js';
import { ColorMatchEvent, ReviewAnswered } from '../api/responses/wvImportCvMatch.js';
import { CoverageEvent } from '../api/responses/wvImportCoverage.js';
import { Geoshape } from '../api/responses/worldViewImport.js';
import { getCoverageSSE } from '../controllers/admin/wvImportCoverageController.js';
import { getGeoshape } from '../controllers/admin/wvImportLifecycleController.js';
import {
  answerClusterReview, answerIcpAdjustment, answerWaterReview, clusterHighlightImage, clusterPreviewImage, waterCropImage,
} from '../controllers/admin/wvImportReviewAnswers.js';
import {
  coverageSSEQuerySchema, reviewIdParamSchema, wikidataIdParamSchema, worldViewIdParamSchema,
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
    params: worldViewIdParamSchema,
    query: wvImportColorMatchSchema,
    response: stream(ColorMatchEvent),
    handler: async (input, exchange) =>
      (await import('../controllers/admin/wvImportMatchPipeline.js')).colorMatchDivisionsSSE(input, exchange),
  }),
  defineRoute({
    ...ADMIN, method: 'post', path: '/wv-import/water-review/:reviewId',
    params: reviewIdParamSchema,
    body: wvImportWaterReviewBodySchema,
    response: ReviewAnswered,
    handler: answerWaterReview,
  }),
  defineRoute({
    ...ADMIN, method: 'post', path: '/wv-import/cluster-review/:reviewId',
    params: reviewIdParamSchema,
    body: wvImportClusterReviewAnswerSchema,
    response: ReviewAnswered,
    handler: answerClusterReview,
  }),
  defineRoute({
    ...ADMIN, method: 'post', path: '/wv-import/icp-adjustment/:reviewId',
    params: reviewIdParamSchema,
    body: wvImportIcpAdjustmentBodySchema,
    response: ReviewAnswered,
    handler: answerIcpAdjustment,
  }),
  // The review screen's images, served from memory so the stream is not held
  // up by their payloads. They are loaded as <img src> through the token in
  // the query (EventSource and <img> send no header), kept five minutes by the
  // reviewer's browser, and drawable by the web on its own origin.
  defineRoute({
    method: 'get', path: '/wv-import/water-crop/:reviewId/:componentId/:subCluster', access: 'admin', cache: { maxAge: 300 },
    params: wvImportWaterCropParamSchema,
    response: IMAGE,
    handler: waterCropImage,
  }),
  defineRoute({
    method: 'get', path: '/wv-import/cluster-preview/:reviewId', access: 'admin', cache: { maxAge: 300 },
    params: reviewIdParamSchema,
    response: IMAGE,
    handler: clusterPreviewImage,
  }),
  defineRoute({
    method: 'get', path: '/wv-import/cluster-highlight/:reviewId/:label', access: 'admin', cache: { maxAge: 300 },
    params: wvImportClusterHighlightParamSchema,
    response: IMAGE,
    handler: clusterHighlightImage,
  }),
  // GADM coverage, reporting as it goes.
  defineRoute({
    method: 'get', path: '/wv-import/matches/:worldViewId/coverage-stream', access: 'admin', cache: 'revalidate',
    params: worldViewIdParamSchema,
    query: coverageSSEQuerySchema,
    response: stream(CoverageEvent),
    handler: getCoverageSSE,
  }),
  // Wikimedia's boundary for a Wikidata id: the same bytes for every caller,
  // admin-gated because the editor is the one that asks, and re-requested on
  // every open of the dialog — kept by the browser and revalidated.
  defineRoute({
    method: 'get', path: '/wv-import/geoshape/:wikidataId', access: 'admin', cache: 'revalidate',
    params: wikidataIdParamSchema,
    response: Geoshape,
    handler: getGeoshape,
  }),
];
