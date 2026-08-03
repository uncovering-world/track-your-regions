/**
 * Shared sync utilities
 *
 * Common database operations used by UNESCO, museum, and landmark sync services.
 */

import { pool } from '../../db/index.js';
import { computeChangeSet, type ChangeSetResult, type ExperienceSnapshot } from './changeSet.js';
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

export interface UpsertOutcome {
  experienceId: number;
  changeSet: ChangeSetResult;
  nameSnapshot: string;
  /** The row carried `missing_since` and the source has produced it again. */
  returnedFromMissing: boolean;
}

/** Columns the diff reads. Declared once; the SQL below is built from them. */
const SNAPSHOT_COLUMNS = [
  'name', 'name_local', 'description', 'short_description', 'category', 'tags',
  'country_codes', 'country_names', 'image_url', 'metadata',
] as const;

function snapshotFromRow(row: Record<string, unknown>, prefix: '' | 'old_'): ExperienceSnapshot {
  const get = (column: string) => row[`${prefix}${column}`];
  return {
    name: (get('name') as string) ?? '',
    nameLocal: (get('name_local') as Record<string, string> | null) ?? null,
    description: (get('description') as string | null) ?? null,
    shortDescription: (get('short_description') as string | null) ?? null,
    category: (get('category') as string | null) ?? null,
    tags: (get('tags') as string[] | null) ?? null,
    lon: Number(get('lon')),
    lat: Number(get('lat')),
    countryCodes: (get('country_codes') as string[] | null) ?? null,
    countryNames: (get('country_names') as string[] | null) ?? null,
    imageUrl: (get('image_url') as string | null) ?? null,
    metadata: (get('metadata') as Record<string, unknown> | null) ?? null,
  };
}

function snapshotFromParams(params: ExperienceUpsertParams): ExperienceSnapshot {
  return {
    name: params.name,
    nameLocal: params.nameLocal,
    description: params.description,
    shortDescription: params.shortDescription,
    category: params.category,
    tags: params.tags,
    lon: params.lon,
    lat: params.lat,
    countryCodes: params.countryCodes,
    countryNames: params.countryNames,
    imageUrl: params.imageUrl,
    metadata: params.metadata,
  };
}

/**
 * Read the stored row and diff it against the incoming record without writing.
 *
 * Backs dry runs: a preview has to be able to say what would change without
 * spending the change.
 */
async function previewUpsert(params: ExperienceUpsertParams): Promise<UpsertOutcome> {
  const result = await pool.query(
    `SELECT id, curated_fields, missing_since, ${SNAPSHOT_COLUMNS.join(', ')},
            ST_X(location) AS lon, ST_Y(location) AS lat
     FROM experiences
     WHERE category_id = $1 AND external_id = $2`,
    [params.categoryId, params.externalId]
  );

  const incoming = snapshotFromParams(params);

  if (result.rows.length === 0) {
    return {
      experienceId: 0,
      changeSet: computeChangeSet(null, incoming, []),
      nameSnapshot: params.name,
      returnedFromMissing: false,
    };
  }

  const row = result.rows[0];
  const curatedFields: string[] = row.curated_fields ?? [];

  return {
    experienceId: row.id,
    changeSet: computeChangeSet(snapshotFromRow(row, ''), incoming, curatedFields),
    // Emulates the upsert's own CASE guard rather than picking a side: a
    // curated name stays as the curator wrote it, an ordinary rename shows the
    // new name. Reading the stored name unconditionally would make a preview
    // label a renamed row differently from the run it stands in for.
    nameSnapshot: curatedFields.includes('name') ? (row.name as string) : params.name,
    returnedFromMissing: row.missing_since !== null,
  };
}

/**
 * Upsert an experience record with curated_fields-aware conflict handling,
 * returning both the prior and resulting state.
 *
 * The `before` CTE is what makes provenance possible: RETURNING can only hand
 * back the row as it now stands, so the previous values are captured in the
 * same statement or they are gone.
 */
export async function upsertExperienceRecord(
  params: ExperienceUpsertParams,
  options: { dryRun?: boolean; syncLogId?: number | null } = {},
): Promise<UpsertOutcome> {
  if (options.dryRun) return previewUpsert(params);

  const result = await pool.query(
    `WITH before AS (
      SELECT id, curated_fields, missing_since, ${SNAPSHOT_COLUMNS.join(', ')},
             ST_X(location) AS lon, ST_Y(location) AS lat
      FROM experiences
      WHERE category_id = $1 AND external_id = $2
    ), ins AS (
      INSERT INTO experiences (
        category_id, external_id, name, name_local, description, short_description,
        category, tags, location, country_codes, country_names, image_url, metadata,
        first_seen_sync_log_id, last_seen_sync_log_id, last_seen_at, created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8,
        ST_SetSRID(ST_MakePoint($9, $10), 4326),
        $11, $12, $13, $14, $15, $15, NOW(), NOW(), NOW()
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
        last_seen_sync_log_id = COALESCE(EXCLUDED.last_seen_sync_log_id, experiences.last_seen_sync_log_id),
        last_seen_at = NOW(),
        missing_since = NULL,
        updated_at = NOW()
      RETURNING id, (xmax = 0) AS inserted, curated_fields, ${SNAPSHOT_COLUMNS.join(', ')},
                ST_X(location) AS lon, ST_Y(location) AS lat
    )
    SELECT ins.*,
           ${SNAPSHOT_COLUMNS.map(column => `before.${column} AS old_${column}`).join(', ')},
           before.lon AS old_lon, before.lat AS old_lat,
           before.missing_since AS old_missing_since
    FROM ins LEFT JOIN before ON before.id = ins.id`,
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
      options.syncLogId ?? null,
    ]
  );

  const row = result.rows[0];
  const before = row.inserted ? null : snapshotFromRow(row, 'old_');

  return {
    experienceId: row.id,
    changeSet: computeChangeSet(before, snapshotFromParams(params), row.curated_fields ?? []),
    // RETURNING carries the name after the curated_fields guards, so a
    // protected name labels the changeset row with what is actually stored.
    nameSnapshot: (row.name as string) ?? params.name,
    returnedFromMissing: row.old_missing_since != null,
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
  isDryRun: boolean = false,
): Promise<number> {
  const result = await pool.query(
    `INSERT INTO experience_sync_logs (category_id, triggered_by, status, is_dry_run)
     VALUES ($1, $2, 'running', $3)
     RETURNING id`,
    [categoryId, triggeredBy, isDryRun]
  );
  return result.rows[0].id;
}

export interface SyncLogStats {
  fetched: number;
  created: number;
  updated: number;
  unchanged: number;
  missing: number;
  curatedConflicts: number;
  filtered: number;
  errors: number;
  detectionSkippedReason?: string | null;
}

/**
 * Update a sync log entry with final status and stats.
 *
 * Also updates the experience_categories table with last sync info — except
 * after a dry run, which synced nothing. Claiming otherwise there would make
 * the category's own record of its last sync a lie.
 */
export async function updateSyncLog(
  categoryId: number,
  logId: number,
  status: string,
  stats: SyncLogStats,
  errorDetails?: unknown[],
): Promise<void> {
  const result = await pool.query(
    `UPDATE experience_sync_logs SET
      completed_at = NOW(),
      status = $2,
      total_fetched = $3,
      total_created = $4,
      total_updated = $5,
      total_errors = $6,
      error_details = $7,
      total_unchanged = $8,
      total_missing = $9,
      total_curated_conflicts = $10,
      detection_skipped_reason = $11,
      total_filtered = $12
     WHERE id = $1
     RETURNING is_dry_run`,
    [logId, status, stats.fetched, stats.created, stats.updated, stats.errors,
     errorDetails ? JSON.stringify(errorDetails) : null,
     stats.unchanged, stats.missing, stats.curatedConflicts,
     stats.detectionSkippedReason ?? null, stats.filtered]
  );

  if (result.rows[0]?.is_dry_run) return;

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
