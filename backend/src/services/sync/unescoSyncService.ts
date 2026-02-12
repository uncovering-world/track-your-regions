/**
 * UNESCO World Heritage Sites Sync Service
 *
 * Fetches data from UNESCO's official API and syncs to local database.
 * API docs: https://data.unesco.org/api/explore/v2.1/console
 */

import { pool } from '../../db/index.js';
import { upsertExperienceRecord } from './syncUtils.js';
import { orchestrateSync, getSyncStatus, cancelSync } from './syncOrchestrator.js';
import type {
  SyncProgress,
  UnescoApiRecord,
  UnescoApiResponse,
  ProcessedExperience,
  ParsedLocation,
} from './types.js';

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
 * Returns a Map from UNESCO id_no (string) -> Wikipedia article URL.
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
  const { experienceId, isCreated } = await upsertExperienceRecord({
    categoryId: exp.categoryId,
    externalId: exp.externalId,
    name: exp.name,
    nameLocal: exp.nameLocal,
    description: exp.description,
    shortDescription: exp.shortDescription,
    category: exp.category,
    tags: exp.tags,
    lon: exp.lon,
    lat: exp.lat,
    countryCodes: exp.countryCodes,
    countryNames: exp.countryNames,
    imageUrl: exp.imageUrl,
    metadata: exp.metadata,
  });

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

// =============================================================================
// Public API
// =============================================================================

/**
 * Main sync function - fetches UNESCO data and upserts to database
 * @param triggeredBy - User ID who triggered the sync
 * @param force - If true, delete all existing data before syncing
 */
export function syncUnescoSites(triggeredBy: number | null, force: boolean = false): Promise<void> {
  // Shared state between fetchItems and processItem via closure
  let wikipediaUrls: Map<string, string>;

  return orchestrateSync<UnescoApiRecord>({
    categoryId: UNESCO_CATEGORY_ID,
    logPrefix: '[UNESCO Sync]',
    fetchItems: async (progress) => {
      const records = await fetchAllUnescoRecords(progress);
      console.log(`[UNESCO Sync] Fetched ${records.length} total records`);

      // Fetch Wikipedia URLs from Wikidata (fails open -- sync continues without them)
      progress.statusMessage = 'Fetching Wikipedia URLs from Wikidata...';
      wikipediaUrls = await fetchWikipediaUrls();

      return { items: records, fetchedCount: records.length };
    },
    processItem: async (record) => {
      const processed = transformRecord(record, wikipediaUrls.get(String(record.id_no)));
      if (!processed) {
        throw new Error('No valid coordinates');
      }
      return upsertExperience(processed);
    },
    getItemName: (record) => record.name_en || `Site ${record.id_no}`,
    getItemId: (record) => String(record.id_no),
  }, triggeredBy, force);
}

/**
 * Get current sync status
 */
export function getUnescoSyncStatus() {
  return getSyncStatus(UNESCO_CATEGORY_ID);
}

/**
 * Cancel running sync
 */
export function cancelUnescoSync() {
  return cancelSync(UNESCO_CATEGORY_ID);
}
