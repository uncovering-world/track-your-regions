/**
 * Admin WorldView Import — Lifecycle controller
 *
 * Owns: import session start/status/cancel.
 * See ADR-0009 for the domain-split rationale.
 */

import { pool } from '../../db/index.js';
import type { ImportCancelled, ImportStarted, ImportStatus } from '../../api/responses/worldViewImport.js';
import type { z } from 'zod/v4';
import { badRequest, createError } from '../../middleware/errorHandler.js';
import type { wvImportBodySchema } from '../../types/index.js';
import {
  startImport,
  getLatestImportStatus,
  cancelImport,
} from '../../services/worldViewImport/index.js';
import { IMPORT_SOURCE_TYPES_ALL } from '../../services/worldViewImport/sourceTypes.js';
import { operationAnswer } from '../../services/operationProgress.js';

// =============================================================================
// Tree validation helper (used by startWorldViewImport)
// =============================================================================

/** Count nodes and max depth in a tree (for size validation) */
function treeStats(node: { children?: unknown[] }, depth = 0): { nodes: number; maxDepth: number } {
  let nodes = 1;
  let maxDepth = depth;
  const children = Array.isArray(node.children) ? node.children : [];
  for (const child of children) {
    const stats = treeStats(child as { children?: unknown[] }, depth + 1);
    nodes += stats.nodes;
    if (stats.maxDepth > maxDepth) maxDepth = stats.maxDepth;
  }
  return { nodes, maxDepth };
}

const MAX_TREE_NODES = 50_000;
const MAX_TREE_DEPTH = 15;

// =============================================================================
// Import endpoints
// =============================================================================

/**
 * Start a world view import from JSON data.
 * POST /api/admin/wv-import/import
 */
export async function startWorldViewImport(
  { body: { name, tree, matchingPolicy } }: { body: z.output<typeof wvImportBodySchema> },
): Promise<ImportStarted> {
  console.log('[WV Import] POST /import — name="%s", children count=%s, policy=%s',
    name, tree?.children?.length ?? 'N/A', matchingPolicy);

  // Zod handles structural validation; check size limits
  const stats = treeStats(tree);
  if (stats.nodes > MAX_TREE_NODES) {
    throw badRequest(`Tree too large: ${stats.nodes} nodes exceeds limit of ${MAX_TREE_NODES}`);
  }
  if (stats.maxDepth > MAX_TREE_DEPTH) {
    throw badRequest(`Tree too deep: depth ${stats.maxDepth} exceeds limit of ${MAX_TREE_DEPTH}`);
  }

  // Check no import is already running
  const existing = getLatestImportStatus();
  if (existing && (existing.progress.status === 'importing' || existing.progress.status === 'matching')) {
    throw createError('An import is already running', 409);
  }

  const opId = startImport(tree, name, {
    matchingPolicy,
    sourceType: 'imported',
    source: 'File upload',
  });
  console.log('[WV Import] POST /import — started opId=%s', opId);
  return { started: true, operationId: opId };
}

/**
 * Get import status.
 * GET /api/admin/wv-import/import/status
 *
 * Returns in-memory progress when an import is running/recently completed,
 * otherwise falls back to querying DB for existing imported world views
 * so the review UI survives page reloads and re-logins.
 */
export async function getWorldViewImportStatus(): Promise<ImportStatus> {
  const status = getLatestImportStatus();

  // Always fetch existing imported world views from DB (both active and finalized)
  const result = await pool.query(`
    SELECT id, name, source_type FROM world_views
    WHERE source_type = ANY($1)
    ORDER BY id DESC
  `, [IMPORT_SOURCE_TYPES_ALL]);
  const importedWorldViews = result.rows.map(r => ({
    id: r.id as number,
    name: r.name as string,
    sourceType: r.source_type as string,
    reviewComplete: (r.source_type as string).endsWith('_done'),
  }));

  if (status) {
    const isActive = status.progress.status === 'importing' || status.progress.status === 'matching';
    console.log('[WV Import] GET /import/status — opId=%s, status=%s, running=%s, regions=%d/%d, countries=%d/%d',
      status.opId, status.progress.status, isActive, status.progress.createdRegions, status.progress.totalRegions,
      status.progress.countriesMatched, status.progress.totalCountries);
    const { progress } = status;
    return {
      running: isActive,
      operationId: status.opId,
      status: progress.status,
      statusMessage: progress.statusMessage,
      createdRegions: progress.createdRegions,
      totalRegions: progress.totalRegions,
      matchedRegions: progress.matchedRegions,
      totalCountries: progress.totalCountries,
      countriesMatched: progress.countriesMatched,
      subdivisionsDrilled: progress.subdivisionsDrilled,
      noCandidates: progress.noCandidates,
      matchTotal: progress.matchTotal,
      matchDone: progress.matchDone,
      worldViewId: progress.worldViewId,
      ...(progress.operation ? { operation: operationAnswer(progress.operation.progress) } : {}),
      importedWorldViews,
    };
  }

  return { running: false, importedWorldViews };
}

/**
 * Cancel a running import.
 * POST /api/admin/wv-import/import/cancel
 */
export async function cancelWorldViewImport(): Promise<ImportCancelled> {
  console.log('[WV Import] POST /import/cancel');
  const cancelled = cancelImport();
  console.log('[WV Import] POST /import/cancel — result: %s', cancelled);
  return { cancelled };
}
