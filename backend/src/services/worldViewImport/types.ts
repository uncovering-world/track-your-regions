/**
 * Types for WorldView import and matching
 */

/** A node in the import region hierarchy JSON */
export interface ImportTreeNode {
  name: string;
  regionMapUrl?: string;
  mapImageCandidates?: string[];
  wikidataId?: string;
  children: ImportTreeNode[];
}

/** Matching policy determines how regions are auto-matched to GADM divisions */
export type MatchingPolicy = 'country-based' | 'none';

/** Match status for a region */
export type MatchStatus =
  | 'auto_matched'       // Region matched to a GADM division (region_member created)
  | 'children_matched'   // All children matched to GADM subdivisions (no direct assignment)
  | 'needs_review'       // Candidates found but no confident auto-match
  | 'no_candidates'      // No matching GADM division found
  | 'manual_matched'     // Manually accepted by admin
  | 'suggested';         // Non-leaf with candidates (legacy, not produced by new matcher)

/** A candidate GADM division for matching */
export interface MatchSuggestion {
  divisionId: number;
  name: string;
  path: string;
  score: number;
}

/**
 * Region import state stored in the region_import_state table.
 * Replaces the old metadata JSONB approach.
 */
export interface RegionImportState {
  regionId: number;
  importRunId: number | null;
  sourceUrl: string | null;
  sourceExternalId: string | null;
  matchStatus: MatchStatus | string;
  needsManualFix: boolean;
  fixNote: string | null;
  regionMapUrl: string | null;
  mapImageReviewed: boolean;
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
