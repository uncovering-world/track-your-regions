/**
 * AI Controller for region grouping suggestions
 */

import type { z } from 'zod/v4';
import type {
  AIGeocodeResult,
  AIModels,
  AIStatus,
  BatchSuggestions,
  GroupDescriptions,
  GroupSuggestion,
  ModelSet,
  WebSearchModelSet,
} from '../api/responses/ai.js';
import {
  suggestGroupForRegion,
  suggestGroupsForMultipleRegions,
  generateGroupDescriptions,
  geocodeDescription,
  isOpenAIAvailable,
  fetchAvailableModelsFromAPI,
  getModel,
  setModel,
  getWebSearchModel,
  setWebSearchModel,
  getWebSearchCapableModels,
} from '../services/ai/openaiService.js';
import { badRequest, failure } from '../middleware/errorHandler.js';
import type {
  aiGeocodeBodySchema, generateDescriptionsBodySchema, setModelBodySchema, suggestGroupBodySchema,
  suggestGroupsBatchBodySchema,
} from '../types/index.js';

/**
 * Check if AI features are available
 */
export async function checkAIStatus(): Promise<AIStatus> {
  const availableModels = await fetchAvailableModelsFromAPI();
  const webSearchModels = getWebSearchCapableModels();

  return {
    available: isOpenAIAvailable(),
    message: isOpenAIAvailable()
      ? 'AI features are available'
      : 'OpenAI API key not configured. Set OPENAI_API_KEY in .env to enable AI features.',
    currentModel: getModel(),
    webSearchModel: getWebSearchModel(),
    availableModels,
    webSearchModels,
  };
}

/**
 * Get available models
 */
export async function getModels(): Promise<AIModels> {
  const availableModels = await fetchAvailableModelsFromAPI();
  const webSearchModels = getWebSearchCapableModels();

  return {
    currentModel: getModel(),
    webSearchModel: getWebSearchModel(),
    availableModels,
    webSearchModels,
  };
}

/**
 * Set the current model
 */
export async function setCurrentModel(
  { body: { modelId } }: { body: z.output<typeof setModelBodySchema> },
): Promise<ModelSet> {
  setModel(modelId);
  return { success: true, currentModel: getModel() };
}

/**
 * Set the web search model
 */
export async function setCurrentWebSearchModel(
  { body: { modelId } }: { body: z.output<typeof setModelBodySchema> },
): Promise<WebSearchModelSet> {
  setWebSearchModel(modelId);
  return { success: true, webSearchModel: getWebSearchModel() };
}

/**
 * What a model call's failure answers: the quota refusal the web shows as
 * such, or the route's own sentence. Never the SDK's text (#1021).
 */
function modelFailure(error: unknown, sentence: string): Error {
  const errorObj = error as { status?: number; code?: string };
  if (errorObj?.status === 429 || errorObj?.code === 'insufficient_quota') {
    return failure('AI quota exceeded', 429, 'quota_exceeded');
  }
  return failure(sentence, 500);
}

/** The refusal every model call gives when no key is configured. */
function requireOpenAI(): void {
  if (!isOpenAIAvailable()) throw failure('AI features are not available', 503);
}

/**
 * Suggest which group a region belongs to
 *
 * POST /api/ai/suggest-group
 */
export async function suggestGroup(
  { body }: { body: z.output<typeof suggestGroupBodySchema> },
): Promise<GroupSuggestion> {
  const { regionPath, regionName, availableGroups, parentRegion, groupDescriptions, useWebSearch, worldViewSource, escalationLevel } = body;

  // The schema takes these as strings and a list; empty ones are refused here.
  if (!regionPath) throw badRequest('regionPath is required and must be a string');
  if (!regionName) throw badRequest('regionName is required and must be a string');
  if (availableGroups.length === 0) throw badRequest('availableGroups must be a non-empty array of strings');
  if (!parentRegion) throw badRequest('parentRegion is required and must be a string');

  requireOpenAI();

  try {
    return await suggestGroupForRegion(
      regionPath,
      regionName,
      availableGroups,
      parentRegion,
      groupDescriptions,
      useWebSearch,
      worldViewSource,
      escalationLevel || 'fast'
    );
  } catch (error: unknown) {
    console.error('AI suggestion error:', error);
    throw modelFailure(error, 'Failed to get AI suggestion');
  }
}

/**
 * Suggest groups for multiple regions at once (batch processing)
 *
 * POST /api/ai/suggest-groups-batch
 */
export async function suggestGroupsBatch(
  { body }: { body: z.output<typeof suggestGroupsBatchBodySchema> },
): Promise<BatchSuggestions> {
  const { regions, availableGroups, parentRegion, worldViewDescription, worldViewSource, useWebSearch, groupDescriptions } = body;

  if (availableGroups.length === 0) throw badRequest('availableGroups must be a non-empty array of strings');
  if (!parentRegion) throw badRequest('parentRegion is required and must be a string');

  requireOpenAI();

  try {
    return await suggestGroupsForMultipleRegions(
      regions,
      availableGroups,
      parentRegion,
      worldViewDescription,
      worldViewSource,
      useWebSearch,
      groupDescriptions
    );
  } catch (error: unknown) {
    console.error('AI batch suggestion error:', error);
    throw modelFailure(error, 'Failed to get AI suggestions');
  }
}

/**
 * Generate descriptions for groups to assist in classification
 *
 * POST /api/ai/generate-group-descriptions
 */
export async function generateDescriptions(
  { body }: { body: z.output<typeof generateDescriptionsBodySchema> },
): Promise<GroupDescriptions> {
  const { groups, parentRegion, worldViewDescription, worldViewSource, useWebSearch } = body;

  if (!parentRegion) throw badRequest('parentRegion is required and must be a string');

  requireOpenAI();

  try {
    return await generateGroupDescriptions(
      groups,
      worldViewDescription,
      worldViewSource,
      useWebSearch
    );
  } catch (error: unknown) {
    console.error('AI description generation error:', error);
    throw modelFailure(error, 'Failed to generate group descriptions');
  }
}

/**
 * Geocode a natural-language place description using AI
 *
 * POST /api/ai/geocode
 * Body: { description: string }
 */
export async function geocodeWithAI(
  { body: { description } }: { body: z.output<typeof aiGeocodeBodySchema> },
): Promise<AIGeocodeResult> {
  if (description.trim().length < 2) {
    throw badRequest('description is required (at least 2 characters)');
  }

  requireOpenAI();

  try {
    return await geocodeDescription(description.trim());
  } catch (error: unknown) {
    console.error('AI geocode error:', error);
    throw modelFailure(error, 'Failed to geocode description');
  }
}
