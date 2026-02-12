/**
 * Experience Query Controller
 *
 * Public browsing endpoints: list, get, search, region counts, categories.
 */

import { Request, Response } from 'express';
import { pool } from '../../db/index.js';
import type { AuthenticatedRequest } from '../../middleware/auth.js';

/**
 * List experiences with filtering and pagination
 * GET /api/experiences
 *
 * Query params:
 * - sourceId: Filter by source
 * - category: Filter by category (cultural, natural, mixed)
 * - regionId: Filter by region
 * - search: Search by name
 * - limit: Max results (default 50, max 5000)
 * - offset: Pagination offset
 * - bbox: Bounding box filter "west,south,east,north"
 */
export async function listExperiences(req: Request, res: Response): Promise<void> {
  const categoryId = req.query.categoryId ? parseInt(String(req.query.categoryId)) : null;
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
      s.name as category_name,
      s.display_priority as category_priority
    FROM experiences e
    JOIN experience_categories s ON e.category_id = s.id
  `;

  const conditions: string[] = [];
  const params: (string | number)[] = [];
  let paramIndex = 1;

  if (categoryId) {
    conditions.push(`e.category_id = $${paramIndex++}`);
    params.push(categoryId);
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
  let countQuery = 'SELECT COUNT(*) FROM experiences e JOIN experience_categories s ON e.category_id = s.id';
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
      e.category_id,
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
      s.name as category_name,
      s.description as category_description
    FROM experiences e
    JOIN experience_categories s ON e.category_id = s.id
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
        s.name as category_name,
        s.display_priority as category_priority
        ${rejectionSelect}
      FROM experiences e
      JOIN experience_regions er ON e.id = er.experience_id
      JOIN experience_categories s ON e.category_id = s.id
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
        s.name as category_name,
        s.display_priority as category_priority
        ${rejectionSelect}
      FROM experiences e
      JOIN experience_regions er ON e.id = er.experience_id
      JOIN experience_categories s ON e.category_id = s.id
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
 * List experience categories
 * GET /api/experiences/categories
 */
export async function listCategories(_req: Request, res: Response): Promise<void> {
  const result = await pool.query(`
    SELECT
      s.id,
      s.name,
      s.description,
      s.is_active,
      s.last_sync_at,
      s.last_sync_status,
      s.display_priority,
      (SELECT COUNT(*) FROM experiences WHERE category_id = s.id) as experience_count
    FROM experience_categories s
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
 * Returns an array of { region_id, region_name, has_subregions, category_counts: { [categoryId]: count } }
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
      e.category_id,
      COUNT(DISTINCT er.experience_id) as count
    FROM regions r
    JOIN experience_regions er ON r.id = er.region_id
    JOIN experiences e ON er.experience_id = e.id
    LEFT JOIN experience_rejections rej ON rej.experience_id = e.id AND rej.region_id = r.id
    WHERE r.world_view_id = $1
      AND ${parentRegionId ? 'r.parent_region_id = $2' : 'r.parent_region_id IS NULL'}
      AND rej.id IS NULL
    GROUP BY r.id, r.name, r.color, e.category_id
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

  // Aggregate into { regionId -> { categoryId -> count } }
  const countMap = new Map<number, Record<number, number>>();
  for (const row of result.rows) {
    const rid = row.region_id;
    if (!countMap.has(rid)) countMap.set(rid, {});
    countMap.get(rid)![row.category_id] = parseInt(row.count);
  }

  const response = allRegionsResult.rows.map(row => ({
    region_id: row.region_id,
    region_name: row.region_name,
    region_color: row.region_color,
    has_subregions: row.has_subregions,
    category_counts: countMap.get(row.region_id) || {},
  }));

  res.json(response);
}
