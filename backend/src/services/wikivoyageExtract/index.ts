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
        // eslint-disable-next-line security/detect-non-literal-fs-filename -- f comes from readdirSync of CACHE_DIR; joined with the same constant dir
        const stats = statSync(path.join(CACHE_DIR, f));
        return { name: f, sizeBytes: stats.size, modifiedAt: stats.mtime.toISOString() };
      })
      .sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
  } catch { return []; }
}

/**
 * Validate that a user-supplied cache name resolves to a file inside CACHE_DIR.
 * Returns the safe absolute path or null if validation fails.
 * Defense in depth on top of Zod regex at the route layer.
 */
function safeCachePath(name: string): string | null {
  if (!name.startsWith('wikivoyage-cache') || !name.endsWith('.json') || name.includes('/') || name.includes('\\') || name.includes('..')) {
    return null;
  }
  const resolved = path.resolve(CACHE_DIR, name);
  if (path.dirname(resolved) !== path.resolve(CACHE_DIR)) {
    return null;
  }
  return resolved;
}

/** Delete a specific cache file (name must match wikivoyage-cache*.json pattern) */
export function deleteCache(name: string): boolean {
  const filePath = safeCachePath(name);
  if (filePath === null) return false;
  try {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- filePath validated by safeCachePath: must match wikivoyage-cache*.json under CACHE_DIR
    if (existsSync(filePath)) {
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- filePath validated by safeCachePath
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
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- snapshotPath built from CACHE_DIR + literal prefix + ISO timestamp
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
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- cachePath defaults to DEFAULT_CACHE_PATH constant; if overridden, comes from internal config, not user input
      if (existsSync(cachePath)) {
        // eslint-disable-next-line security/detect-non-literal-fs-filename -- same as above
        unlinkSync(cachePath);
        console.log(`[WV Extract] Deleted cache at ${cachePath} (clean fetch)`);
      }
    } catch (err) {
      console.warn(`[WV Extract] Failed to delete cache:`, err);
    }
  } else if (config.cacheFile && config.cacheFile !== DEFAULT_CACHE_FILE) {
    // Load a specific snapshot into the default cache path. Fail fast — a
    // silent fallback would run extraction against the wrong cache while
    // reporting a successful start to the admin.
    const sourcePath = safeCachePath(config.cacheFile);
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- sourcePath validated by safeCachePath (matches wikivoyage-cache*.json under CACHE_DIR)
    if (sourcePath === null || !existsSync(sourcePath)) {
      throw new Error(`Cache snapshot not found or invalid: ${config.cacheFile}`);
    }

    copyFileSync(sourcePath, cachePath);
    console.log(`[WV Extract] Loaded cache from snapshot: ${config.cacheFile}`);
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

type AiContext = { openai: OpenAI; accumulator: ReturnType<typeof createExtractionAccumulator> };

/** Load a recent region count from DB to use as a progress estimate. */
async function loadEstimatedRegionCount(progress: ExtractionProgress): Promise<void> {
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
}

/** Instantiate AI context (OpenAI client + accumulator) if OpenAI is configured. */
async function initAiContext(): Promise<AiContext | undefined> {
  if (!isOpenAIAvailable()) return undefined;
  // AI is opportunistic — the deterministic parser path still works without
  // it. A failure preloading learned rules must not abort the entire import.
  try {
    const ctx: AiContext = {
      openai: new OpenAI({ apiKey: process.env.OPENAI_API_KEY }),
      accumulator: createExtractionAccumulator(),
    };
    await preloadLearnedRules();
    return ctx;
  } catch (err) {
    console.warn('[WV Extract] AI bootstrap failed; continuing without AI:', err instanceof Error ? err.message : err);
    return undefined;
  }
}

/** Build per-continent trees, respecting cancellation. Returns null if cancelled. */
async function extractContinentTrees(
  fetcher: WikivoyageFetcher,
  config: ExtractionConfig,
  progress: ExtractionProgress,
  aiContext: AiContext | undefined,
): Promise<TreeNode[] | null> {
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
  return progress.cancel ? null : trees;
}

/** Wait for any pending AI questions to be resolved; applies their outcomes to the tree. */
async function awaitPendingQuestions(
  opId: string,
  progress: ExtractionProgress,
  rootTree: TreeNode,
): Promise<boolean> {
  const unresolvedQuestions = progress.pendingQuestions.filter(q => !q.resolved);
  if (unresolvedQuestions.length === 0) return true;

  const plural = (n: number) => (n !== 1 ? 's' : '');
  progress.statusMessage = `Waiting for ${unresolvedQuestions.length} AI question${plural(unresolvedQuestions.length)} to be resolved...`;
  console.log(`[WV Extract] ${opId} Waiting for ${unresolvedQuestions.length} unresolved AI questions...`);

  while (progress.pendingQuestions.some(q => !q.resolved) && !progress.cancel) {
    await new Promise(resolve => setTimeout(resolve, 2000));
    const remaining = progress.pendingQuestions.filter(q => !q.resolved).length;
    progress.statusMessage = `Waiting for ${remaining} AI question${plural(remaining)} to be resolved...`;
  }

  if (progress.cancel) {
    progress.status = 'cancelled';
    progress.statusMessage = 'Extraction cancelled while waiting for AI questions';
    console.log(`[WV Extract] ${opId} Cancelled while waiting for AI questions`);
    return false;
  }

  console.log(`[WV Extract] ${opId} All AI questions resolved — proceeding`);

  for (const q of progress.pendingQuestions) {
    if (q.extractedRegions.length === 0) {
      // Admin decided not to split — remove children from this node in the tree
      removeChildrenByTitle(rootTree, q.pageTitle);
    }
  }
  return true;
}

/** Run the extract tree phase; returns the root tree + total node count, or null on cancel. */
async function runExtractPhase(
  opId: string,
  config: ExtractionConfig,
  progress: ExtractionProgress,
  fetcher: WikivoyageFetcher,
  startTime: number,
): Promise<{ rootTree: TreeNode; totalNodes: number } | null> {
  console.log(`[WV Extract] ${opId} Phase 1: Extracting tree from Wikivoyage...`);
  progress.status = 'extracting';
  progress.statusMessage = 'Fetching region hierarchy from Wikivoyage...';

  await loadEstimatedRegionCount(progress);
  const aiContext = await initAiContext();
  console.log(`[WV Extract] ${opId} AI extraction: ${aiContext ? 'enabled' : 'DISABLED (no OpenAI key)'}`);

  const trees = await extractContinentTrees(fetcher, config, progress, aiContext);
  if (trees === null) {
    progress.status = 'cancelled';
    progress.statusMessage = 'Extraction cancelled';
    console.log(`[WV Extract] ${opId} Cancelled during phase 1`);
    return null;
  }

  const rootTree: TreeNode = { name: 'World', children: trees };
  const totalNodes = countNodes(rootTree) - 1; // -1 for root
  const phase1Duration = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(
    `[WV Extract] ${opId} Phase 1 complete: ${totalNodes} regions in ${phase1Duration}s ` +
    `(API=${progress.apiRequests}, cache=${progress.cacheHits})`,
  );

  if (progress.decisions.length > 0) {
    const { formatDecisionSummary } = await import('./decisionSummary.js');
    console.log(formatDecisionSummary(progress.decisions, progress.regionsFetched));
  }

  const proceed = await awaitPendingQuestions(opId, progress, rootTree);
  if (!proceed) return null;

  return { rootTree, totalNodes };
}

/** Enrich the tree with Wikidata IDs; returns false if cancelled. */
async function runEnrichPhase(
  opId: string,
  progress: ExtractionProgress,
  fetcher: WikivoyageFetcher,
  rootTree: TreeNode,
  startTime: number,
): Promise<boolean> {
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
    return false;
  }

  const phase2Duration = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(
    `[WV Extract] ${opId} Phase 2 complete: ${wikidataMap.size}/${allTitles.size} Wikidata IDs found (${phase2Duration}s total)`,
  );

  fetcher.save();
  return true;
}

/** Import the enriched tree into a new world view; returns null on cancel. */
async function runImportPhase(
  opId: string,
  config: ExtractionConfig,
  progress: ExtractionProgress,
  rootTree: TreeNode,
  totalNodes: number,
  startTime: number,
): Promise<{ worldViewId: number; importProgress: ReturnType<typeof createImportProgress> } | null> {
  progress.status = 'importing';
  progress.statusMessage = 'Importing into WorldView...';
  console.log(`[WV Extract] ${opId} Phase 3: Importing tree into WorldView...`);

  const importProgress = createImportProgress();
  const worldViewId = await importTree(rootTree, config.name, importProgress, {
    sourceType: 'wikivoyage',
    source: 'English Wikivoyage',
    description: `Imported from Wikivoyage region hierarchy (${totalNodes} regions)`,
  });

  progress.createdRegions = importProgress.createdRegions;
  progress.totalRegions = importProgress.totalRegions;
  progress.worldViewId = worldViewId;

  if (importProgress.cancel || progress.cancel) {
    progress.status = 'cancelled';
    progress.statusMessage = 'Import cancelled';
    console.log(`[WV Extract] ${opId} Cancelled during phase 3`);
    return null;
  }

  const phase3Duration = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(
    `[WV Extract] ${opId} Phase 3 complete: ${importProgress.createdRegions} regions created (${phase3Duration}s total)`,
  );
  return { worldViewId, importProgress };
}

/** Match top-level countries to GADM; returns false if cancelled. */
async function runMatchPhase(
  opId: string,
  progress: ExtractionProgress,
  worldViewId: number,
  importProgress: ReturnType<typeof createImportProgress>,
): Promise<boolean> {
  progress.status = 'matching';
  progress.statusMessage = 'Matching countries to GADM divisions...';
  console.log(`[WV Extract] ${opId} Phase 4: Matching countries to GADM...`);

  await matchCountryLevel(worldViewId, importProgress);

  progress.countriesMatched = importProgress.countriesMatched;
  progress.totalCountries = importProgress.totalCountries;
  progress.subdivisionsDrilled = importProgress.subdivisionsDrilled;
  progress.noCandidates = importProgress.noCandidates;

  if (importProgress.cancel || progress.cancel) {
    progress.status = 'cancelled';
    progress.statusMessage = 'Matching cancelled';
    console.log(`[WV Extract] ${opId} Cancelled during phase 4`);
    return false;
  }

  await pool.query(
    `UPDATE import_runs SET status = 'reviewing', completed_at = NOW()
     WHERE world_view_id = $1 AND status = 'matching'`,
    [worldViewId],
  );

  snapshotCache();
  return true;
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
    const extractResult = await runExtractPhase(opId, config, progress, fetcher, startTime);
    if (!extractResult) return;
    const { rootTree, totalNodes } = extractResult;

    const enriched = await runEnrichPhase(opId, progress, fetcher, rootTree, startTime);
    if (!enriched) return;

    const importResult = await runImportPhase(opId, config, progress, rootTree, totalNodes, startTime);
    if (!importResult) return;
    const { worldViewId, importProgress } = importResult;

    const matched = await runMatchPhase(opId, progress, worldViewId, importProgress);
    if (!matched) return;

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
