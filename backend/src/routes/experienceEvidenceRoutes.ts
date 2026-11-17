/**
 * What stands behind the evidence a curator's screens show (#2520), mounted
 * at /api/experiences with the curation routes (ADR-0071): the Wikivoyage
 * articles behind a guide's yes, read from the local copy when a curator opens
 * them, and the first sentence of each asked place's Wikipedia article a page of
 * review cards shows and an arrival's answered neighbours in its kind (#2185).
 * Under `review/`, so `/:id/…` cannot take them.
 */

import { defineRoute } from '../api/route.js';
import { ReviewArticleLeads } from '../api/responses/articleLeads.js';
import { GuideArticles } from '../api/responses/guideArticles.js';
import { KindNeighbours } from '../api/responses/kindNeighbours.js';
import { getGuideArticles, getKindNeighbours, getReviewArticleLeads } from '../controllers/experience/index.js';
import { guideArticlesParamSchema } from '../types/guideArticlesSchema.js';
import { reviewQueueMapNamesQuerySchema } from '../types/index.js';

export const experienceEvidenceRoutes = [
  // One indexed read of a serving table, bounded by `MOST_GUIDE_ARTICLES`.
  defineRoute({
    method: 'get', path: '/review/guide-articles/:membershipId', access: 'curator', cache: 'no-store',
    summary: "The Wikivoyage articles that use the item a membership's source knows its place by, from the local copy",
    params: guideArticlesParamSchema,
    response: GuideArticles,
    handler: getGuideArticles,
  }),
  // The places named by the same bounded id list the map's short list asks with (#2501), within the
  // caller's scope; Wikipedia is asked only for leads not read in the last day.
  defineRoute({
    method: 'get', path: '/review/article-leads', access: 'curator', cache: 'no-store',
    summary: "The first sentence of the English Wikipedia article of each asked place a page of review cards shows",
    query: reviewQueueMapNamesQuerySchema,
    response: ReviewArticleLeads,
    handler: getReviewArticleLeads,
  }),
  // Two bounded reads, one row each: a kept and a refused place of the membership's kind and type.
  defineRoute({
    method: 'get', path: '/review/kind-neighbours/:membershipId', access: 'curator', cache: 'no-store',
    summary: "One place of an arrival's kind and type a curator kept, and one a curator turned away",
    params: guideArticlesParamSchema,
    response: KindNeighbours,
    handler: getKindNeighbours,
  }),
];
