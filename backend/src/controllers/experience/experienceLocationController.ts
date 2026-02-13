/**
 * Experience Location Controller
 *
 * Multi-location support and batch location fetching for experiences.
 */

import { Request, Response } from 'express';
import { pool } from '../../db/index.js';
import type { AuthenticatedRequest } from '../../middleware/auth.js';

// =============================================================================
// Batch Location Fetching (eliminates N+1 for experience lists/markers)
// =============================================================================

/**
 * Get all locations for all experiences in a region (batch)
 * GET /api/experiences/by-region/:regionId/locations
 *
 * Single query returning all locations grouped by experience_id.
 * Used by ExperienceMarkers and ExperienceList to avoid N+1 calls.
 */
export async function getRegionExperienceLocations(req: Request, res: Response): Promise<void> {
  const regionId = parseInt(String(req.params.regionId));
  const includeChildren = req.query.includeChildren !== 'false';

  let query: string;
  const params: number[] = [regionId];

  if (includeChildren) {
    query = `
      WITH RECURSIVE descendant_regions AS (
        SELECT id FROM regions WHERE id = $1
        UNION ALL
        SELECT r.id FROM regions r
        JOIN descendant_regions dr ON r.parent_region_id = dr.id
      )
      SELECT
        el.id,
        el.experience_id,
        el.name,
        el.external_ref,
        el.ordinal,
        ST_X(el.location) as longitude,
        ST_Y(el.location) as latitude,
        el.created_at,
        EXISTS(
          SELECT 1 FROM experience_location_regions elr
          WHERE elr.location_id = el.id AND elr.region_id IN (SELECT id FROM descendant_regions)
        ) as in_region,
        leaf_r.region_path
      FROM experience_locations el
      JOIN experiences e ON e.id = el.experience_id
      LEFT JOIN LATERAL (
        WITH RECURSIVE
        leaf AS (
          SELECT r.id, r.name, r.parent_region_id
          FROM experience_location_regions elr
          JOIN regions r ON elr.region_id = r.id
          WHERE elr.location_id = el.id
            AND r.is_leaf = true
            AND r.world_view_id = (SELECT world_view_id FROM regions WHERE id = $1)
          LIMIT 1
        ),
        ancestors AS (
          SELECT id, name, parent_region_id, 0 as depth FROM leaf
          UNION ALL
          SELECT r.id, r.name, r.parent_region_id, a.depth + 1
          FROM regions r
          JOIN ancestors a ON r.id = a.parent_region_id
        )
        SELECT string_agg(name, ' > ' ORDER BY depth DESC) as region_path
        FROM ancestors
      ) leaf_r ON true
      WHERE e.id IN (
        SELECT DISTINCT er.experience_id FROM experience_regions er
        WHERE er.region_id IN (SELECT id FROM descendant_regions)
      )
      ORDER BY el.experience_id, el.ordinal
    `;
  } else {
    query = `
      SELECT
        el.id,
        el.experience_id,
        el.name,
        el.external_ref,
        el.ordinal,
        ST_X(el.location) as longitude,
        ST_Y(el.location) as latitude,
        el.created_at,
        EXISTS(
          SELECT 1 FROM experience_location_regions elr
          WHERE elr.location_id = el.id AND elr.region_id = $1
        ) as in_region,
        leaf_r.region_path
      FROM experience_locations el
      JOIN experiences e ON e.id = el.experience_id
      LEFT JOIN LATERAL (
        WITH RECURSIVE
        leaf AS (
          SELECT r.id, r.name, r.parent_region_id
          FROM experience_location_regions elr
          JOIN regions r ON elr.region_id = r.id
          WHERE elr.location_id = el.id
            AND r.is_leaf = true
            AND r.world_view_id = (SELECT world_view_id FROM regions WHERE id = $1)
          LIMIT 1
        ),
        ancestors AS (
          SELECT id, name, parent_region_id, 0 as depth FROM leaf
          UNION ALL
          SELECT r.id, r.name, r.parent_region_id, a.depth + 1
          FROM regions r
          JOIN ancestors a ON r.id = a.parent_region_id
        )
        SELECT string_agg(name, ' > ' ORDER BY depth DESC) as region_path
        FROM ancestors
      ) leaf_r ON true
      JOIN experience_regions er ON er.experience_id = e.id
      WHERE er.region_id = $1
      ORDER BY el.experience_id, el.ordinal
    `;
  }

  const result = await pool.query(query, params);

  // Group by experience_id
  const locationsByExperience: Record<number, Array<{
    id: number;
    experience_id: number;
    name: string | null;
    external_ref: string | null;
    ordinal: number;
    longitude: number;
    latitude: number;
    created_at: string;
    in_region: boolean;
    region_path: string | null;
  }>> = {};

  for (const row of result.rows) {
    const expId = row.experience_id;
    if (!locationsByExperience[expId]) {
      locationsByExperience[expId] = [];
    }
    locationsByExperience[expId].push({
      id: row.id,
      experience_id: row.experience_id,
      name: row.name,
      external_ref: row.external_ref,
      ordinal: row.ordinal,
      longitude: parseFloat(row.longitude),
      latitude: parseFloat(row.latitude),
      created_at: row.created_at,
      in_region: row.in_region,
      region_path: row.region_path,
    });
  }

  res.json({ locationsByExperience });
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
