/**
 * Shared module-level state for the WorldView Import controllers.
 *
 * State that's read or written by multiple domain controllers lives here
 * to avoid circular re-exports between the focused controllers and the
 * worldViewImportController barrel.
 *
 * Currently consumed by:
 * - wvImportTreeOpsController (dismissChildren)
 * - wvImportHierarchyController (undoLastOperation, in PR-15)
 * - wvImportFlattenController (handleAsGrouping, in PR-16)
 *
 * See ADR-0009 for the spine domain-split rationale.
 */

// =============================================================================
// Undo infrastructure
// =============================================================================

interface ImportStateSnapshot {
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

interface SuggestionSnapshot {
  region_id: number;
  division_id: number;
  name: string;
  path: string | null;
  score: number;
  rejected: boolean;
}

interface UndoEntry {
  operation: 'dismiss-children' | 'handle-as-grouping';
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

export type { ImportStateSnapshot, SuggestionSnapshot, UndoEntry };
