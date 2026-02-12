/**
 * Hook: usage stat helpers (totalStats, getPercentage, resetStats).
 */

import { useCallback, useMemo } from 'react';
import type { UsageStats, LastOperation } from './aiAssistTypes';

interface UseAIUsageTrackingOptions {
  singleRequestStats: UsageStats;
  setSingleRequestStats: React.Dispatch<React.SetStateAction<UsageStats>>;
  batchRequestStats: UsageStats;
  setBatchRequestStats: React.Dispatch<React.SetStateAction<UsageStats>>;
  setLastOperation: React.Dispatch<React.SetStateAction<LastOperation | null>>;
}

/** Create a zeroed-out UsageStats object. */
export const emptyStats = (): UsageStats => ({
  tokens: 0,
  inputCost: 0,
  outputCost: 0,
  webSearchCost: 0,
  totalCost: 0,
  requests: 0,
  regionsProcessed: 0,
});

/** Calculate percentage (safe for zero denominator). */
export const getPercentage = (part: number, total: number): string => {
  if (total === 0) return '0';
  return ((part / total) * 100).toFixed(0);
};

export function useAIUsageTracking({
  singleRequestStats,
  setSingleRequestStats,
  batchRequestStats,
  setBatchRequestStats,
  setLastOperation,
}: UseAIUsageTrackingOptions) {
  const totalStats = useMemo(() => ({
    tokens: singleRequestStats.tokens + batchRequestStats.tokens,
    inputCost: singleRequestStats.inputCost + batchRequestStats.inputCost,
    outputCost: singleRequestStats.outputCost + batchRequestStats.outputCost,
    webSearchCost: (singleRequestStats.webSearchCost || 0) + (batchRequestStats.webSearchCost || 0),
    totalCost: singleRequestStats.totalCost + batchRequestStats.totalCost,
    requests: singleRequestStats.requests + batchRequestStats.requests,
    regionsProcessed: (singleRequestStats.regionsProcessed || 0) + (batchRequestStats.regionsProcessed || 0),
  }), [singleRequestStats, batchRequestStats]);

  const resetStats = useCallback(() => {
    setSingleRequestStats(emptyStats());
    setBatchRequestStats(emptyStats());
    setLastOperation(null);
  }, [setSingleRequestStats, setBatchRequestStats, setLastOperation]);

  return { totalStats, resetStats };
}
