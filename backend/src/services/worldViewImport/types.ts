/**
 * Types for WorldView import and matching
 */

import type { MatchStatus } from '../../api/responses/worldViewImport.js';

/** A node in the import region hierarchy JSON */
export interface ImportTreeNode {
  name: string;
  regionMapUrl?: string;
  mapImageCandidates?: string[];
  wikidataId?: string;
  sourceUrl?: string;
  warnings?: string[];
  children: ImportTreeNode[];
}

/**
 * Matching policy determines how regions are auto-matched to GADM divisions.
 *
 * - `country-based` (default) — anchor on country names found anywhere in the
 *   tree, then push matched countries down a level. Correct for sources whose
 *   nodes may group several divisions, e.g. Wikivoyage's "Benelux".
 * - `hierarchical` — descend the division hierarchy alongside the import tree,
 *   resolving each node among the divisions under its nearest resolved ancestor.
 *   Correct for sources that mirror the hierarchy, e.g. a base-layer mirror.
 * - `none` — import without matching at all.
 *
 * See ADR-0019 for why this is a policy choice rather than one algorithm.
 */
export type MatchingPolicy = 'country-based' | 'hierarchical' | 'none';

// A region's match status is what the review's tree answers, so its type is
// that answer's schema (ADR-0066).
export type { MatchStatus };

/** A candidate GADM division for matching */
export interface MatchSuggestion {
  divisionId: number;
  name: string;
  path: string;
  score: number;
}

/**
 * One region's match outcome, as every policy produces it and every writer
 * consumes it: the status to record, the candidates to offer for review, and the
 * division to bind if the policy resolved one.
 */
export interface MatchUpdate {
  id: number;
  matchStatus: MatchStatus;
  suggestions: MatchSuggestion[];
  divisionId?: number;
}

/** Import progress tracked in memory */
export interface ImportProgress {
  cancel: boolean;
  status: 'importing' | 'matching' | 'complete' | 'failed' | 'cancelled';
  statusMessage: string;
  createdRegions: number;
  totalRegions: number;
  matchedRegions: number;
  totalCountries: number;
  countriesMatched: number;
  subdivisionsDrilled: number;
  noCandidates: number;
  worldViewId: number | null;
}

/** Progress for AI re-matching (separate from import progress) */
export interface AIMatchProgress {
  status: 'running' | 'complete' | 'failed' | 'cancelled';
  statusMessage: string;
  totalLeaves: number;
  processedLeaves: number;
  improved: number;
  totalCost: number;
  cancel: boolean;
}

/** Result from a single AI match attempt */
export interface AIMatchResult {
  regionId: number;
  divisionId: number | null;
  divisionName: string | null;
  alternativeNames: string[];
  /** Additional divisions when a region spans multiple GADM entries (e.g., Donbas = Donetsk + Luhansk) */
  additionalDivisions: Array<{ name: string; alternativeNames: string[] }>;
  confidence: 'high' | 'medium' | 'low';
  reasoning: string;
}

export function createInitialProgress(): ImportProgress {
  return {
    cancel: false,
    status: 'importing',
    statusMessage: 'Starting import...',
    createdRegions: 0,
    totalRegions: 0,
    matchedRegions: 0,
    totalCountries: 0,
    countriesMatched: 0,
    subdivisionsDrilled: 0,
    noCandidates: 0,
    worldViewId: null,
  };
}
