/**
 * Shared types for AI Assist Tab and related components.
 */

import type { RegionMember } from '@/types';
import type { GroupSuggestion } from '@/api';

/** Cumulative usage stats for a session (single or batch). */
export interface UsageStats {
  tokens: number;
  inputCost: number;
  outputCost: number;
  webSearchCost: number;
  totalCost: number;
  requests: number;
  regionsProcessed: number;
}

/** Details of the most recent AI operation. */
export interface LastOperation {
  type: 'single' | 'batch';
  tokens: number;
  inputCost: number;
  outputCost: number;
  webSearchCost: number;
  totalCost: number;
  regionsCount: number;
  model: string;
  timestamp: Date;
}

/** Per-division suggestion state. */
export interface RegionSuggestion {
  division: RegionMember;
  suggestion: GroupSuggestion | null;
  loading: boolean;
  error: string | null;
}
