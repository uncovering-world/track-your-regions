/**
 * Wikivoyage Extraction Service
 *
 * Full pipeline: extract tree from Wikivoyage API → enrich with Wikidata IDs
 * → import into WorldView → match countries to GADM.
 *
 * Follows the same fire-and-forget pattern as worldViewImport/index.ts.
 */

import path from 'path';
import { existsSync, unlinkSync, statSync } from 'fs';
import { pool } from '../../db/index.js';
import type { ExtractionProgress, ExtractionConfig, TreeNode } from './types.js';
import { createInitialExtractionProgress } from './types.js';
import { WikivoyageFetcher } from './fetcher.js';
import { buildTree, countNodes, CONTINENTS } from './treeBuilder.js';
import { collectPageTitles, fetchWikidataIds, enrichWikidataIds } from './wikidataEnricher.js';
import { importTree } from '../worldViewImport/importer.js';
import { matchCountryLevel } from '../worldViewImport/matcher.js';
import { createInitialProgress as createImportProgress } from '../worldViewImport/types.js';

export type { ExtractionProgress, ExtractionConfig } from './types.js';

/** Default persistent cache path (follows same data/ pattern as image storage) */
const DEFAULT_CACHE_PATH = path.join(process.cwd(), 'data', 'cache', 'wikivoyage-cache.json');

/** Get cache file info (exists, size, modified time) */
export function getCacheInfo(): { exists: boolean; sizeBytes?: number; modifiedAt?: string } {
  try {
    if (existsSync(DEFAULT_CACHE_PATH)) {
      const stats = statSync(DEFAULT_CACHE_PATH);
      return {
        exists: true,
        sizeBytes: stats.size,
        modifiedAt: stats.mtime.toISOString(),
      };
    }
  } catch { /* ignore */ }
  return { exists: false };
}

/** In-memory progress map, keyed by operation ID */
const runningExtractions = new Map<string, ExtractionProgress>();

/** Auto-incrementing operation ID */
let nextOpId = 1;

/**
 * Start a Wikivoyage extraction (background operation).
 * Returns immediately with an operation ID for progress polling.
 *
 * @param config.useCache - If false, deletes cache file before starting (clean fetch)
 */
export function startExtraction(config: Partial<ExtractionConfig> & { useCache?: boolean } = {}): string {
  const cachePath = config.cachePath ?? DEFAULT_CACHE_PATH;

  // Clean fetch: delete existing cache if useCache is false
  if (config.useCache === false) {
    try {
      if (existsSync(cachePath)) {
        unlinkSync(cachePath);
        console.log(`[WV Extract] Deleted cache at ${cachePath} (clean fetch)`);
      }
    } catch (err) {
      console.warn(`[WV Extract] Failed to delete cache:`, err);
    }
  }

  const fullConfig: ExtractionConfig = {
    name: config.name ?? 'Wikivoyage Regions',
    maxDepth: config.maxDepth ?? 10,
    cachePath,
  };

  const opId = `wv-extract-${nextOpId++}`;
  const progress = createInitialExtractionProgress();
  runningExtractions.set(opId, progress);

  console.log(`[WV Extract] Starting extraction ${opId}: name="${fullConfig.name}", maxDepth=${fullConfig.maxDepth}`);

  // Fire and forget
  runExtraction(opId, fullConfig, progress).catch((err) => {
    console.error(`[WV Extract] Extraction error for ${opId}:`, err);
  });

  return opId;
}

/**
 * Get the status of a running or recently-completed extraction.
 */
export function getExtractionStatus(opId: string): ExtractionProgress | null {
  return runningExtractions.get(opId) ?? null;
}

/**
 * Get the most recent extraction status (for simple polling without tracking opId).
 */
export function getLatestExtractionStatus(): { opId: string; progress: ExtractionProgress } | null {
  let latest: { opId: string; progress: ExtractionProgress } | null = null;
  for (const [opId, progress] of runningExtractions) {
    latest = { opId, progress };
  }
  return latest;
}

/**
 * Cancel a running extraction.
 */
export function cancelExtraction(opId?: string): boolean {
  if (opId) {
    const progress = runningExtractions.get(opId);
    if (progress && !isTerminalStatus(progress.status)) {
      progress.cancel = true;
      return true;
    }
    return false;
  }
  // Cancel any running extraction
  for (const progress of runningExtractions.values()) {
    if (!isTerminalStatus(progress.status)) {
      progress.cancel = true;
      return true;
    }
  }
  return false;
}

function isTerminalStatus(status: string): boolean {
  return status === 'complete' || status === 'failed' || status === 'cancelled';
}

/** Internal: run the full extraction → import → match pipeline */
async function runExtraction(
  opId: string,
  config: ExtractionConfig,
  progress: ExtractionProgress,
): Promise<void> {
  const thisProgress = progress;
  const startTime = Date.now();
  const fetcher = new WikivoyageFetcher(config.cachePath, progress);

  try {
    // ─── Phase 1: Extract tree from Wikivoyage ────────────────────────
    console.log(`[WV Extract] ${opId} Phase 1: Extracting tree from Wikivoyage...`);
    progress.status = 'extracting';
    progress.statusMessage = 'Fetching region hierarchy from Wikivoyage...';

    const trees: TreeNode[] = [];
    for (const continent of CONTINENTS) {
      if (progress.cancel) break;
      progress.statusMessage = `Extracting ${continent}...`;
      const tree = await buildTree(fetcher, continent, config.maxDepth, progress);
      if (tree !== 'self_ref' && tree !== 'missing') {
        trees.push(tree);
      }
    }

    if (progress.cancel) {
      progress.status = 'cancelled';
      progress.statusMessage = 'Extraction cancelled';
      console.log(`[WV Extract] ${opId} Cancelled during phase 1`);
      return;
    }

    // Wrap in a root node
    const rootTree: TreeNode = {
      name: 'World',
      children: trees,
    };
    const totalNodes = countNodes(rootTree) - 1; // -1 for root
    const phase1Duration = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(
      `[WV Extract] ${opId} Phase 1 complete: ${totalNodes} regions in ${phase1Duration}s ` +
      `(API=${progress.apiRequests}, cache=${progress.cacheHits})`,
    );

    // ─── Phase 2: Enrich with Wikidata IDs ────────────────────────────
    progress.status = 'enriching';
    progress.statusMessage = 'Fetching Wikidata IDs...';
    console.log(`[WV Extract] ${opId} Phase 2: Enriching with Wikidata IDs...`);

    const allTitles = collectPageTitles(rootTree);
    const wikidataMap = await fetchWikidataIds(fetcher, allTitles, progress);
    enrichWikidataIds(rootTree, wikidataMap);

    if (progress.cancel) {
      progress.status = 'cancelled';
      progress.statusMessage = 'Extraction cancelled during enrichment';
      console.log(`[WV Extract] ${opId} Cancelled during phase 2`);
      return;
    }

    const phase2Duration = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(
      `[WV Extract] ${opId} Phase 2 complete: ${wikidataMap.size}/${allTitles.size} Wikidata IDs found (${phase2Duration}s total)`,
    );

    // Save cache
    fetcher.save();

    // ─── Phase 3: Import into WorldView ───────────────────────────────
    progress.status = 'importing';
    progress.statusMessage = 'Importing into WorldView...';
    console.log(`[WV Extract] ${opId} Phase 3: Importing tree into WorldView...`);

    const importProgress = createImportProgress();
    const worldViewId = await importTree(rootTree, config.name, importProgress, {
      sourceType: 'wikivoyage',
      source: 'English Wikivoyage',
      description: `Imported from Wikivoyage region hierarchy (${totalNodes} regions)`,
    });

    // Forward import progress fields
    progress.createdRegions = importProgress.createdRegions;
    progress.totalRegions = importProgress.totalRegions;
    progress.worldViewId = worldViewId;

    if (importProgress.cancel || progress.cancel) {
      progress.status = 'cancelled';
      progress.statusMessage = 'Import cancelled';
      console.log(`[WV Extract] ${opId} Cancelled during phase 3`);
      return;
    }

    const phase3Duration = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(
      `[WV Extract] ${opId} Phase 3 complete: ${importProgress.createdRegions} regions created (${phase3Duration}s total)`,
    );

    // ─── Phase 4: Match countries to GADM ─────────────────────────────
    progress.status = 'matching';
    progress.statusMessage = 'Matching countries to GADM divisions...';
    console.log(`[WV Extract] ${opId} Phase 4: Matching countries to GADM...`);

    await matchCountryLevel(worldViewId, importProgress);

    // Forward matching progress fields
    progress.countriesMatched = importProgress.countriesMatched;
    progress.totalCountries = importProgress.totalCountries;
    progress.subdivisionsDrilled = importProgress.subdivisionsDrilled;
    progress.noCandidates = importProgress.noCandidates;

    if (importProgress.cancel || progress.cancel) {
      progress.status = 'cancelled';
      progress.statusMessage = 'Matching cancelled';
      console.log(`[WV Extract] ${opId} Cancelled during phase 4`);
      return;
    }

    // Mark import run as ready for admin review
    await pool.query(
      `UPDATE import_runs SET status = 'reviewing', completed_at = NOW()
       WHERE world_view_id = $1 AND status = 'matching'`,
      [worldViewId],
    );

    // ─── Complete ─────────────────────────────────────────────────────
    progress.status = 'complete';
    progress.statusMessage =
      `Extraction complete: ${totalNodes} regions extracted, ` +
      `${importProgress.createdRegions} imported, ` +
      `${importProgress.countriesMatched} countries matched`;

    const totalDuration = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(
      `[WV Extract] ${opId} Complete in ${totalDuration}s: ` +
      `regions=${totalNodes}, imported=${importProgress.createdRegions}, ` +
      `matched=${importProgress.countriesMatched}, ` +
      `drilldowns=${importProgress.subdivisionsDrilled}, ` +
      `noMatch=${importProgress.noCandidates}`,
    );
  } catch (err) {
    progress.status = 'failed';
    progress.statusMessage = `Extraction failed: ${err instanceof Error ? err.message : String(err)}`;
    console.error(`[WV Extract] ${opId} failed after ${((Date.now() - startTime) / 1000).toFixed(1)}s:`, err);
  } finally {
    fetcher.save();
    // Clean up after 5 minutes
    setTimeout(() => {
      if (runningExtractions.get(opId) === thisProgress) {
        runningExtractions.delete(opId);
      }
    }, 300_000);
  }
}
