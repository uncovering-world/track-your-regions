/**
 * OpenAI Service — public API surface for AI-assisted features.
 *
 * This file re-exports the concrete implementations that live in sibling
 * modules:
 *   - `openaiShared.ts`       — client state, model selection, shared helpers
 *   - `openaiGroupSuggestion.ts` — single + batch region-to-group classification
 *   - `openaiGroupDescriptions.ts` — short per-group descriptions
 *   - `openaiVisionMatch.ts`  — vision-based GADM division matching
 *
 * It also hosts the small `geocodeDescription` helper used for ad-hoc natural
 * language geocoding.
 */

import { chatCompletion } from './chatCompletion.js';
import {
  getOpenAIClient,
  getModel,
  parseJsonResponse,
} from './openaiShared.js';

// =============================================================================
// Re-exports (preserve the public API for all existing callers)
// =============================================================================

export {
  initOpenAI,
  isOpenAIAvailable,
  setModel,
  setWebSearchModel,
  getModel,
  getWebSearchModel,
  getWebSearchCapableModels,
  fetchAvailableModelsFromAPI,
  type AIModel,
  type TokenUsage,
  type EscalationLevel,
} from './openaiShared.js';

export {
  suggestGroupForRegion,
  suggestGroupsForMultipleRegions,
  type GroupSuggestionResponse,
  type BatchSuggestionResult,
} from './openaiGroupSuggestion.js';

export {
  generateGroupDescriptions,
  type GroupDescriptionsResult,
} from './openaiGroupDescriptions.js';

export {
  matchDivisionsByVision,
  type VisionMatchDivision,
  type VisionMatchResult,
} from './openaiVisionMatch.js';

// =============================================================================
// geocodeDescription — natural-language geocoding
// =============================================================================

/**
 * Use AI to geocode a natural-language place description.
 * Returns coordinates, a resolved name, and a confidence level.
 */
export interface AIGeocodeResult {
  lat: number;
  lng: number;
  name: string;
  confidence: 'high' | 'medium' | 'low';
}

export async function geocodeDescription(description: string): Promise<AIGeocodeResult> {
  const openai = getOpenAIClient();
  if (!openai) {
    throw new Error('OpenAI API is not configured. Please set OPENAI_API_KEY in .env');
  }

  const systemPrompt = `You are a geocoding assistant. Given a description of a place, return its coordinates.
Respond with valid JSON only, no markdown. Format:
{"lat": number, "lng": number, "name": "Resolved place name", "confidence": "high"|"medium"|"low"}

- "high" = well-known, unambiguous place
- "medium" = likely correct but could be ambiguous
- "low" = best guess, uncertain`;

  const response = await chatCompletion(openai, {
    model: getModel(),
    temperature: 0.1,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `Geocode this place: ${description}` },
    ],
  });

  const content = response.choices[0]?.message?.content;
  if (!content) throw new Error('Empty response from OpenAI');

  return parseJsonResponse<AIGeocodeResult>(content);
}
