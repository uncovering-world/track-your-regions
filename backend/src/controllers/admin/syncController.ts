/**
 * Admin Sync Controller
 *
 * Handles sync operations for experience categories (UNESCO, etc.)
 */

import { Request, Response } from 'express';
import { isTerminalSyncStatus } from '../../services/sync/types.js';
import { isCancellable } from '../../services/sync/syncOrchestrator.js';
import { pool } from '../../db/index.js';
import {
  syncUnescoSites,
  syncMuseums,
  fixMuseumImages,
  syncLandmarks,
  runningSyncs,
  getSyncStatus as getServiceSyncStatus,
  cancelSync as cancelServiceSync,
  assignExperiencesToRegions,
  getAssignmentStatus,
  cancelAssignment,
  getExperienceCountsByRegion,
} from '../../services/sync/index.js';
import type { AuthenticatedRequest } from '../../middleware/auth.js';

const MUSEUM_CATEGORY_ID = 2;

/** Registry mapping category IDs to their sync functions */
const syncRegistry: Record<number, (triggeredBy: number | null, options: { dryRun?: boolean }) => Promise<void>> = {
  1: syncUnescoSites,
  2: syncMuseums,
  3: syncLandmarks,
};

/**
 * Start sync for a source
 * POST /api/admin/sync/sources/:categoryId/start
 */
export async function startSync(req: AuthenticatedRequest, res: Response): Promise<void> {
  const categoryId = parseInt(String(req.params.categoryId));

  // Validate source exists
  const source = await pool.query(
    'SELECT id, name, is_active FROM experience_categories WHERE id = $1',
    [categoryId]
  );

  if (source.rows.length === 0) {
    res.status(404).json({ error: 'Source not found' });
    return;
  }

  if (!source.rows[0].is_active) {
    res.status(400).json({ error: 'Source is not active' });
    return;
  }

  // Check if already running
  const existing = runningSyncs.get(categoryId);
  if (existing && !isTerminalSyncStatus(existing.status)) {
    res.status(409).json({ error: 'Sync already in progress for this source' });
    return;
  }

  // Get triggering user ID
  const triggeredBy = req.user?.id || null;

  const dryRun = req.body.dryRun === true;

  // Start sync based on source type
  const syncFn = syncRegistry[categoryId];
  if (!syncFn) {
    res.status(400).json({ error: `Sync not implemented for source: ${source.rows[0].name}` });
    return;
  }

  syncFn(triggeredBy, { dryRun }).catch((err) => {
    // nosemgrep: javascript.lang.security.audit.unsafe-formatstring.unsafe-formatstring -- categoryId is a parseInt result, so it cannot carry a format specifier
    console.error(`[Sync Controller] Sync error for category ${categoryId}:`, err);
  });

  res.json({
    started: true,
    categoryId,
    categoryName: source.rows[0].name,
    dryRun,
    message: buildStartMessage({ dryRun }),
  });
}

function buildStartMessage(mode: { dryRun: boolean }): string {
  if (mode.dryRun) {
    return 'Dry run started: the changeset will be recorded, experiences will not be written.';
  }
  return 'Sync started. Poll /status endpoint for progress.';
}

/**
 * Get sync status for a source
 * GET /api/admin/sync/sources/:categoryId/status
 */
export async function getSyncStatus(req: Request, res: Response): Promise<void> {
  const categoryId = parseInt(String(req.params.categoryId));

  // Get in-memory sync status (generic for all categories)
  const status = getServiceSyncStatus(categoryId);

  if (status) {
    const isRunning = !isTerminalSyncStatus(status.status);
    // Whether a Cancel press would actually be acted on. Sent rather than
    // re-derived in the panel: the rule has moved twice in this change alone,
    // and a copy that lags shows up as a button promising what the server
    // refuses.
    const cancellable = isCancellable(status);
    res.json({
      running: isRunning,
      cancellable,
      status: status.status,
      statusMessage: status.statusMessage,
      progress: status.progress,
      total: status.total,
      percent: status.total > 0 ? Math.round((status.progress / status.total) * 100) : 0,
      created: status.created,
      updated: status.updated,
      unchanged: status.unchanged,
      missing: status.missing,
      curatedConflicts: status.curatedConflicts,
      filtered: status.filtered,
      errors: status.errors,
      currentItem: status.currentItem,
      logId: status.logId,
      dryRun: status.dryRun,
    });
    return;
  }

  // No in-memory status - check the database for last sync status
  const source = await pool.query(
    'SELECT last_sync_at, last_sync_status FROM experience_categories WHERE id = $1',
    [categoryId]
  );

  if (source.rows.length === 0) {
    res.status(404).json({ error: 'Source not found' });
    return;
  }

  res.json({
    running: false,
    lastSyncAt: source.rows[0].last_sync_at,
    lastSyncStatus: source.rows[0].last_sync_status,
  });
}

/**
 * Cancel sync for a source
 * POST /api/admin/sync/sources/:categoryId/cancel
 */
export async function cancelSync(req: Request, res: Response): Promise<void> {
  const categoryId = parseInt(String(req.params.categoryId));

  const source = await pool.query(
    'SELECT id FROM experience_categories WHERE id = $1',
    [categoryId]
  );
  if (source.rows.length === 0) {
    res.status(404).json({ error: 'Source not found' });
    return;
  }

  const cancelled = cancelServiceSync(categoryId);
  res.json({ cancelled });
}

/**
 * Fix missing images for a source
 * POST /api/admin/sync/sources/:categoryId/fix-images
 */
export async function fixImages(req: AuthenticatedRequest, res: Response): Promise<void> {
  const categoryId = parseInt(String(req.params.categoryId));
  const triggeredBy = req.user?.id || null;

  if (categoryId === MUSEUM_CATEGORY_ID) {
    fixMuseumImages(triggeredBy).catch((err) => {
      console.error('[Sync Controller] Fix museum images error:', err);
    });
    res.json({ started: true, message: 'Fixing missing images. Poll /status endpoint for progress.' });
  } else {
    res.status(400).json({ error: 'Fix images not implemented for this source' });
  }
}

/**
 * Get sync history/logs
 * GET /api/admin/sync/logs
 */
export async function getSyncLogs(req: Request, res: Response): Promise<void> {
  const categoryId = req.query.categoryId ? parseInt(String(req.query.categoryId)) : null;
  const limit = Math.min(parseInt(String(req.query.limit)) || 20, 100);
  const offset = parseInt(String(req.query.offset)) || 0;

  let query = `
    SELECT
      l.id,
      l.category_id,
      s.name as category_name,
      l.started_at,
      l.completed_at,
      l.status,
      l.total_fetched,
      l.total_created,
      l.total_updated,
      l.total_unchanged,
      l.total_missing,
      l.total_curated_conflicts,
      l.total_filtered,
      l.total_errors,
      l.is_dry_run,
      l.detection_skipped_reason,
      l.triggered_by,
      u.display_name as triggered_by_name,
      -- A run from before change provenance: its total_updated counted every
      -- row the upsert touched, so it is not comparable with later ones. After
      -- slice 1 any run that changed something also wrote a changeset, so the
      -- absence of one alongside a non-zero count is the marker.
      EXISTS (SELECT 1 FROM experience_sync_changes c WHERE c.sync_log_id = l.id) AS has_changeset
    FROM experience_sync_logs l
    JOIN experience_categories s ON l.category_id = s.id
    LEFT JOIN users u ON l.triggered_by = u.id
  `;

  const params: (number | string)[] = [];
  let paramIndex = 1;

  if (categoryId) {
    query += ` WHERE l.category_id = $${paramIndex++}`;
    params.push(categoryId);
  }

  query += ` ORDER BY l.started_at DESC LIMIT $${paramIndex++} OFFSET $${paramIndex}`;
  params.push(limit, offset);

  const result = await pool.query(query, params);

  // Get total count
  let countQuery = 'SELECT COUNT(*) FROM experience_sync_logs';
  const countParams: number[] = [];
  if (categoryId) {
    countQuery += ' WHERE category_id = $1';
    countParams.push(categoryId);
  }
  const countResult = await pool.query(countQuery, countParams);

  res.json({
    logs: result.rows,
    total: parseInt(countResult.rows[0].count),
    limit,
    offset,
  });
}

/**
 * Get single sync log with error details
 * GET /api/admin/sync/logs/:logId
 */
export async function getSyncLogDetails(req: Request, res: Response): Promise<void> {
  const logId = parseInt(String(req.params.logId));

  const result = await pool.query(
    `SELECT
      l.*,
      s.name as category_name,
      u.display_name as triggered_by_name,
      EXISTS (SELECT 1 FROM experience_sync_changes c WHERE c.sync_log_id = l.id) AS has_changeset
     FROM experience_sync_logs l
     JOIN experience_categories s ON l.category_id = s.id
     LEFT JOIN users u ON l.triggered_by = u.id
     WHERE l.id = $1`,
    [logId]
  );

  if (result.rows.length === 0) {
    res.status(404).json({ error: 'Sync log not found' });
    return;
  }

  res.json(result.rows[0]);
}

/**
 * List what a run did, object by object.
 * GET /api/admin/sync/logs/:logId/changes
 *
 * Rows that came through unchanged are not here — they are a count on the log.
 * Ordering puts the significant ones first, since that is what a reviewer came
 * for.
 */
export async function getSyncLogChanges(req: Request, res: Response): Promise<void> {
  const logId = parseInt(String(req.params.logId));
  const { type, significance, significantOnly, limit = 50, offset = 0 } = req.query as {
    type?: string; significance?: string; significantOnly?: 'true' | 'false';
    limit?: number; offset?: number;
  };

  const conditions = ['sync_log_id = $1'];
  const params: unknown[] = [logId];

  if (type) {
    params.push(type);
    conditions.push(`change_type = $${params.length}`);
  }
  if (significance) {
    params.push(significance);
    conditions.push(`significance = $${params.length}`);
  }
  // "Significant" means "worth a reviewer's attention", which is not the same as
  // significance = 'major': created, missing, returned, conflict and failed rows
  // carry no significance at all, and hiding them would empty the view of
  // everything a run is actually reporting. Only minor field edits drop out.
  if (significantOnly === 'true') {
    conditions.push(`(significance = 'major' OR change_type <> 'updated')`);
  }
  // Assembled from literal fragments only; every value travels as a parameter.
  const where = conditions.join(' AND ');

  const countResult = await pool.query(
    `SELECT COUNT(*)::int AS total FROM experience_sync_changes WHERE ${where}`,
    params
  );

  const rowsResult = await pool.query(
    `SELECT id, experience_id, external_id, name_snapshot, change_type,
            changed_fields, significance, error
     FROM experience_sync_changes
     WHERE ${where}
     ORDER BY CASE
                WHEN significance = 'major' THEN 0
                WHEN change_type <> 'updated' THEN 1
                ELSE 2
              END, change_type, external_id
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, limit, offset]
  );

  res.json({
    changes: rowsResult.rows,
    total: Number(countResult.rows[0]?.total ?? 0),
    limit: Number(limit),
    offset: Number(offset),
  });
}

/**
 * List all experience sources with assignment status
 * GET /api/admin/sync/sources
 */
export async function getCategories(req: Request, res: Response): Promise<void> {
  // Get sources
  const sourcesResult = await pool.query(`
    SELECT
      id,
      name,
      description,
      is_active,
      last_sync_at,
      last_sync_status,
      display_priority,
      created_at
    FROM experience_categories
    WHERE is_active = true
    ORDER BY display_priority, id
  `);

  // No `assignment_needed` flag any more, and no `last_assignment_at` either.
  //
  // The flag meant "a sync happened after the last full re-assignment", which
  // stopped being a question a sync can leave open: the run places what moved
  // before it finishes. Kept as a computed field it would have been permanently
  // true — a full rebuild is now only for changed region geometry, so nothing a
  // sync does could ever satisfy it.
  //
  // `last_assignment_at` went with it rather than being ported to Drizzle: it
  // existed to feed that comparison and no client ever read it on its own. The
  // column is still written by `assignExperiencesToRegions` and still available
  // to whatever wants it later.
  res.json(sourcesResult.rows);
}

// =============================================================================
// Region Assignment Endpoints
// =============================================================================

/**
 * Start region assignment for a world view
 * POST /api/admin/experiences/assign-regions
 */
export async function startRegionAssignment(req: Request, res: Response): Promise<void> {
  const worldViewId = parseInt(String(req.body.worldViewId || req.query.worldViewId));
  const categoryId = req.body.categoryId ? parseInt(String(req.body.categoryId)) : undefined;

  if (!worldViewId || isNaN(worldViewId)) {
    res.status(400).json({ error: 'worldViewId is required' });
    return;
  }

  // Validate world view exists
  const worldView = await pool.query(
    'SELECT id, name FROM world_views WHERE id = $1',
    [worldViewId]
  );

  if (worldView.rows.length === 0) {
    res.status(404).json({ error: 'World view not found' });
    return;
  }

  // Start assignment in background
  assignExperiencesToRegions(worldViewId, categoryId).catch((err) => {
    console.error('[Sync Controller] Region assignment error:', err);
  });

  res.json({
    started: true,
    worldViewId,
    worldViewName: worldView.rows[0].name,
    categoryId: categoryId || null,
    message: 'Region assignment started. Poll /status endpoint for progress.',
  });
}

/**
 * Get region assignment status
 * GET /api/admin/experiences/assign-regions/status
 */
export async function getRegionAssignmentStatus(req: Request, res: Response): Promise<void> {
  const worldViewId = parseInt(String(req.query.worldViewId));

  if (!worldViewId || isNaN(worldViewId)) {
    res.status(400).json({ error: 'worldViewId query parameter is required' });
    return;
  }

  const status = getAssignmentStatus(worldViewId);
  if (!status) {
    res.json({ running: false });
    return;
  }

  const isRunning = !isTerminalSyncStatus(status.status);

  res.json({
    running: isRunning,
    status: status.status,
    statusMessage: status.statusMessage,
    directAssignments: status.directAssignments,
    ancestorAssignments: status.ancestorAssignments,
    totalAssignments: status.directAssignments + status.ancestorAssignments,
    errors: status.errors,
  });
}

/**
 * Cancel region assignment
 * POST /api/admin/experiences/assign-regions/cancel
 */
export async function cancelRegionAssignment(req: Request, res: Response): Promise<void> {
  const worldViewId = parseInt(String(req.body.worldViewId || req.query.worldViewId));

  if (!worldViewId || isNaN(worldViewId)) {
    res.status(400).json({ error: 'worldViewId is required' });
    return;
  }

  const cancelled = cancelAssignment(worldViewId);
  res.json({ cancelled });
}

/**
 * Get experience counts by region
 * GET /api/admin/experiences/counts-by-region
 */
export async function getExperienceCounts(req: Request, res: Response): Promise<void> {
  const worldViewId = parseInt(String(req.query.worldViewId));
  const categoryId = req.query.categoryId ? parseInt(String(req.query.categoryId)) : undefined;

  if (!worldViewId || isNaN(worldViewId)) {
    res.status(400).json({ error: 'worldViewId query parameter is required' });
    return;
  }

  const counts = await getExperienceCountsByRegion(worldViewId, categoryId);
  res.json(counts);
}

/**
 * Reorder experience sources (set display_priority)
 * PUT /api/admin/sync/sources/reorder
 * Body: { categoryIds: [1, 3, 2] }  -- array of source IDs in desired order
 */
export async function reorderCategories(req: Request, res: Response): Promise<void> {
  const { categoryIds } = req.body as { categoryIds?: number[] };

  if (!Array.isArray(categoryIds) || categoryIds.length === 0) {
    res.status(400).json({ error: 'categoryIds array is required' });
    return;
  }

  await pool.query('BEGIN');
  try {
    for (let i = 0; i < categoryIds.length; i++) {
      await pool.query(
        'UPDATE experience_categories SET display_priority = $1 WHERE id = $2',
        [i + 1, categoryIds[i]]
      );
    }
    await pool.query('COMMIT');
  } catch (err) {
    await pool.query('ROLLBACK');
    throw err;
  }

  res.json({ success: true, order: categoryIds });
}
