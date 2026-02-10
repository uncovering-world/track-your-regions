/**
 * AI Controller for region grouping suggestions
 */

import type { Request, Response } from 'express';
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
  type GroupSuggestionResponse,
} from '../services/ai/openaiService.js';

/**
 * Check if AI features are available
 */
export async function checkAIStatus(_req: Request, res: Response) {
  const availableModels = await fetchAvailableModelsFromAPI();
  const webSearchModels = getWebSearchCapableModels();

  res.json({
    available: isOpenAIAvailable(),
    message: isOpenAIAvailable()
      ? 'AI features are available'
      : 'OpenAI API key not configured. Set OPENAI_API_KEY in .env to enable AI features.',
    currentModel: getModel(),
    webSearchModel: getWebSearchModel(),
    availableModels,
    webSearchModels,
  });
}

/**
 * Get available models
 */
export async function getModels(_req: Request, res: Response) {
  const availableModels = await fetchAvailableModelsFromAPI();
  const webSearchModels = getWebSearchCapableModels();

  res.json({
    currentModel: getModel(),
    webSearchModel: getWebSearchModel(),
    availableModels,
    webSearchModels,
  });
}

/**
 * Set the current model
 */
export async function setCurrentModel(req: Request, res: Response) {
  const { modelId } = req.body;

  if (!modelId || typeof modelId !== 'string') {
    return res.status(400).json({ error: 'modelId is required' });
  }

  setModel(modelId);
  res.json({ success: true, currentModel: getModel() });
}

/**
 * Set the web search model
 */
export async function setCurrentWebSearchModel(req: Request, res: Response) {
  const { modelId } = req.body;

  if (!modelId || typeof modelId !== 'string') {
    return res.status(400).json({ error: 'modelId is required' });
  }

  setWebSearchModel(modelId);
  res.json({ success: true, webSearchModel: getWebSearchModel() });
}

/**
 * Suggest which group a region belongs to
 *
 * POST /api/ai/suggest-group
 * Body: {
 *   regionPath: string,
 *   regionName: string,
 *   availableGroups: string[],
 *   parentRegion: string,
 *   groupDescriptions?: Record<string, string>,
 *   useWebSearch?: boolean,
 *   worldViewSource?: string,
 *   escalationLevel?: 'fast' | 'reasoning' | 'reasoning_search'
 * }
 */
export async function suggestGroup(req: Request, res: Response) {
  const { regionPath, regionName, availableGroups, parentRegion, groupDescriptions, useWebSearch, worldViewSource, escalationLevel } = req.body;

  // Validation
  if (!regionPath || typeof regionPath !== 'string') {
    return res.status(400).json({ error: 'regionPath is required and must be a string' });
  }
  if (!regionName || typeof regionName !== 'string') {
    return res.status(400).json({ error: 'regionName is required and must be a string' });
  }
  if (!Array.isArray(availableGroups) || availableGroups.length === 0) {
    return res.status(400).json({ error: 'availableGroups must be a non-empty array of strings' });
  }
  if (!parentRegion || typeof parentRegion !== 'string') {
    return res.status(400).json({ error: 'parentRegion is required and must be a string' });
  }

  if (!isOpenAIAvailable()) {
    return res.status(503).json({
      error: 'AI features are not available',
      message: 'OpenAI API key not configured. Set OPENAI_API_KEY in .env to enable AI features.',
    });
  }

  try {
    const suggestion = await suggestGroupForRegion(
      regionPath,
      regionName,
      availableGroups,
      parentRegion,
      groupDescriptions,
      useWebSearch,
      worldViewSource,
      escalationLevel || 'fast'
    );

    res.json(suggestion);
  } catch (error: unknown) {
    console.error('AI suggestion error:', error);

    // Handle OpenAI quota/rate limit errors
    const errorObj = error as { status?: number; code?: string; message?: string };
    if (errorObj?.status === 429 || errorObj?.code === 'insufficient_quota') {
      return res.status(429).json({
        error: 'AI quota exceeded',
        code: 'quota_exceeded',
        message: "Oops! Looks like our AI hamsters are tired and need more snacks. 🐹💤 Please ask your admin to add more AI credits!",
      });
    }

    res.status(500).json({
      error: 'Failed to get AI suggestion',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

/**
 * Suggest groups for multiple regions at once (batch processing)
 *
 * POST /api/ai/suggest-groups-batch
 * Body: {
 *   regions: Array<{ path: string, name: string }>,
 *   availableGroups: string[],
 *   parentRegion: string,
 *   worldViewDescription?: string,
 *   worldViewSource?: string,
 *   useWebSearch?: boolean,
 *   groupDescriptions?: Record<string, string>
 * }
 */
export async function suggestGroupsBatch(req: Request, res: Response) {
  const { regions, availableGroups, parentRegion, worldViewDescription, worldViewSource, useWebSearch, groupDescriptions } = req.body;

  // Validation
  if (!Array.isArray(regions) || regions.length === 0) {
    return res.status(400).json({ error: 'regions must be a non-empty array' });
  }
  if (!Array.isArray(availableGroups) || availableGroups.length === 0) {
    return res.status(400).json({ error: 'availableGroups must be a non-empty array of strings' });
  }
  if (!parentRegion || typeof parentRegion !== 'string') {
    return res.status(400).json({ error: 'parentRegion is required and must be a string' });
  }

  if (!isOpenAIAvailable()) {
    return res.status(503).json({
      error: 'AI features are not available',
      message: 'OpenAI API key not configured. Set OPENAI_API_KEY in .env to enable AI features.',
    });
  }

  try {
    const result = await suggestGroupsForMultipleRegions(
      regions,
      availableGroups,
      parentRegion,
      worldViewDescription,
      worldViewSource,
      useWebSearch,
      groupDescriptions
    );

    // Convert Map to object for JSON response
    const suggestions: Record<string, GroupSuggestionResponse> = {};
    for (const [name, suggestion] of result.suggestions) {
      suggestions[name] = suggestion;
    }

    res.json({ suggestions, usage: result.totalUsage, apiRequestsCount: result.apiRequestsCount });
  } catch (error: unknown) {
    console.error('AI batch suggestion error:', error);

    // Handle OpenAI quota/rate limit errors
    const errorObj = error as { status?: number; code?: string; message?: string };
    if (errorObj?.status === 429 || errorObj?.code === 'insufficient_quota') {
      return res.status(429).json({
        error: 'AI quota exceeded',
        code: 'quota_exceeded',
        message: "Oops! Looks like our AI hamsters are tired and need more snacks. 🐹💤 Please ask your admin to add more AI credits!",
      });
    }

    res.status(500).json({
      error: 'Failed to get AI suggestions',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

/**
 * Generate descriptions for groups to assist in classification
 *
 * POST /api/ai/generate-group-descriptions
 * Body: {
 *   groups: string[],
 *   parentRegion: string,
 *   worldViewDescription?: string,
 *   worldViewSource?: string,
 *   useWebSearch?: boolean
 * }
 */
export async function generateDescriptions(req: Request, res: Response) {
  const { groups, parentRegion, worldViewDescription, worldViewSource, useWebSearch } = req.body;

  // Validation
  if (!Array.isArray(groups) || groups.length === 0) {
    return res.status(400).json({ error: 'groups must be a non-empty array of strings' });
  }
  if (!parentRegion || typeof parentRegion !== 'string') {
    return res.status(400).json({ error: 'parentRegion is required and must be a string' });
  }

  if (!isOpenAIAvailable()) {
    return res.status(503).json({
      error: 'AI features are not available',
      message: 'OpenAI API key not configured. Set OPENAI_API_KEY in .env to enable AI features.',
    });
  }

  try {
    const result = await generateGroupDescriptions(
      groups,
      worldViewDescription,
      worldViewSource,
      useWebSearch
    );

    res.json({ descriptions: result.descriptions, usage: result.usage });
  } catch (error: unknown) {
    console.error('AI description generation error:', error);

    const errorObj = error as { status?: number; code?: string; message?: string };
    if (errorObj?.status === 429 || errorObj?.code === 'insufficient_quota') {
      return res.status(429).json({
        error: 'AI quota exceeded',
        code: 'quota_exceeded',
        message: "Oops! Looks like our AI hamsters are tired and need more snacks. 🐹💤 Please ask your admin to add more AI credits!",
      });
    }

    res.status(500).json({
      error: 'Failed to generate group descriptions',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

/**
 * Geocode a natural-language place description using AI
 *
 * POST /api/ai/geocode
 * Body: { description: string }
 */
export async function geocodeWithAI(req: Request, res: Response) {
  const { description } = req.body;

  if (!description || typeof description !== 'string' || description.trim().length < 2) {
    return res.status(400).json({ error: 'description is required (at least 2 characters)' });
  }

  if (!isOpenAIAvailable()) {
    return res.status(503).json({
      error: 'AI features are not available',
      message: 'OpenAI API key not configured. Set OPENAI_API_KEY in .env to enable AI features.',
    });
  }

  try {
    const result = await geocodeDescription(description.trim());
    res.json(result);
  } catch (error: unknown) {
    console.error('AI geocode error:', error);

    const errorObj = error as { status?: number; code?: string; message?: string };
    if (errorObj?.status === 429 || errorObj?.code === 'insufficient_quota') {
      return res.status(429).json({
        error: 'AI quota exceeded',
        code: 'quota_exceeded',
        message: 'AI rate limit reached. Please try again later.',
      });
    }

    res.status(500).json({
      error: 'Failed to geocode description',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}
