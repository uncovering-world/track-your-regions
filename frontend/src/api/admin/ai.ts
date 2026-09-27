import type {
  AISettings, AIUsageSummary, HierarchyReviewResult, LearnedRule, LearnedRules, PricingUpdated, ReviewSuggestion,
  ReviewSuggestionApplied, RuleReviewResult,
} from '@tyr/shared/api';
import {
  deleteAdminAiRulesById, getAdminAiRules, getAdminAiSettings, getAdminAiUsage, postAdminAiHierarchyReviewByWorldViewId,
  postAdminAiRules, postAdminAiRulesApplyReview, postAdminAiRulesReview, postAdminAiUpdatePricing,
  putAdminAiSettingsByKey,
} from '../client.generated';

// What every call here answers is declared once, as a backend schema (ADR-0066),
// and generated into `@tyr/shared/api`. Passed on from here, so a component
// imports a call's answer from the module of the call.
export type {
  AIModelOption, AISettings, AISettingSaved, AIUsageByModelFeature, AIUsageSummary, HierarchyReviewAction,
  HierarchyReviewResult, LearnedRule, LearnedRuleDeleted, LearnedRules, PredefinedRule, PricingUpdated,
  ReviewSuggestion, ReviewSuggestionApplied, RuleReviewResult,
} from '@tyr/shared/api';

export async function getAISettings(): Promise<AISettings> {
  return getAdminAiSettings();
}

export async function updateAISetting(key: string, value: string): Promise<void> {
  await putAdminAiSettingsByKey(key, { value });
}

export async function getAIUsage(): Promise<AIUsageSummary> {
  return getAdminAiUsage();
}

export async function updatePricing(): Promise<PricingUpdated> {
  return postAdminAiUpdatePricing();
}

export async function getLearnedRules(): Promise<LearnedRules> {
  return getAdminAiRules();
}

export async function addLearnedRule(feature: string, ruleText: string, context?: string): Promise<LearnedRule> {
  return postAdminAiRules({ feature, ruleText, context });
}

export async function deleteLearnedRule(id: number): Promise<void> {
  await deleteAdminAiRulesById(id);
}

export async function reviewLearnedRules(): Promise<RuleReviewResult> {
  return postAdminAiRulesReview();
}

export async function applyRuleReviewSuggestion(suggestion: ReviewSuggestion): Promise<ReviewSuggestionApplied> {
  return postAdminAiRulesApplyReview(suggestion);
}

// =============================================================================
// Hierarchy Review
// =============================================================================

export async function runHierarchyReview(
  worldViewId: number,
  regionId?: number,
): Promise<HierarchyReviewResult> {
  return postAdminAiHierarchyReviewByWorldViewId(worldViewId, regionId != null ? { regionId } : {});
}
