/**
 * Experience Controller
 *
 * Handles public experience browsing and user visited experiences.
 * Browse endpoints are public, marking visited requires authentication.
 */

import { Request, Response } from 'express';
import { pool } from '../../db/index.js';
import type { AuthenticatedRequest } from '../../middleware/auth.js';

// =============================================================================
// Public Endpoints - Experience Browsing
// =============================================================================

/**
 * List experiences with filtering and pagination
 * GET /api/experiences
 *
 * Query params:
 * - sourceId: Filter by source
 * - category: Filter by category (cultural, natural, mixed)
 * - regionId: Filter by region (includes experiences in child regions)
 * - search: Search by name
 * - limit: Max results (default 50, max 200)
 * - offset: Pagination offset
 * - bbox: Bounding box filter "west,south,east,north"
 */
export async function listExperiences(req: Request, res: Response): Promise<void> {
  const sourceId = req.query.sourceId ? parseInt(String(req.query.sourceId)) : null;
  const category = req.query.category ? String(req.query.category) : null;
  const country = req.query.country ? String(req.query.country) : null;
  const regionId = req.query.regionId ? parseInt(String(req.query.regionId)) : null;
  const search = req.query.search ? String(req.query.search) : null;
  const bbox = req.query.bbox ? String(req.query.bbox) : null;
  const limit = Math.min(parseInt(String(req.query.limit)) || 50, 5000);
  const offset = parseInt(String(req.query.offset)) || 0;

  let query = `
    SELECT
      e.id,
      e.external_id,
      e.name,
      e.short_description,
      e.category,
      e.country_codes,
      e.country_names,
      e.image_url,
      e.metadata->>'dateInscribed' as date_inscribed,
      e.metadata->>'inDanger' as in_danger,
      ST_X(e.location) as longitude,
      ST_Y(e.location) as latitude,
      s.name as source_name,
      s.display_priority as source_priority
    FROM experiences e
    JOIN experience_sources s ON e.source_id = s.id
  `;

  const conditions: string[] = [];
  const params: (string | number)[] = [];
  let paramIndex = 1;

  if (sourceId) {
    conditions.push(`e.source_id = $${paramIndex++}`);
    params.push(sourceId);
  }

  if (category) {
    conditions.push(`e.category = $${paramIndex++}`);
    params.push(category);
  }

  if (regionId) {
    // Include experiences in this region or any descendant region
    conditions.push(`e.id IN (
      SELECT er.experience_id FROM experience_regions er
      WHERE er.region_id = $${paramIndex++}
    )`);
    params.push(regionId);
  }

  if (country) {
    conditions.push(`$${paramIndex++} = ANY(e.country_codes)`);
    params.push(country.toUpperCase());
  }

  if (search) {
    conditions.push(`e.name ILIKE $${paramIndex++}`);
    params.push(`%${search}%`);
  }

  if (bbox) {
    const [west, south, east, north] = bbox.split(',').map(Number);
    if (!isNaN(west) && !isNaN(south) && !isNaN(east) && !isNaN(north)) {
      conditions.push(`ST_Intersects(e.location, ST_MakeEnvelope($${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, 4326))`);
      params.push(west, south, east, north);
    }
  }

  if (conditions.length > 0) {
    query += ' WHERE ' + conditions.join(' AND ');
  }

  // Snapshot filter params before adding limit/offset
  const filterParams = [...params];

  query += ` ORDER BY e.name LIMIT $${paramIndex++} OFFSET $${paramIndex}`;
  params.push(limit, offset);

  const result = await pool.query(query, params);

  // Get total count for pagination (same WHERE, no LIMIT/OFFSET)
  let countQuery = 'SELECT COUNT(*) FROM experiences e JOIN experience_sources s ON e.source_id = s.id';
  if (conditions.length > 0) {
    countQuery += ' WHERE ' + conditions.join(' AND ');
  }
  const countResult = await pool.query(countQuery, filterParams);

  res.json({
    experiences: result.rows.map(row => ({
      ...row,
      in_danger: row.in_danger === 'true',
    })),
    total: parseInt(countResult.rows[0].count),
    limit,
    offset,
  });
}

/**
 * Get single experience by ID
 * GET /api/experiences/:id
 */
export async function getExperience(req: Request, res: Response): Promise<void> {
  const id = parseInt(String(req.params.id));

  const result = await pool.query(`
    SELECT
      e.id,
      e.source_id,
      e.external_id,
      e.name,
      e.name_local,
      e.description,
      e.short_description,
      e.category,
      e.tags,
      e.country_codes,
      e.country_names,
      e.image_url,
      e.metadata,
      e.created_at,
      e.updated_at,
      ST_X(e.location) as longitude,
      ST_Y(e.location) as latitude,
      ST_AsGeoJSON(e.boundary)::json as boundary_geojson,
      e.area_km2,
      s.name as source_name,
      s.description as source_description
    FROM experiences e
    JOIN experience_sources s ON e.source_id = s.id
    WHERE e.id = $1
  `, [id]);

  if (result.rows.length === 0) {
    res.status(404).json({ error: 'Experience not found' });
    return;
  }

  // Get assigned regions
  const regionsResult = await pool.query(`
    SELECT r.id, r.name, r.world_view_id, wv.name as world_view_name
    FROM experience_regions er
    JOIN regions r ON er.region_id = r.id
    JOIN world_views wv ON r.world_view_id = wv.id
    WHERE er.experience_id = $1
    ORDER BY wv.name, r.name
  `, [id]);

  res.json({
    ...result.rows[0],
    regions: regionsResult.rows,
  });
}

/**
 * Get experiences by region
 * GET /api/experiences/by-region/:regionId
 *
 * Uses optionalAuth: curators see rejected items marked with is_rejected,
 * regular users have them filtered out entirely.
 */
export async function getExperiencesByRegion(req: AuthenticatedRequest, res: Response): Promise<void> {
  const regionId = parseInt(String(req.params.regionId));
  const includeChildren = req.query.includeChildren !== 'false';
  const limit = Math.min(parseInt(String(req.query.limit)) || 100, 500);
  const offset = parseInt(String(req.query.offset)) || 0;

  // Determine if the user is a curator with scope for this region
  const userRole = req.user?.role;
  const userId = req.user?.id;
  const showRejected = userId && userRole && (userRole === 'curator' || userRole === 'admin')
    ? await import('../../middleware/auth.js').then(m => m.checkCuratorScope(userId, userRole, regionId))
    : false;

  // Rejection fields: include for curators, filter for others
  // For includeChildren, check rejections against all descendant regions (not just $1)
  const simpleRejectionJoin = `LEFT JOIN experience_rejections rej ON rej.experience_id = e.id AND rej.region_id = $1`;
  const descendantRejectionJoin = `LEFT JOIN experience_rejections rej ON rej.experience_id = e.id AND rej.region_id IN (SELECT id FROM descendant_regions)`;
  const rejectionFilter = showRejected ? '' : ' AND rej.id IS NULL';

  let query: string;
  let params: (number | string)[];

  if (includeChildren) {
    const rejectionSelect = showRejected
      ? `, bool_or(rej.id IS NOT NULL) as is_rejected, MAX(rej.reason) as rejection_reason`
      : '';
    query = `
      WITH RECURSIVE descendant_regions AS (
        SELECT id FROM regions WHERE id = $1
        UNION ALL
        SELECT r.id FROM regions r
        JOIN descendant_regions dr ON r.parent_region_id = dr.id
      )
      SELECT
        e.id,
        e.external_id,
        e.name,
        e.short_description,
        e.category,
        e.country_codes,
        e.country_names,
        e.image_url,
        e.created_at,
        ST_X(e.location) as longitude,
        ST_Y(e.location) as latitude,
        e.metadata->>'inDanger' as in_danger,
        (SELECT COUNT(*)::int FROM experience_locations el WHERE el.experience_id = e.id) as location_count,
        s.name as source_name,
        s.display_priority as source_priority
        ${rejectionSelect}
      FROM experiences e
      JOIN experience_regions er ON e.id = er.experience_id
      JOIN experience_sources s ON e.source_id = s.id
      ${descendantRejectionJoin}
      WHERE er.region_id IN (SELECT id FROM descendant_regions)
      ${rejectionFilter}
      GROUP BY e.id, s.name, s.display_priority
      ORDER BY e.name
      LIMIT $2 OFFSET $3
    `;
    params = [regionId, limit, offset];
  } else {
    const rejectionSelect = showRejected
      ? `, rej.id IS NOT NULL as is_rejected, rej.reason as rejection_reason`
      : '';
    query = `
      SELECT
        e.id,
        e.external_id,
        e.name,
        e.short_description,
        e.category,
        e.country_codes,
        e.country_names,
        e.image_url,
        e.created_at,
        ST_X(e.location) as longitude,
        ST_Y(e.location) as latitude,
        e.metadata->>'inDanger' as in_danger,
        (SELECT COUNT(*)::int FROM experience_locations el WHERE el.experience_id = e.id) as location_count,
        s.name as source_name,
        s.display_priority as source_priority
        ${rejectionSelect}
      FROM experiences e
      JOIN experience_regions er ON e.id = er.experience_id
      JOIN experience_sources s ON e.source_id = s.id
      ${simpleRejectionJoin}
      WHERE er.region_id = $1
      ${rejectionFilter}
      ORDER BY e.name
      LIMIT $2 OFFSET $3
    `;
    params = [regionId, limit, offset];
  }

  const result = await pool.query(query, params);

  // Get region info
  const regionResult = await pool.query(`
    SELECT r.id, r.name, wv.name as world_view_name
    FROM regions r
    JOIN world_views wv ON r.world_view_id = wv.id
    WHERE r.id = $1
  `, [regionId]);

  if (regionResult.rows.length === 0) {
    res.status(404).json({ error: 'Region not found' });
    return;
  }

  res.json({
    region: regionResult.rows[0],
    experiences: result.rows.map(row => ({
      ...row,
      in_danger: row.in_danger === 'true',
    })),
    total: result.rows.length,
    limit,
    offset,
  });
}

/**
 * List experience sources
 * GET /api/experiences/sources
 */
export async function listSources(req: Request, res: Response): Promise<void> {
  const result = await pool.query(`
    SELECT
      s.id,
      s.name,
      s.description,
      s.is_active,
      s.last_sync_at,
      s.last_sync_status,
      s.display_priority,
      (SELECT COUNT(*) FROM experiences WHERE source_id = s.id) as experience_count
    FROM experience_sources s
    WHERE s.is_active = true
    ORDER BY s.display_priority, s.name
  `);

  res.json(result.rows);
}

/**
 * Search experiences with full-text search
 * GET /api/experiences/search
 */
export async function searchExperiences(req: Request, res: Response): Promise<void> {
  const query = req.query.q ? String(req.query.q) : '';
  const limit = Math.min(parseInt(String(req.query.limit)) || 20, 100);

  if (!query || query.length < 2) {
    res.status(400).json({ error: 'Search query must be at least 2 characters' });
    return;
  }

  const result = await pool.query(`
    SELECT
      e.id,
      e.name,
      e.short_description,
      e.category,
      e.country_names,
      e.image_url,
      ST_X(e.location) as longitude,
      ST_Y(e.location) as latitude,
      similarity(e.name, $1) as relevance
    FROM experiences e
    WHERE e.name ILIKE $2
       OR e.name % $1
    ORDER BY
      CASE WHEN e.name ILIKE $2 THEN 0 ELSE 1 END,
      similarity(e.name, $1) DESC
    LIMIT $3
  `, [query, `%${query}%`, limit]);

  res.json({
    query,
    results: result.rows,
    total: result.rows.length,
  });
}

/**
 * Get experience counts per region per source for a world view
 * GET /api/experiences/region-counts
 *
 * Query params:
 * - worldViewId: Required. The world view to get counts for
 * - parentRegionId: Optional. If provided, returns counts for subregions only
 *
 * Returns an array of { region_id, region_name, has_subregions, source_counts: { [sourceId]: count } }
 * Only returns direct assignment counts (not recursive children).
 */
export async function getExperienceRegionCounts(req: Request, res: Response): Promise<void> {
  const worldViewId = req.query.worldViewId ? parseInt(String(req.query.worldViewId)) : null;
  const parentRegionId = req.query.parentRegionId ? parseInt(String(req.query.parentRegionId)) : null;

  if (!worldViewId) {
    res.status(400).json({ error: 'worldViewId is required' });
    return;
  }

  // Get counts broken down by source for regions at the requested level
  // Exclude rejected experiences from counts
  const result = await pool.query(`
    SELECT
      r.id as region_id,
      r.name as region_name,
      r.color as region_color,
      EXISTS(SELECT 1 FROM regions c WHERE c.parent_region_id = r.id LIMIT 1) as has_subregions,
      e.source_id,
      COUNT(DISTINCT er.experience_id) as count
    FROM regions r
    JOIN experience_regions er ON r.id = er.region_id
    JOIN experiences e ON er.experience_id = e.id
    LEFT JOIN experience_rejections rej ON rej.experience_id = e.id AND rej.region_id = r.id
    WHERE r.world_view_id = $1
      AND ${parentRegionId ? 'r.parent_region_id = $2' : 'r.parent_region_id IS NULL'}
      AND rej.id IS NULL
    GROUP BY r.id, r.name, r.color, e.source_id
    ORDER BY r.name
  `, parentRegionId ? [worldViewId, parentRegionId] : [worldViewId]);

  // Also get regions with zero experiences at this level (for complete tree)
  const allRegionsResult = await pool.query(`
    SELECT
      r.id as region_id,
      r.name as region_name,
      r.color as region_color,
      EXISTS(SELECT 1 FROM regions c WHERE c.parent_region_id = r.id LIMIT 1) as has_subregions
    FROM regions r
    WHERE r.world_view_id = $1
      AND ${parentRegionId ? 'r.parent_region_id = $2' : 'r.parent_region_id IS NULL'}
    ORDER BY r.name
  `, parentRegionId ? [worldViewId, parentRegionId] : [worldViewId]);

  // Aggregate into { regionId -> { sourceId -> count } }
  const countMap = new Map<number, Record<number, number>>();
  for (const row of result.rows) {
    const rid = row.region_id;
    if (!countMap.has(rid)) countMap.set(rid, {});
    countMap.get(rid)![row.source_id] = parseInt(row.count);
  }

  const response = allRegionsResult.rows.map(row => ({
    region_id: row.region_id,
    region_name: row.region_name,
    region_color: row.region_color,
    has_subregions: row.has_subregions,
    source_counts: countMap.get(row.region_id) || {},
  }));

  res.json(response);
}

// =============================================================================
// Authenticated Endpoints - User Visited Experiences
// =============================================================================

/**
 * Get current user's visited experiences
 * GET /api/users/me/visited-experiences
 */
export async function getVisitedExperiences(req: AuthenticatedRequest, res: Response): Promise<void> {
  const userId = req.user?.id;
  if (!userId) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  const sourceId = req.query.sourceId ? parseInt(String(req.query.sourceId)) : null;
  const limit = Math.min(parseInt(String(req.query.limit)) || 100, 500);
  const offset = parseInt(String(req.query.offset)) || 0;

  let query = `
    SELECT
      uve.id as visit_id,
      uve.visited_at,
      uve.notes,
      uve.rating,
      e.id,
      e.name,
      e.short_description,
      e.category,
      e.country_names,
      e.image_url,
      ST_X(e.location) as longitude,
      ST_Y(e.location) as latitude,
      s.name as source_name
    FROM user_visited_experiences uve
    JOIN experiences e ON uve.experience_id = e.id
    JOIN experience_sources s ON e.source_id = s.id
    WHERE uve.user_id = $1
  `;

  const params: (number | string)[] = [userId];
  let paramIndex = 2;

  if (sourceId) {
    query += ` AND e.source_id = $${paramIndex++}`;
    params.push(sourceId);
  }

  query += ` ORDER BY uve.visited_at DESC LIMIT $${paramIndex++} OFFSET $${paramIndex}`;
  params.push(limit, offset);

  const result = await pool.query(query, params);

  // Get total count
  let countQuery = 'SELECT COUNT(*) FROM user_visited_experiences uve JOIN experiences e ON uve.experience_id = e.id WHERE uve.user_id = $1';
  const countParams: number[] = [userId];
  if (sourceId) {
    countQuery += ' AND e.source_id = $2';
    countParams.push(sourceId);
  }
  const countResult = await pool.query(countQuery, countParams);

  res.json({
    visited: result.rows,
    total: parseInt(countResult.rows[0].count),
    limit,
    offset,
  });
}

/**
 * Mark experience as visited
 * POST /api/users/me/visited-experiences/:experienceId
 */
export async function markVisited(req: AuthenticatedRequest, res: Response): Promise<void> {
  const userId = req.user?.id;
  if (!userId) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  const experienceId = parseInt(String(req.params.experienceId));
  const notes = req.body.notes ? String(req.body.notes) : null;
  const rating = req.body.rating ? parseInt(String(req.body.rating)) : null;

  // Validate rating if provided
  if (rating !== null && (rating < 1 || rating > 5)) {
    res.status(400).json({ error: 'Rating must be between 1 and 5' });
    return;
  }

  // Verify experience exists
  const expResult = await pool.query('SELECT id, name FROM experiences WHERE id = $1', [experienceId]);
  if (expResult.rows.length === 0) {
    res.status(404).json({ error: 'Experience not found' });
    return;
  }

  // Upsert visited record
  const result = await pool.query(`
    INSERT INTO user_visited_experiences (user_id, experience_id, notes, rating, visited_at)
    VALUES ($1, $2, $3, $4, NOW())
    ON CONFLICT (user_id, experience_id) DO UPDATE SET
      notes = COALESCE($3, user_visited_experiences.notes),
      rating = COALESCE($4, user_visited_experiences.rating),
      visited_at = NOW()
    RETURNING id, visited_at, notes, rating
  `, [userId, experienceId, notes, rating]);

  res.json({
    success: true,
    experienceId,
    experienceName: expResult.rows[0].name,
    ...result.rows[0],
  });
}

/**
 * Unmark experience as visited
 * DELETE /api/users/me/visited-experiences/:experienceId
 */
export async function unmarkVisited(req: AuthenticatedRequest, res: Response): Promise<void> {
  const userId = req.user?.id;
  if (!userId) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  const experienceId = parseInt(String(req.params.experienceId));

  const result = await pool.query(
    'DELETE FROM user_visited_experiences WHERE user_id = $1 AND experience_id = $2 RETURNING id',
    [userId, experienceId]
  );

  if (result.rowCount === 0) {
    res.status(404).json({ error: 'Visit record not found' });
    return;
  }

  res.json({ success: true, experienceId });
}

/**
 * Update visit notes/rating
 * PATCH /api/users/me/visited-experiences/:experienceId
 */
export async function updateVisit(req: AuthenticatedRequest, res: Response): Promise<void> {
  const userId = req.user?.id;
  if (!userId) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  const experienceId = parseInt(String(req.params.experienceId));
  const notes = req.body.notes !== undefined ? (req.body.notes ? String(req.body.notes) : null) : undefined;
  const rating = req.body.rating !== undefined ? (req.body.rating ? parseInt(String(req.body.rating)) : null) : undefined;

  // Validate rating if provided
  if (rating !== undefined && rating !== null && (rating < 1 || rating > 5)) {
    res.status(400).json({ error: 'Rating must be between 1 and 5' });
    return;
  }

  // Build update query
  const updates: string[] = [];
  const params: (number | string | null)[] = [userId, experienceId];
  let paramIndex = 3;

  if (notes !== undefined) {
    updates.push(`notes = $${paramIndex++}`);
    params.push(notes);
  }
  if (rating !== undefined) {
    updates.push(`rating = $${paramIndex++}`);
    params.push(rating);
  }

  if (updates.length === 0) {
    res.status(400).json({ error: 'No updates provided' });
    return;
  }

  const result = await pool.query(`
    UPDATE user_visited_experiences
    SET ${updates.join(', ')}
    WHERE user_id = $1 AND experience_id = $2
    RETURNING id, visited_at, notes, rating
  `, params);

  if (result.rowCount === 0) {
    res.status(404).json({ error: 'Visit record not found' });
    return;
  }

  res.json({
    success: true,
    experienceId,
    ...result.rows[0],
  });
}

/**
 * Get visited experience IDs for quick lookup
 * GET /api/users/me/visited-experiences/ids
 */
export async function getVisitedIds(req: AuthenticatedRequest, res: Response): Promise<void> {
  const userId = req.user?.id;
  if (!userId) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  const sourceId = req.query.sourceId ? parseInt(String(req.query.sourceId)) : null;

  let query = `
    SELECT uve.experience_id
    FROM user_visited_experiences uve
  `;

  const params: number[] = [userId];

  if (sourceId) {
    query += `
      JOIN experiences e ON uve.experience_id = e.id
      WHERE uve.user_id = $1 AND e.source_id = $2
    `;
    params.push(sourceId);
  } else {
    query += ' WHERE uve.user_id = $1';
  }

  const result = await pool.query(query, params);

  res.json({
    visitedIds: result.rows.map(r => r.experience_id),
    total: result.rows.length,
  });
}

// =============================================================================
// Multi-Location Support
// =============================================================================

/**
 * Get locations for an experience
 * GET /api/experiences/:id/locations
 * Query params:
 *   - regionId: Filter to show which locations are in this region
 */
export async function getExperienceLocations(req: Request, res: Response): Promise<void> {
  const experienceId = parseInt(String(req.params.id));
  const regionId = req.query.regionId ? parseInt(String(req.query.regionId)) : null;

  // Verify experience exists
  const expResult = await pool.query('SELECT id, name FROM experiences WHERE id = $1', [experienceId]);
  if (expResult.rows.length === 0) {
    res.status(404).json({ error: 'Experience not found' });
    return;
  }

  // Get locations with region membership info
  const result = await pool.query(`
    SELECT
      el.id,
      el.experience_id,
      el.name,
      el.external_ref,
      el.ordinal,
      ST_X(el.location) as longitude,
      ST_Y(el.location) as latitude,
      el.created_at,
      ${regionId ? `EXISTS(
        SELECT 1 FROM experience_location_regions elr
        WHERE elr.location_id = el.id AND elr.region_id = $2
      ) as in_region` : 'true as in_region'}
    FROM experience_locations el
    WHERE el.experience_id = $1
    ORDER BY el.ordinal
  `, regionId ? [experienceId, regionId] : [experienceId]);

  res.json({
    experienceId,
    experienceName: expResult.rows[0].name,
    locations: result.rows,
    totalLocations: result.rows.length,
    regionId,
  });
}

/**
 * Get contents (artworks, artifacts) for an experience
 * GET /api/experiences/:id/contents
 */
export async function getExperienceContents(req: Request, res: Response): Promise<void> {
  const experienceId = parseInt(String(req.params.id));

  const result = await pool.query(`
    SELECT
      id, external_id, name, content_type, artist, year,
      image_url, sitelinks_count
    FROM experience_contents
    WHERE experience_id = $1
    ORDER BY sitelinks_count DESC
  `, [experienceId]);

  res.json({
    experienceId,
    contents: result.rows,
    total: result.rows.length,
  });
}

/**
 * Get visited location IDs for current user
 * GET /api/users/me/visited-locations/ids
 */
export async function getVisitedLocationIds(req: AuthenticatedRequest, res: Response): Promise<void> {
  const userId = req.user?.id;
  if (!userId) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  const experienceId = req.query.experienceId ? parseInt(String(req.query.experienceId)) : null;

  let query = `
    SELECT uvl.location_id, el.experience_id
    FROM user_visited_locations uvl
    JOIN experience_locations el ON uvl.location_id = el.id
    WHERE uvl.user_id = $1
  `;

  const params: number[] = [userId];

  if (experienceId) {
    query += ' AND el.experience_id = $2';
    params.push(experienceId);
  }

  const result = await pool.query(query, params);

  // Group by experience for easy lookup
  const byExperience: Record<number, number[]> = {};
  for (const row of result.rows) {
    if (!byExperience[row.experience_id]) {
      byExperience[row.experience_id] = [];
    }
    byExperience[row.experience_id].push(row.location_id);
  }

  res.json({
    visitedLocationIds: result.rows.map(r => r.location_id),
    byExperience,
    total: result.rows.length,
  });
}

/**
 * Mark a location as visited
 * POST /api/users/me/visited-locations/:locationId
 */
export async function markLocationVisited(req: AuthenticatedRequest, res: Response): Promise<void> {
  const userId = req.user?.id;
  if (!userId) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  const locationId = parseInt(String(req.params.locationId));
  const notes = req.body.notes ? String(req.body.notes) : null;

  // Verify location exists and get experience info
  const locResult = await pool.query(`
    SELECT el.id, el.name, el.experience_id, e.name as experience_name
    FROM experience_locations el
    JOIN experiences e ON el.experience_id = e.id
    WHERE el.id = $1
  `, [locationId]);

  if (locResult.rows.length === 0) {
    res.status(404).json({ error: 'Location not found' });
    return;
  }

  const location = locResult.rows[0];

  // Upsert visited record
  const result = await pool.query(`
    INSERT INTO user_visited_locations (user_id, location_id, notes, visited_at)
    VALUES ($1, $2, $3, NOW())
    ON CONFLICT (user_id, location_id) DO UPDATE SET
      notes = COALESCE($3, user_visited_locations.notes),
      visited_at = NOW()
    RETURNING id, visited_at, notes
  `, [userId, locationId, notes]);

  // Also mark the experience as visited (via any location) in user_visited_experiences
  // This maintains backward compatibility
  await pool.query(`
    INSERT INTO user_visited_experiences (user_id, experience_id, visited_at)
    VALUES ($1, $2, NOW())
    ON CONFLICT (user_id, experience_id) DO NOTHING
  `, [userId, location.experience_id]);

  res.json({
    success: true,
    locationId,
    locationName: location.name,
    experienceId: location.experience_id,
    experienceName: location.experience_name,
    ...result.rows[0],
  });
}

/**
 * Unmark a location as visited
 * DELETE /api/users/me/visited-locations/:locationId
 */
export async function unmarkLocationVisited(req: AuthenticatedRequest, res: Response): Promise<void> {
  const userId = req.user?.id;
  if (!userId) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  const locationId = parseInt(String(req.params.locationId));

  // Get the experience ID before deleting
  const locResult = await pool.query(`
    SELECT el.experience_id FROM experience_locations el WHERE el.id = $1
  `, [locationId]);

  if (locResult.rows.length === 0) {
    res.status(404).json({ error: 'Location not found' });
    return;
  }

  const experienceId = locResult.rows[0].experience_id;

  // Delete the visit record
  const result = await pool.query(
    'DELETE FROM user_visited_locations WHERE user_id = $1 AND location_id = $2 RETURNING id',
    [userId, locationId]
  );

  if (result.rowCount === 0) {
    res.status(404).json({ error: 'Visit record not found' });
    return;
  }

  // Check if user still has any visited locations for this experience
  // If not, remove the experience from user_visited_experiences too
  const remainingResult = await pool.query(`
    SELECT COUNT(*) as count
    FROM user_visited_locations uvl
    JOIN experience_locations el ON uvl.location_id = el.id
    WHERE uvl.user_id = $1 AND el.experience_id = $2
  `, [userId, experienceId]);

  if (parseInt(remainingResult.rows[0].count) === 0) {
    await pool.query(
      'DELETE FROM user_visited_experiences WHERE user_id = $1 AND experience_id = $2',
      [userId, experienceId]
    );
  }

  res.json({ success: true, locationId, experienceId });
}

/**
 * Mark locations of an experience as visited
 * POST /api/users/me/experiences/:experienceId/mark-all-locations
 * Query params:
 *   - regionId: If provided, only mark locations that are in this region
 */
export async function markAllLocationsVisited(req: AuthenticatedRequest, res: Response): Promise<void> {
  const userId = req.user?.id;
  if (!userId) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  const experienceId = parseInt(String(req.params.experienceId));
  const regionId = req.query.regionId ? parseInt(String(req.query.regionId)) : null;

  // Get locations for this experience, optionally filtered by region
  let locationsQuery: string;
  let locationsParams: number[];

  if (regionId) {
    // Only locations that are in the specified region
    locationsQuery = `
      SELECT el.id
      FROM experience_locations el
      JOIN experience_location_regions elr ON elr.location_id = el.id
      WHERE el.experience_id = $1 AND elr.region_id = $2
    `;
    locationsParams = [experienceId, regionId];
  } else {
    // All locations
    locationsQuery = `SELECT id FROM experience_locations WHERE experience_id = $1`;
    locationsParams = [experienceId];
  }

  const locationsResult = await pool.query(locationsQuery, locationsParams);

  if (locationsResult.rows.length === 0) {
    res.status(404).json({ error: 'Experience not found or has no locations in this region' });
    return;
  }

  // Mark locations as visited in a single transaction
  await pool.query('BEGIN');
  try {
    for (const loc of locationsResult.rows) {
      await pool.query(`
        INSERT INTO user_visited_locations (user_id, location_id, visited_at)
        VALUES ($1, $2, NOW())
        ON CONFLICT (user_id, location_id) DO NOTHING
      `, [userId, loc.id]);
    }

    // Also mark the experience itself as visited for backward compatibility
    await pool.query(`
      INSERT INTO user_visited_experiences (user_id, experience_id, visited_at)
      VALUES ($1, $2, NOW())
      ON CONFLICT (user_id, experience_id) DO NOTHING
    `, [userId, experienceId]);

    await pool.query('COMMIT');
  } catch (error) {
    await pool.query('ROLLBACK');
    throw error;
  }

  res.json({
    success: true,
    experienceId,
    regionId,
    locationsMarked: locationsResult.rows.length,
  });
}

/**
 * Unmark locations of an experience as visited
 * DELETE /api/users/me/experiences/:experienceId/mark-all-locations
 * Query params:
 *   - regionId: If provided, only unmark locations that are in this region
 */
export async function unmarkAllLocationsVisited(req: AuthenticatedRequest, res: Response): Promise<void> {
  const userId = req.user?.id;
  if (!userId) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  const experienceId = parseInt(String(req.params.experienceId));
  const regionId = req.query.regionId ? parseInt(String(req.query.regionId)) : null;

  await pool.query('BEGIN');
  try {
    let result;

    if (regionId) {
      // Only unmark locations that are in the specified region
      result = await pool.query(`
        DELETE FROM user_visited_locations
        WHERE user_id = $1 AND location_id IN (
          SELECT el.id
          FROM experience_locations el
          JOIN experience_location_regions elr ON elr.location_id = el.id
          WHERE el.experience_id = $2 AND elr.region_id = $3
        )
      `, [userId, experienceId, regionId]);
    } else {
      // Unmark all locations
      result = await pool.query(`
        DELETE FROM user_visited_locations
        WHERE user_id = $1 AND location_id IN (
          SELECT id FROM experience_locations WHERE experience_id = $2
        )
      `, [userId, experienceId]);
    }

    // Check if user still has any visited locations for this experience
    // If not, remove the experience from user_visited_experiences too
    const remainingResult = await pool.query(`
      SELECT COUNT(*) as count
      FROM user_visited_locations uvl
      JOIN experience_locations el ON uvl.location_id = el.id
      WHERE uvl.user_id = $1 AND el.experience_id = $2
    `, [userId, experienceId]);

    if (parseInt(remainingResult.rows[0].count) === 0) {
      await pool.query(
        'DELETE FROM user_visited_experiences WHERE user_id = $1 AND experience_id = $2',
        [userId, experienceId]
      );
    }

    await pool.query('COMMIT');

    res.json({
      success: true,
      experienceId,
      regionId,
      locationsUnmarked: result.rowCount || 0,
    });
  } catch (error) {
    await pool.query('ROLLBACK');
    throw error;
  }
}

// =============================================================================
// Viewed Contents (artwork "seen" tracking)
// =============================================================================

/**
 * Get viewed content IDs for current user
 * GET /api/users/me/viewed-contents/ids
 */
export async function getViewedContentIds(req: AuthenticatedRequest, res: Response): Promise<void> {
  const userId = req.user?.id;
  if (!userId) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  const experienceId = req.query.experienceId ? parseInt(String(req.query.experienceId)) : null;

  let query = `
    SELECT uvc.content_id
    FROM user_viewed_contents uvc
    JOIN experience_contents ec ON uvc.content_id = ec.id
    WHERE uvc.user_id = $1
  `;

  const params: number[] = [userId];

  if (experienceId) {
    query += ' AND ec.experience_id = $2';
    params.push(experienceId);
  }

  const result = await pool.query(query, params);

  res.json({
    viewedContentIds: result.rows.map(r => r.content_id),
  });
}

/**
 * Mark a content as viewed
 * POST /api/users/me/viewed-contents/:contentId
 * Also auto-marks the parent experience as visited.
 */
export async function markContentViewed(req: AuthenticatedRequest, res: Response): Promise<void> {
  const userId = req.user?.id;
  if (!userId) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  const contentId = parseInt(String(req.params.contentId));

  // Verify content exists and get experience info
  const contentResult = await pool.query(`
    SELECT ec.id, ec.name, ec.experience_id, e.name as experience_name
    FROM experience_contents ec
    JOIN experiences e ON ec.experience_id = e.id
    WHERE ec.id = $1
  `, [contentId]);

  if (contentResult.rows.length === 0) {
    res.status(404).json({ error: 'Content not found' });
    return;
  }

  const content = contentResult.rows[0];

  // Insert viewed record
  await pool.query(`
    INSERT INTO user_viewed_contents (user_id, content_id, viewed_at)
    VALUES ($1, $2, NOW())
    ON CONFLICT (user_id, content_id) DO NOTHING
  `, [userId, contentId]);

  // Auto-mark parent experience as visited
  await pool.query(`
    INSERT INTO user_visited_experiences (user_id, experience_id, visited_at)
    VALUES ($1, $2, NOW())
    ON CONFLICT (user_id, experience_id) DO NOTHING
  `, [userId, content.experience_id]);

  // Auto-mark all locations of the experience as visited
  // (needed because the checkbox state is driven by location visits)
  await pool.query(`
    INSERT INTO user_visited_locations (user_id, location_id, visited_at)
    SELECT $1, el.id, NOW()
    FROM experience_locations el
    WHERE el.experience_id = $2
    ON CONFLICT (user_id, location_id) DO NOTHING
  `, [userId, content.experience_id]);

  res.json({
    success: true,
    contentId,
    contentName: content.name,
    experienceId: content.experience_id,
    experienceName: content.experience_name,
  });
}

/**
 * Unmark a content as viewed
 * DELETE /api/users/me/viewed-contents/:contentId
 * Does NOT unvisit the parent experience.
 */
export async function unmarkContentViewed(req: AuthenticatedRequest, res: Response): Promise<void> {
  const userId = req.user?.id;
  if (!userId) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  const contentId = parseInt(String(req.params.contentId));

  const result = await pool.query(
    'DELETE FROM user_viewed_contents WHERE user_id = $1 AND content_id = $2 RETURNING id',
    [userId, contentId]
  );

  if (result.rowCount === 0) {
    res.status(404).json({ error: 'Viewed record not found' });
    return;
  }

  res.json({ success: true, contentId });
}

/**
 * Get experience visited status with location details
 * GET /api/experiences/:id/visited-status
 */
export async function getExperienceVisitedStatus(req: AuthenticatedRequest, res: Response): Promise<void> {
  const userId = req.user?.id;
  if (!userId) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  const experienceId = parseInt(String(req.params.id));

  // Get all locations with their visited status
  const result = await pool.query(`
    SELECT
      el.id as location_id,
      el.name,
      el.ordinal,
      ST_X(el.location) as longitude,
      ST_Y(el.location) as latitude,
      uvl.id as visit_id,
      uvl.visited_at,
      uvl.notes
    FROM experience_locations el
    LEFT JOIN user_visited_locations uvl ON uvl.location_id = el.id AND uvl.user_id = $2
    WHERE el.experience_id = $1
    ORDER BY el.ordinal
  `, [experienceId, userId]);

  if (result.rows.length === 0) {
    res.status(404).json({ error: 'Experience not found or has no locations' });
    return;
  }

  const totalLocations = result.rows.length;
  const visitedLocations = result.rows.filter(r => r.visit_id !== null).length;

  // Compute visited status
  let visitedStatus: 'not_visited' | 'partial' | 'visited';
  if (visitedLocations === 0) {
    visitedStatus = 'not_visited';
  } else if (visitedLocations === totalLocations) {
    visitedStatus = 'visited';
  } else {
    visitedStatus = 'partial';
  }

  res.json({
    experienceId,
    visitedStatus,
    totalLocations,
    visitedLocations,
    locations: result.rows.map(r => ({
      id: r.location_id,
      name: r.name,
      ordinal: r.ordinal,
      longitude: r.longitude,
      latitude: r.latitude,
      isVisited: r.visit_id !== null,
      visitedAt: r.visited_at,
      notes: r.notes,
    })),
  });
}
