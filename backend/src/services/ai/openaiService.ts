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
import { Confidence, type AIGeocodeResult } from '../../api/responses/ai.js';
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
} from './openaiGroupSuggestion.js';

export { generateGroupDescriptions } from './openaiGroupDescriptions.js';

export {
  matchDivisionsByVision,
  type VisionMatchDivision,
  type VisionMatchResult,
} from './openaiVisionMatch.js';

// =============================================================================
// geocodeDescription — natural-language geocoding
// =============================================================================

/**
 * Read the model's geocode out of its JSON, key by key. A point that is not on
 * the globe is no answer at all; a missing name is the curator's own
 * description, and a confidence outside the vocabulary is `low`.
 */
function geocodeOf(value: unknown, description: string): AIGeocodeResult {
  const answer = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  const { lat, lng } = answer;
  if (typeof lat !== 'number' || typeof lng !== 'number'
    || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    throw new Error('The model did not locate the place');
  }
  const confidence = Confidence.safeParse(answer.confidence);
  return {
    lat,
    lng,
    name: typeof answer.name === 'string' && answer.name ? answer.name : description,
    confidence: confidence.success ? confidence.data : 'low',
  };
}

/**
 * Use AI to geocode a natural-language place description.
 * Returns coordinates, a resolved name, and a confidence level.
 */
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

  return geocodeOf(parseJsonResponse<unknown>(content), description);
}
