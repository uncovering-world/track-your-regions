/**
 * Base Layer Import controller
 *
 * Starts an import that mirrors the administrative base layer. Everything after
 * the start — progress, cancellation, match review, finalize — is the shared
 * import machinery (GET/POST /api/admin/wv-import/import/status|cancel and the
 * review endpoints).
 */

import type { Response } from 'express';
import type { AuthenticatedRequest } from '../../middleware/auth.js';
import { startBaseLayerImport, getLatestImportStatus } from '../../services/worldViewImport/index.js';

/**
 * Start a base layer import.
 * POST /api/admin/wv-import/base-layer
 */
export async function startBaseLayerImportEndpoint(
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> {
  const { name, providerLabel, maxDepth } = req.body;

  const existing = getLatestImportStatus();
  if (existing && (existing.progress.status === 'importing' || existing.progress.status === 'matching')) {
    res.status(409).json({ error: 'An import is already running' });
    return;
  }

  const operationId = await startBaseLayerImport({ name, providerLabel, maxDepth });
  console.log(`[Base Layer Import] POST /base-layer — started opId=${operationId}`);
  res.json({ started: true, operationId });
}
