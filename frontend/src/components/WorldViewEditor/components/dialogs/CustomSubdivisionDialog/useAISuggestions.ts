/**
 * Hook: AI suggestion operations (single ask, batch process, auto-assign, manual assign).
 */

import { useState, useCallback } from 'react';
import {
  suggestGroupForRegion,
  suggestGroupsForMultipleRegions,
} from '@/api';
import type { RegionMember } from '@/types';
import type { SubdivisionGroup } from './types';
import type { UsageStats, LastOperation, RegionSuggestion } from './aiAssistTypes';

export type EscalationLevel = 'fast' | 'reasoning' | 'reasoning_search';

interface UseAISuggestionsOptions {
  selectedRegionName: string;
  worldViewDescription?: string;
  worldViewSource?: string;
  groupNames: string[];
  groupDescriptions: Record<string, string>;
  unassignedDivisions: RegionMember[];
  setUnassignedDivisions: React.Dispatch<React.SetStateAction<RegionMember[]>>;
  subdivisionGroups: SubdivisionGroup[];
  setSubdivisionGroups: React.Dispatch<React.SetStateAction<SubdivisionGroup[]>>;
  suggestions: Map<number, RegionSuggestion>;
  setSuggestions: React.Dispatch<React.SetStateAction<Map<number, RegionSuggestion>>>;
  aiAvailable: boolean | null;
  currentModel: string;
  // Stats
  setSingleRequestStats: React.Dispatch<React.SetStateAction<UsageStats>>;
  setBatchRequestStats: React.Dispatch<React.SetStateAction<UsageStats>>;
  setLastOperation: React.Dispatch<React.SetStateAction<LastOperation | null>>;
}

export function useAISuggestions({
  selectedRegionName,
  worldViewDescription,
  worldViewSource,
  groupNames,
  groupDescriptions,
  unassignedDivisions,
  setUnassignedDivisions,
  subdivisionGroups,
  setSubdivisionGroups,
  suggestions,
  setSuggestions,
  aiAvailable,
  currentModel,
  setSingleRequestStats,
  setBatchRequestStats,
  setLastOperation,
}: UseAISuggestionsOptions) {
  const [batchProcessing, setBatchProcessing] = useState(false);
  const [autoAssignCount, setAutoAssignCount] = useState(0);
  const [quotaError, setQuotaError] = useState<string | null>(null);
  const [forceReprocess, setForceReprocess] = useState(false);
  const [escalationLevel, setEscalationLevel] = useState<EscalationLevel>('fast');
  const [useWebSearch, setUseWebSearch] = useState(false);

  const effectiveWebSearch = escalationLevel === 'reasoning_search' || useWebSearch;

  const hasDescriptions = Object.keys(groupDescriptions).length > 0;

  // Ask AI for a single region
  const askAI = useCallback(async (division: RegionMember, overrideEscalation?: EscalationLevel) => {
    if (!aiAvailable || groupNames.length === 0 || quotaError) return;

    const useLevel = overrideEscalation || escalationLevel;
    const divisionKey = division.memberRowId || division.id;
    setSuggestions(prev => new Map(prev).set(divisionKey, {
      division,
      suggestion: null,
      loading: true,
      error: null,
    }));

    try {
      const regionPath = division.path || `${selectedRegionName} > ${division.name}`;
      const suggestion = await suggestGroupForRegion(
        regionPath,
        division.name,
        groupNames,
        selectedRegionName,
        hasDescriptions ? groupDescriptions : undefined,
        useLevel === 'reasoning_search' || useWebSearch,
        worldViewSource,
        useLevel
      );

      setSuggestions(prev => new Map(prev).set(divisionKey, {
        division,
        suggestion,
        loading: false,
        error: null,
      }));

      // Track single request usage
      if (suggestion.usage) {
        const tokens = suggestion.usage.totalTokens;
        const inputCost = suggestion.usage.cost?.inputCost ?? 0;
        const outputCost = suggestion.usage.cost?.outputCost ?? 0;
        const webSearchCost = suggestion.usage.cost?.webSearchCost ?? 0;
        const totalCost = suggestion.usage.cost?.totalCost ?? 0;

        setSingleRequestStats(prev => ({
          tokens: prev.tokens + tokens,
          inputCost: prev.inputCost + inputCost,
          outputCost: prev.outputCost + outputCost,
          webSearchCost: (prev.webSearchCost || 0) + webSearchCost,
          totalCost: prev.totalCost + totalCost,
          requests: prev.requests + 1,
          regionsProcessed: (prev.regionsProcessed || 0) + 1,
        }));

        setLastOperation({
          type: 'single',
          tokens,
          inputCost,
          outputCost,
          webSearchCost,
          totalCost,
          regionsCount: 1,
          model: suggestion.usage.model || currentModel,
          timestamp: new Date(),
        });
      }
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      if (errorMessage.includes('hamsters') || errorMessage.includes('quota') || errorMessage.includes('429')) {
        setQuotaError(errorMessage);
      }

      setSuggestions(prev => new Map(prev).set(divisionKey, {
        division,
        suggestion: null,
        loading: false,
        error: errorMessage,
      }));
    }
  }, [aiAvailable, groupNames, quotaError, escalationLevel, useWebSearch, selectedRegionName,
      groupDescriptions, hasDescriptions, worldViewSource, currentModel,
      setSuggestions, setSingleRequestStats, setLastOperation]);

  // Batch process all unassigned divisions
  const batchProcess = useCallback(async () => {
    if (!aiAvailable || groupNames.length === 0 || unassignedDivisions.length === 0 || quotaError) return;

    // Filter out divisions that already have suggestions (unless force is enabled)
    const divisionsToProcess = forceReprocess
      ? unassignedDivisions
      : unassignedDivisions.filter(div => {
          const divisionKey = div.memberRowId || div.id;
          const existing = suggestions.get(divisionKey);
          return !existing?.suggestion;
        });

    if (divisionsToProcess.length === 0) {
      console.log('All divisions already have AI suggestions');
      return;
    }

    setBatchProcessing(true);

    try {
      const regions = divisionsToProcess.map(div => ({
        path: '',
        name: div.name,
      }));

      const result = await suggestGroupsForMultipleRegions(
        regions,
        groupNames,
        selectedRegionName,
        worldViewDescription,
        worldViewSource,
        effectiveWebSearch,
        hasDescriptions ? groupDescriptions : undefined
      );

      // Track batch usage
      if (result.usage) {
        const tokens = result.usage.totalTokens;
        const inputCost = result.usage.cost?.inputCost ?? 0;
        const outputCost = result.usage.cost?.outputCost ?? 0;
        const webSearchCost = result.usage.cost?.webSearchCost ?? 0;
        const totalCost = result.usage.cost?.totalCost ?? 0;
        const actualRequests = result.apiRequestsCount || 1;

        setBatchRequestStats(prev => ({
          tokens: prev.tokens + tokens,
          inputCost: prev.inputCost + inputCost,
          outputCost: prev.outputCost + outputCost,
          webSearchCost: (prev.webSearchCost || 0) + webSearchCost,
          totalCost: prev.totalCost + totalCost,
          requests: prev.requests + actualRequests,
          regionsProcessed: (prev.regionsProcessed || 0) + regions.length,
        }));

        setLastOperation({
          type: 'batch',
          tokens,
          inputCost,
          outputCost,
          webSearchCost,
          totalCost,
          regionsCount: regions.length,
          model: result.usage.model || currentModel,
          timestamp: new Date(),
        });
      }

      // Update suggestions map
      const newSuggestions = new Map(suggestions);
      for (const div of divisionsToProcess) {
        const suggestion = result.suggestions[div.name];
        if (suggestion) {
          const divisionKey = div.memberRowId || div.id;
          newSuggestions.set(divisionKey, {
            division: div,
            suggestion,
            loading: false,
            error: null,
          });
        }
      }
      setSuggestions(newSuggestions);
    } catch (error: unknown) {
      console.error('Batch processing failed:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      if (errorMessage.includes('hamsters') || errorMessage.includes('quota') || errorMessage.includes('429')) {
        setQuotaError(errorMessage);
      }
    } finally {
      setBatchProcessing(false);
    }
  }, [aiAvailable, groupNames, unassignedDivisions, quotaError, forceReprocess,
      suggestions, selectedRegionName, worldViewDescription, worldViewSource,
      effectiveWebSearch, groupDescriptions, hasDescriptions, currentModel,
      setSuggestions, setBatchRequestStats, setLastOperation]);

  // Auto-assign all high-confidence suggestions
  const autoAssignHighConfidence = useCallback(() => {
    let assignedCount = 0;

    const newUnassigned = [...unassignedDivisions];
    const newGroups = subdivisionGroups.map(g => ({ ...g, members: [...g.members] }));

    for (const [divisionKey, data] of suggestions) {
      if (
        data.suggestion?.confidence === 'high' &&
        data.suggestion.suggestedGroup &&
        !data.suggestion.shouldSplit
      ) {
        const divIndex = newUnassigned.findIndex(
          d => (d.memberRowId || d.id) === divisionKey
        );
        if (divIndex === -1) continue;

        const division = newUnassigned[divIndex];

        const groupIndex = newGroups.findIndex(
          g => g.name === data.suggestion!.suggestedGroup
        );
        if (groupIndex === -1) continue;

        newUnassigned.splice(divIndex, 1);
        newGroups[groupIndex].members.push(division);
        assignedCount++;
      }
    }

    if (assignedCount > 0) {
      setUnassignedDivisions(newUnassigned);
      setSubdivisionGroups(newGroups);
      setAutoAssignCount(assignedCount);
      setTimeout(() => setAutoAssignCount(0), 3000);
    }
  }, [unassignedDivisions, subdivisionGroups, suggestions, setUnassignedDivisions, setSubdivisionGroups]);

  // Assign a single division to a group
  const assignToGroup = useCallback((division: RegionMember, groupName: string) => {
    const divisionKey = division.memberRowId || division.id;

    const newUnassigned = unassignedDivisions.filter(
      d => (d.memberRowId || d.id) !== divisionKey
    );

    const newGroups = subdivisionGroups.map(g => ({
      ...g,
      members: g.members.filter(m => (m.memberRowId || m.id) !== divisionKey),
    }));

    const targetGroupIndex = newGroups.findIndex(g => g.name === groupName);
    if (targetGroupIndex !== -1) {
      newGroups[targetGroupIndex].members.push(division);
    }

    setUnassignedDivisions(newUnassigned);
    setSubdivisionGroups(newGroups);
  }, [unassignedDivisions, subdivisionGroups, setUnassignedDivisions, setSubdivisionGroups]);

  // Count high-confidence suggestions for auto-assign button
  const highConfidenceCount = Array.from(suggestions.values()).filter(
    s => s.suggestion?.confidence === 'high' &&
         s.suggestion.suggestedGroup &&
         !s.suggestion.shouldSplit &&
         unassignedDivisions.some(d => (d.memberRowId || d.id) === (s.division.memberRowId || s.division.id))
  ).length;

  // Count divisions to process (respects forceReprocess flag)
  const divisionsToProcessCount = forceReprocess
    ? unassignedDivisions.length
    : unassignedDivisions.filter(div => {
        const divisionKey = div.memberRowId || div.id;
        return !suggestions.get(divisionKey)?.suggestion;
      }).length;

  return {
    batchProcessing,
    autoAssignCount,
    quotaError,
    setQuotaError,
    forceReprocess,
    setForceReprocess,
    escalationLevel,
    setEscalationLevel,
    useWebSearch,
    setUseWebSearch,
    effectiveWebSearch,
    askAI,
    batchProcess,
    autoAssignHighConfidence,
    assignToGroup,
    highConfidenceCount,
    divisionsToProcessCount,
  };
}
