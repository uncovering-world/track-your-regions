/**
 * AI API Client for region grouping suggestions
 */

import type {
  AIModels, AIStatus, BatchSuggestions, EscalationLevel, GroupDescriptions, GroupSuggestion, ModelSet,
  WebSearchModelSet,
} from './client.generated';
import {
  getAiModels, getAiStatus, postAiGenerateGroupDescriptions, postAiModels, postAiModelsWebSearch,
  postAiSuggestGroup, postAiSuggestGroupsBatch,
} from './client.generated';

// What every call here answers is declared once, as a backend schema (ADR-0066),
// and generated into `client.generated.ts`. Passed on from here, so a component
// imports a call's answer from the module of the call.
export type {
  AIModel, AIModels, AIStatus, BatchGroupSuggestion, BatchSuggestions, Confidence, EscalationLevel,
  GroupDescriptions, GroupSuggestion, ModelSet, TokenUsage, WebSearchModelSet,
} from './client.generated';

/**
 * Check if AI features are available
 */
export async function checkAIStatus(): Promise<AIStatus> {
  return getAiStatus();
}

/**
 * Get available models
 */
export async function getAIModels(): Promise<AIModels> {
  return getAiModels();
}

/**
 * Set the current AI model
 */
export async function setAIModel(modelId: string): Promise<ModelSet> {
  return postAiModels({ modelId });
}

/**
 * Set the web search AI model
 */
export async function setWebSearchModel(modelId: string): Promise<WebSearchModelSet> {
  return postAiModelsWebSearch({ modelId });
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
  return postAiSuggestGroup({
    regionPath,
    regionName,
    availableGroups,
    parentRegion,
    groupDescriptions,
    useWebSearch,
    worldViewSource,
    escalationLevel,
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
  return postAiSuggestGroupsBatch({
    regions,
    availableGroups,
    parentRegion,
    worldViewDescription,
    worldViewSource,
    useWebSearch,
    groupDescriptions,
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
  return postAiGenerateGroupDescriptions({
    groups,
    parentRegion,
    worldViewDescription,
    worldViewSource,
    useWebSearch,
  });
}
