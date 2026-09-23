/**
 * AI API Client for region grouping suggestions
 */

import type {
  AIModels, AIStatus, BatchSuggestions, EscalationLevel, GroupDescriptions, GroupSuggestion, ModelSet,
  WebSearchModelSet,
} from '@tyr/shared/api';
import { authFetchJson, API_URL } from './fetchUtils.js';

// What every call here answers is declared once, as a backend schema (ADR-0066),
// and generated into `@tyr/shared/api`. Passed on from here, so a component
// imports a call's answer from the module of the call.
export type {
  AIModel, AIModels, AIStatus, BatchGroupSuggestion, BatchSuggestions, Confidence, EscalationLevel,
  GroupDescriptions, GroupSuggestion, ModelSet, TokenUsage, WebSearchModelSet,
} from '@tyr/shared/api';

/**
 * Check if AI features are available
 */
export async function checkAIStatus(): Promise<AIStatus> {
  return authFetchJson<AIStatus>(`${API_URL}/api/ai/status`);
}

/**
 * Get available models
 */
export async function getAIModels(): Promise<AIModels> {
  return authFetchJson<AIModels>(`${API_URL}/api/ai/models`);
}

/**
 * Set the current AI model
 */
export async function setAIModel(modelId: string): Promise<ModelSet> {
  return authFetchJson<ModelSet>(`${API_URL}/api/ai/models`, {
    method: 'POST',
    body: JSON.stringify({ modelId }),
  });
}

/**
 * Set the web search AI model
 */
export async function setWebSearchModel(modelId: string): Promise<WebSearchModelSet> {
  return authFetchJson<WebSearchModelSet>(`${API_URL}/api/ai/models/web-search`, {
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
): Promise<BatchSuggestions> {
  return authFetchJson<BatchSuggestions>(`${API_URL}/api/ai/suggest-groups-batch`, {
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
): Promise<GroupDescriptions> {
  return authFetchJson<GroupDescriptions>(`${API_URL}/api/ai/generate-group-descriptions`, {
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
