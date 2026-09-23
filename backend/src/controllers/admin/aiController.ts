/**
 * AI Admin Controller
 *
 * Endpoints for AI settings and usage dashboard.
 */

import type { Response } from 'express';
import { respond } from '../../api/respond.js';
import {
  AISettings,
  AISettingSaved,
  AIUsageSummary,
  LearnedRule,
  LearnedRuleDeleted,
  LearnedRules,
  PricingUpdated,
  ReviewSuggestionApplied,
  RuleReviewResult,
  type ReviewSuggestion,
} from '../../api/responses/adminAi.js';
import type { AuthenticatedRequest } from '../../middleware/auth.js';
import { getAllSettings, updateSetting } from '../../services/ai/aiSettingsService.js';
import { getUsageSummary } from '../../services/ai/aiUsageLogger.js';
import { getAllPricing, updatePricingFromRemote } from '../../services/ai/pricingService.js';
import { getAllRules, addRule, deleteRule, updateRuleText, deleteRules, PREDEFINED_RULES } from '../../services/ai/learnedRulesService.js';
import { reviewRules } from '../../services/ai/ruleReviewService.js';
import { isOpenAIAvailable } from '../../services/ai/openaiShared.js';

export async function getAISettings(_req: AuthenticatedRequest, res: Response): Promise<void> {
  const settings = await getAllSettings();
  const models = getAllPricing().map(p => ({ id: p.model, inputPer1M: p.inputPer1M, outputPer1M: p.outputPer1M }));
  respond(res, AISettings, { settings, models });
}

export async function updateAISetting(req: AuthenticatedRequest, res: Response): Promise<void> {
  const key = req.params.key as string;
  const { value } = req.body;
  await updateSetting(key, value);
  respond(res, AISettingSaved, { ok: true });
}

export async function getAIUsage(_req: AuthenticatedRequest, res: Response): Promise<void> {
  respond(res, AIUsageSummary, await getUsageSummary());
}

export async function updatePricing(_req: AuthenticatedRequest, res: Response): Promise<void> {
  let result: PricingUpdated;
  try {
    result = await updatePricingFromRemote();
  } catch (err) {
    res.status(502).json({
      error: 'Failed to update pricing',
      message: err instanceof Error ? err.message : String(err),
    });
    return;
  }
  respond(res, PricingUpdated, result);
}

export async function getLearnedRules(_req: AuthenticatedRequest, res: Response): Promise<void> {
  const rules = await getAllRules();
  respond(res, LearnedRules, { learned: rules, predefined: PREDEFINED_RULES });
}

export async function addLearnedRule(req: AuthenticatedRequest, res: Response): Promise<void> {
  const { feature, ruleText, context } = req.body;
  if (!feature || !ruleText) {
    res.status(400).json({ error: 'feature and ruleText are required' });
    return;
  }
  const rule = await addRule(feature, ruleText, context);
  respond(res.status(201), LearnedRule, rule);
}

export async function deleteLearnedRule(req: AuthenticatedRequest, res: Response): Promise<void> {
  const id = Number(req.params.id);
  const deleted = await deleteRule(id);
  if (!deleted) {
    res.status(404).json({ error: 'Rule not found' });
    return;
  }
  respond(res, LearnedRuleDeleted, { ok: true });
}

export async function reviewLearnedRules(_req: AuthenticatedRequest, res: Response): Promise<void> {
  if (!isOpenAIAvailable()) {
    res.status(503).json({ error: 'OpenAI is not configured — rule review unavailable' });
    return;
  }
  respond(res, RuleReviewResult, await reviewRules());
}

export async function applyRuleReviewSuggestion(req: AuthenticatedRequest, res: Response): Promise<void> {
  // Body is Zod-validated at the route layer (keepId positive int, deleteIds array of positive ints,
  // replacementText nullable string). No defensive guard needed here.
  const suggestion = req.body as ReviewSuggestion;

  // Update the kept rule's text if a replacement was provided. Abort the
  // delete step if the keep rule doesn't exist — otherwise we'd remove the
  // deleteIds rules with no surviving canonical replacement.
  if (suggestion.replacementText) {
    const updated = await updateRuleText(suggestion.keepId, suggestion.replacementText);
    if (!updated) {
      res.status(404).json({
        error: `Rule ${suggestion.keepId} not found — aborting before deleting other rules`,
      });
      return;
    }
  }

  // Delete the duplicate/conflicting rules
  const deletedCount = await deleteRules(suggestion.deleteIds);

  respond(res, ReviewSuggestionApplied, { ok: true, deletedCount });
}
