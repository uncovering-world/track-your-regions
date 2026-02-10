/**
 * Shared types for World View controllers
 */

/**
 * Progress tracking for background geometry computations
 */
export interface ComputationProgress {
  cancel: boolean;
  progress: number;
  total: number;
  status: string;
  computed: number;
  skipped: number;
  errors: number;
  currentGroup: string;
  currentMembers: number;
}

/**
 * Store for tracking running computations by worldViewId
 */
export const runningComputations = new Map<number, ComputationProgress>();
