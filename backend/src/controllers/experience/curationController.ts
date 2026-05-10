/**
 * Curation Controller
 *
 * Handles curator actions: reject/unreject experiences from regions,
 * manually assign/unassign experiences to regions, and create manual experiences.
 * All routes require curator authentication + scope verification.
 */

import { Response } from 'express';
import type { PoolClient } from 'pg';
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

  // Pin all three writes (assignment upsert, rejection clear, audit log) to a
  // single client so they form a real transaction — pg.Pool's pool.query()
  // can pick a different client per call, so BEGIN/COMMIT against the pool
  // does not actually wrap the intermediate queries.
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Insert manual assignment (or update to manual if auto already exists)
    await client.query(`
      INSERT INTO experience_regions (experience_id, region_id, assignment_type, assigned_by)
      VALUES ($1, $2, 'manual', $3)
      ON CONFLICT (experience_id, region_id)
      DO UPDATE SET assignment_type = 'manual', assigned_by = $3
    `, [experienceId, regionId, userId]);

    // Clear any rejection for this experience-region pair
    await client.query(
      'DELETE FROM experience_rejections WHERE experience_id = $1 AND region_id = $2',
      [experienceId, regionId],
    );

    // Log the action
    await client.query(`
      INSERT INTO experience_curation_log (experience_id, curator_id, action, region_id)
      VALUES ($1, $2, 'added_to_region', $3)
    `, [experienceId, userId, regionId]);

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
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

interface FieldUpdate {
  column: string;
  bodyKey: string;
  value: unknown;
}

interface EditPayload {
  updates: FieldUpdate[];
  websiteUrl: string | undefined;
  wikipediaUrl: string | undefined;
  hasWebsiteUpdate: boolean;
  hasWikipediaUpdate: boolean;
}

const EDIT_FIELD_MAP: Record<string, string> = {
  name: 'name',
  shortDescription: 'short_description',
  description: 'description',
  category: 'category',
  imageUrl: 'image_url',
  tags: 'tags',
};

function parseEditPayload(body: Record<string, unknown>): EditPayload {
  const updates: FieldUpdate[] = [];
  for (const [bodyKey, column] of Object.entries(EDIT_FIELD_MAP)) {
    if (body[bodyKey] !== undefined) {
      updates.push({ column, bodyKey, value: body[bodyKey] });
    }
  }
  const websiteUrl = body.websiteUrl as string | undefined;
  const wikipediaUrl = body.wikipediaUrl as string | undefined;
  return {
    updates,
    websiteUrl,
    wikipediaUrl,
    hasWebsiteUpdate: websiteUrl !== undefined,
    hasWikipediaUpdate: wikipediaUrl !== undefined,
  };
}

function validateEditPayload(payload: EditPayload): string | null {
  const { websiteUrl, wikipediaUrl, updates, hasWebsiteUpdate, hasWikipediaUpdate } = payload;
  if (typeof websiteUrl === 'string' && websiteUrl && isUnsafeUrl(websiteUrl)) {
    return 'Invalid URL scheme';
  }
  if (typeof wikipediaUrl === 'string' && wikipediaUrl && isUnsafeUrl(wikipediaUrl)) {
    return 'Invalid URL scheme';
  }
  const hasMetadataUpdate = hasWebsiteUpdate || hasWikipediaUpdate;
  if (updates.length === 0 && !hasMetadataUpdate) {
    return 'No fields to update';
  }
  return null;
}

function buildUpdateQuery(
  payload: EditPayload,
  existingCurated: string[],
  experienceId: number,
): { sql: string; values: unknown[]; newCurated: string[] } {
  const { updates, hasWebsiteUpdate, hasWikipediaUpdate, websiteUrl, wikipediaUrl } = payload;
  const setClauses: string[] = [];
  const values: unknown[] = [];
  let paramIdx = 1;

  for (const upd of updates) {
    setClauses.push(`${upd.column} = $${paramIdx}`);
    if (upd.column === 'tags') {
      values.push(upd.value ? JSON.stringify(upd.value) : null);
    } else {
      values.push(upd.value ?? null);
    }
    paramIdx++;
  }

  if (hasWebsiteUpdate || hasWikipediaUpdate) {
    const metadataPatch: Record<string, string | null> = {};
    if (hasWebsiteUpdate) metadataPatch.website = websiteUrl || null;
    if (hasWikipediaUpdate) metadataPatch.wikipediaUrl = wikipediaUrl || null;
    setClauses.push(`metadata = COALESCE(metadata, '{}'::jsonb) || $${paramIdx}::jsonb`);
    values.push(JSON.stringify(metadataPatch));
    paramIdx++;
  }

  const curatedFieldNames = updates.map(u => u.column);
  if (hasWebsiteUpdate) curatedFieldNames.push('metadata.website');
  if (hasWikipediaUpdate) curatedFieldNames.push('metadata.wikipediaUrl');
  const newCurated = [...new Set([...existingCurated, ...curatedFieldNames])];
  setClauses.push(`curated_fields = $${paramIdx}`);
  values.push(JSON.stringify(newCurated));
  paramIdx++;

  setClauses.push(`updated_at = NOW()`);
  values.push(experienceId);
  return {
    sql: `UPDATE experiences SET ${setClauses.join(', ')} WHERE id = $${paramIdx}`,
    values,
    newCurated,
  };
}

function buildEditAuditDetails(
  payload: EditPayload,
  existing: Record<string, unknown>,
): Record<string, { old: unknown; new: unknown }> {
  const details: Record<string, { old: unknown; new: unknown }> = {};
  for (const upd of payload.updates) {
    details[upd.column] = { old: existing[upd.column], new: upd.value ?? null };
  }
  const existingMetadata = existing.metadata as Record<string, unknown> | null | undefined;
  if (payload.hasWebsiteUpdate) {
    details['metadata.website'] = {
      old: existingMetadata?.website ?? null,
      new: payload.websiteUrl || null,
    };
  }
  if (payload.hasWikipediaUpdate) {
    details['metadata.wikipediaUrl'] = {
      old: existingMetadata?.wikipediaUrl ?? null,
      new: payload.wikipediaUrl || null,
    };
  }
  return details;
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

  const payload = parseEditPayload(req.body as Record<string, unknown>);
  const validationError = validateEditPayload(payload);
  if (validationError) {
    res.status(400).json({ error: validationError });
    return;
  }

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

  // Scope check — we need at least one region the experience belongs to.
  // For global/category curators, checkCuratorScope with regionId=null works;
  // for region curators we check against the first assigned region.
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

  const { sql, values, newCurated } = buildUpdateQuery(
    payload,
    (existing.curated_fields as string[]) || [],
    experienceId,
  );

  // `pool.query('BEGIN')` does NOT pin a connection — each call checks out
  // an arbitrary idle client from pg.Pool, so BEGIN, the UPDATE, the audit
  // INSERT, and COMMIT/ROLLBACK can run on different clients (no real
  // transaction). Use pool.connect() to bind everything to one client.
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(sql, values);
    const details = buildEditAuditDetails(payload, existing);
    await client.query(`
      INSERT INTO experience_curation_log (experience_id, curator_id, action, region_id, details)
      VALUES ($1, $2, 'edited', $3, $4)
    `, [experienceId, userId, regionId, JSON.stringify(details)]);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
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

interface CreateManualBody {
  name?: unknown;
  shortDescription?: unknown;
  category?: unknown;
  longitude?: unknown;
  latitude?: unknown;
  imageUrl?: unknown;
  tags?: unknown;
  countryCode?: unknown;
  countryName?: unknown;
  regionId?: unknown;
  categoryId?: unknown;
  websiteUrl?: unknown;
  wikipediaUrl?: unknown;
}

function validateCreateManualInput(body: CreateManualBody): string | null {
  if (!body.name || body.longitude == null || body.latitude == null) {
    return 'name, longitude, and latitude are required';
  }
  if (typeof body.websiteUrl === 'string' && body.websiteUrl && isUnsafeUrl(body.websiteUrl)) {
    return 'Invalid URL scheme';
  }
  if (typeof body.wikipediaUrl === 'string' && body.wikipediaUrl && isUnsafeUrl(body.wikipediaUrl)) {
    return 'Invalid URL scheme';
  }
  if (!body.regionId) {
    return 'regionId is required for initial region assignment';
  }
  if (!body.categoryId) {
    return 'categoryId is required';
  }
  return null;
}

async function insertManualExperience(
  client: PoolClient,
  body: CreateManualBody,
  userId: number,
  categoryId: number,
): Promise<{ experienceId: number; externalId: string }> {
  const externalId = `curator-${userId}-${Date.now()}`;

  const metadataObj: Record<string, string> = {};
  if (body.websiteUrl) metadataObj.website = body.websiteUrl as string;
  if (body.wikipediaUrl) metadataObj.wikipediaUrl = body.wikipediaUrl as string;
  const metadata = Object.keys(metadataObj).length > 0 ? JSON.stringify(metadataObj) : null;

  const expResult = await client.query(`
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
    body.name,
    body.shortDescription || null,
    body.category || null,
    body.longitude,
    body.latitude,
    body.imageUrl || null,
    body.tags ? JSON.stringify(body.tags) : null,
    body.countryCode ? [body.countryCode] : null,
    body.countryName ? [body.countryName] : null,
    metadata,
    userId,
  ]);
  const experienceId = expResult.rows[0].id as number;

  const locResult = await client.query(`
    INSERT INTO experience_locations (experience_id, name, ordinal, location)
    VALUES ($1, $2, 0, ST_SetSRID(ST_MakePoint($3, $4), 4326))
    RETURNING id
  `, [experienceId, body.name, body.longitude, body.latitude]);
  const locationId = locResult.rows[0].id as number;

  await client.query(`
    INSERT INTO experience_regions (experience_id, region_id, assignment_type, assigned_by)
    VALUES ($1, $2, 'manual', $3)
  `, [experienceId, body.regionId, userId]);

  await client.query(`
    INSERT INTO experience_location_regions (location_id, region_id, assignment_type)
    VALUES ($1, $2, 'manual')
  `, [locationId, body.regionId]);

  await client.query(`
    INSERT INTO experience_curation_log (experience_id, curator_id, action, region_id, details)
    VALUES ($1, $2, 'created', $3, $4)
  `, [experienceId, userId, body.regionId, JSON.stringify({
    name: body.name,
    category: body.category,
    categoryId,
  })]);

  return { experienceId, externalId };
}

/**
 * Create a new manual experience
 * POST /api/experiences
 * Body: { name, shortDescription?, category?, longitude, latitude, imageUrl?, tags?, countryCode?, countryName?, regionId, categoryId }
 */
export async function createManualExperience(req: AuthenticatedRequest, res: Response): Promise<void> {
  const userId = req.user!.id;
  const userRole = req.user!.role;
  const body = req.body as CreateManualBody;

  const validationError = validateCreateManualInput(body);
  if (validationError) {
    res.status(400).json({ error: validationError });
    return;
  }

  const hasScope = await checkCuratorScope(userId, userRole, body.regionId as number);
  if (!hasScope) {
    res.status(403).json({ error: 'You do not have curator permissions for this region' });
    return;
  }

  const categoryResult = await pool.query(
    `SELECT id FROM experience_categories WHERE id = $1`,
    [body.categoryId],
  );
  if (categoryResult.rows.length === 0) {
    res.status(400).json({ error: 'Invalid categoryId' });
    return;
  }
  const categoryId = categoryResult.rows[0].id as number;

  // Pin all five inserts (experience, location, region link, location-region
  // link, curation log) to a single client so they form a real transaction.
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { experienceId, externalId } = await insertManualExperience(client, body, userId, categoryId);
    await client.query('COMMIT');
    res.status(201).json({ id: experienceId, name: body.name, externalId });
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
