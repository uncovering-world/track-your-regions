/**
 * AI Admin Controller
 *
 * Endpoints for AI settings and usage dashboard.
 */

import type { z } from 'zod/v4';
import type {
  AISettings,
  AISettingSaved,
  AIUsageSummary,
  LearnedRule,
  LearnedRuleDeleted,
  LearnedRules,
  PricingUpdated,
  ReviewSuggestionApplied,
  RuleReviewResult,
} from '../../api/responses/adminAi.js';
import { failure, notFound } from '../../middleware/errorHandler.js';
import type {
  addLearnedRuleBodySchema, aiRuleIdParamSchema, aiSettingKeyParamSchema, aiSettingValueBodySchema,
  applyRuleReviewBodySchema,
} from '../../types/index.js';
import { getAllSettings, updateSetting } from '../../services/ai/aiSettingsService.js';
import { getUsageSummary } from '../../services/ai/aiUsageLogger.js';
import { getAllPricing, updatePricingFromRemote } from '../../services/ai/pricingService.js';
import { getAllRules, addRule, deleteRule, updateRuleText, deleteRules, PREDEFINED_RULES } from '../../services/ai/learnedRulesService.js';
import { reviewRules } from '../../services/ai/ruleReviewService.js';
import { isOpenAIAvailable } from '../../services/ai/openaiShared.js';

export async function getAISettings(): Promise<AISettings> {
  const settings = await getAllSettings();
  const models = getAllPricing().map(p => ({ id: p.model, inputPer1M: p.inputPer1M, outputPer1M: p.outputPer1M }));
  return { settings, models };
}

export async function updateAISetting(
  { params: { key }, body: { value } }: {
    params: z.output<typeof aiSettingKeyParamSchema>; body: z.output<typeof aiSettingValueBodySchema>;
  },
): Promise<AISettingSaved> {
  await updateSetting(key, value);
  return { ok: true };
}

export async function getAIUsage(): Promise<AIUsageSummary> {
  return getUsageSummary();
}

export async function updatePricing(): Promise<PricingUpdated> {
  try {
    return await updatePricingFromRemote();
  } catch (err) {
    console.error('[AI] Pricing update failed:', err);
    throw failure('Could not fetch model prices from the provider.', 502);
  }
}

export async function getLearnedRules(): Promise<LearnedRules> {
  const rules = await getAllRules();
  return { learned: rules, predefined: PREDEFINED_RULES };
}

export async function addLearnedRule(
  { body: { feature, ruleText, context } }: { body: z.output<typeof addLearnedRuleBodySchema> },
): Promise<LearnedRule> {
  return addRule(feature, ruleText, context);
}

export async function deleteLearnedRule(
  { params: { id } }: { params: z.output<typeof aiRuleIdParamSchema> },
): Promise<LearnedRuleDeleted> {
  const deleted = await deleteRule(id);
  if (!deleted) throw notFound('Rule not found');
  return { ok: true };
}

export async function reviewLearnedRules(): Promise<RuleReviewResult> {
  if (!isOpenAIAvailable()) {
    throw failure('OpenAI is not configured — rule review unavailable', 503);
  }
  return reviewRules();
}

export async function applyRuleReviewSuggestion(
  { body: suggestion }: { body: z.output<typeof applyRuleReviewBodySchema> },
): Promise<ReviewSuggestionApplied> {
  // Update the kept rule's text if a replacement was provided. Abort the
  // delete step if the keep rule doesn't exist — otherwise we'd remove the
  // deleteIds rules with no surviving canonical replacement.
  if (suggestion.replacementText) {
    const updated = await updateRuleText(suggestion.keepId, suggestion.replacementText);
    if (!updated) {
      throw notFound(`Rule ${suggestion.keepId} not found — aborting before deleting other rules`);
    }
  }

  // Delete the duplicate/conflicting rules
  const deletedCount = await deleteRules(suggestion.deleteIds);

  return { ok: true, deletedCount };
}
