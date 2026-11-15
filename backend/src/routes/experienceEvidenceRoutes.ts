/**
 * What stands behind the evidence a curator's screens show (#2520), mounted
 * at /api/experiences with the curation routes (ADR-0071): the Wikivoyage
 * articles behind a guide's yes, read from the local copy when a curator opens
 * them. Under `review/`, so `/:id/…` cannot take it.
 */

import { defineRoute } from '../api/route.js';
import { GuideArticles } from '../api/responses/guideArticles.js';
import { getGuideArticles } from '../controllers/experience/index.js';
import { guideArticlesParamSchema } from '../types/guideArticlesSchema.js';

export const experienceEvidenceRoutes = [
  // One indexed read of a serving table, bounded by `MOST_GUIDE_ARTICLES`.
  defineRoute({
    method: 'get', path: '/review/guide-articles/:membershipId', access: 'curator', cache: 'no-store',
    summary: "The Wikivoyage articles that use the item a membership's source knows its place by, from the local copy",
    params: guideArticlesParamSchema,
    response: GuideArticles,
    handler: getGuideArticles,
  }),
];
