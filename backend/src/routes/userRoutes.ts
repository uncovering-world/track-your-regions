import { Router, Response } from 'express';
import { respond } from '../api/respond.js';
import { MyAccount, type CuratorScope } from '../api/responses/auth.js';
import { VisitedRegion, VisitedRegions } from '../api/responses/visited.js';
import { curatorScopeOf, type CuratorScopeRow } from '../controllers/admin/curatorScopeRows.js';
import { pool } from '../db/index.js';
import type { UsersRow, UserVisitedRegionsRow } from '../db/schema.generated.js';
import { requireAuth, type AuthenticatedRequest } from '../middleware/auth.js';
import { authenticatedLimiter } from '../middleware/rateLimiter.js';
import { validate } from '../middleware/errorHandler.js';
import {
  regionIdParamSchema,
  worldViewIdParamSchema,
  experienceIdParamSchema,
  locationIdParamSchema,
  treasureIdParamSchema,
  markTreasureViewedBodySchema,
  idParamSchema,
  visitedRegionBodySchema,
  markVisitedBodySchema,
  updateVisitBodySchema,
  markLocationVisitedBodySchema,
  visitedExperiencesQuerySchema,
  visitedIdsQuerySchema,
  visitedLocationIdsQuerySchema,
  viewedTreasureIdsQuerySchema,
  markAllLocationsQuerySchema,
} from '../types/index.js';
import {
  getVisitedExperiences,
  markVisited,
  unmarkVisited,
  updateVisit,
  getVisitedIds,
  getVisitedLocationIds,
  markLocationVisited,
  unmarkLocationVisited,
  getExperienceVisitedStatus,
  markAllLocationsVisited,
  unmarkAllLocationsVisited,
  getViewedTreasureIds,
  markTreasureViewed,
  unmarkTreasureViewed,
} from '../controllers/experience/index.js';

const router = Router();

// Rate limit all user endpoints (60 req/min per IP)
router.use(authenticatedLimiter);

/**
 * GET /api/users/me
 * Get current user info (includes curatorScopes for curators/admins)
 */
router.get('/me', requireAuth, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  let body: MyAccount;
  try {
    // Fetch full profile from DB (the JWT carries no PII)
    const userResult = await pool.query<Pick<UsersRow, 'id' | 'uuid' | 'email' | 'display_name' | 'role' | 'avatar_url'>>(
      `SELECT id, uuid, email, display_name, role, avatar_url FROM users WHERE id = $1`,
      [req.user!.id],
    );
    if (userResult.rows.length === 0) {
      res.status(404).json({ error: 'User not found' });
      return;
    }
    const u = userResult.rows[0];

    // Include curator scopes for curators and admins
    let curatorScopes: CuratorScope[] | undefined;
    if (req.user!.role === 'curator' || req.user!.role === 'admin') {
      const scopesResult = await pool.query<CuratorScopeRow>(`
        SELECT
          ca.id, ca.scope_type, ca.region_id, r.name AS region_name,
          ca.source_id, es.name AS source_name, ca.assigned_at, ca.notes
        FROM curator_assignments ca
        LEFT JOIN regions r ON ca.region_id = r.id
        LEFT JOIN experience_sources es ON ca.source_id = es.id
        WHERE ca.user_id = $1
        ORDER BY ca.assigned_at DESC
      `, [req.user!.id]);
      curatorScopes = scopesResult.rows.map(curatorScopeOf);
    }

    body = {
      id: u.id,
      uuid: u.uuid,
      email: u.email,
      displayName: u.display_name,
      role: u.role,
      avatarUrl: u.avatar_url,
      curatorScopes,
    };
  } catch (error) {
    console.error('Error getting user:', error);
    res.status(500).json({ error: 'Failed to get user' });
    return;
  }
  respond(res, MyAccount, body);
});

/** A visited region as the three region statements select it. */
type VisitedRegionRow = Pick<UserVisitedRegionsRow, 'region_id' | 'visited_at' | 'notes'>;

/** A visited region as the answer declares it, key by key. */
function visitedRegionOf(row: VisitedRegionRow): VisitedRegion {
  return { region_id: row.region_id, visited_at: row.visited_at?.toISOString() ?? null, notes: row.notes };
}

/**
 * GET /api/users/me/visited-regions
 * Get all visited region IDs for current user
 */
router.get('/me/visited-regions', requireAuth, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  let rows: VisitedRegionRow[];
  try {
    const result = await pool.query<VisitedRegionRow>(
      `SELECT region_id, visited_at, notes 
       FROM user_visited_regions 
       WHERE user_id = $1 
       ORDER BY visited_at DESC`,
      [req.user!.id]
    );
    rows = result.rows;
  } catch (error) {
    console.error('Error getting visited regions:', error);
    res.status(500).json({ error: 'Failed to get visited regions' });
    return;
  }
  // Outside the try: a body that fails its schema is the named 500 `respond()`
  // raises (ADR-0066), not this route's generic message.
  respond(res, VisitedRegions, rows.map(visitedRegionOf));
});

/**
 * GET /api/users/me/visited-regions/by-world-view/:worldViewId
 * Get visited region IDs for a specific world view
 */
router.get('/me/visited-regions/by-world-view/:worldViewId', validate(worldViewIdParamSchema, 'params'), requireAuth, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  let rows: VisitedRegionRow[];
  try {
    const { worldViewId } = req.params as unknown as { worldViewId: number };

    const result = await pool.query<VisitedRegionRow>(
      `SELECT uvr.region_id, uvr.visited_at, uvr.notes
       FROM user_visited_regions uvr
       JOIN regions r ON r.id = uvr.region_id
       WHERE uvr.user_id = $1 AND r.world_view_id = $2
       ORDER BY uvr.visited_at DESC`,
      [req.user!.id, worldViewId]
    );
    rows = result.rows;
  } catch (error) {
    console.error('Error getting visited regions:', error);
    res.status(500).json({ error: 'Failed to get visited regions' });
    return;
  }
  respond(res, VisitedRegions, rows.map(visitedRegionOf));
});

/**
 * POST /api/users/me/visited-regions/:regionId
 * Mark a region as visited
 */
router.post('/me/visited-regions/:regionId', validate(regionIdParamSchema, 'params'), validate(visitedRegionBodySchema), requireAuth, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  let row: VisitedRegionRow;
  try {
    const { regionId } = req.params as unknown as { regionId: number };
    const { notes } = req.body || {};

    // Verify region exists
    const regionCheck = await pool.query(
      'SELECT id FROM regions WHERE id = $1',
      [regionId]
    );

    if (regionCheck.rows.length === 0) {
      res.status(404).json({ error: 'Region not found' });
      return;
    }

    // Insert or update
    const result = await pool.query<VisitedRegionRow>(
      `INSERT INTO user_visited_regions (user_id, region_id, notes)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id, region_id)
       DO UPDATE SET visited_at = NOW(), notes = COALESCE($3, user_visited_regions.notes)
       RETURNING region_id, visited_at, notes`,
      [req.user!.id, regionId, notes || null]
    );
    row = result.rows[0];
  } catch (error) {
    console.error('Error marking region as visited:', error);
    res.status(500).json({ error: 'Failed to mark region as visited' });
    return;
  }
  // Outside the try for the reason above, and one more: the write has committed
  // by now, which the named 500 says and the generic message would not.
  respond(res, VisitedRegion, visitedRegionOf(row));
});

/**
 * DELETE /api/users/me/visited-regions/:regionId
 * Unmark a region as visited
 */
router.delete('/me/visited-regions/:regionId', validate(regionIdParamSchema, 'params'), requireAuth, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { regionId } = req.params as unknown as { regionId: number };

    await pool.query(
      'DELETE FROM user_visited_regions WHERE user_id = $1 AND region_id = $2',
      [req.user!.id, regionId]
    );

    res.status(204).send();
  } catch (error) {
    console.error('Error unmarking region as visited:', error);
    res.status(500).json({ error: 'Failed to unmark region as visited' });
  }
});

// =============================================================================
// Visited Experiences Routes
// =============================================================================

/**
 * GET /api/users/me/visited-experiences
 * Get all visited experiences for current user
 */
router.get('/me/visited-experiences', validate(visitedExperiencesQuerySchema, 'query'), requireAuth, getVisitedExperiences);

/**
 * GET /api/users/me/visited-experiences/ids
 * Get just the IDs of visited experiences (for quick lookup)
 */
router.get('/me/visited-experiences/ids', validate(visitedIdsQuerySchema, 'query'), requireAuth, getVisitedIds);

/**
 * POST /api/users/me/visited-experiences/:experienceId
 * Mark an experience as visited
 */
router.post('/me/visited-experiences/:experienceId', validate(experienceIdParamSchema, 'params'), validate(markVisitedBodySchema), requireAuth, markVisited);

/**
 * PATCH /api/users/me/visited-experiences/:experienceId
 * Update visit notes/rating
 */
router.patch('/me/visited-experiences/:experienceId', validate(experienceIdParamSchema, 'params'), validate(updateVisitBodySchema), requireAuth, updateVisit);

/**
 * DELETE /api/users/me/visited-experiences/:experienceId
 * Unmark an experience as visited
 */
router.delete('/me/visited-experiences/:experienceId', validate(experienceIdParamSchema, 'params'), requireAuth, unmarkVisited);

// =============================================================================
// Visited Locations Routes (Multi-Location Support)
// =============================================================================

/**
 * GET /api/users/me/visited-locations/ids
 * Get IDs of visited locations for quick lookup
 */
router.get('/me/visited-locations/ids', validate(visitedLocationIdsQuerySchema, 'query'), requireAuth, getVisitedLocationIds);

/**
 * POST /api/users/me/visited-locations/:locationId
 * Mark a location as visited
 */
router.post('/me/visited-locations/:locationId', validate(locationIdParamSchema, 'params'), validate(markLocationVisitedBodySchema), requireAuth, markLocationVisited);

/**
 * DELETE /api/users/me/visited-locations/:locationId
 * Unmark a location as visited
 */
router.delete('/me/visited-locations/:locationId', validate(locationIdParamSchema, 'params'), requireAuth, unmarkLocationVisited);

/**
 * GET /api/users/me/experiences/:experienceId/visited-status
 * Get detailed visited status for an experience (locations breakdown)
 */
router.get('/me/experiences/:id/visited-status', validate(idParamSchema, 'params'), requireAuth, getExperienceVisitedStatus);

/**
 * POST /api/users/me/experiences/:experienceId/mark-all-locations
 * Mark ALL locations of an experience as visited
 */
router.post('/me/experiences/:experienceId/mark-all-locations', validate(experienceIdParamSchema, 'params'), validate(markAllLocationsQuerySchema, 'query'), requireAuth, markAllLocationsVisited);

/**
 * DELETE /api/users/me/experiences/:experienceId/mark-all-locations
 * Unmark ALL locations of an experience as visited
 */
router.delete('/me/experiences/:experienceId/mark-all-locations', validate(experienceIdParamSchema, 'params'), validate(markAllLocationsQuerySchema, 'query'), requireAuth, unmarkAllLocationsVisited);

// =============================================================================
// Viewed Treasures Routes (artwork "seen" tracking)
// =============================================================================

/**
 * GET /api/users/me/viewed-treasures/ids
 * Get IDs of viewed treasures for quick lookup
 */
router.get('/me/viewed-treasures/ids', validate(viewedTreasureIdsQuerySchema, 'query'), requireAuth, getViewedTreasureIds);

/**
 * POST /api/users/me/viewed-treasures/:treasureId
 * Mark a treasure as viewed (auto-marks parent experience as visited)
 */
router.post('/me/viewed-treasures/:treasureId', validate(treasureIdParamSchema, 'params'), validate(markTreasureViewedBodySchema), requireAuth, markTreasureViewed);

/**
 * DELETE /api/users/me/viewed-treasures/:treasureId
 * Unmark a treasure as viewed (does NOT unvisit parent experience)
 */
router.delete('/me/viewed-treasures/:treasureId', validate(treasureIdParamSchema, 'params'), requireAuth, unmarkTreasureViewed);

export default router;
