/**
 * Jev's suggestions on the review queue's cards (ADR-0087), mounted at
 * /api/experiences with the curation routes (ADR-0071). Each is a POST,
 * since a call may be made and paid for; each answers what Jev suggests and
 * applies nothing, and a curator decides on the card.
 */

import { defineRoute } from '../api/route.js';
import {
  ComponentItemSuggestions, MergeProposalSuggestions, PointHintSuggestions, ViewSuggestions, VisitSuggestion,
} from '../api/responses/curation.js';
import { suggestComponentItems } from '../controllers/experience/componentItemSuggestionController.js';
import { suggestMergeProposals } from '../controllers/experience/mergeProposalSuggestionController.js';
import { suggestPointHints } from '../controllers/experience/pointHintSuggestionController.js';
import { suggestViews } from '../controllers/experience/viewSuggestionController.js';
import { suggestVisit } from '../controllers/experience/visitSuggestionController.js';
import { authenticatedLimiter } from '../middleware/rateLimiter.js';
import { idParamSchema } from '../types/index.js';

export const experienceSuggestionRoutes = [
  // Jev's suggestion for the card that asks which source's view a place shows
  // (#1260): the stored one for the views as they stand, or a new one asked
  // for — a POST, since a call may be paid for.
  defineRoute({
    method: 'post', path: '/:id/view-suggestions', access: 'curator', cache: 'no-store', limiter: authenticatedLimiter,
    summary: 'Ask Jev which source\'s view of each disputed field a place should show; a suggestion, never applied',
    params: idParamSchema,
    response: ViewSuggestions,
    handler: suggestViews,
  }),
  // Jev's judgement of a site's candidate component items (#1272): the stored
  // one for each candidate as it stands, or a new one asked for — one call for
  // the card's candidates, a POST since it may be paid for.
  defineRoute({
    method: 'post', path: '/:id/component-item-suggestions', access: 'curator', cache: 'no-store',
    limiter: authenticatedLimiter,
    summary: "Ask Jev whether each candidate item is the component it was proposed for; a suggestion, never applied",
    params: idParamSchema,
    response: ComponentItemSuggestions,
    handler: suggestComponentItems,
  }),
  // Jev's judgement of the hints of where a site's roughly placed components
  // stand (#1913): the stored one for each hint as it stands, or a new one
  // asked for — one call for the card's hints, a POST since it may be paid for.
  defineRoute({
    method: 'post', path: '/:id/point-hint-suggestions', access: 'curator', cache: 'no-store',
    limiter: authenticatedLimiter,
    summary: 'Ask Jev whether each hint is where a roughly placed component stands; a suggestion, never applied',
    params: idParamSchema,
    response: PointHintSuggestions,
    handler: suggestPointHints,
  }),
  // Jev's judgement of a place's pairs of near places with similar names
  // (#1249): the stored one for each pair as it stands, or a new one asked for
  // — one call for the card's pairs, a POST since it may be paid for.
  defineRoute({
    method: 'post', path: '/:id/merge-proposal-suggestions', access: 'curator', cache: 'no-store',
    limiter: authenticatedLimiter,
    summary: 'Ask Jev whether each pair of near places is one place, two places or one part of the other; a suggestion, never applied',
    params: idParamSchema,
    response: MergeProposalSuggestions,
    handler: suggestMergeProposals,
  }),
  // Jev's reading of what a visitor finds at an arriving place (#1768): the
  // stored one for the place as it stands, or a new one asked for — a POST,
  // since a call may be paid for.
  defineRoute({
    method: 'post', path: '/:id/visit-suggestion', access: 'curator', cache: 'no-store', limiter: authenticatedLimiter,
    summary: 'Ask Jev what a visitor finds at an arriving place; a suggestion, never applied',
    params: idParamSchema,
    response: VisitSuggestion,
    handler: suggestVisit,
  }),
];
