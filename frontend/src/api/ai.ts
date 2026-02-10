/**
 * AI API Client for region grouping suggestions
 */

import { authFetchJson, API_URL } from './fetchUtils.js';

/**
 * Available AI models
 */
export interface AIModel {
  id: string;
  name: string;
  description: string;
}

/**
 * Token usage information from API call
 */
export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cost: {
    inputCost: number;
    outputCost: number;
    webSearchCost: number;
    totalCost: number;
  };
  model: string;
}

/**
 * Escalation level for AI requests
 */
export type EscalationLevel = 'fast' | 'reasoning' | 'reasoning_search';

/**
 * Response from AI suggesting group assignment
 */
export interface GroupSuggestion {
  /** The suggested group name (null if no match or split needed) */
  suggestedGroup: string | null;
  /** Confidence level: 'high' (auto-assign), 'medium' (suggest), 'low' (uncertain) */
  confidence: 'high' | 'medium' | 'low';
  /** Whether the region should be split across multiple groups */
  shouldSplit: boolean;
  /** If shouldSplit is true, list of groups to split into */
  splitGroups?: string[];
  /** AI's reasoning for the suggestion */
  reasoning: string;
  /** Any additional geographic or cultural context */
  context?: string;
  /** URLs of sources used (when web search is enabled) */
  sources?: string[];
  /** Token usage for this request */
  usage?: TokenUsage;
  /** The escalation level used for this response */
  escalationLevel?: EscalationLevel;
  /** If true, AI recommends escalating to next level for better accuracy */
  needsEscalation?: boolean;
}

/**
 * Batch suggestion result with usage info
 */
export interface BatchSuggestionResult {
  suggestions: Record<string, GroupSuggestion>;
  usage: TokenUsage;
  apiRequestsCount: number;
}

export interface AIStatusResponse {
  available: boolean;
  message: string;
  currentModel?: string;
  webSearchModel?: string;
  availableModels?: AIModel[];
  webSearchModels?: AIModel[];
}

/**
 * Check if AI features are available
 */
export async function checkAIStatus(): Promise<AIStatusResponse> {
  return authFetchJson<AIStatusResponse>(`${API_URL}/api/ai/status`);
}

/**
 * Get available models
 */
export async function getAIModels(): Promise<{
  currentModel: string;
  webSearchModel: string;
  availableModels: AIModel[];
  webSearchModels: AIModel[];
}> {
  return authFetchJson(`${API_URL}/api/ai/models`);
}

/**
 * Set the current AI model
 */
export async function setAIModel(modelId: string): Promise<{ success: boolean; currentModel: string }> {
  return authFetchJson(`${API_URL}/api/ai/models`, {
    method: 'POST',
    body: JSON.stringify({ modelId }),
  });
}

/**
 * Set the web search AI model
 */
export async function setWebSearchModel(modelId: string): Promise<{ success: boolean; webSearchModel: string }> {
  return authFetchJson(`${API_URL}/api/ai/models/web-search`, {
    method: 'POST',
    body: JSON.stringify({ modelId }),
  });
}

/**
 * Get AI suggestion for which group a region belongs to
 */
export async function suggestGroupForRegion(
  regionPath: string,
  regionName: string,
  availableGroups: string[],
  parentRegion: string,
  groupDescriptions?: Record<string, string>,
  useWebSearch?: boolean,
  worldViewSource?: string,
  escalationLevel?: EscalationLevel
): Promise<GroupSuggestion> {
  return authFetchJson<GroupSuggestion>(`${API_URL}/api/ai/suggest-group`, {
    method: 'POST',
    body: JSON.stringify({
      regionPath,
      regionName,
      availableGroups,
      parentRegion,
      groupDescriptions,
      useWebSearch,
      worldViewSource,
      escalationLevel,
    }),
  });
}

/**
 * Get AI suggestions for multiple regions at once
 */
export async function suggestGroupsForMultipleRegions(
  regions: Array<{ path: string; name: string }>,
  availableGroups: string[],
  parentRegion: string,
  worldViewDescription?: string,
  worldViewSource?: string,
  useWebSearch?: boolean,
  groupDescriptions?: Record<string, string>
): Promise<BatchSuggestionResult> {
  const data = await authFetchJson<{
    suggestions: Record<string, GroupSuggestion>;
    usage?: TokenUsage;
    apiRequestsCount?: number;
  }>(`${API_URL}/api/ai/suggest-groups-batch`, {
    method: 'POST',
    body: JSON.stringify({
      regions,
      availableGroups,
      parentRegion,
      worldViewDescription,
      worldViewSource,
      useWebSearch,
      groupDescriptions,
    }),
  });

  return {
    suggestions: data.suggestions,
    usage: data.usage || { promptTokens: 0, completionTokens: 0, totalTokens: 0, cost: { inputCost: 0, outputCost: 0, webSearchCost: 0, totalCost: 0 }, model: '' },
    apiRequestsCount: data.apiRequestsCount || 1,
  };
}

/**
 * Generate short descriptions for each group to help with classification
 */
export async function generateGroupDescriptions(
  groups: string[],
  parentRegion: string,
  worldViewDescription?: string,
  worldViewSource?: string,
  useWebSearch?: boolean
): Promise<{ descriptions: Record<string, string>; usage?: TokenUsage }> {
  return authFetchJson(`${API_URL}/api/ai/generate-group-descriptions`, {
    method: 'POST',
    body: JSON.stringify({
      groups,
      parentRegion,
      worldViewDescription,
      worldViewSource,
      useWebSearch,
    }),
  });
}
