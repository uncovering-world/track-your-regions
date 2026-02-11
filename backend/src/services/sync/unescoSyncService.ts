/**
 * UNESCO World Heritage Sites Sync Service
 *
 * Fetches data from UNESCO's official API and syncs to local database.
 * API docs: https://data.unesco.org/api/explore/v2.1/console
 */

import { pool } from '../../db/index.js';
import type {
  SyncProgress,
  UnescoApiRecord,
  UnescoApiResponse,
  ProcessedExperience,
  ParsedLocation,
} from './types.js';
import { runningSyncs } from './types.js';

const UNESCO_CATEGORY_ID = 1; // Seeded in migration
const PAGE_SIZE = 100;
const WIKIDATA_ENDPOINT = 'https://query.wikidata.org/sparql';
const USER_AGENT = 'TrackYourRegions/1.0 (https://github.com/trackyourregions; contact@trackyourregions.com)';

/**
 * Parse UNESCO components_list field to extract individual locations
 * Format: "{name: Fort Name, ref: 1739-005, latitude: 18.236, longitude: 73.444}"
 * Multiple components are separated by newlines or commas between braces
 */
function parseComponentsList(componentsList: string | undefined): ParsedLocation[] {
  if (!componentsList) {
    return [];
  }

  const locations: ParsedLocation[] = [];

  // Match individual component objects
  // Format: {name: ..., ref: ..., latitude: ..., longitude: ...}
  const componentRegex = /\{[^}]*name:\s*([^,}]+)[^}]*ref:\s*([^,}]+)[^}]*latitude:\s*([\d.-]+)[^}]*longitude:\s*([\d.-]+)[^}]*\}/gi;

  let match;
  while ((match = componentRegex.exec(componentsList)) !== null) {
    const name = match[1].trim();
    const externalRef = match[2].trim();
    const lat = parseFloat(match[3]);
    const lon = parseFloat(match[4]);

    // Validate coordinates
    if (!isNaN(lat) && !isNaN(lon) && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180) {
      locations.push({ name, externalRef, lat, lon });
    }
  }

  return locations;
}

/**
 * Fetch all records from UNESCO API with pagination
 */
async function fetchAllUnescoRecords(
  progress: SyncProgress
): Promise<UnescoApiRecord[]> {
  const baseUrl =
    'https://data.unesco.org/api/explore/v2.1/catalog/datasets/whc001/records';
  const allRecords: UnescoApiRecord[] = [];
  let offset = 0;
  let totalCount = 0;

  progress.status = 'fetching';
  progress.statusMessage = 'Fetching from UNESCO API...';

  do {
    if (progress.cancel) {
      throw new Error('Sync cancelled');
    }

    const url = `${baseUrl}?limit=${PAGE_SIZE}&offset=${offset}`;
    progress.statusMessage = `Fetching page ${Math.floor(offset / PAGE_SIZE) + 1}...`;

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`UNESCO API error: ${response.status} ${response.statusText}`);
    }

    const data = (await response.json()) as UnescoApiResponse;
    totalCount = data.total_count;
    allRecords.push(...data.results);

    progress.total = totalCount;
    progress.progress = allRecords.length;
    progress.statusMessage = `Fetched ${allRecords.length}/${totalCount} records`;

    console.log(`[UNESCO Sync] Fetched ${allRecords.length}/${totalCount} records`);

    offset += PAGE_SIZE;
  } while (allRecords.length < totalCount);

  return allRecords;
}

/**
 * Fetch Wikipedia article URLs for all UNESCO sites from Wikidata.
 * Uses property P757 (UNESCO World Heritage Site ID) to match sites,
 * then schema:about + schema:isPartOf to get English Wikipedia URLs.
 * Returns a Map from UNESCO id_no (string) → Wikipedia article URL.
 */
async function fetchWikipediaUrls(): Promise<Map<string, string>> {
  const query = `
    SELECT ?unescoId ?article WHERE {
      ?item wdt:P757 ?unescoId .
      ?article schema:about ?item ;
               schema:isPartOf <https://en.wikipedia.org/> .
    }
  `;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60000);

  try {
    const response = await fetch(WIKIDATA_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/sparql-results+json',
        'User-Agent': USER_AGENT,
      },
      body: `query=${encodeURIComponent(query)}&timeout=60000`,
      signal: controller.signal,
    });

    if (!response.ok) {
      console.warn(`[UNESCO Sync] Wikipedia URL fetch failed: ${response.status}`);
      return new Map();
    }

    const data = await response.json() as {
      results: { bindings: Array<{ unescoId?: { value: string }; article?: { value: string } }> };
    };

    const map = new Map<string, string>();
    for (const binding of data.results.bindings) {
      if (binding.unescoId?.value && binding.article?.value) {
        map.set(binding.unescoId.value, binding.article.value);
      }
    }

    console.log(`[UNESCO Sync] Fetched ${map.size} Wikipedia URLs from Wikidata`);
    return map;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.warn(`[UNESCO Sync] Wikipedia URL fetch error: ${msg}`);
    return new Map(); // Fail open: sync proceeds without Wikipedia links
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Transform UNESCO API record to our internal format
 */
function transformRecord(record: UnescoApiRecord, wikipediaUrl?: string): ProcessedExperience | null {
  // Skip records without coordinates
  if (!record.coordinates || !record.coordinates.lat || !record.coordinates.lon) {
    console.log(`[UNESCO Sync] Skipping ${record.id_no} - no coordinates`);
    return null;
  }

  // Build multilingual name object
  const nameLocal: Record<string, string> = {};
  if (record.name_en) nameLocal.en = record.name_en;
  if (record.name_fr) nameLocal.fr = record.name_fr;
  if (record.name_es) nameLocal.es = record.name_es;
  if (record.name_ru) nameLocal.ru = record.name_ru;
  if (record.name_ar) nameLocal.ar = record.name_ar;
  if (record.name_zh) nameLocal.zh = record.name_zh;

  // Parse country codes (format: "FR,ES" for transboundary)
  // Handle both string and array formats from API
  let countryCodes: string[] = [];
  if (record.iso_codes) {
    if (typeof record.iso_codes === 'string') {
      countryCodes = record.iso_codes.split(',').map((c) => c.trim()).filter(Boolean);
    } else if (Array.isArray(record.iso_codes)) {
      countryCodes = record.iso_codes.map(String);
    }
  }

  // Parse country names - handle both string and array formats
  let countryNames: string[] = [];
  if (record.states_names) {
    if (typeof record.states_names === 'string') {
      countryNames = record.states_names.split(',').map((c) => c.trim()).filter(Boolean);
    } else if (Array.isArray(record.states_names)) {
      countryNames = record.states_names.map(String);
    }
  }

  // Normalize category
  let category: string | null = null;
  if (record.category) {
    const cat = record.category.toLowerCase();
    if (cat.includes('cultural')) category = 'cultural';
    else if (cat.includes('natural')) category = 'natural';
    else if (cat.includes('mixed')) category = 'mixed';
    else category = cat;
  }

  // Build tags from criteria
  const tags: string[] = [];
  if (record.criteria) {
    // UNESCO criteria like "(i)(ii)(iv)" -> ["criterion_i", "criterion_ii", "criterion_iv"]
    const criteriaMatches = record.criteria.match(/\(([ivx]+)\)/gi);
    if (criteriaMatches) {
      tags.push(...criteriaMatches.map((c) => `criterion_${c.replace(/[()]/g, '').toLowerCase()}`));
    }
  }
  if (record.danger === 1 || record.danger_list) {
    tags.push('in_danger');
  }
  if (record.transboundary === 1) {
    tags.push('transboundary');
  }

  // Build metadata object with UNESCO-specific fields
  const metadata: Record<string, unknown> = {
    dateInscribed: record.date_inscribed,
    inDanger: record.danger === 1,
    dangerList: record.danger_list || null,
    criteria: record.criteria,
    region: record.region,
    areaHectares: record.area_hectares,
    transboundary: record.transboundary === 1,
    website: `https://whc.unesco.org/en/list/${record.id_no}`,
    wikipediaUrl: wikipediaUrl || null,
  };

  // Extract image URL - UNESCO returns either a string URL or a JSON object with url field
  let remoteImageUrl: string | null = null;
  if (record.main_image_url) {
    if (typeof record.main_image_url === 'string') {
      // Check if it's a JSON string
      try {
        const parsed = JSON.parse(record.main_image_url);
        remoteImageUrl = parsed.url || null;
      } catch {
        // It's a plain URL string
        remoteImageUrl = record.main_image_url;
      }
    } else if (typeof record.main_image_url === 'object' && record.main_image_url !== null) {
      // It's already an object
      remoteImageUrl = (record.main_image_url as { url?: string }).url || null;
    }
  }

  // Parse multi-location components (serial nominations)
  const locations = parseComponentsList(record.components_list);

  return {
    categoryId: UNESCO_CATEGORY_ID,
    externalId: String(record.id_no),
    name: record.name_en || `Site ${record.id_no}`,
    nameLocal,
    description: null, // UNESCO API doesn't provide full description
    shortDescription: record.short_description_en || null,
    category,
    tags,
    lat: record.coordinates.lat,
    lon: record.coordinates.lon,
    countryCodes,
    countryNames,
    imageUrl: remoteImageUrl, // Store remote URL directly
    metadata,
    locations,
  };
}

/**
 * Upsert a single experience into the database
 */
async function upsertExperience(exp: ProcessedExperience): Promise<'created' | 'updated'> {
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
      exp.categoryId,
      exp.externalId,
      exp.name,
      JSON.stringify(exp.nameLocal),
      exp.description,
      exp.shortDescription,
      exp.category,
      JSON.stringify(exp.tags),
      exp.lon, // ST_MakePoint takes (lon, lat)
      exp.lat,
      exp.countryCodes,
      exp.countryNames,
      exp.imageUrl,
      JSON.stringify(exp.metadata),
    ]
  );

  const experienceId = result.rows[0].id;
  const isCreated = result.rows[0].inserted;

  // Upsert locations
  await upsertExperienceLocations(experienceId, exp);

  return isCreated ? 'created' : 'updated';
}

/**
 * Upsert locations for an experience
 *
 * For multi-location experiences (with components_list):
 *   - Only create locations from the parsed components (ordinal 1, 2, 3...)
 *   - Do NOT create a redundant ordinal 0 from the main coordinates
 *
 * For single-location experiences (no components_list):
 *   - Create one location (ordinal 1) from the experience's main coordinates
 */
async function upsertExperienceLocations(experienceId: number, exp: ProcessedExperience): Promise<void> {
  // Delete all existing locations for this experience (we'll recreate them)
  await pool.query(
    `DELETE FROM experience_locations WHERE experience_id = $1`,
    [experienceId]
  );

  if (exp.locations.length > 0) {
    // Multi-location experience: create locations from components_list only
    for (let i = 0; i < exp.locations.length; i++) {
      const loc = exp.locations[i];
      await pool.query(
        `INSERT INTO experience_locations (experience_id, name, external_ref, ordinal, location)
         VALUES ($1, $2, $3, $4, ST_SetSRID(ST_MakePoint($5, $6), 4326))`,
        [
          experienceId,
          loc.name,
          loc.externalRef,
          i + 1, // ordinal starts at 1
          loc.lon,
          loc.lat,
        ]
      );
    }
  } else {
    // Single-location experience: create one location from main coordinates
    await pool.query(
      `INSERT INTO experience_locations (experience_id, name, external_ref, ordinal, location)
       VALUES ($1, NULL, NULL, 1, ST_SetSRID(ST_MakePoint($2, $3), 4326))`,
      [experienceId, exp.lon, exp.lat]
    );
  }
}

/**
 * Create a sync log entry
 */
async function createSyncLog(triggeredBy: number | null): Promise<number> {
  const result = await pool.query(
    `INSERT INTO experience_sync_logs (category_id, triggered_by, status)
     VALUES ($1, $2, 'running')
     RETURNING id`,
    [UNESCO_CATEGORY_ID, triggeredBy]
  );
  return result.rows[0].id;
}

/**
 * Update sync log with final status
 */
async function updateSyncLog(
  logId: number,
  status: string,
  stats: { fetched: number; created: number; updated: number; errors: number },
  errorDetails?: unknown[]
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
    [
      logId,
      status,
      stats.fetched,
      stats.created,
      stats.updated,
      stats.errors,
      errorDetails ? JSON.stringify(errorDetails) : null,
    ]
  );

  // Also update the source's last sync info
  await pool.query(
    `UPDATE experience_categories SET
      last_sync_at = NOW(),
      last_sync_status = $2,
      last_sync_error = $3
     WHERE id = $1`,
    [
      UNESCO_CATEGORY_ID,
      status,
      status === 'failed' ? 'See sync log for details' : null,
    ]
  );
}

/**
 * Delete all data for UNESCO source (for force sync)
 */
async function cleanupUnescoData(progress: SyncProgress): Promise<void> {
  progress.statusMessage = 'Cleaning up existing data...';

  // Delete in correct order due to foreign key constraints
  // 1. Delete user visited locations for UNESCO experiences
  await pool.query(`
    DELETE FROM user_visited_locations
    WHERE location_id IN (
      SELECT el.id FROM experience_locations el
      JOIN experiences e ON el.experience_id = e.id
      WHERE e.category_id = $1
    )
  `, [UNESCO_CATEGORY_ID]);

  // 2. Delete user visited experiences
  await pool.query(`
    DELETE FROM user_visited_experiences
    WHERE experience_id IN (SELECT id FROM experiences WHERE category_id = $1)
  `, [UNESCO_CATEGORY_ID]);

  // 3. Delete experience location regions (auto-assigned only, preserve manual curator assignments)
  await pool.query(`
    DELETE FROM experience_location_regions
    WHERE assignment_type = 'auto'
      AND location_id IN (
        SELECT el.id FROM experience_locations el
        JOIN experiences e ON el.experience_id = e.id
        WHERE e.category_id = $1
      )
  `, [UNESCO_CATEGORY_ID]);

  // 4. Delete experience regions (auto-assigned only, preserve manual curator assignments)
  await pool.query(`
    DELETE FROM experience_regions
    WHERE assignment_type = 'auto'
      AND experience_id IN (SELECT id FROM experiences WHERE category_id = $1)
  `, [UNESCO_CATEGORY_ID]);

  // 5. Delete experience locations
  await pool.query(`
    DELETE FROM experience_locations
    WHERE experience_id IN (SELECT id FROM experiences WHERE category_id = $1)
  `, [UNESCO_CATEGORY_ID]);

  // 6. Delete experiences
  const result = await pool.query(`
    DELETE FROM experiences WHERE category_id = $1
  `, [UNESCO_CATEGORY_ID]);

  console.log(`[UNESCO Sync] Cleaned up ${result.rowCount} existing experiences`);
  progress.statusMessage = `Cleaned up ${result.rowCount} existing experiences`;
}

/**
 * Main sync function - fetches UNESCO data and upserts to database
 * @param triggeredBy - User ID who triggered the sync
 * @param force - If true, delete all existing data before syncing
 */
export async function syncUnescoSites(triggeredBy: number | null, force: boolean = false): Promise<void> {
  // Check if already running
  const existing = runningSyncs.get(UNESCO_CATEGORY_ID);
  if (existing && existing.status !== 'complete' && existing.status !== 'failed' && existing.status !== 'cancelled') {
    throw new Error('UNESCO sync already in progress');
  }

  // Initialize progress
  const progress: SyncProgress = {
    cancel: false,
    status: 'fetching',
    statusMessage: 'Initializing...',
    progress: 0,
    total: 0,
    created: 0,
    updated: 0,
    errors: 0,
    currentItem: '',
    logId: null,
  };
  runningSyncs.set(UNESCO_CATEGORY_ID, progress);

  const errorDetails: { externalId: string; error: string }[] = [];

  try {
    // Create sync log entry
    progress.logId = await createSyncLog(triggeredBy);
    console.log(`[UNESCO Sync] Started sync (log ID: ${progress.logId})${force ? ' [FORCE MODE]' : ''}`);

    // If force mode, clean up all existing data first
    if (force) {
      await cleanupUnescoData(progress);
    }

    // Fetch all records from API
    const records = await fetchAllUnescoRecords(progress);
    console.log(`[UNESCO Sync] Fetched ${records.length} total records`);

    // Fetch Wikipedia URLs from Wikidata (fails open — sync continues without them)
    progress.statusMessage = 'Fetching Wikipedia URLs from Wikidata...';
    const wikipediaUrls = await fetchWikipediaUrls();

    // Process records
    progress.status = 'processing';
    progress.progress = 0;
    progress.total = records.length;

    for (let i = 0; i < records.length; i++) {
      if (progress.cancel) {
        throw new Error('Sync cancelled');
      }

      const record = records[i];
      progress.currentItem = record.name_en || `Site ${record.id_no}`;
      progress.statusMessage = `Processing ${i + 1}/${records.length}: ${progress.currentItem}`;

      try {
        const processed = transformRecord(record, wikipediaUrls.get(String(record.id_no)));
        if (processed) {
          const result = await upsertExperience(processed);
          if (result === 'created') {
            progress.created++;
          } else {
            progress.updated++;
          }
        } else {
          progress.errors++;
          errorDetails.push({
            externalId: String(record.id_no),
            error: 'No valid coordinates',
          });
        }
      } catch (err) {
        progress.errors++;
        const errorMsg = err instanceof Error ? err.message : String(err);
        errorDetails.push({
          externalId: String(record.id_no),
          error: errorMsg,
        });
        console.error(`[UNESCO Sync] Error processing ${record.id_no}:`, errorMsg);
      }

      progress.progress = i + 1;
    }

    // Determine final status
    const finalStatus = progress.errors > 0 && progress.created + progress.updated === 0
      ? 'failed'
      : progress.errors > 0
      ? 'partial'
      : 'success';

    progress.status = 'complete';
    progress.statusMessage = `Complete: ${progress.created} created, ${progress.updated} updated, ${progress.errors} errors`;

    await updateSyncLog(progress.logId, finalStatus, {
      fetched: records.length,
      created: progress.created,
      updated: progress.updated,
      errors: progress.errors,
    }, errorDetails.length > 0 ? errorDetails : undefined);

    console.log(`[UNESCO Sync] Complete: created=${progress.created}, updated=${progress.updated}, errors=${progress.errors}`);
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    progress.status = progress.cancel ? 'cancelled' : 'failed';
    progress.statusMessage = errorMsg;

    if (progress.logId) {
      await updateSyncLog(progress.logId, progress.status, {
        fetched: progress.progress,
        created: progress.created,
        updated: progress.updated,
        errors: progress.errors,
      }, [{ externalId: 'system', error: errorMsg }]);
    }

    console.error(`[UNESCO Sync] Failed:`, errorMsg);
    throw err;
  } finally {
    // Clean up after delay, but only if this sync's progress is still current
    const thisProgress = progress;
    setTimeout(() => {
      if (runningSyncs.get(UNESCO_CATEGORY_ID) === thisProgress) {
        runningSyncs.delete(UNESCO_CATEGORY_ID);
      }
    }, 30000);
  }
}

/**
 * Get current sync status
 */
export function getUnescoSyncStatus(): SyncProgress | null {
  return runningSyncs.get(UNESCO_CATEGORY_ID) || null;
}

/**
 * Cancel running sync
 */
export function cancelUnescoSync(): boolean {
  const progress = runningSyncs.get(UNESCO_CATEGORY_ID);
  if (progress && progress.status !== 'complete' && progress.status !== 'failed') {
    progress.cancel = true;
    progress.statusMessage = 'Cancelling...';
    return true;
  }
  return false;
}
