/**
 * Pricing Service for OpenAI API costs
 *
 * Loads pricing information from CSV file and provides cost calculation
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

interface ModelPricing {
  model: string;
  inputPer1M: number;
  cachedInputPer1M: number | null;
  outputPer1M: number;
  serviceTier: string;
}

// Cache for pricing data
const pricingCache: Map<string, ModelPricing> = new Map();
let pricingLoaded = false;

/**
 * Load pricing data from CSV file
 */
export function loadPricing(): void {
  if (pricingLoaded) return;

  try {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
    const csvPath = join(__dirname, '..', '..', 'data', 'openai_api_model_costs.csv');

    const content = readFileSync(csvPath, 'utf-8');
    const lines = content.split('\n');

    // Skip header
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      const parts = line.split(',');
      if (parts.length < 7) continue;

      const [category, serviceTier, model, , inputStr, cachedInputStr, outputStr] = parts;

      // Only load text_tokens category and standard tier (or batch as fallback)
      if (category !== 'text_tokens') continue;

      const input = parseFloat(inputStr) || 0;
      const cachedInput = cachedInputStr ? parseFloat(cachedInputStr) : null;
      const output = parseFloat(outputStr) || 0;

      // Prefer standard tier, but use batch if standard not available
      const key = model;
      const existing = pricingCache.get(key);

      if (!existing || serviceTier === 'standard') {
        pricingCache.set(key, {
          model,
          inputPer1M: input,
          cachedInputPer1M: cachedInput,
          outputPer1M: output,
          serviceTier,
        });
      }
    }

    console.log(`💰 Loaded pricing for ${pricingCache.size} models`);
    pricingLoaded = true;
  } catch (error) {
    console.error('❌ Failed to load pricing data:', error instanceof Error ? error.message : error);
    // Set up some default pricing as fallback
    setDefaultPricing();
    pricingLoaded = true;
  }
}

/**
 * Set default pricing as fallback
 */
function setDefaultPricing(): void {
  const defaults: ModelPricing[] = [
    { model: 'gpt-4.1', inputPer1M: 2.0, cachedInputPer1M: 0.5, outputPer1M: 8.0, serviceTier: 'default' },
    { model: 'gpt-4.1-mini', inputPer1M: 0.4, cachedInputPer1M: 0.1, outputPer1M: 1.6, serviceTier: 'default' },
    { model: 'gpt-4o', inputPer1M: 2.5, cachedInputPer1M: 1.25, outputPer1M: 10.0, serviceTier: 'default' },
    { model: 'gpt-4o-mini', inputPer1M: 0.15, cachedInputPer1M: 0.075, outputPer1M: 0.6, serviceTier: 'default' },
    { model: 'gpt-3.5-turbo', inputPer1M: 0.5, cachedInputPer1M: null, outputPer1M: 1.5, serviceTier: 'default' },
  ];

  for (const pricing of defaults) {
    pricingCache.set(pricing.model, pricing);
  }
}

/**
 * Get pricing for a specific model
 */
export function getModelPricing(modelId: string): ModelPricing | null {
  loadPricing();

  // Try exact match first
  if (pricingCache.has(modelId)) {
    return pricingCache.get(modelId)!;
  }

  // Try to find a matching model by prefix
  for (const [key, pricing] of pricingCache) {
    if (modelId.startsWith(key) || key.startsWith(modelId)) {
      return pricing;
    }
  }

  return null;
}

/**
 * Calculate cost for given token usage
 * @param webSearchUsed - if true, adds web search tool cost (per search)
 */
export function calculateCost(
  promptTokens: number,
  completionTokens: number,
  modelId: string,
  webSearchUsed: boolean = false
): { inputCost: number; outputCost: number; webSearchCost: number; totalCost: number; pricing: ModelPricing | null } {
  const pricing = getModelPricing(modelId);

  // Web search costs ~$25-30 per 1000 searches for most models
  // Approximating at $0.03 per search (based on OpenAI's Responses API pricing)
  const WEB_SEARCH_COST_PER_CALL = 0.03;

  if (!pricing) {
    // Use a reasonable default if model not found
    const defaultRate = { input: 1.0, output: 4.0 };
    const inputCost = (promptTokens / 1_000_000) * defaultRate.input;
    const outputCost = (completionTokens / 1_000_000) * defaultRate.output;
    const webSearchCost = webSearchUsed ? WEB_SEARCH_COST_PER_CALL : 0;
    return {
      inputCost,
      outputCost,
      webSearchCost,
      totalCost: inputCost + outputCost + webSearchCost,
      pricing: null,
    };
  }

  const inputCost = (promptTokens / 1_000_000) * pricing.inputPer1M;
  const outputCost = (completionTokens / 1_000_000) * pricing.outputPer1M;
  const webSearchCost = webSearchUsed ? WEB_SEARCH_COST_PER_CALL : 0;

  return {
    inputCost,
    outputCost,
    webSearchCost,
    totalCost: inputCost + outputCost + webSearchCost,
    pricing,
  };
}

/**
 * Get all loaded pricing data
 */
export function getAllPricing(): ModelPricing[] {
  loadPricing();
  return Array.from(pricingCache.values());
}
