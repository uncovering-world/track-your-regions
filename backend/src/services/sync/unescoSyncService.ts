/**
 * UNESCO World Heritage Sites Sync Service
 *
 * Fetches data from UNESCO's official API and syncs to local database.
 * API docs: https://data.unesco.org/api/explore/v2.1/console
 */

import {
  writeExperienceLocations,
  type LocationWriteResult,
} from './locationWriter.js';
import type { IncomingLocation } from './locationIncoming.js';
import { upsertExperienceRecord } from './syncUtils.js';
import { orchestrateSync, getSyncStatus, cancelSync } from './syncOrchestrator.js';
import type { ProcessItemResult, SyncRunContext } from './syncOrchestrator.js';
import { readFixtureRecords } from './fixtureSource.js';
import type {
  SyncProgress,
  UnescoApiRecord,
  UnescoApiResponse,
  ProcessedExperience,
  ParsedLocation,
  ContentsByKind,
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

  // Format: {name: ..., ref: ..., latitude: ..., longitude: ...}. Split into
  // two passes — find each `{…}` first, then extract fields from inside —
  // so each individual regex is bounded and not catastrophic.
  // eslint-disable-next-line sonarjs/slow-regex -- negated class `[^}]+` cannot match past `}`, so the `+` quantifier is committed and there's no backtracking across object boundaries
  const objectRegex = /\{[^}]+\}/g;
  const fieldName = /name:\s*([^,}]+)/i;
  const fieldRef = /ref:\s*([^,}]+)/i;
  const fieldLat = /latitude:\s*([\d.-]+)/i;
  const fieldLon = /longitude:\s*([\d.-]+)/i;

  for (const objMatch of componentsList.matchAll(objectRegex)) {
    const obj = objMatch[0];
    const nameMatch = obj.match(fieldName);
    const refMatch = obj.match(fieldRef);
    const latMatch = obj.match(fieldLat);
    const lonMatch = obj.match(fieldLon);
    if (!nameMatch || !refMatch || !latMatch || !lonMatch) continue;

    const lat = parseFloat(latMatch[1]);
    const lon = parseFloat(lonMatch[1]);
    if (!isNaN(lat) && !isNaN(lon) && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180) {
      locations.push({
        name: nameMatch[1].trim(),
        externalRef: refMatch[1].trim(),
        lat,
        lon,
      });
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

const NAME_LOCALE_FIELDS: Array<[keyof UnescoApiRecord, string]> = [
  ['name_en', 'en'],
  ['name_fr', 'fr'],
  ['name_es', 'es'],
  ['name_ru', 'ru'],
  ['name_ar', 'ar'],
  ['name_zh', 'zh'],
];

function buildMultilingualNames(record: UnescoApiRecord): Record<string, string> {
  const nameLocal: Record<string, string> = {};
  for (const [field, locale] of NAME_LOCALE_FIELDS) {
    const value = record[field];
    if (typeof value === 'string' && value) nameLocal[locale] = value;
  }
  return nameLocal;
}

/** UNESCO API hands us "FR,ES" or ["FR","ES"] depending on the field; normalize either shape. */
function parseDelimitedField(value: unknown): string[] {
  if (typeof value === 'string') {
    return value.split(',').map(c => c.trim()).filter(Boolean);
  }
  if (Array.isArray(value)) {
    return value.map(String);
  }
  return [];
}

function normalizeCategory(category: string | undefined | null): string | null {
  if (!category) return null;
  const cat = category.toLowerCase();
  if (cat.includes('cultural')) return 'cultural';
  if (cat.includes('natural')) return 'natural';
  if (cat.includes('mixed')) return 'mixed';
  return cat;
}

function buildUnescoTags(record: UnescoApiRecord): string[] {
  const tags: string[] = [];
  if (record.criteria) {
    // UNESCO criteria like "(i)(ii)(iv)" -> ["criterion_i", "criterion_ii", "criterion_iv"]
    const criteriaMatches = record.criteria.match(/\(([ivx]+)\)/gi);
    if (criteriaMatches) {
      tags.push(...criteriaMatches.map(c => `criterion_${c.replace(/[()]/g, '').toLowerCase()}`));
    }
  }
  if (record.danger === 1 || record.danger_list) tags.push('in_danger');
  if (record.transboundary === 1) tags.push('transboundary');
  return tags;
}

/** UNESCO returns either a plain URL, a JSON-stringified object, or an object literal. */
function extractRemoteImageUrl(value: unknown): string | null {
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return parsed.url || null;
    } catch {
      return value;
    }
  }
  if (typeof value === 'object' && value !== null) {
    return (value as { url?: string }).url || null;
  }
  return null;
}

/**
 * The site's own point, falling back to its most central component.
 *
 * UNESCO leaves `coordinates` null on serial nominations and carries the real
 * positions in `components_list` — 28 of the 29 records that failed the dry run
 * of 3 August were of this shape, including sites already in the catalogue
 * (Garamba, Berlin Modernism) whose main field the source has since emptied.
 *
 * Neither the centroid nor the first component will do. A centroid of scattered
 * parts (the Roças of São Tomé, the D-Day beaches) can land in open water; the
 * first component is wherever the source happened to list it, which for Getbol
 * sat 301 km from the site's former point — far enough to land in a different
 * region and take the experience's assignment with it. The component nearest
 * the centroid is both a real place at the site and a central one.
 */
export function resolveMainPoint(
  record: UnescoApiRecord,
  locations: ParsedLocation[],
): { lat: number; lon: number } | null {
  // Number.isFinite, not truthiness: a site on the equator or the prime
  // meridian has a coordinate of 0, which is a position, not a missing value.
  const { lat, lon } = record.coordinates ?? {};
  if (Number.isFinite(lat) && Number.isFinite(lon)) {
    return { lat: lat as number, lon: lon as number };
  }
  if (locations.length === 0) return null;

  const centroidLat = locations.reduce((sum, l) => sum + l.lat, 0) / locations.length;
  const centroidLon = meanLongitude(locations);
  // Comparing squared offsets is enough to rank candidates; longitude is scaled
  // by cos(lat) so the comparison stays sane away from the equator, and the
  // difference is taken the short way round so a site spanning the
  // antimeridian is not judged against a point on the far side of the planet.
  const lonScale = Math.cos((centroidLat * Math.PI) / 180);
  const offset = (l: ParsedLocation) =>
    (l.lat - centroidLat) ** 2 + (longitudeDelta(l.lon, centroidLon) * lonScale) ** 2;

  const medoid = locations.reduce((best, l) => (offset(l) < offset(best) ? l : best));
  return { lat: medoid.lat, lon: medoid.lon };
}

/**
 * Mean of longitudes, taken as directions rather than numbers.
 *
 * An arithmetic mean puts parts at 179.5 and -179.5 — half a degree apart
 * across the antimeridian — at longitude 0, on the opposite side of the world.
 * Averaging the unit vectors and reading the angle back gives 180, which is
 * where the site actually is. See CLAUDE.md § Antimeridian Handling.
 */
function meanLongitude(locations: ParsedLocation[]): number {
  const toRad = Math.PI / 180;
  const x = locations.reduce((sum, l) => sum + Math.cos(l.lon * toRad), 0);
  const y = locations.reduce((sum, l) => sum + Math.sin(l.lon * toRad), 0);
  return (Math.atan2(y, x) * 180) / Math.PI;
}

/** Separation between two longitudes, never more than half a turn. */
function longitudeDelta(a: number, b: number): number {
  const diff = Math.abs(a - b) % 360;
  return diff > 180 ? 360 - diff : diff;
}

/**
 * Transform UNESCO API record to our internal format
 */
function transformRecord(record: UnescoApiRecord, wikipediaUrl?: string): ProcessedExperience | null {
  const locations = parseComponentsList(record.components_list);
  const point = resolveMainPoint(record, locations);
  if (!point) {
    console.log(`[UNESCO Sync] Skipping ${record.id_no} - no coordinates`);
    return null;
  }

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

  return {
    categoryId: UNESCO_CATEGORY_ID,
    externalId: String(record.id_no),
    name: record.name_en || `Site ${record.id_no}`,
    nameLocal: buildMultilingualNames(record),
    description: null, // UNESCO API doesn't provide full description
    shortDescription: record.short_description_en || null,
    category: normalizeCategory(record.category),
    tags: buildUnescoTags(record),
    lat: point.lat,
    lon: point.lon,
    countryCodes: parseDelimitedField(record.iso_codes),
    countryNames: parseDelimitedField(record.states_names),
    imageUrl: extractRemoteImageUrl(record.main_image_url),
    metadata,
    locations,
  };
}

/**
 * Upsert a single experience into the database
 */
async function upsertExperience(
  exp: ProcessedExperience,
  context: SyncRunContext,
): Promise<ProcessItemResult> {
  const { experienceId, changeSet, nameSnapshot, returnedFromMissing } = await upsertExperienceRecord({
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
  }, { dryRun: context.dryRun, syncLogId: context.syncLogId });

  // A preview writes nothing downstream either: locations would belong to a row
  // that was never touched.
  let contents: ContentsByKind | undefined;
  if (!context.dryRun) {
    const written = await upsertExperienceLocations(experienceId, exp);
    if (written.needsAssignment.length > 0 || written.unoffered > 0) {
      context.onLocationsChanged(experienceId);
    }
    // The serial sites are here — 485 objects hold more than one point, and a
    // component arriving or leaving is often the only thing a run changed about
    // one of them (ADR-0026).
    contents = { locations: written.delta };
  }

  return {
    outcome: changeSet.changeType,
    // 0 is previewUpsert's stand-in for a row that does not exist yet and would
    // violate the FK; a real id is worth keeping even in a preview.
    experienceId: experienceId || null,
    nameSnapshot,
    changeSet,
    returnedFromMissing,
    contents,
  };
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
async function upsertExperienceLocations(
  experienceId: number,
  exp: ProcessedExperience,
): Promise<LocationWriteResult> {
  // Components when the site has them, the main point otherwise. The write
  // itself keeps every point that is still offered on its existing row — see
  // `locationWriter.ts` for why deleting first destroyed region assignments.
  const incoming: IncomingLocation[] = exp.locations.length > 0
    ? exp.locations.map(loc => ({
        name: loc.name,
        externalRef: loc.externalRef,
        lon: loc.lon,
        lat: loc.lat,
      }))
    : [{ name: null, externalRef: null, lon: exp.lon, lat: exp.lat }];

  return writeExperienceLocations(experienceId, incoming);
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Main sync function - fetches UNESCO data and upserts to database
 * @param triggeredBy - User ID who triggered the sync
 */
export function syncUnescoSites(
  triggeredBy: number | null,
  options: { dryRun?: boolean } = {},
): Promise<void> {
  // Shared state between fetchItems and processItem via closure
  let wikipediaUrls: Map<string, string>;

  return orchestrateSync<UnescoApiRecord>({
    categoryId: UNESCO_CATEGORY_ID,
    logPrefix: '[UNESCO Sync]',
    // UNESCO publishes its whole list, so a site absent from a clean run really
    // is absent from the list.
    sourceCompleteness: 'authoritative',
    fetchItems: async (progress) => {
      const fixture = await readFixtureRecords<UnescoApiRecord>('unesco.json');
      if (fixture !== null) {
        console.log(`[UNESCO Sync] Using fixture source: ${fixture.length} records`);
        wikipediaUrls = new Map();
        return { items: fixture, fetchedCount: fixture.length };
      }

      const records = await fetchAllUnescoRecords(progress);
      console.log(`[UNESCO Sync] Fetched ${records.length} total records`);

      // Fetch Wikipedia URLs from Wikidata (fails open -- sync continues without them)
      progress.statusMessage = 'Fetching Wikipedia URLs from Wikidata...';
      wikipediaUrls = await fetchWikipediaUrls();

      return { items: records, fetchedCount: records.length };
    },
    processItem: async (record, _progress, context) => {
      const processed = transformRecord(record, wikipediaUrls.get(String(record.id_no)));
      if (!processed) {
        throw new Error('No valid coordinates');
      }
      return upsertExperience(processed, context);
    },
    getItemName: (record) => record.name_en || `Site ${record.id_no}`,
    getItemId: (record) => String(record.id_no),
  }, triggeredBy, options);
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
