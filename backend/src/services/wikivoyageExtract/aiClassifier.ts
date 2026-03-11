/**
 * AI-based entity classification for depth-aware extraction.
 *
 * Classifies Wikivoyage page titles as country/grouping/sub_country
 * to determine recursion depth limits during tree building.
 */

import type OpenAI from 'openai';
import { getModelForFeature } from '../ai/aiSettingsService.js';
import { calculateCost } from '../ai/pricingService.js';
import { chatCompletion } from '../ai/chatCompletion.js';
import { logAIUsage } from '../ai/aiUsageLogger.js';

export interface ClassificationResult {
  type: 'country' | 'grouping' | 'sub_country';
  area_km2: number | null;
  confidence: 'high' | 'medium' | 'low' | 'cached';
}

/** Cache key: "title|parent" → classification */
export type ClassificationCache = Map<string, { type: string; area_km2: number | null }>;

const VALID_TYPES = ['country', 'grouping', 'sub_country'];

const SYSTEM_PROMPT = `Classify this geographic entity for a travel region hierarchy.

Respond with JSON only:
{
  "type": "country" | "grouping" | "sub_country",
  "area_km2": <number or null>,
  "confidence": "high" | "medium" | "low"
}

Definitions:
- "country": sovereign country or self-governing territory (France, Puerto Rico, Hong Kong, Curaçao)
- "grouping": geographic/cultural grouping of multiple countries (Eastern Europe, Polynesia, Southeast Asia, Balkans)
- "sub_country": administrative region within a country (Bavaria, California, Provence, Hokkaido)

Key signal: if the entity's sub-regions are themselves countries or territories, it is a "grouping", not a "country". Look at the children list provided.

For "country", always provide area_km2 (approximate, in square kilometers).
For "grouping" and "sub_country", area_km2 should be null.`;

/**
 * Compute max allowed depth below a country based on its area.
 *
 * Tiers:
 * - ≤ 5K km²: 0 (leaf — tiny country, no sub-regions)
 * - 5K – 300K km²: 1 (regions only)
 * - 300K – 1M km²: 2 (regions + sub-regions)
 * - > 1M km²: 3 (deep hierarchy)
 */
export function computeMaxSubDepth(areaKm2: number): number {
  if (areaKm2 <= 5_000) return 0;
  if (areaKm2 <= 300_000) return 1;
  if (areaKm2 <= 1_000_000) return 2;
  return 3;
}

function cacheKey(title: string, parent: string): string {
  return `${title}|${parent}`;
}

/**
 * Classify a geographic entity using AI.
 *
 * Returns null if AI is unavailable (no OpenAI client).
 * Uses cache to avoid redundant API calls across re-extractions.
 */
export async function classifyEntity(
  openai: OpenAI | null,
  title: string,
  parentName: string,
  cache: ClassificationCache,
  childNames?: string[],
): Promise<ClassificationResult | null> {
  const key = cacheKey(title, parentName);

  // Check cache first
  const cached = cache.get(key);
  if (cached) {
    return {
      type: cached.type as ClassificationResult['type'],
      area_km2: cached.area_km2,
      confidence: 'cached',
    };
  }

  if (!openai) return null;

  const model = await getModelForFeature('extraction');
  let userMessage = `Entity: "${title}"\nAppears under: "${parentName}"`;
  if (childNames && childNames.length > 0) {
    userMessage += `\nSub-regions: ${childNames.join(', ')}`;
  }

  try {
    const response = await chatCompletion(openai, {
      model,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userMessage },
      ],
      temperature: 0,
      response_format: { type: 'json_object' },
    });

    const content = response.choices[0]?.message?.content;
    if (!content) return null;

    const parsed = JSON.parse(content) as ClassificationResult;

    // Validate type
    if (!VALID_TYPES.includes(parsed.type)) return null;

    // Log AI usage
    const usage = response.usage;
    if (usage) {
      const cost = calculateCost(usage.prompt_tokens, usage.completion_tokens, model);
      await logAIUsage({
        feature: 'extraction_classify',
        model,
        apiCalls: 1,
        promptTokens: usage.prompt_tokens,
        completionTokens: usage.completion_tokens,
        totalCost: cost.totalCost,
        description: `Classify "${title}" under "${parentName}" → ${parsed.type}`,
      });
    }

    // Cache the result
    cache.set(key, { type: parsed.type, area_km2: parsed.area_km2 });

    return parsed;
  } catch (err) {
    console.warn(`[WV Extract] Classification failed for "${title}":`, err instanceof Error ? err.message : err);
    return null;
  }
}
