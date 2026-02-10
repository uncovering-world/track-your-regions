/**
 * Admin Routes
 *
 * All routes require admin authentication.
 * Handles sync operations, geometry computation, and other admin tasks.
 */

import { Router, Response } from 'express';
import type { AuthenticatedRequest } from '../middleware/auth.js';
import { pool } from '../db/index.js';
import { validate } from '../middleware/errorHandler.js';
import {
  sourceIdParamSchema,
  logIdParamSchema,
  assignmentIdParamSchema,
  userIdParamSchema,
  startSyncBodySchema,
  reorderSourcesBodySchema,
  startRegionAssignmentBodySchema,
  regionAssignmentStatusQuerySchema,
  experienceCountsQuerySchema,
  syncLogsQuerySchema,
  createCuratorAssignmentBodySchema,
  curatorActivityQuerySchema,
  adminUserSearchQuerySchema,
} from '../types/index.js';
import {
  startSync,
  getSyncStatus,
  cancelSync,
  fixImages,
  getSyncLogs,
  getSyncLogDetails,
  getSources,
  reorderSources,
  startRegionAssignment,
  getRegionAssignmentStatus,
  cancelRegionAssignment,
  getExperienceCounts,
} from '../controllers/admin/syncController.js';
import {
  listCurators,
  createCuratorAssignment,
  revokeCuratorAssignment,
  getCuratorActivity,
} from '../controllers/admin/curatorController.js';

const router = Router();

// =============================================================================
// Sync Routes
// =============================================================================

// List all experience sources
router.get('/sync/sources', getSources);

// Reorder experience sources (set display_priority)
router.put('/sync/sources/reorder', validate(reorderSourcesBodySchema), reorderSources);

// Start sync for a source
router.post('/sync/sources/:sourceId/start', validate(sourceIdParamSchema, 'params'), validate(startSyncBodySchema), startSync);

// Get sync status for a source (poll this endpoint)
router.get('/sync/sources/:sourceId/status', validate(sourceIdParamSchema, 'params'), getSyncStatus);

// Cancel sync for a source
router.post('/sync/sources/:sourceId/cancel', validate(sourceIdParamSchema, 'params'), cancelSync);

// Fix missing images for a source
router.post('/sync/sources/:sourceId/fix-images', validate(sourceIdParamSchema, 'params'), fixImages);

// Get sync history/logs
router.get('/sync/logs', validate(syncLogsQuerySchema, 'query'), getSyncLogs);

// Get single sync log with error details
router.get('/sync/logs/:logId', validate(logIdParamSchema, 'params'), getSyncLogDetails);

// =============================================================================
// Experience Region Assignment Routes
// =============================================================================

// Start region assignment for a world view
router.post('/experiences/assign-regions', validate(startRegionAssignmentBodySchema), startRegionAssignment);

// Get region assignment status
router.get('/experiences/assign-regions/status', validate(regionAssignmentStatusQuerySchema, 'query'), getRegionAssignmentStatus);

// Cancel region assignment
router.post('/experiences/assign-regions/cancel', validate(startRegionAssignmentBodySchema), cancelRegionAssignment);

// Get experience counts by region
router.get('/experiences/counts-by-region', validate(experienceCountsQuerySchema, 'query'), getExperienceCounts);

// =============================================================================
// Curator Management Routes
// =============================================================================

// List all curators with scopes
router.get('/curators', listCurators);

// Create a curator assignment (promote user + assign scope)
router.post('/curators', validate(createCuratorAssignmentBodySchema), createCuratorAssignment);

// Revoke a curator assignment (and potentially demote role)
router.delete('/curators/:assignmentId', validate(assignmentIdParamSchema, 'params'), revokeCuratorAssignment);

// Get curator activity log
router.get('/curators/:userId/activity', validate(userIdParamSchema, 'params'), validate(curatorActivityQuerySchema, 'query'), getCuratorActivity);

// =============================================================================
// User Search (for curator promotion)
// =============================================================================

router.get('/users/search', validate(adminUserSearchQuerySchema, 'query'), async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const { q } = req.query as unknown as { q: string };

  const result = await pool.query(`
    SELECT id, display_name, email, role
    FROM users
    WHERE display_name ILIKE $1 OR email ILIKE $1
    ORDER BY display_name
    LIMIT 20
  `, [`%${q}%`]);

  res.json(result.rows);
});

// =============================================================================
// Geometry Routes (to be moved from worldViewRoutes in future)
// =============================================================================
// TODO: Move geometry computation endpoints here from worldViewRoutes
// POST /geometry/world-views/:id/compute
// GET /geometry/world-views/:id/status

export default router;
