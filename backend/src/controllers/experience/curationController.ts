/**
 * Curation Controller
 *
 * Handles curator actions: reject/unreject experiences from regions,
 * manually assign/unassign experiences to regions, and create manual experiences.
 * All routes require curator authentication + scope verification.
 */

import { Response } from 'express';
import { pool } from '../../db/index.js';
import type { AuthenticatedRequest } from '../../middleware/auth.js';
import { checkCuratorScope } from '../../middleware/auth.js';

const UNSAFE_URL_SCHEMES = /^(javascript|data|vbscript|blob):/i;

function isUnsafeUrl(url: string): boolean {
  return UNSAFE_URL_SCHEMES.test(url.trim());
}

/**
 * Reject an experience from a region
 * POST /api/experiences/:id/reject
 * Body: { regionId, reason? }
 */
export async function rejectExperience(req: AuthenticatedRequest, res: Response): Promise<void> {
  const experienceId = parseInt(String(req.params.id));
  const { regionId, reason } = req.body;
  const userId = req.user!.id;
  const userRole = req.user!.role;

  if (!regionId) {
    res.status(400).json({ error: 'regionId is required' });
    return;
  }

  // Get experience source for scope check
  const expResult = await pool.query('SELECT id, category_id FROM experiences WHERE id = $1', [experienceId]);
  if (expResult.rows.length === 0) {
    res.status(404).json({ error: 'Experience not found' });
    return;
  }

  // Check curator scope
  const hasScope = await checkCuratorScope(userId, userRole, regionId, expResult.rows[0].category_id);
  if (!hasScope) {
    res.status(403).json({ error: 'You do not have curator permissions for this region' });
    return;
  }

  // Upsert rejection
  await pool.query(`
    INSERT INTO experience_rejections (experience_id, region_id, rejected_by, reason)
    VALUES ($1, $2, $3, $4)
    ON CONFLICT (experience_id, region_id)
    DO UPDATE SET rejected_by = $3, reason = $4, created_at = NOW()
  `, [experienceId, regionId, userId, reason || null]);

  // Log the action
  await pool.query(`
    INSERT INTO experience_curation_log (experience_id, curator_id, action, region_id, details)
    VALUES ($1, $2, 'rejected', $3, $4)
  `, [experienceId, userId, regionId, reason ? JSON.stringify({ reason }) : null]);

  res.json({ success: true, experienceId, regionId });
}

/**
 * Unreject an experience from a region
 * POST /api/experiences/:id/unreject
 * Body: { regionId }
 */
export async function unrejectExperience(req: AuthenticatedRequest, res: Response): Promise<void> {
  const experienceId = parseInt(String(req.params.id));
  const { regionId } = req.body;
  const userId = req.user!.id;
  const userRole = req.user!.role;

  if (!regionId) {
    res.status(400).json({ error: 'regionId is required' });
    return;
  }

  // Get experience source for scope check
  const expResult = await pool.query('SELECT id, category_id FROM experiences WHERE id = $1', [experienceId]);
  if (expResult.rows.length === 0) {
    res.status(404).json({ error: 'Experience not found' });
    return;
  }

  // Check curator scope
  const hasScope = await checkCuratorScope(userId, userRole, regionId, expResult.rows[0].category_id);
  if (!hasScope) {
    res.status(403).json({ error: 'You do not have curator permissions for this region' });
    return;
  }

  const result = await pool.query(
    'DELETE FROM experience_rejections WHERE experience_id = $1 AND region_id = $2 RETURNING id',
    [experienceId, regionId],
  );

  if (result.rowCount === 0) {
    res.status(404).json({ error: 'No rejection found for this experience in this region' });
    return;
  }

  // Log the action
  await pool.query(`
    INSERT INTO experience_curation_log (experience_id, curator_id, action, region_id)
    VALUES ($1, $2, 'unrejected', $3)
  `, [experienceId, userId, regionId]);

  res.json({ success: true, experienceId, regionId });
}

/**
 * Manually assign an experience to a region
 * POST /api/experiences/:id/assign
 * Body: { regionId }
 */
export async function assignExperienceToRegion(req: AuthenticatedRequest, res: Response): Promise<void> {
  const experienceId = parseInt(String(req.params.id));
  const { regionId } = req.body;
  const userId = req.user!.id;
  const userRole = req.user!.role;

  if (!regionId) {
    res.status(400).json({ error: 'regionId is required' });
    return;
  }

  // Verify experience exists
  const expResult = await pool.query('SELECT id, category_id FROM experiences WHERE id = $1', [experienceId]);
  if (expResult.rows.length === 0) {
    res.status(404).json({ error: 'Experience not found' });
    return;
  }

  // Check curator scope
  const hasScope = await checkCuratorScope(userId, userRole, regionId, expResult.rows[0].category_id);
  if (!hasScope) {
    res.status(403).json({ error: 'You do not have curator permissions for this region' });
    return;
  }

  // Verify region exists
  const regionResult = await pool.query('SELECT id FROM regions WHERE id = $1', [regionId]);
  if (regionResult.rows.length === 0) {
    res.status(404).json({ error: 'Region not found' });
    return;
  }

  await pool.query('BEGIN');
  try {
    // Insert manual assignment (or update to manual if auto already exists)
    await pool.query(`
      INSERT INTO experience_regions (experience_id, region_id, assignment_type, assigned_by)
      VALUES ($1, $2, 'manual', $3)
      ON CONFLICT (experience_id, region_id)
      DO UPDATE SET assignment_type = 'manual', assigned_by = $3
    `, [experienceId, regionId, userId]);

    // Clear any rejection for this experience-region pair
    await pool.query(
      'DELETE FROM experience_rejections WHERE experience_id = $1 AND region_id = $2',
      [experienceId, regionId],
    );

    // Log the action
    await pool.query(`
      INSERT INTO experience_curation_log (experience_id, curator_id, action, region_id)
      VALUES ($1, $2, 'added_to_region', $3)
    `, [experienceId, userId, regionId]);

    await pool.query('COMMIT');
  } catch (error) {
    await pool.query('ROLLBACK');
    throw error;
  }

  res.json({ success: true, experienceId, regionId });
}

/**
 * Unassign an experience from a region (manual assignments only)
 * DELETE /api/experiences/:id/assign/:regionId
 */
export async function unassignExperienceFromRegion(req: AuthenticatedRequest, res: Response): Promise<void> {
  const experienceId = parseInt(String(req.params.id));
  const regionId = parseInt(String(req.params.regionId));
  const userId = req.user!.id;
  const userRole = req.user!.role;

  // Get experience source for scope check
  const expResult = await pool.query('SELECT id, category_id FROM experiences WHERE id = $1', [experienceId]);
  if (expResult.rows.length === 0) {
    res.status(404).json({ error: 'Experience not found' });
    return;
  }

  // Check curator scope
  const hasScope = await checkCuratorScope(userId, userRole, regionId, expResult.rows[0].category_id);
  if (!hasScope) {
    res.status(403).json({ error: 'You do not have curator permissions for this region' });
    return;
  }

  // Only remove manual assignments (never remove auto-computed spatial assignments)
  const result = await pool.query(
    `DELETE FROM experience_regions
     WHERE experience_id = $1 AND region_id = $2 AND assignment_type = 'manual'
     RETURNING id`,
    [experienceId, regionId],
  );

  if (result.rowCount === 0) {
    res.status(404).json({ error: 'No manual assignment found for this experience in this region' });
    return;
  }

  // Log the action
  await pool.query(`
    INSERT INTO experience_curation_log (experience_id, curator_id, action, region_id)
    VALUES ($1, $2, 'removed_from_region', $3)
  `, [experienceId, userId, regionId]);

  res.json({ success: true, experienceId, regionId });
}

/**
 * Remove an experience from a region entirely (any assignment type).
 * DELETE /api/experiences/:id/remove-from-region/:regionId
 *
 * Unlike unassign (which only removes manual assignments), this removes
 * the experience_regions row regardless of assignment_type. The rejection
 * row is kept as a guard — if a future spatial recompute re-adds the
 * experience, it will automatically be hidden again.
 */
export async function removeExperienceFromRegion(req: AuthenticatedRequest, res: Response): Promise<void> {
  const experienceId = parseInt(String(req.params.id));
  const regionId = parseInt(String(req.params.regionId));
  const userId = req.user!.id;
  const userRole = req.user!.role;

  // Get experience source for scope check
  const expResult = await pool.query('SELECT id, category_id FROM experiences WHERE id = $1', [experienceId]);
  if (expResult.rows.length === 0) {
    res.status(404).json({ error: 'Experience not found' });
    return;
  }

  // Check curator scope
  const hasScope = await checkCuratorScope(userId, userRole, regionId, expResult.rows[0].category_id);
  if (!hasScope) {
    res.status(403).json({ error: 'You do not have curator permissions for this region' });
    return;
  }

  // Remove the region assignment (any type: auto or manual)
  const result = await pool.query(
    'DELETE FROM experience_regions WHERE experience_id = $1 AND region_id = $2 RETURNING id',
    [experienceId, regionId],
  );

  if (result.rowCount === 0) {
    res.status(404).json({ error: 'Experience is not assigned to this region' });
    return;
  }

  // Keep rejection row — it acts as a guard if spatial recompute re-adds the experience.

  // Log the action
  await pool.query(`
    INSERT INTO experience_curation_log (experience_id, curator_id, action, region_id)
    VALUES ($1, $2, 'removed_from_region', $3)
  `, [experienceId, userId, regionId]);

  res.json({ success: true, experienceId, regionId });
}

/**
 * Edit an experience's fields
 * PATCH /api/experiences/:id/edit
 * Body: { name?, shortDescription?, description?, category?, imageUrl?, tags? }
 *
 * Updates curated_fields so syncs won't overwrite curator edits.
 * Logs old/new values to curation_log.
 */
export async function editExperience(req: AuthenticatedRequest, res: Response): Promise<void> {
  const experienceId = parseInt(String(req.params.id));
  const userId = req.user!.id;
  const userRole = req.user!.role;

  // Map of body field -> DB column name
  const fieldMap: Record<string, string> = {
    name: 'name',
    shortDescription: 'short_description',
    description: 'description',
    category: 'category',
    imageUrl: 'image_url',
    tags: 'tags',
  };

  // Collect fields that were provided in the request body
  const updates: { column: string; bodyKey: string; value: unknown }[] = [];
  for (const [bodyKey, column] of Object.entries(fieldMap)) {
    if (req.body[bodyKey] !== undefined) {
      updates.push({ column, bodyKey, value: req.body[bodyKey] });
    }
  }

  // Special handling: websiteUrl and wikipediaUrl are stored in metadata JSONB, not direct columns
  const websiteUrl = req.body.websiteUrl;
  const wikipediaUrl = req.body.wikipediaUrl;
  const hasWebsiteUpdate = websiteUrl !== undefined;
  const hasWikipediaUpdate = wikipediaUrl !== undefined;
  const hasMetadataUpdate = hasWebsiteUpdate || hasWikipediaUpdate;

  if (typeof websiteUrl === 'string' && websiteUrl && isUnsafeUrl(websiteUrl)) {
    res.status(400).json({ error: 'Invalid URL scheme' });
    return;
  }
  if (typeof wikipediaUrl === 'string' && wikipediaUrl && isUnsafeUrl(wikipediaUrl)) {
    res.status(400).json({ error: 'Invalid URL scheme' });
    return;
  }

  if (updates.length === 0 && !hasMetadataUpdate) {
    res.status(400).json({ error: 'No fields to update' });
    return;
  }

  // Fetch existing experience for scope check and old values
  const expResult = await pool.query(
    `SELECT id, category_id, name, short_description, description, category, image_url, tags, metadata, curated_fields
     FROM experiences WHERE id = $1`,
    [experienceId],
  );
  if (expResult.rows.length === 0) {
    res.status(404).json({ error: 'Experience not found' });
    return;
  }
  const existing = expResult.rows[0];

  // Scope check — we need at least one region the experience belongs to
  // For global/source curators, checkCuratorScope with regionId=null works;
  // for region curators we check against the first assigned region
  const regionResult = await pool.query(
    'SELECT region_id FROM experience_regions WHERE experience_id = $1 LIMIT 1',
    [experienceId],
  );
  const regionId = regionResult.rows[0]?.region_id || null;
  const hasScope = await checkCuratorScope(userId, userRole, regionId, existing.category_id);
  if (!hasScope) {
    res.status(403).json({ error: 'You do not have curator permissions for this experience' });
    return;
  }

  // Build dynamic UPDATE query
  const setClauses: string[] = [];
  const values: unknown[] = [];
  let paramIdx = 1;

  for (const upd of updates) {
    if (upd.column === 'tags') {
      setClauses.push(`${upd.column} = $${paramIdx}`);
      values.push(upd.value ? JSON.stringify(upd.value) : null);
    } else {
      setClauses.push(`${upd.column} = $${paramIdx}`);
      values.push(upd.value ?? null);
    }
    paramIdx++;
  }

  // Handle websiteUrl/wikipediaUrl → metadata JSONB merge
  if (hasMetadataUpdate) {
    const metadataPatch: Record<string, string | null> = {};
    if (hasWebsiteUpdate) metadataPatch.website = websiteUrl || null;
    if (hasWikipediaUpdate) metadataPatch.wikipediaUrl = wikipediaUrl || null;
    setClauses.push(`metadata = COALESCE(metadata, '{}'::jsonb) || $${paramIdx}::jsonb`);
    values.push(JSON.stringify(metadataPatch));
    paramIdx++;
  }

  // Merge new field names into curated_fields
  const curatedFieldNames = updates.map((u) => u.column);
  if (hasWebsiteUpdate) curatedFieldNames.push('metadata.website');
  if (hasWikipediaUpdate) curatedFieldNames.push('metadata.wikipediaUrl');
  const existingCurated: string[] = existing.curated_fields || [];
  const newCurated = [...new Set([...existingCurated, ...curatedFieldNames])];
  setClauses.push(`curated_fields = $${paramIdx}`);
  values.push(JSON.stringify(newCurated));
  paramIdx++;

  setClauses.push(`updated_at = NOW()`);

  // Add experience ID as last parameter
  values.push(experienceId);

  await pool.query('BEGIN');
  try {
    await pool.query(
      `UPDATE experiences SET ${setClauses.join(', ')} WHERE id = $${paramIdx}`,
      values,
    );

    // Build old/new details for audit log
    const details: Record<string, { old: unknown; new: unknown }> = {};
    for (const upd of updates) {
      details[upd.column] = {
        old: existing[upd.column],
        new: upd.value ?? null,
      };
    }
    if (hasWebsiteUpdate) {
      details['metadata.website'] = {
        old: existing.metadata?.website ?? null,
        new: websiteUrl || null,
      };
    }
    if (hasWikipediaUpdate) {
      details['metadata.wikipediaUrl'] = {
        old: existing.metadata?.wikipediaUrl ?? null,
        new: wikipediaUrl || null,
      };
    }

    await pool.query(`
      INSERT INTO experience_curation_log (experience_id, curator_id, action, region_id, details)
      VALUES ($1, $2, 'edited', $3, $4)
    `, [experienceId, userId, regionId, JSON.stringify(details)]);

    await pool.query('COMMIT');
  } catch (error) {
    await pool.query('ROLLBACK');
    throw error;
  }

  res.json({ success: true, experienceId, curatedFields: newCurated });
}

/**
 * Get curation log for an experience
 * GET /api/experiences/:id/curation-log
 *
 * Returns the curation history: who did what and when.
 * Requires curator auth.
 */
export async function getCurationLog(req: AuthenticatedRequest, res: Response): Promise<void> {
  const experienceId = parseInt(String(req.params.id));
  const userId = req.user!.id;
  const userRole = req.user!.role;

  // Check curator scope — look up experience's first region and source
  const expResult = await pool.query(
    `SELECT e.category_id, er.region_id
     FROM experiences e
     LEFT JOIN experience_regions er ON er.experience_id = e.id
     WHERE e.id = $1
     LIMIT 1`,
    [experienceId],
  );
  if (expResult.rows.length === 0) {
    res.status(404).json({ error: 'Experience not found' });
    return;
  }
  const regionId = expResult.rows[0].region_id;
  const catId = expResult.rows[0].category_id;
  if (regionId) {
    const hasScope = await checkCuratorScope(userId, userRole, regionId, catId);
    if (!hasScope) {
      res.status(403).json({ error: 'You do not have curator permissions for this experience' });
      return;
    }
  }

  const result = await pool.query(`
    SELECT
      cl.id,
      cl.action,
      cl.region_id,
      r.name as region_name,
      cl.details,
      cl.created_at,
      u.display_name as curator_name
    FROM experience_curation_log cl
    JOIN users u ON cl.curator_id = u.id
    LEFT JOIN regions r ON cl.region_id = r.id
    WHERE cl.experience_id = $1
    ORDER BY cl.created_at DESC
    LIMIT 50
  `, [experienceId]);

  res.json(result.rows);
}

/**
 * Create a new manual experience
 * POST /api/experiences
 * Body: { name, shortDescription?, category?, longitude, latitude, imageUrl?, tags?, countryCode?, countryName?, regionId, categoryId }
 */
export async function createManualExperience(req: AuthenticatedRequest, res: Response): Promise<void> {
  const userId = req.user!.id;
  const userRole = req.user!.role;
  const {
    name,
    shortDescription,
    category,
    longitude,
    latitude,
    imageUrl,
    tags,
    countryCode,
    countryName,
    regionId,
    categoryId: requestedCategoryId,
    websiteUrl,
    wikipediaUrl: createWikipediaUrl,
  } = req.body;

  if (!name || longitude == null || latitude == null) {
    res.status(400).json({ error: 'name, longitude, and latitude are required' });
    return;
  }

  if (typeof websiteUrl === 'string' && websiteUrl && isUnsafeUrl(websiteUrl)) {
    res.status(400).json({ error: 'Invalid URL scheme' });
    return;
  }
  if (typeof createWikipediaUrl === 'string' && createWikipediaUrl && isUnsafeUrl(createWikipediaUrl)) {
    res.status(400).json({ error: 'Invalid URL scheme' });
    return;
  }

  if (!regionId) {
    res.status(400).json({ error: 'regionId is required for initial region assignment' });
    return;
  }

  // Check curator scope for the target region
  const hasScope = await checkCuratorScope(userId, userRole, regionId);
  if (!hasScope) {
    res.status(403).json({ error: 'You do not have curator permissions for this region' });
    return;
  }

  // Category is required — curators must assign to an existing category
  if (!requestedCategoryId) {
    res.status(400).json({ error: 'categoryId is required' });
    return;
  }
  const categoryResult = await pool.query(
    `SELECT id FROM experience_categories WHERE id = $1`,
    [requestedCategoryId],
  );
  if (categoryResult.rows.length === 0) {
    res.status(400).json({ error: 'Invalid categoryId' });
    return;
  }
  const categoryId = categoryResult.rows[0].id;

  await pool.query('BEGIN');
  try {
    const externalId = `curator-${userId}-${Date.now()}`;

    // Build metadata JSONB (website + wikipedia URLs if provided)
    const metadataObj: Record<string, string> = {};
    if (websiteUrl) metadataObj.website = websiteUrl;
    if (createWikipediaUrl) metadataObj.wikipediaUrl = createWikipediaUrl;
    const metadata = Object.keys(metadataObj).length > 0 ? JSON.stringify(metadataObj) : null;

    // Create the experience
    const expResult = await pool.query(`
      INSERT INTO experiences (
        category_id, external_id, name, short_description, category,
        location, image_url, tags, country_codes, country_names,
        metadata, is_manual, created_by, status
      ) VALUES (
        $1, $2, $3, $4, $5,
        ST_SetSRID(ST_MakePoint($6, $7), 4326), $8, $9, $10, $11,
        $12, true, $13, 'active'
      ) RETURNING id
    `, [
      categoryId,
      externalId,
      name,
      shortDescription || null,
      category || null,
      longitude,
      latitude,
      imageUrl || null,
      tags ? JSON.stringify(tags) : null,
      countryCode ? [countryCode] : null,
      countryName ? [countryName] : null,
      metadata,
      userId,
    ]);
    const experienceId = expResult.rows[0].id;

    // Create the default location entry
    const locResult = await pool.query(`
      INSERT INTO experience_locations (experience_id, name, ordinal, location)
      VALUES ($1, $2, 0, ST_SetSRID(ST_MakePoint($3, $4), 4326))
      RETURNING id
    `, [experienceId, name, longitude, latitude]);
    const locationId = locResult.rows[0].id;

    // Assign to the curator's region (manual assignment)
    await pool.query(`
      INSERT INTO experience_regions (experience_id, region_id, assignment_type, assigned_by)
      VALUES ($1, $2, 'manual', $3)
    `, [experienceId, regionId, userId]);

    // Link the location to the region (required for in_region markers on the map)
    await pool.query(`
      INSERT INTO experience_location_regions (location_id, region_id, assignment_type)
      VALUES ($1, $2, 'manual')
    `, [locationId, regionId]);

    // Log the creation
    await pool.query(`
      INSERT INTO experience_curation_log (experience_id, curator_id, action, region_id, details)
      VALUES ($1, $2, 'created', $3, $4)
    `, [experienceId, userId, regionId, JSON.stringify({ name, category, categoryId })]);

    await pool.query('COMMIT');

    res.status(201).json({ id: experienceId, name, externalId });
  } catch (error) {
    await pool.query('ROLLBACK');
    throw error;
  }
}
