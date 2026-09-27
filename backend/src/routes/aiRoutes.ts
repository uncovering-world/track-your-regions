/**
 * AI Routes for region grouping suggestions, mounted at /api/ai (ADR-0071).
 *
 * Every route is the editor's: `admin`, `no-store`.
 */

import { defineRoute } from '../api/route.js';
import {
  AIModels,
  AIStatus,
  BatchSuggestions,
  GroupDescriptions,
  GroupSuggestion,
  ModelSet,
  WebSearchModelSet,
} from '../api/responses/ai.js';
import {
  checkAIStatus,
  suggestGroup,
  suggestGroupsBatch,
  generateDescriptions,
  getModels,
  setCurrentModel,
  setCurrentWebSearchModel,
} from '../controllers/aiController.js';
import {
  setModelBodySchema,
  suggestGroupBodySchema,
  suggestGroupsBatchBodySchema,
  generateDescriptionsBodySchema,
} from '../types/index.js';

/** The fields every route here shares: the editor's, and kept nowhere. */
const EDITOR = { access: 'admin', cache: 'no-store' } as const;

export const aiRoutes = [
  // Whether AI features are available
  defineRoute({
    ...EDITOR, method: 'get', path: '/status',
    summary: 'Report whether AI features are configured, with the selected and available models',
    response: AIStatus,
    handler: checkAIStatus,
  }),

  // Model management
  defineRoute({
    ...EDITOR, method: 'get', path: '/models',
    summary: 'List the available OpenAI models and the two currently selected',
    response: AIModels,
    handler: getModels,
  }),
  defineRoute({
    ...EDITOR, method: 'post', path: '/models',
    summary: 'Select the OpenAI model for requests without web search, server-wide until restart',
    body: setModelBodySchema,
    response: ModelSet,
    handler: setCurrentModel,
  }),
  defineRoute({
    ...EDITOR, method: 'post', path: '/models/web-search',
    summary: 'Select the OpenAI model for web-search requests, server-wide until restart',
    body: setModelBodySchema,
    response: WebSearchModelSet,
    handler: setCurrentWebSearchModel,
  }),

  // Suggest the group for a single region
  defineRoute({
    ...EDITOR, method: 'post', path: '/suggest-group',
    summary: 'Ask the AI model which of the given groups a single region belongs to',
    body: suggestGroupBodySchema,
    response: GroupSuggestion,
    handler: suggestGroup,
  }),
  // Suggest groups for several regions at once
  defineRoute({
    ...EDITOR, method: 'post', path: '/suggest-groups-batch',
    summary: 'Ask the AI model which of the given groups each of several regions belongs to',
    body: suggestGroupsBatchBodySchema,
    response: BatchSuggestions,
    handler: suggestGroupsBatch,
  }),
  // Describe groups, to help the classification
  defineRoute({
    ...EDITOR, method: 'post', path: '/generate-group-descriptions',
    summary: 'Have the AI model describe each group, to guide later group suggestions',
    body: generateDescriptionsBodySchema,
    response: GroupDescriptions,
    handler: generateDescriptions,
  }),
];

