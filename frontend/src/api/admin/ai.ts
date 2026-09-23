import type {
  AISettings, AISettingSaved, AIUsageSummary, HierarchyReviewResult, LearnedRule, LearnedRuleDeleted, LearnedRules,
  PricingUpdated, ReviewSuggestion, ReviewSuggestionApplied, RuleReviewResult,
} from '@tyr/shared/api';
import { authFetchJson } from '../fetchUtils';

// What every call here answers is declared once, as a backend schema (ADR-0066),
// and generated into `@tyr/shared/api`. Passed on from here, so a component
// imports a call's answer from the module of the call.
export type {
  AIModelOption, AISettings, AISettingSaved, AIUsageByModelFeature, AIUsageSummary, HierarchyReviewAction,
  HierarchyReviewResult, LearnedRule, LearnedRuleDeleted, LearnedRules, PredefinedRule, PricingUpdated,
  ReviewSuggestion, ReviewSuggestionApplied, RuleReviewResult,
} from '@tyr/shared/api';

const API_URL = import.meta.env.VITE_API_URL || '';

export async function getAISettings(): Promise<AISettings> {
  return authFetchJson<AISettings>(`${API_URL}/api/admin/ai/settings`);
}

export async function updateAISetting(key: string, value: string): Promise<void> {
  await authFetchJson<AISettingSaved>(`${API_URL}/api/admin/ai/settings/${encodeURIComponent(key)}`, {
    method: 'PUT',
    body: JSON.stringify({ value }),
  });
}

export async function getAIUsage(): Promise<AIUsageSummary> {
  return authFetchJson<AIUsageSummary>(`${API_URL}/api/admin/ai/usage`);
}

export async function updatePricing(): Promise<PricingUpdated> {
  return authFetchJson<PricingUpdated>(`${API_URL}/api/admin/ai/update-pricing`, { method: 'POST' });
}

export async function getLearnedRules(): Promise<LearnedRules> {
  return authFetchJson<LearnedRules>(`${API_URL}/api/admin/ai/rules`);
}

export async function addLearnedRule(feature: string, ruleText: string, context?: string): Promise<LearnedRule> {
  return authFetchJson<LearnedRule>(`${API_URL}/api/admin/ai/rules`, {
    method: 'POST',
    body: JSON.stringify({ feature, ruleText, context }),
  });
}

export async function deleteLearnedRule(id: number): Promise<void> {
  await authFetchJson<LearnedRuleDeleted>(`${API_URL}/api/admin/ai/rules/${id}`, { method: 'DELETE' });
}

export async function reviewLearnedRules(): Promise<RuleReviewResult> {
  return authFetchJson<RuleReviewResult>(`${API_URL}/api/admin/ai/rules/review`, { method: 'POST' });
}

export async function applyRuleReviewSuggestion(suggestion: ReviewSuggestion): Promise<ReviewSuggestionApplied> {
  return authFetchJson<ReviewSuggestionApplied>(`${API_URL}/api/admin/ai/rules/apply-review`, {
    method: 'POST',
    body: JSON.stringify(suggestion),
  });
}

// =============================================================================
// Hierarchy Review
// =============================================================================

export async function runHierarchyReview(
  worldViewId: number,
  regionId?: number,
): Promise<HierarchyReviewResult> {
  return authFetchJson<HierarchyReviewResult>(`${API_URL}/api/admin/ai/hierarchy-review/${worldViewId}`, {
    method: 'POST',
    body: JSON.stringify(regionId != null ? { regionId } : {}),
  });
}
