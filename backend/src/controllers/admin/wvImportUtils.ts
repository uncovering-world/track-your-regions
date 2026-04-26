/**
 * WorldView Import Shared Utilities
 *
 * Shared types and helpers used across multiple WV import controller files.
 */

import { pool } from '../../db/index.js';
import { computeGeoSimilarityForRegion } from '../../services/worldViewImport/geoshapeCache.js';

// =============================================================================
// Undo infrastructure
// =============================================================================

export interface ImportStateSnapshot {
  region_id: number;
  match_status: string;
  needs_manual_fix: boolean;
  fix_note: string | null;
  source_url: string | null;
  source_external_id: string | null;
  region_map_url: string | null;
  map_image_reviewed: boolean;
  import_run_id: number | null;
}

export interface SuggestionSnapshot {
  region_id: number;
  division_id: number;
  name: string;
  path: string | null;
  score: number;
  rejected: boolean;
  geo_similarity: number | null;
}

export interface UndoEntry {
  operation: 'dismiss-children' | 'handle-as-grouping' | 'smart-flatten' | 'collapse-to-parent' | 'auto-resolve-children' | 'prune-to-leaves';
  regionId: number;
  timestamp: number;
  // Import state snapshots
  parentImportState: ImportStateSnapshot | null;
  parentMembers: Array<{ region_id: number; division_id: number }>;
  descendantRegions: Array<{
    id: number;
    name: string;
    parent_region_id: number | null;
    is_leaf: boolean;
    world_view_id: number;
  }>;
  descendantImportStates: ImportStateSnapshot[];
  descendantSuggestions: SuggestionSnapshot[];
  descendantMembers: Array<{ region_id: number; division_id: number }>;
  childSnapshots: Array<{
    regionId: number;
    importState: ImportStateSnapshot | null;
    suggestions: SuggestionSnapshot[];
    members: Array<{ region_id: number; division_id: number }>;
  }>;
}

/** One undo entry per world view (last operation only) */
export const undoEntries = new Map<number, UndoEntry>();

// =============================================================================
// Geo similarity helper for individual match endpoints
// =============================================================================

/**
 * After an individual search/match endpoint adds suggestions, compute geo similarity
 * if the region now has multiple non-rejected suggestions.
 */
export async function computeGeoSimilarityIfNeeded(regionId: number): Promise<void> {
  const sugResult = await pool.query(
    `SELECT division_id AS "divisionId" FROM region_match_suggestions WHERE region_id = $1 AND rejected = false`,
    [regionId],
  );
  if (sugResult.rows.length <= 1) return;

  const client = await pool.connect();
  try {
    await computeGeoSimilarityForRegion(client, regionId, sugResult.rows as Array<{ divisionId: number }>);
  } finally {
    client.release();
  }
}
