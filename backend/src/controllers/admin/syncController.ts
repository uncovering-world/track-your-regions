/**
 * Admin Sync Controller
 *
 * Handles sync operations for experience categories (UNESCO, etc.)
 */

import { Request, Response } from 'express';
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
const syncRegistry: Record<number, (triggeredBy: number | null, force: boolean) => Promise<void>> = {
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
  if (existing && !['complete', 'failed', 'cancelled'].includes(existing.status)) {
    res.status(409).json({ error: 'Sync already in progress for this source' });
    return;
  }

  // Get triggering user ID
  const triggeredBy = req.user?.id || null;

  // Check for force mode
  const force = req.body.force === true;

  // Start sync based on source type
  const syncFn = syncRegistry[categoryId];
  if (!syncFn) {
    res.status(400).json({ error: `Sync not implemented for source: ${source.rows[0].name}` });
    return;
  }

  syncFn(triggeredBy, force).catch((err) => {
    console.error(`[Sync Controller] Sync error for category ${categoryId}:`, err);
  });

  res.json({
    started: true,
    categoryId,
    categoryName: source.rows[0].name,
    force,
    message: force
      ? 'Force sync started (existing data will be deleted). Poll /status endpoint for progress.'
      : 'Sync started. Poll /status endpoint for progress.',
  });
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
    const isRunning = !['complete', 'failed', 'cancelled'].includes(status.status);
    res.json({
      running: isRunning,
      status: status.status,
      statusMessage: status.statusMessage,
      progress: status.progress,
      total: status.total,
      percent: status.total > 0 ? Math.round((status.progress / status.total) * 100) : 0,
      created: status.created,
      updated: status.updated,
      errors: status.errors,
      currentItem: status.currentItem,
      logId: status.logId,
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
      l.total_errors,
      l.triggered_by,
      u.display_name as triggered_by_name
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
      u.display_name as triggered_by_name
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

  // Get the latest last_assignment_at from any world view (except GADM)
  const assignmentResult = await pool.query(`
    SELECT MAX(last_assignment_at) as last_assignment_at
    FROM world_views
    WHERE is_default = false AND is_active = true
  `);

  const lastAssignmentAt = assignmentResult.rows[0]?.last_assignment_at;

  // Add assignment_needed flag to each source
  const sources = sourcesResult.rows.map(source => ({
    ...source,
    // Assignment is needed if sync happened after the last assignment
    assignment_needed: source.last_sync_at && (
      !lastAssignmentAt || new Date(source.last_sync_at) > new Date(lastAssignmentAt)
    ),
    last_assignment_at: lastAssignmentAt,
  }));

  res.json(sources);
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

  const isRunning = !['complete', 'failed', 'cancelled'].includes(status.status);

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
