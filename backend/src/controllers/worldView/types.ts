/**
 * Shared types for World View controllers
 */

import type { Operation } from '../../services/operationProgress.js';

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
  /** The step the run is on, of the two, and how far through it (#1356). */
  operation: Operation;
}

/**
 * Store for tracking running computations by worldViewId
 */
export const runningComputations = new Map<number, ComputationProgress>();
