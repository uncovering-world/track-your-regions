/**
 * Admin Country Canon Sync Controller
 * POST /api/admin/canon/sync    — start a rebuild from open sources
 * GET  /api/admin/canon/sync    — progress + last build log (report/diff)
 * DELETE /api/admin/canon/sync  — cancel the running rebuild
 */
import type { Response } from 'express';
import type { AuthenticatedRequest } from '../../middleware/auth.js';
import { syncCanon, getCanonSyncStatus, cancelCanonSync, getLastCanonLog } from '../../services/canonSync/index.js';

export function startCanonSync(req: AuthenticatedRequest, res: Response): void {
  const started = syncCanon(req.user?.id ?? null);
  if (!started) {
    res.status(409).json({ error: 'A canon sync is already running' });
    return;
  }
  res.json({ started: true });
}

export async function getCanonSyncState(_req: AuthenticatedRequest, res: Response): Promise<void> {
  const progress = getCanonSyncStatus();
  const lastLog = await getLastCanonLog();
  res.json({ progress, lastLog });
}

export function cancelCanonSyncEndpoint(_req: AuthenticatedRequest, res: Response): void {
  const cancelled = cancelCanonSync();
  res.json({ cancelled });
}
