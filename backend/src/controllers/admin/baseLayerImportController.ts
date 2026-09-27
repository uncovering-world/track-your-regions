/**
 * Base Layer Import controller
 *
 * Starts an import that mirrors the administrative base layer. Everything after
 * the start — progress, cancellation, match review, finalize — is the shared
 * import machinery (GET/POST /api/admin/wv-import/import/status|cancel and the
 * review endpoints).
 */

import type { z } from 'zod/v4';
import type { ImportStarted } from '../../api/responses/worldViewImport.js';
import { createError } from '../../middleware/errorHandler.js';
import type { baseLayerImportBodySchema } from '../../types/index.js';
import { startBaseLayerImport, getLatestImportStatus } from '../../services/worldViewImport/index.js';

/**
 * Start a base layer import.
 * POST /api/admin/wv-import/base-layer
 */
export async function startBaseLayerImportEndpoint(
  { body: { name, providerLabel, maxDepth } }: { body: z.output<typeof baseLayerImportBodySchema> },
): Promise<ImportStarted> {
  const existing = getLatestImportStatus();
  if (existing && (existing.progress.status === 'importing' || existing.progress.status === 'matching')) {
    throw createError('An import is already running', 409);
  }

  const operationId = await startBaseLayerImport({ name, providerLabel, maxDepth });
  console.log('[Base Layer Import] POST /base-layer — started opId=%s', operationId);
  return { started: true, operationId };
}
