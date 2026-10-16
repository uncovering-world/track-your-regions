/**
 * WorldView Import Shared Utilities
 *
 * Shared types and helpers used across multiple WV import controller files.
 */

import type { UndoOperation } from '../../api/responses/wvImportTreeOps.js';

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
  operation: UndoOperation;
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

