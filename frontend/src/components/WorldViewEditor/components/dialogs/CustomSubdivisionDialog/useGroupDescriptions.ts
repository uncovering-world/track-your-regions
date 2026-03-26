/**
 * Hook: group description management (localStorage persistence, AI generation, editing).
 */

import { useState, useEffect, useCallback } from 'react';
import { generateGroupDescriptions } from '@/api';
import type { UsageStats } from './aiAssistTypes';

interface UseGroupDescriptionsOptions {
  regionId: number | undefined;
  regionName: string;
  groupNames: string[];
  worldViewDescription?: string;
  worldViewSource?: string;
  aiAvailable: boolean | null;
  setSingleRequestStats: React.Dispatch<React.SetStateAction<UsageStats>>;
  setQuotaError: (error: string | null) => void;
}

export function useGroupDescriptions({
  regionId,
  regionName,
  groupNames,
  worldViewDescription,
  worldViewSource,
  aiAvailable,
  setSingleRequestStats,
  setQuotaError,
}: UseGroupDescriptionsOptions) {
  const [groupDescriptions, setGroupDescriptions] = useState<Record<string, string>>({});
  const [generatingDescriptions, setGeneratingDescriptions] = useState(false);
  const [showDescriptions, setShowDescriptions] = useState(false);

  // LocalStorage key for group descriptions
  const descriptionsStorageKey = regionId ? `ai-group-descriptions-${regionId}` : null;

  // Load descriptions from localStorage on mount
  useEffect(() => {
    if (descriptionsStorageKey) {
      try {
        const saved = localStorage.getItem(descriptionsStorageKey);
        if (saved) {
          setGroupDescriptions(JSON.parse(saved));
        }
      } catch (e) {
        console.error('Failed to load group descriptions:', e);
      }
    }
  }, [descriptionsStorageKey]);

  // Save descriptions to localStorage when they change
  useEffect(() => {
    if (descriptionsStorageKey && Object.keys(groupDescriptions).length > 0) {
      try {
        localStorage.setItem(descriptionsStorageKey, JSON.stringify(groupDescriptions));
      } catch (e) {
        console.error('Failed to save group descriptions:', e);
      }
    }
  }, [groupDescriptions, descriptionsStorageKey]);

  // Generate descriptions using AI
  const handleGenerateDescriptions = useCallback(async (useWebSearch: boolean) => {
    if (!aiAvailable || groupNames.length === 0) return;

    setGeneratingDescriptions(true);
    try {
      const result = await generateGroupDescriptions(
        groupNames,
        regionName,
        worldViewDescription,
        worldViewSource,
        useWebSearch
      );

      setGroupDescriptions(result.descriptions);
      setShowDescriptions(true);

      // Track usage if available
      if (result.usage) {
        setSingleRequestStats(prev => ({
          tokens: prev.tokens + result.usage!.totalTokens,
          inputCost: prev.inputCost + (result.usage!.cost?.inputCost ?? 0),
          outputCost: prev.outputCost + (result.usage!.cost?.outputCost ?? 0),
          webSearchCost: (prev.webSearchCost || 0) + (result.usage!.cost?.webSearchCost ?? 0),
          totalCost: prev.totalCost + (result.usage!.cost?.totalCost ?? 0),
          requests: prev.requests + 1,
          regionsProcessed: prev.regionsProcessed,
        }));
      }
    } catch (error) {
      console.error('Failed to generate descriptions:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      if (errorMessage.includes('hamsters') || errorMessage.includes('quota')) {
        setQuotaError(errorMessage);
      }
    } finally {
      setGeneratingDescriptions(false);
    }
  }, [aiAvailable, groupNames, regionName, worldViewDescription, worldViewSource, setSingleRequestStats, setQuotaError]);

  // Update a single group description
  const handleDescriptionChange = useCallback((groupName: string, description: string) => {
    setGroupDescriptions(prev => ({
      ...prev,
      [groupName]: description,
    }));
  }, []);

  const toggleShowDescriptions = useCallback(() => {
    setShowDescriptions(prev => !prev);
  }, []);

  return {
    groupDescriptions,
    generatingDescriptions,
    showDescriptions,
    toggleShowDescriptions,
    handleGenerateDescriptions,
    handleDescriptionChange,
  };
}
