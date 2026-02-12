/**
 * Shared sync utilities
 *
 * Common database operations used by UNESCO, museum, and landmark sync services.
 */

import { pool } from '../../db/index.js';
import type { SyncProgress } from './types.js';

// =============================================================================
// Experience Upsert
// =============================================================================

export interface ExperienceUpsertParams {
  categoryId: number;
  externalId: string;
  name: string;
  nameLocal: Record<string, string>;
  description: string | null;
  shortDescription: string | null;
  category: string | null;
  tags: string[];
  lon: number;
  lat: number;
  countryCodes: string[];
  countryNames: string[];
  imageUrl: string | null;
  metadata: Record<string, unknown>;
}

/**
 * Upsert an experience record with curated_fields-aware conflict handling.
 *
 * All sync services share the same INSERT...ON CONFLICT pattern that preserves
 * curator-edited fields while updating the rest from source data.
 */
export async function upsertExperienceRecord(
  params: ExperienceUpsertParams,
): Promise<{ experienceId: number; isCreated: boolean }> {
  const result = await pool.query(
    `INSERT INTO experiences (
      category_id, external_id, name, name_local, description, short_description,
      category, tags, location, country_codes, country_names, image_url, metadata,
      created_at, updated_at
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8,
      ST_SetSRID(ST_MakePoint($9, $10), 4326),
      $11, $12, $13, $14, NOW(), NOW()
    )
    ON CONFLICT (category_id, external_id) DO UPDATE SET
      name = CASE WHEN experiences.curated_fields ? 'name' THEN experiences.name ELSE EXCLUDED.name END,
      name_local = CASE WHEN experiences.curated_fields ? 'name_local' THEN experiences.name_local ELSE EXCLUDED.name_local END,
      description = CASE WHEN experiences.curated_fields ? 'description' THEN experiences.description ELSE EXCLUDED.description END,
      short_description = CASE WHEN experiences.curated_fields ? 'short_description' THEN experiences.short_description ELSE EXCLUDED.short_description END,
      category = CASE WHEN experiences.curated_fields ? 'category' THEN experiences.category ELSE EXCLUDED.category END,
      tags = CASE WHEN experiences.curated_fields ? 'tags' THEN experiences.tags ELSE EXCLUDED.tags END,
      location = CASE WHEN experiences.curated_fields ? 'location' THEN experiences.location ELSE EXCLUDED.location END,
      country_codes = CASE WHEN experiences.curated_fields ? 'country_codes' THEN experiences.country_codes ELSE EXCLUDED.country_codes END,
      country_names = CASE WHEN experiences.curated_fields ? 'country_names' THEN experiences.country_names ELSE EXCLUDED.country_names END,
      image_url = CASE WHEN experiences.curated_fields ? 'image_url' THEN experiences.image_url ELSE EXCLUDED.image_url END,
      metadata = CASE WHEN experiences.curated_fields ? 'metadata' THEN experiences.metadata ELSE EXCLUDED.metadata END,
      updated_at = NOW()
    RETURNING id, (xmax = 0) AS inserted`,
    [
      params.categoryId,
      params.externalId,
      params.name,
      JSON.stringify(params.nameLocal),
      params.description,
      params.shortDescription,
      params.category,
      JSON.stringify(params.tags),
      params.lon,
      params.lat,
      params.countryCodes,
      params.countryNames,
      params.imageUrl,
      JSON.stringify(params.metadata),
    ]
  );

  return {
    experienceId: result.rows[0].id,
    isCreated: result.rows[0].inserted,
  };
}

// =============================================================================
// Single-Location Upsert
// =============================================================================

/**
 * Upsert a single location for an experience (DELETE + INSERT pattern).
 *
 * Used by museum and landmark syncs for venues with one location.
 * UNESCO uses its own multi-location upsert logic.
 */
export async function upsertSingleLocation(
  experienceId: number,
  externalRef: string,
  lon: number,
  lat: number,
): Promise<void> {
  await pool.query(
    `DELETE FROM experience_locations WHERE experience_id = $1`,
    [experienceId]
  );
  await pool.query(
    `INSERT INTO experience_locations (experience_id, name, external_ref, ordinal, location)
     VALUES ($1, NULL, $2, 1, ST_SetSRID(ST_MakePoint($3, $4), 4326))`,
    [experienceId, externalRef, lon, lat]
  );
}

// =============================================================================
// Sync Log Operations
// =============================================================================

/**
 * Create a new sync log entry with status 'running'.
 */
export async function createSyncLog(
  categoryId: number,
  triggeredBy: number | null,
): Promise<number> {
  const result = await pool.query(
    `INSERT INTO experience_sync_logs (category_id, triggered_by, status)
     VALUES ($1, $2, 'running')
     RETURNING id`,
    [categoryId, triggeredBy]
  );
  return result.rows[0].id;
}

/**
 * Update a sync log entry with final status and stats.
 * Also updates the experience_categories table with last sync info.
 */
export async function updateSyncLog(
  categoryId: number,
  logId: number,
  status: string,
  stats: { fetched: number; created: number; updated: number; errors: number },
  errorDetails?: unknown[],
): Promise<void> {
  await pool.query(
    `UPDATE experience_sync_logs SET
      completed_at = NOW(),
      status = $2,
      total_fetched = $3,
      total_created = $4,
      total_updated = $5,
      total_errors = $6,
      error_details = $7
     WHERE id = $1`,
    [logId, status, stats.fetched, stats.created, stats.updated, stats.errors,
     errorDetails ? JSON.stringify(errorDetails) : null]
  );

  await pool.query(
    `UPDATE experience_categories SET
      last_sync_at = NOW(),
      last_sync_status = $2,
      last_sync_error = $3
     WHERE id = $1`,
    [categoryId, status, status === 'failed' ? 'See sync log for details' : null]
  );
}

// =============================================================================
// Category Data Cleanup
// =============================================================================

/**
 * Delete all data for a category in correct foreign-key order.
 *
 * Region assignment links (experience_regions, experience_location_regions) are
 * deleted with an auto-only filter first to avoid FK violations, but all
 * assignments — including manual curator assignments — are ultimately removed
 * via ON DELETE CASCADE when experiences and locations are deleted.
 *
 * Museums should call their treasure cleanup before this function.
 *
 * @returns Number of deleted experiences
 */
export async function cleanupCategoryData(
  categoryId: number,
  logPrefix: string,
  progress: SyncProgress,
): Promise<number> {
  await pool.query(`
    DELETE FROM user_visited_locations
    WHERE location_id IN (
      SELECT el.id FROM experience_locations el
      JOIN experiences e ON el.experience_id = e.id
      WHERE e.category_id = $1
    )
  `, [categoryId]);

  await pool.query(`
    DELETE FROM user_visited_experiences
    WHERE experience_id IN (SELECT id FROM experiences WHERE category_id = $1)
  `, [categoryId]);

  await pool.query(`
    DELETE FROM experience_location_regions
    WHERE assignment_type = 'auto'
      AND location_id IN (
        SELECT el.id FROM experience_locations el
        JOIN experiences e ON el.experience_id = e.id
        WHERE e.category_id = $1
      )
  `, [categoryId]);

  await pool.query(`
    DELETE FROM experience_regions
    WHERE assignment_type = 'auto'
      AND experience_id IN (SELECT id FROM experiences WHERE category_id = $1)
  `, [categoryId]);

  await pool.query(`
    DELETE FROM experience_locations
    WHERE experience_id IN (SELECT id FROM experiences WHERE category_id = $1)
  `, [categoryId]);

  const result = await pool.query(`
    DELETE FROM experiences WHERE category_id = $1
  `, [categoryId]);

  const count = result.rowCount ?? 0;
  console.log(`${logPrefix} Cleaned up ${count} existing experiences`);
  progress.statusMessage = `Cleaned up ${count} existing experiences`;
  return count;
}
