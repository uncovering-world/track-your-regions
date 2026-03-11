import { authFetchJson } from './fetchUtils';

const API_URL = import.meta.env.VITE_API_URL || '';

export interface AIModelOption {
  id: string;
  inputPer1M: number;
  outputPer1M: number;
}

export interface AISettingsResponse {
  settings: Record<string, string>;
  models: AIModelOption[];
}

export interface UsageByModelFeature {
  feature: string;
  model: string;
  totalCalls: number;
  totalPromptTokens: number;
  totalCompletionTokens: number;
  totalCost: number;
  avgCostPerCall: number;
  lastUsed: string;
}

export interface UsageSummaryResponse {
  today: number;
  thisMonth: number;
  allTime: number;
  byModelFeature: UsageByModelFeature[];
}

export interface LearnedRule {
  id: number;
  feature: string;
  ruleText: string;
  context: string | null;
  createdAt: string;
}

export interface PredefinedRule {
  code: string;
  feature: string;
  ruleText: string;
}

export interface RulesResponse {
  learned: LearnedRule[];
  predefined: PredefinedRule[];
}

export async function getAISettings(): Promise<AISettingsResponse> {
  return authFetchJson(`${API_URL}/api/admin/ai/settings`);
}

export async function updateAISetting(key: string, value: string): Promise<void> {
  await authFetchJson(`${API_URL}/api/admin/ai/settings/${encodeURIComponent(key)}`, {
    method: 'PUT',
    body: JSON.stringify({ value }),
  });
}

export async function getAIUsage(): Promise<UsageSummaryResponse> {
  return authFetchJson(`${API_URL}/api/admin/ai/usage`);
}

export async function updatePricing(): Promise<{ modelsUpdated: number; modelsAdded: number; totalModels: number }> {
  return authFetchJson(`${API_URL}/api/admin/ai/update-pricing`, { method: 'POST' });
}

export async function getLearnedRules(): Promise<RulesResponse> {
  return authFetchJson(`${API_URL}/api/admin/ai/rules`);
}

export async function addLearnedRule(feature: string, ruleText: string, context?: string): Promise<LearnedRule> {
  return authFetchJson(`${API_URL}/api/admin/ai/rules`, {
    method: 'POST',
    body: JSON.stringify({ feature, ruleText, context }),
  });
}

export async function deleteLearnedRule(id: number): Promise<void> {
  await authFetchJson(`${API_URL}/api/admin/ai/rules/${id}`, { method: 'DELETE' });
}

export interface ReviewSuggestion {
  type: 'merge' | 'contradiction' | 'obsolete';
  description: string;
  deleteIds: number[];
  keepId: number;
  replacementText: string | null;
}

export interface RuleReviewResult {
  suggestions: ReviewSuggestion[];
  summary: string;
  consolidatedCount: number;
}

export async function reviewLearnedRules(): Promise<RuleReviewResult> {
  return authFetchJson(`${API_URL}/api/admin/ai/rules/review`, { method: 'POST' });
}

export async function applyRuleReviewSuggestion(suggestion: ReviewSuggestion): Promise<{ ok: boolean; deletedCount: number }> {
  return authFetchJson(`${API_URL}/api/admin/ai/rules/apply-review`, {
    method: 'POST',
    body: JSON.stringify(suggestion),
  });
}

// =============================================================================
// Hierarchy Review
// =============================================================================

export interface HierarchyReviewStats {
  passes: number;
  inputTokens: number;
  outputTokens: number;
  cost: number;
}

export interface ReviewAction {
  id: string;
  type: 'rename' | 'reparent' | 'remove' | 'merge' | 'dismiss_children' | 'add_child' | 'other';
  regionId: number;
  regionName: string;
  description: string;
  params?: Record<string, unknown>;
  choices?: Array<{ label: string; value: string }>;
  selectedChoice?: string;
  completed: boolean;
}

export interface HierarchyReviewResult {
  report: string;
  actions?: ReviewAction[];
  stats: HierarchyReviewStats;
}

export async function runHierarchyReview(
  worldViewId: number,
  regionId?: number,
): Promise<HierarchyReviewResult> {
  return authFetchJson(`${API_URL}/api/admin/ai/hierarchy-review/${worldViewId}`, {
    method: 'POST',
    body: JSON.stringify(regionId != null ? { regionId } : {}),
  });
}
