/**
 * Wikivoyage Extraction Service
 *
 * Full pipeline: extract tree from Wikivoyage API → enrich with Wikidata IDs
 * → import into WorldView → match countries to GADM.
 *
 * Follows the same fire-and-forget pattern as worldViewImport/index.ts.
 */

import path from 'path';
import { existsSync, unlinkSync, statSync, readdirSync, copyFileSync } from 'fs';
import { pool } from '../../db/index.js';
import type { ExtractionProgress, ExtractionConfig, TreeNode } from './types.js';
import { createInitialExtractionProgress } from './types.js';
import { WikivoyageFetcher } from './fetcher.js';
import { buildTree, countNodes, removeChildrenByTitle, CONTINENTS } from './treeBuilder.js';
import { type ClassificationCache } from './aiClassifier.js';
import { collectPageTitles, fetchWikidataIds, enrichWikidataIds } from './wikidataEnricher.js';
import { importTree } from '../worldViewImport/importer.js';
import { matchCountryLevel } from '../worldViewImport/matcher.js';
import { createInitialProgress as createImportProgress } from '../worldViewImport/types.js';
import OpenAI from 'openai';
import { isOpenAIAvailable } from '../ai/openaiService.js';
import { createExtractionAccumulator, preloadLearnedRules } from './aiRegionParser.js';

export type { ExtractionProgress, ExtractionConfig } from './types.js';

/** Cache directory and default file */
const CACHE_DIR = path.join(process.cwd(), 'data', 'cache');
const DEFAULT_CACHE_FILE = 'wikivoyage-cache.json';
const DEFAULT_CACHE_PATH = path.join(CACHE_DIR, DEFAULT_CACHE_FILE);

export interface CacheEntry {
  name: string;
  sizeBytes: number;
  modifiedAt: string;
}

/** List all cache files with metadata */
export function listCaches(): CacheEntry[] {
  try {
    if (!existsSync(CACHE_DIR)) return [];
    return readdirSync(CACHE_DIR)
      .filter(f => f.startsWith('wikivoyage-cache') && f.endsWith('.json'))
      .map(f => {
        const stats = statSync(path.join(CACHE_DIR, f));
        return { name: f, sizeBytes: stats.size, modifiedAt: stats.mtime.toISOString() };
      })
      .sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
  } catch { return []; }
}

/** Delete a specific cache file (name must match wikivoyage-cache*.json pattern) */
export function deleteCache(name: string): boolean {
  if (!name.startsWith('wikivoyage-cache') || !name.endsWith('.json') || name.includes('/') || name.includes('..')) {
    return false;
  }
  const filePath = path.join(CACHE_DIR, name);
  try {
    if (existsSync(filePath)) {
      unlinkSync(filePath);
      return true;
    }
  } catch { /* ignore */ }
  return false;
}

/** Snapshot the current cache with a timestamped name */
function snapshotCache(): void {
  try {
    if (!existsSync(DEFAULT_CACHE_PATH)) return;
    const now = new Date();
    const ts = now.toISOString().replace(/[:.]/g, '-').slice(0, 16); // 2026-02-26T15-30
    const snapshotName = `wikivoyage-cache-${ts}.json`;
    const snapshotPath = path.join(CACHE_DIR, snapshotName);
    if (!existsSync(snapshotPath)) {
      copyFileSync(DEFAULT_CACHE_PATH, snapshotPath);
      console.log(`[WV Cache] Snapshot saved: ${snapshotName}`);
    }
  } catch (err) {
    console.warn('[WV Cache] Failed to create snapshot:', err);
  }
}

/** In-memory progress map, keyed by operation ID */
const runningExtractions = new Map<string, ExtractionProgress>();

/** Auto-incrementing operation ID */
let nextOpId = 1;

/**
 * Start a Wikivoyage extraction (background operation).
 * Returns immediately with an operation ID for progress polling.
 *
 * @param config.cacheFile - Cache file to use: name of an existing cache, 'none' for clean fetch,
 *                           or undefined to use the default cache (if it exists)
 */
export function startExtraction(config: Partial<ExtractionConfig> & { cacheFile?: string | null } = {}): string {
  const cachePath = config.cachePath ?? DEFAULT_CACHE_PATH;

  if (config.cacheFile === 'none') {
    // Clean fetch: delete default cache
    try {
      if (existsSync(cachePath)) {
        unlinkSync(cachePath);
        console.log(`[WV Extract] Deleted cache at ${cachePath} (clean fetch)`);
      }
    } catch (err) {
      console.warn(`[WV Extract] Failed to delete cache:`, err);
    }
  } else if (config.cacheFile && config.cacheFile !== DEFAULT_CACHE_FILE) {
    // Load a specific snapshot into the default cache path
    const sourcePath = path.join(CACHE_DIR, config.cacheFile);
    if (existsSync(sourcePath)) {
      try {
        copyFileSync(sourcePath, cachePath);
        console.log(`[WV Extract] Loaded cache from snapshot: ${config.cacheFile}`);
      } catch (err) {
        console.warn(`[WV Extract] Failed to load cache snapshot:`, err);
      }
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

/**
 * Find a pending AI question across all running extractions.
 */
export function findPendingQuestion(questionId: number) {
  for (const progress of runningExtractions.values()) {
    const q = progress.pendingQuestions.find(pq => pq.id === questionId);
    if (q) return q;
  }
  return null;
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

    // Use last known region count from DB as estimate (more accurate than default)
    try {
      const estResult = await pool.query(`
        SELECT COUNT(*) AS cnt FROM regions
        WHERE world_view_id = (
          SELECT id FROM world_views
          WHERE source_type LIKE 'wikivoyage%'
          ORDER BY id DESC LIMIT 1
        )
      `);
      const lastCount = parseInt(estResult.rows[0]?.cnt, 10);
      if (lastCount > 1000) progress.estimatedTotal = lastCount;
    } catch { /* keep default */ }

    // Set up AI extraction context (optional — only if OpenAI is configured)
    let aiContext: { openai: OpenAI; accumulator: ReturnType<typeof createExtractionAccumulator> } | undefined;
    if (isOpenAIAvailable()) {
      aiContext = { openai: new OpenAI({ apiKey: process.env.OPENAI_API_KEY }), accumulator: createExtractionAccumulator() };
      await preloadLearnedRules();
    }
    console.log(`[WV Extract] ${opId} AI extraction: ${aiContext ? 'enabled' : 'DISABLED (no OpenAI key)'}`);

    const classificationCache: ClassificationCache = new Map();
    const trees: TreeNode[] = [];
    for (const continent of CONTINENTS) {
      if (progress.cancel) break;
      progress.statusMessage = `Extracting ${continent}...`;
      const tree = await buildTree(fetcher, continent, config.maxDepth, progress, 0, new Set(), aiContext, undefined, classificationCache);
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

    // AI usage is now logged per-call in aiRegionParser.ts (visible immediately on AI Settings page)

    // Print decision summary
    if (progress.decisions.length > 0) {
      const { formatDecisionSummary } = await import('./decisionSummary.js');
      console.log(formatDecisionSummary(progress.decisions, progress.regionsFetched));
    }

    // ─── Phase 1.5: Wait for pending AI questions to be resolved ──────
    const unresolvedQuestions = progress.pendingQuestions.filter(q => !q.resolved);
    if (unresolvedQuestions.length > 0) {
      progress.statusMessage = `Waiting for ${unresolvedQuestions.length} AI question${unresolvedQuestions.length !== 1 ? 's' : ''} to be resolved...`;
      console.log(`[WV Extract] ${opId} Waiting for ${unresolvedQuestions.length} unresolved AI questions...`);

      // Poll every 2s until all questions are resolved or extraction is cancelled
      while (progress.pendingQuestions.some(q => !q.resolved) && !progress.cancel) {
        await new Promise(resolve => setTimeout(resolve, 2000));
        const remaining = progress.pendingQuestions.filter(q => !q.resolved).length;
        progress.statusMessage = `Waiting for ${remaining} AI question${remaining !== 1 ? 's' : ''} to be resolved...`;
      }

      if (progress.cancel) {
        progress.status = 'cancelled';
        progress.statusMessage = 'Extraction cancelled while waiting for AI questions';
        console.log(`[WV Extract] ${opId} Cancelled while waiting for AI questions`);
        return;
      }

      console.log(`[WV Extract] ${opId} All AI questions resolved — proceeding`);

      // Apply resolved question outcomes to the tree
      // Questions that cleared regions need their subtrees removed
      for (const q of progress.pendingQuestions) {
        if (q.extractedRegions.length === 0) {
          // Admin decided not to split — remove children from this node in the tree
          removeChildrenByTitle(rootTree, q.pageTitle);
        }
      }
    }

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

    // ─── Snapshot cache for future reuse ──────────────────────────────
    snapshotCache();

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
