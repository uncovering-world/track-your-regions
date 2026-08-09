/**
 * Curation Controller
 *
 * Handles curator actions: reject/unreject experiences from regions,
 * manually assign/unassign experiences to regions, and create manual experiences.
 * All routes require curator authentication + scope verification.
 */

import { Response } from 'express';
import type { PoolClient } from 'pg';
import { pool, rollbackQuietly } from '../../db/index.js';
import type { AuthenticatedRequest } from '../../middleware/auth.js';
import type { UserRole } from '../../types/auth.js';
import { resolveExperienceScope } from './experienceScope.js';
import {
  checkCuratorScope,
  CURATOR_SCOPED_REGIONS_CTE,
  CURATOR_UNRESTRICTED_SCOPE_EXISTS,
} from '../../middleware/auth.js';
import { METADATA_CLAIM_PREFIX } from '../../services/sync/changeSet.js';

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
  if (hasWebsiteUpdate) curatedFieldNames.push(`${METADATA_CLAIM_PREFIX}website`);
  if (hasWikipediaUpdate) curatedFieldNames.push(`${METADATA_CLAIM_PREFIX}wikipediaUrl`);
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
 * Logs old/new values to curation_log, under a region the caller has scope
 * over — see `resolveEditScope`.
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

  const { permitted, logRegionId } = await resolveExperienceScope(
    userId,
    userRole,
    experienceId,
    existing.category_id as number,
  );
  if (!permitted) {
    res.status(403).json({ error: 'You do not have curator permissions for this experience' });
    return;
  }

  // `pool.query('BEGIN')` does NOT pin a connection — each call checks out
  // an arbitrary idle client from pg.Pool, so BEGIN, the UPDATE, the audit
  // INSERT, and COMMIT/ROLLBACK can run on different clients (no real
  // transaction). Use pool.connect() to bind everything to one client.
  const client = await pool.connect();
  let unusable: Error | undefined;
  let newCurated: string[];
  try {
    await client.query('BEGIN');

    // Re-read under the lock everything this transaction depends on. The read
    // above answers 404 and scope and is outside any transaction, so by now it
    // may be stale in two ways: an accept-source releasing a claim between the
    // two would be undone here, the union putting back a key it had just
    // removed; and the `old` values in the audit row would name a version that
    // was already gone when the edit was written.
    const locked = await client.query(
      `SELECT curated_fields, name, short_description, description, category, image_url, tags, metadata
       FROM experiences WHERE id = $1 FOR UPDATE`,
      [experienceId],
    );
    const before = locked.rows[0] ?? existing;
    const built = buildUpdateQuery(
      payload,
      (before.curated_fields as string[]) || [],
      experienceId,
    );
    newCurated = built.newCurated;
    await client.query(built.sql, built.values);
    const details = buildEditAuditDetails(payload, before);
    await client.query(`
      INSERT INTO experience_curation_log (experience_id, curator_id, action, region_id, details)
      VALUES ($1, $2, 'edited', $3, $4)
    `, [experienceId, userId, logRegionId, JSON.stringify(details)]);
    await client.query('COMMIT');
  } catch (error) {
    // A client whose ROLLBACK also failed must be destroyed, not pooled: it
    // would otherwise carry an open transaction into the next request.
    unusable = await rollbackQuietly(client);
    throw error;
  } finally {
    client.release(unusable);
  }

  res.json({ success: true, experienceId, curatedFields: newCurated });
}

/**
 * Resolve what a caller may see of one experience's curation log.
 *
 * `unrestricted` — admins, global curators, and curators of the experience's
 * category see every row. `hasScopedRegion` — a region-scoped curator reaches
 * the log at all only if something in it is attributable to their scope: a
 * region the experience is assigned to, or a region already named by one of
 * its log rows. The second half matters because a curator's last act in a
 * region is often removing the experience from it, which deletes the
 * assignment and logs that removal — on assignments alone, the gate would
 * refuse them the record of what they just did.
 *
 * It grants nothing extra: the rows that come back are filtered through the
 * same closure either way, so the gate never admits a row the filter would
 * drop. It is strictly the stronger of the two, and deliberately so — neither
 * `EXISTS` can be satisfied by a row naming no region, so an experience whose
 * log holds only those is refused here even though the filter would have
 * returned them. That is the hole #442 names: without the gate, any curator
 * could read the log of an experience in no one's scope.
 */
async function resolveCurationLogScope(
  userId: number,
  userRole: UserRole,
  experienceId: number,
  categoryId: number,
): Promise<{ unrestricted: boolean; hasScopedRegion: boolean }> {
  if (userRole === 'admin') return { unrestricted: true, hasScopedRegion: true };

  const result = await pool.query(`${CURATOR_SCOPED_REGIONS_CTE}
    SELECT
      ${CURATOR_UNRESTRICTED_SCOPE_EXISTS} AS unrestricted,
      (EXISTS (
        SELECT 1 FROM experience_regions er
        JOIN curator_scoped_regions s ON s.id = er.region_id
        WHERE er.experience_id = $2
      ) OR EXISTS (
        SELECT 1 FROM experience_curation_log cl
        JOIN curator_scoped_regions s ON s.id = cl.region_id
        WHERE cl.experience_id = $2
      )) AS has_scoped_region
  `, [userId, experienceId, categoryId]);

  const row = result.rows[0];
  return { unrestricted: row.unrestricted === true, hasScopedRegion: row.has_scoped_region === true };
}

/**
 * Get curation log for an experience
 * GET /api/experiences/:id/curation-log
 *
 * Returns the curation history: who did what and when. Requires curator auth,
 * and a region-scoped curator gets only the rows for regions they cover — the
 * scope check qualifies the result set, not one representative region.
 */
export async function getCurationLog(req: AuthenticatedRequest, res: Response): Promise<void> {
  const experienceId = parseInt(String(req.params.id));
  const userId = req.user!.id;
  const userRole = req.user!.role;

  const expResult = await pool.query(
    'SELECT category_id FROM experiences WHERE id = $1',
    [experienceId],
  );
  if (expResult.rows.length === 0) {
    res.status(404).json({ error: 'Experience not found' });
    return;
  }

  const { unrestricted, hasScopedRegion } = await resolveCurationLogScope(
    userId,
    userRole,
    experienceId,
    expResult.rows[0].category_id as number,
  );
  if (!unrestricted && !hasScopedRegion) {
    res.status(403).json({ error: 'You do not have curator permissions for this experience' });
    return;
  }

  // A row survives when the curator is unrestricted, when it names no region
  // (it identifies no region to leak), or when its region is one they cover.
  const result = await pool.query(`${CURATOR_SCOPED_REGIONS_CTE}
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
    WHERE cl.experience_id = $2
      AND ($3::boolean OR cl.region_id IS NULL OR cl.region_id IN (SELECT id FROM curator_scoped_regions))
    ORDER BY cl.created_at DESC
    LIMIT 50
  `, [userId, experienceId, unrestricted]);

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
