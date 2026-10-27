/**
 * Wikivoyage Extraction Service
 *
 * Full pipeline: extract tree from English Wikivoyage's copy (`pageCopy.ts`)
 * → enrich with Wikidata IDs → import into WorldView → match countries to GADM.
 *
 * Follows the same fire-and-forget pattern as worldViewImport/index.ts.
 */

import { pool } from '../../db/index.js';
import type { ExtractionProgress, ExtractionConfig, TreeNode } from './types.js';
import { createInitialExtractionProgress } from './types.js';
import { CopyRefusal, PageCopy } from './pageCopy.js';
import { applyUntilSettled, buildTree, countNodes, CONTINENTS } from './treeBuilder.js';
import { type ClassificationCache } from './aiClassifier.js';
import { collectPageTitles, enrichWikidataIds } from './wikidataEnricher.js';
import { importTree } from '../worldViewImport/importer.js';
import { runMatchingPolicy } from '../worldViewImport/index.js';
import { spatialSentence, type SpatialPassSummary } from '../worldViewImport/spatialPass.js';
import { defaultMatchingPolicy } from '../worldViewImport/sourceTypes.js';
import { createInitialProgress as createImportProgress } from '../worldViewImport/types.js';
import { Operation } from '../operationProgress.js';

/** An extraction's steps, as its progress counts them (#1356). */
const EXTRACT_STEPS = { extract: 1, questions: 2, enrich: 3, import: 4, names: 5, spatial: 6 } as const;
import OpenAI from 'openai';
import { isOpenAIAvailable } from '../ai/openaiService.js';
import { createExtractionAccumulator, preloadLearnedRules } from './aiRegionParser.js';

export type { ExtractionProgress, ExtractionConfig } from './types.js';

/** In-memory progress map, keyed by operation ID */
const runningExtractions = new Map<string, ExtractionProgress>();

/** Auto-incrementing operation ID */
let nextOpId = 1;

/**
 * Start a Wikivoyage extraction (background operation).
 * Returns immediately with an operation ID for progress polling.
 */
export function startExtraction(config: Partial<ExtractionConfig> = {}): string {
  const fullConfig: ExtractionConfig = {
    name: config.name ?? 'Wikivoyage Regions',
    maxDepth: config.maxDepth ?? 10,
  };

  const opId = `wv-extract-${nextOpId++}`;
  const progress = createInitialExtractionProgress();
  progress.operation = new Operation(`[WV Extract] ${opId}:`, Object.keys(EXTRACT_STEPS).length);
  runningExtractions.set(opId, progress);

  console.log(`[WV Extract] Starting extraction ${opId}: name="${fullConfig.name}", maxDepth=${fullConfig.maxDepth}`);

  // Fire and forget
  runExtraction(opId, fullConfig, progress).catch((err) => {
    // nosemgrep: javascript.lang.security.audit.unsafe-formatstring.unsafe-formatstring -- opId is generated here as wv-extract-<counter>
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
      progress.operation?.cancel();
      return true;
    }
    return false;
  }
  // Cancel any running extraction
  for (const progress of runningExtractions.values()) {
    if (!isTerminalStatus(progress.status)) {
      progress.cancel = true;
      progress.operation?.cancel();
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
  wiki: PageCopy,
  config: ExtractionConfig,
  progress: ExtractionProgress,
  aiContext: AiContext | undefined,
): Promise<TreeNode[] | null> {
  const classificationCache: ClassificationCache = new Map();
  const trees: TreeNode[] = [];
  for (const continent of CONTINENTS) {
    if (progress.cancel) break;
    progress.statusMessage = `Extracting ${continent}...`;
    const tree = await buildTree(wiki, continent, config.maxDepth, progress, 0, new Set(), aiContext, undefined, classificationCache);
    if (tree !== 'self_ref' && tree !== 'missing') {
      trees.push(tree);
    }
  }
  return progress.cancel ? null : trees;
}

/**
 * Wait for any pending AI questions to be resolved, and apply their outcomes
 * to the tree. Applied even when nothing waits: an admin can answer while the
 * walk is still running. A rebuild from an answer can reach a page the model
 * is unsure of, which queues a question of its own, so the wait repeats until
 * no question is left open (#368).
 */
async function awaitPendingQuestions(
  progress: ExtractionProgress,
  rootTree: TreeNode,
): Promise<boolean> {
  const open = () => progress.pendingQuestions.filter(q => !q.resolved).length;
  const plural = (n: number) => (n !== 1 ? 's' : '');
  let waiting = false;

  do {
    if (open() > 0 && !waiting) {
      // A person answers these: the step waits on the admin, counted by the
      // questions answered, and opens the first time one is open — after the
      // walk, or after a rebuild queued one.
      waiting = true;
      // No count in the sentence: a rebuild can queue more, and the counter says how many.
      progress.operation?.step(EXTRACT_STEPS.questions, 'Waiting for the answers to the AI questions asked', 0,
        () => ({ done: progress.pendingQuestions.filter(q => q.resolved).length, total: progress.pendingQuestions.length }));
    }
    while (open() > 0 && !progress.cancel) {
      progress.statusMessage = `Waiting for ${open()} AI question${plural(open())} to be resolved...`;
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
    if (progress.cancel) {
      progress.status = 'cancelled';
      progress.statusMessage = 'Extraction cancelled while waiting for AI questions';
      progress.operation?.finish('cancelled while waiting for AI questions');
      return false;
    }
    await applyUntilSettled(progress, rootTree);
  } while (open() > 0 || progress.cancel);
  return true;
}

/** Run the extract tree phase; returns the root tree + total node count, or null on cancel. */
async function runExtractPhase(
  opId: string,
  config: ExtractionConfig,
  progress: ExtractionProgress,
  wiki: PageCopy,
): Promise<{ rootTree: TreeNode; totalNodes: number } | null> {
  progress.status = 'extracting';
  progress.statusMessage = "Reading the region hierarchy from English Wikivoyage's copy...";

  await loadEstimatedRegionCount(progress);
  // Measured against an estimate of the region count, never below what is done.
  progress.operation?.step(EXTRACT_STEPS.extract, 'Reading the region hierarchy from Wikivoyage', 0,
    () => ({ done: progress.regionsFetched, total: Math.max(progress.estimatedTotal, progress.regionsFetched) }));
  const aiContext = await initAiContext();
  console.log(`[WV Extract] ${opId} AI extraction: ${aiContext ? 'enabled' : 'DISABLED (no OpenAI key)'}`);

  const trees = await extractContinentTrees(wiki, config, progress, aiContext);
  if (trees === null) {
    progress.status = 'cancelled';
    progress.statusMessage = 'Extraction cancelled';
    progress.operation?.finish('cancelled while reading the hierarchy');
    return null;
  }

  const rootTree: TreeNode = { name: 'World', children: trees };
  progress.operation?.note(`${countNodes(rootTree) - 1} regions read from the ${wiki.dumpDate} copy of English Wikivoyage`);

  if (progress.decisions.length > 0) {
    const { formatDecisionSummary } = await import('./decisionSummary.js');
    console.log(formatDecisionSummary(progress.decisions, progress.regionsFetched));
  }

  const proceed = await awaitPendingQuestions(progress, rootTree);
  if (!proceed) return null;

  // Counted after the answers, which can rebuild a page's regions either way.
  return { rootTree, totalNodes: countNodes(rootTree) - 1 }; // -1 for root
}

/** Enrich the tree with Wikidata IDs; returns false if cancelled. */
async function runEnrichPhase(
  progress: ExtractionProgress,
  wiki: PageCopy,
  rootTree: TreeNode,
): Promise<boolean> {
  progress.status = 'enriching';
  progress.statusMessage = 'Fetching Wikidata IDs...';

  const allTitles = collectPageTitles(rootTree);
  progress.operation?.step(EXTRACT_STEPS.enrich, `Reading the Wikidata ids of ${allTitles.size} pages`);
  const wikidataMap = await wiki.wikidataIds(allTitles);
  enrichWikidataIds(rootTree, wikidataMap);

  if (progress.cancel) {
    progress.status = 'cancelled';
    progress.statusMessage = 'Extraction cancelled during enrichment';
    progress.operation?.finish('cancelled while reading the Wikidata ids');
    return false;
  }

  progress.operation?.advance(wikidataMap.size);
  progress.operation?.note(`${wikidataMap.size} of ${allTitles.size} pages have a Wikidata id`);
  return true;
}

/** Import the enriched tree into a new world view; returns null on cancel. */
async function runImportPhase(
  wiki: PageCopy,
  config: ExtractionConfig,
  progress: ExtractionProgress,
  rootTree: TreeNode,
  totalNodes: number,
): Promise<{ worldViewId: number; importProgress: ReturnType<typeof createImportProgress> } | null> {
  // Every page the tree was built from comes from one copy, the one the run records.
  if (!await wiki.unchanged()) {
    throw new CopyRefusal(`English Wikivoyage's copy of ${wiki.dumpDate} was replaced while the extraction read it; start the extraction again`);
  }
  progress.status = 'importing';
  progress.statusMessage = 'Importing into WorldView...';

  const importProgress = createImportProgress();
  progress.operation?.step(EXTRACT_STEPS.import, 'Creating the regions', 0,
    () => ({ done: importProgress.createdRegions, total: importProgress.totalRegions }));
  const worldViewId = await importTree(rootTree, config.name, importProgress, {
    sourceType: 'wikivoyage',
    source: 'English Wikivoyage',
    sourceDumpDate: wiki.dumpDate,
    description: `Imported from Wikivoyage region hierarchy (${totalNodes} regions)`,
  });

  progress.createdRegions = importProgress.createdRegions;
  progress.totalRegions = importProgress.totalRegions;
  progress.worldViewId = worldViewId;

  if (importProgress.cancel || progress.cancel) {
    progress.status = 'cancelled';
    progress.statusMessage = 'Import cancelled';
    progress.operation?.finish('cancelled while creating the regions');
    return null;
  }

  return { worldViewId, importProgress };
}

/** Match top-level countries to GADM; returns false if cancelled. */
async function runMatchPhase(
  progress: ExtractionProgress,
  worldViewId: number,
  importProgress: ReturnType<typeof createImportProgress>,
): Promise<{ spatial: SpatialPassSummary | null } | false> {
  progress.status = 'matching';
  progress.statusMessage = 'Matching countries to GADM divisions...';
  // The match and the spatial pass report as the extraction's own steps 5 and 6.
  importProgress.operation = progress.operation;

  // Through the dispatch, not straight to a matcher: a caller naming one is
  // the divergence re-match guards against too — flipping a source's
  // policy would change every other path and silently not this one.
  //
  // The cancel flag has to be bridged, because the matcher reads it on the
  // ImportProgress it is handed while cancelExtraction sets it on the
  // ExtractionProgress — two different objects, and nothing ever assigned
  // importProgress.cancel. Both policies guard on it, so without this link they
  // would see `false` for the whole run: the walk completes, the write commits,
  // and only afterwards does the check below notice, leaving a fully matched
  // world view with import_runs stuck in 'matching' — which the review UI reads
  // as an import still in flight. A getter rather than a copy because the flag
  // flips *during* the await.
  Object.defineProperty(importProgress, 'cancel', {
    configurable: true,
    get: () => progress.cancel,
  });

  // And the line the panel reads: the matcher and the spatial pass write theirs on
  // the import's progress, which the panel never polls, so each write is mirrored
  // onto the extraction's own (#622).
  let importMessage = importProgress.statusMessage;
  Object.defineProperty(importProgress, 'statusMessage', {
    configurable: true,
    get: () => importMessage,
    set: (message: string) => { importMessage = message; progress.statusMessage = message; },
  });

  const { cancelled, spatial } = await runMatchingPolicy(defaultMatchingPolicy('wikivoyage'), worldViewId, importProgress,
    { names: EXTRACT_STEPS.names, spatial: EXTRACT_STEPS.spatial });

  progress.countriesMatched = importProgress.countriesMatched;
  progress.totalCountries = importProgress.totalCountries;
  progress.subdivisionsDrilled = importProgress.subdivisionsDrilled;
  progress.noCandidates = importProgress.noCandidates;

  // A cancel the policy saw; one during the spatial pass only stopped the scoring,
  // and the match is written, so the run finishes (`runMatchingPolicy`).
  if (cancelled) {
    progress.status = 'cancelled';
    progress.statusMessage = 'Matching cancelled';
    progress.operation?.finish('cancelled while matching by name');
    return false;
  }

  await pool.query(
    `UPDATE import_runs SET status = 'reviewing', completed_at = NOW()
     WHERE world_view_id = $1 AND status = 'matching'`,
    [worldViewId],
  );

  return { spatial };
}

/** Internal: run the full extraction → import → match pipeline */
async function runExtraction(
  opId: string,
  config: ExtractionConfig,
  progress: ExtractionProgress,
): Promise<void> {
  const thisProgress = progress;
  const startTime = Date.now();

  try {
    const wiki = await PageCopy.open();
    const extractResult = await runExtractPhase(opId, config, progress, wiki);
    if (!extractResult) return;
    const { rootTree, totalNodes } = extractResult;

    const enriched = await runEnrichPhase(progress, wiki, rootTree);
    if (!enriched) return;

    const importResult = await runImportPhase(wiki, config, progress, rootTree, totalNodes);
    if (!importResult) return;
    const { worldViewId, importProgress } = importResult;

    const matched = await runMatchPhase(progress, worldViewId, importProgress);
    if (!matched) return;

    progress.status = 'complete';
    progress.statusMessage =
      `Extraction complete: ${totalNodes} regions extracted, ` +
      `${importProgress.createdRegions} imported, ` +
      `${importProgress.countriesMatched} countries matched` +
      (matched.spatial ? spatialSentence(matched.spatial) : '');

    progress.operation?.finish(progress.statusMessage);
  } catch (err) {
    progress.status = 'failed';
    progress.statusMessage = err instanceof CopyRefusal ? err.sentence : 'Extraction failed; the server log has the cause.';
    progress.operation?.finish('failed');
    // nosemgrep: javascript.lang.security.audit.unsafe-formatstring.unsafe-formatstring -- opId is generated here as wv-extract-<counter> and the elapsed time is a number
    console.error(`[WV Extract] ${opId} failed after ${((Date.now() - startTime) / 1000).toFixed(1)}s:`, err);
  } finally {
    // Clean up after 5 minutes
    setTimeout(() => {
      if (runningExtractions.get(opId) === thisProgress) {
        runningExtractions.delete(opId);
      }
    }, 300_000);
  }
}
