/**
 * AI Admin Controller
 *
 * Endpoints for AI settings and usage dashboard.
 */

import type { Response } from 'express';
import type { AuthenticatedRequest } from '../../middleware/auth.js';
import { getAllSettings, updateSetting } from '../../services/ai/aiSettingsService.js';
import { getUsageSummary } from '../../services/ai/aiUsageLogger.js';
import { getAllPricing, updatePricingFromRemote } from '../../services/ai/pricingService.js';
import { getAllRules, addRule, deleteRule, updateRuleText, deleteRules, PREDEFINED_RULES } from '../../services/ai/learnedRulesService.js';
import { reviewRules, type ReviewSuggestion } from '../../services/ai/ruleReviewService.js';

export async function getAISettings(_req: AuthenticatedRequest, res: Response): Promise<void> {
  const settings = await getAllSettings();
  const models = getAllPricing().map(p => ({ id: p.model, inputPer1M: p.inputPer1M, outputPer1M: p.outputPer1M }));
  res.json({ settings, models });
}

export async function updateAISetting(req: AuthenticatedRequest, res: Response): Promise<void> {
  const key = req.params.key as string;
  const { value } = req.body;
  await updateSetting(key, value);
  res.json({ ok: true });
}

export async function getAIUsage(_req: AuthenticatedRequest, res: Response): Promise<void> {
  const summary = await getUsageSummary();
  res.json(summary);
}

export async function updatePricing(_req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const result = await updatePricingFromRemote();
    res.json(result);
  } catch (err) {
    res.status(502).json({
      error: 'Failed to update pricing',
      message: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function getLearnedRules(_req: AuthenticatedRequest, res: Response): Promise<void> {
  const rules = await getAllRules();
  res.json({ learned: rules, predefined: PREDEFINED_RULES });
}

export async function addLearnedRule(req: AuthenticatedRequest, res: Response): Promise<void> {
  const { feature, ruleText, context } = req.body;
  if (!feature || !ruleText) {
    res.status(400).json({ error: 'feature and ruleText are required' });
    return;
  }
  const rule = await addRule(feature, ruleText, context);
  res.status(201).json(rule);
}

export async function deleteLearnedRule(req: AuthenticatedRequest, res: Response): Promise<void> {
  const id = Number(req.params.id);
  const deleted = await deleteRule(id);
  if (!deleted) {
    res.status(404).json({ error: 'Rule not found' });
    return;
  }
  res.json({ ok: true });
}

export async function reviewLearnedRules(_req: AuthenticatedRequest, res: Response): Promise<void> {
  const result = await reviewRules();
  res.json(result);
}

export async function applyRuleReviewSuggestion(req: AuthenticatedRequest, res: Response): Promise<void> {
  const suggestion = req.body as ReviewSuggestion;

  if (!suggestion.keepId || !Array.isArray(suggestion.deleteIds)) {
    res.status(400).json({ error: 'keepId and deleteIds are required' });
    return;
  }

  // Update the kept rule's text if a replacement was provided
  if (suggestion.replacementText) {
    await updateRuleText(suggestion.keepId, suggestion.replacementText);
  }

  // Delete the duplicate/conflicting rules
  const deletedCount = await deleteRules(suggestion.deleteIds);

  res.json({ ok: true, deletedCount });
}
