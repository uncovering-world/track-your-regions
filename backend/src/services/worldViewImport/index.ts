/**
 * WorldView Import Service
 *
 * Manages importing region hierarchies into WorldViews
 * and matching regions to GADM divisions at the country level.
 */

import { pool } from '../../db/index.js';
import { importTree } from './importer.js';
import type { ImportTreeOptions } from './importer.js';
import { matchCountryLevel, matchHierarchical } from './matcher.js';
import type { ImportTreeNode, ImportProgress, MatchingPolicy } from './types.js';
import { createInitialProgress } from './types.js';
import { defaultMatchingPolicy, type ImportSourceType } from './sourceTypes.js';
import { buildBaseLayerTree } from './baseLayerImporter.js';

export type { ImportTreeNode, ImportProgress, MatchSuggestion, MatchingPolicy } from './types.js';
export { matchCountryLevel } from './matcher.js';
export { matchChildrenAsCountries } from './matcherGrouping.js';

/** In-memory progress map, keyed by operation ID */
const runningImports = new Map<string, ImportProgress>();

/** Auto-incrementing operation ID */
let nextOpId = 1;

/**
 * Reserve a new import operation slot synchronously, with no `await` anywhere
 * in between creating it and registering it in `runningImports`. Callers that
 * do their own async setup (e.g. `startBaseLayerImport` building its tree)
 * must call this *before* their first `await`, so a concurrent request's
 * "is one already running" check (`getLatestImportStatus`) can never land in
 * the gap between deciding to start an import and that import registering.
 * Mirrors the pattern in
 * backend/src/controllers/worldView/computationProgress.ts.
 */
function reserveImportSlot(): { opId: string; progress: ImportProgress } {
  const opId = `wv-import-${nextOpId++}`;
  const progress = createInitialProgress();
  runningImports.set(opId, progress);
  return { opId, progress };
}

/** Options for starting an import */
export interface StartImportOptions {
  matchingPolicy?: MatchingPolicy;
  sourceType?: ImportSourceType;
  source?: string;
  description?: string;
}

/**
 * Start a WorldView import (background operation).
 * Returns immediately with an operation ID for progress polling.
 */
export function startImport(
  jsonData: ImportTreeNode,
  name: string,
  options: StartImportOptions = {},
): string {
  const { opId, progress } = reserveImportSlot();

  console.log(`[WV Import] Starting import ${opId}: name="${name}", root children=${jsonData.children?.length ?? 0}, policy=${options.matchingPolicy ?? 'country-based'}`);

  // Fire and forget — runs in background
  runImport(opId, jsonData, name, progress, options).catch((err) => {
    // nosemgrep: javascript.lang.security.audit.unsafe-formatstring.unsafe-formatstring -- opId is generated here as wv-import-<counter>
    console.error(`[WV Import] Import error for ${opId}:`, err);
  });

  return opId;
}

/** Options for starting a base layer import */
export interface BaseLayerImportOptions {
  /** World view name. */
  name: string;
  /** Provider label stored as world_views.source, e.g. the dataset and version. */
  providerLabel: string;
  /** Deepest division level to mirror. */
  maxDepth: number;
}

/**
 * Start an import that mirrors the administrative base layer.
 *
 * Deliberately thin: the tree is built from the base layer, then handed to the
 * ordinary import pipeline, which imports it and runs the matcher over it. The
 * base layer gets no privileged path — that is what makes this import a test of
 * the generic one.
 *
 * The slot is reserved synchronously, before `buildBaseLayerTree` is awaited,
 * rather than delegating to `startImport` (which only registers afterwards).
 * `startBaseLayerImportEndpoint` checks `getLatestImportStatus` for an active
 * import before calling this function, with no `await` of its own in between;
 * reserving here first is what makes that check race-free for a second,
 * concurrent request instead of a check the tree build could run straight
 * past.
 *
 * That reservation must not outlive a failed build, though. buildBaseLayerTree
 * can reject (its own orphaned-parent invariant, the statement timeout a
 * deep recursive CTE can hit, any pool error), and if it does, the catch
 * below removes the slot before rethrowing — never leaves it in a terminal
 * state — so getLatestImportStatus() goes back to reporting nothing running.
 * Left in place, a failed slot would stay 'importing' forever and the 409
 * guard in startBaseLayerImportEndpoint and startWorldViewImport would
 * refuse every import after it until the process restarts.
 */
export async function startBaseLayerImport(options: BaseLayerImportOptions): Promise<string> {
  const { opId, progress } = reserveImportSlot();

  let tree: ImportTreeNode;
  try {
    tree = await buildBaseLayerTree({ maxDepth: options.maxDepth });
  } catch (err) {
    runningImports.delete(opId);
    throw err;
  }

  console.log(`[WV Import] Starting base layer import ${opId}: name="${options.name}", root children=${tree.children?.length ?? 0}`);

  // Fire and forget, reusing the slot reserved above — not startImport, which
  // would reserve a second one.
  runImport(opId, tree, options.name, progress, {
    // Derived, not hardcoded: the policy belongs to the shape of the source's
    // tree, and one place decides that for every entry point (ADR-0019).
    matchingPolicy: defaultMatchingPolicy('base_layer'),
    sourceType: 'base_layer',
    source: options.providerLabel,
    description: `Mirror of the administrative base layer (${options.providerLabel}), depth ${options.maxDepth}`,
  }).catch((err) => {
    // nosemgrep: javascript.lang.security.audit.unsafe-formatstring.unsafe-formatstring -- opId is generated here as wv-import-<counter>
    console.error(`[WV Import] Import error for ${opId}:`, err);
  });

  return opId;
}

/**
 * Get the most recent import status (for simple polling without tracking opId).
 */
export function getLatestImportStatus(): { opId: string; progress: ImportProgress } | null {
  let latest: { opId: string; progress: ImportProgress } | null = null;
  for (const [opId, progress] of runningImports) {
    latest = { opId, progress };
  }
  return latest;
}

/**
 * Cancel a running import.
 */
export function cancelImport(opId?: string): boolean {
  if (opId) {
    const progress = runningImports.get(opId);
    if (progress && (progress.status === 'importing' || progress.status === 'matching')) {
      progress.cancel = true;
      return true;
    }
    return false;
  }
  // Cancel any running import
  for (const progress of runningImports.values()) {
    if (progress.status === 'importing' || progress.status === 'matching') {
      progress.cancel = true;
      return true;
    }
  }
  return false;
}

/**
 * Dispatch to the policy's matcher. `'none'` never reaches here — the caller
 * short-circuits it before the matching phase, since it also skips the
 * bookkeeping this path does afterwards.
 *
 * Exported so the re-match path runs the same dispatch as the import path. They
 * diverged before: re-match called the country matcher directly, so a world view
 * imported under one policy was silently re-matched under another.
 */
export async function runMatchingPolicy(
  policy: Exclude<MatchingPolicy, 'none'>,
  worldViewId: number,
  progress: ImportProgress,
): Promise<void> {
  if (policy === 'hierarchical') {
    await matchHierarchical(worldViewId, progress);
    return;
  }
  await matchCountryLevel(worldViewId, progress);
}

/** Internal: run the full import + match pipeline */
async function runImport(
  opId: string,
  tree: ImportTreeNode,
  name: string,
  progress: ImportProgress,
  options: StartImportOptions = {},
): Promise<void> {
  const thisProgress = progress;
  const startTime = Date.now();
  const matchingPolicy = options.matchingPolicy ?? 'country-based';
  const importOptions: ImportTreeOptions = {
    sourceType: options.sourceType,
    source: options.source,
    description: options.description,
  };

  try {
    // Phase 1: Import tree into WorldView
    console.log(`[WV Import] ${opId} Phase 1: Importing tree into WorldView...`);
    const worldViewId = await importTree(tree, name, progress, importOptions);
    const phase1Duration = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`[WV Import] ${opId} Phase 1 complete: ${progress.createdRegions} regions created in ${phase1Duration}s (worldViewId=${worldViewId})`);

    if (progress.cancel) {
      console.log(`[WV Import] ${opId} Cancelled after phase 1`);
      return;
    }

    // Phase 2: Match countries to GADM (skip if policy is 'none')
    if (matchingPolicy === 'none') {
      // Mark import run as ready for review (no matching phase)
      await pool.query(
        `UPDATE import_runs SET status = 'reviewing', completed_at = NOW()
         WHERE world_view_id = $1 AND status = 'matching'`,
        [worldViewId],
      );
      progress.status = 'complete';
      progress.statusMessage = `Import complete: ${progress.createdRegions} regions created (matching skipped)`;
      console.log(`[WV Import] ${opId} Complete (no matching): ${progress.createdRegions} regions`);
    } else {
      const phase2Start = Date.now();
      console.log(`[WV Import] ${opId} Phase 2: Matching to GADM (policy=${matchingPolicy})...`);
      await runMatchingPolicy(matchingPolicy, worldViewId, progress);
      const phase2Duration = ((Date.now() - phase2Start) / 1000).toFixed(1);

      if (!progress.cancel) {
        // Mark import run as ready for admin review
        await pool.query(
          `UPDATE import_runs SET status = 'reviewing', completed_at = NOW()
           WHERE world_view_id = $1 AND status = 'matching'`,
          [worldViewId],
        );
        progress.status = 'complete';
        const totalDuration = ((Date.now() - startTime) / 1000).toFixed(1);
        // Same reason as the re-match path: only the country policy fills the
        // country-named counters, so only it can be summarised in their terms.
        // Rebuilding this sentence for every policy overwrote a base-layer
        // import's own accurate summary with "0 countries matched (0 with
        // subdivisions), 0 unmatched leaves", and this string is the only
        // completion signal the panel shows — the chips that would contradict it
        // are gated on `> 0` and stay hidden.
        progress.statusMessage = matchingPolicy === 'country-based'
          ? `Import complete: ${progress.createdRegions} regions, ${progress.countriesMatched} countries matched (${progress.subdivisionsDrilled} with subdivisions), ${progress.noCandidates} unmatched leaves`
          : `Import complete: ${progress.createdRegions} regions. ${progress.statusMessage}`;
        console.log(`[WV Import] ${opId} Complete in ${totalDuration}s (phase2=${phase2Duration}s): ${progress.statusMessage}`);
      } else {
        console.log(`[WV Import] ${opId} Cancelled during phase 2`);
      }
    }
  } catch (err) {
    progress.status = 'failed';
    progress.statusMessage = `Import failed: ${err instanceof Error ? err.message : String(err)}`;
    // nosemgrep: javascript.lang.security.audit.unsafe-formatstring.unsafe-formatstring -- opId is generated here as wv-import-<counter> and the elapsed time is a number
    console.error(`[WV Import] Import ${opId} failed after ${((Date.now() - startTime) / 1000).toFixed(1)}s:`, err);
  } finally {
    // Clean up after 5 minutes (keep for polling)
    setTimeout(() => {
      if (runningImports.get(opId) === thisProgress) {
        runningImports.delete(opId);
      }
    }, 300_000);
  }
}
