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
import { fetchUnescoRecords } from './unescoApi.js';
import {
  creditToWrite,
  readStoredCredits,
  type ImageCredit,
  type StoredCredit,
} from './imageCredit.js';
import { sparqlQuery, SPARQL_WAIT_BUDGET_MS, waitMessage } from './wikidataUtils.js';
import { WaitBudget } from './sourceRetry.js';
import type {
  SyncProgress,
  UnescoApiRecord,
  ProcessedExperience,
  ParsedLocation,
  ContentsByKind,
} from './types.js';

const UNESCO_CATEGORY_ID = 1; // Seeded in migration

/**
 * What each site's row already says about who took its picture.
 *
 * Read once per run, like the other two collectors: `creditToWrite` needs it to
 * know whether a curator owns the photograph, and asking per site would be 1272
 * queries inside the write loop.
 */
let storedCredits = new Map<string, StoredCredit>();

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
 * Fetch Wikipedia article URLs for all UNESCO sites from Wikidata.
 * Uses property P757 (UNESCO World Heritage Site ID) to match sites,
 * then schema:about + schema:isPartOf to get English Wikipedia URLs.
 * Returns a Map from UNESCO id_no (string) -> Wikipedia article URL.
 *
 * Sent through the shared SPARQL client rather than a hand-rolled POST, which is
 * what this used to be: it asked for a 60-second server deadline, the value
 * their engine clamps and answers as a gateway error, and it had no retry at
 * all, so one bad minute at Wikidata silently cost every site its article link.
 * Still fails open — a missing link is a missing link, not a failed import — but
 * now only after the same waiting every other query gets.
 */
async function fetchWikipediaUrls(
  progress: SyncProgress,
  budget: WaitBudget,
): Promise<Map<string, string>> {
  const query = `
    SELECT ?unescoId ?article WHERE {
      ?item wdt:P757 ?unescoId .
      ?article schema:about ?item ;
               schema:isPartOf <https://en.wikipedia.org/> .
    }
  `;

  try {
    const bindings = await sparqlQuery(query, '[UNESCO Sync]', {
      budget,
      isCancelled: () => progress.cancel,
      onWait: (wait) => {
        progress.statusMessage = waitMessage('Wikidata', wait, budget);
      },
    });

    const map = new Map<string, string>();
    for (const binding of bindings) {
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

/**
 * A yes from the portal, in whichever way it chose to say it.
 *
 * These fields arrive as the *strings* `"True"` and `"False"` — measured on
 * 2026-08-21, from both the paged and the export endpoint. The code compared
 * them against the number `1`, so the answer was no for every site ever
 * imported: **0 of 1272** carried `metadata.inDanger`, and **0** carried the
 * `transboundary` tag, against 58 and 51 in the source. The `in_danger` tag
 * survived only because `danger_list` is a string and was checked beside it.
 *
 * Written wide rather than for the one shape seen today: a portal that switches
 * to a real JSON boolean would otherwise turn every yes back into a no, and
 * nothing anywhere would say so.
 */
function isSet(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value === 1;
  if (typeof value === 'string') return /^(true|1|y|yes)$/i.test(value.trim());
  return false;
}

function normalizeCategory(category: string | undefined | null): string | null {
  if (!category) return null;
  const cat = category.toLowerCase();
  if (cat.includes('cultural')) return 'cultural';
  if (cat.includes('natural')) return 'natural';
  if (cat.includes('mixed')) return 'mixed';
  return cat;
}

export function buildUnescoTags(record: UnescoApiRecord): string[] {
  const tags: string[] = [];
  if (record.criteria_txt) {
    // UNESCO criteria like "(i)(ii)(iv)" -> ["criterion_i", "criterion_ii", "criterion_iv"]
    const criteriaMatches = record.criteria_txt.match(/\(([ivx]+)\)/gi);
    if (criteriaMatches) {
      tags.push(...criteriaMatches.map(c => `criterion_${c.replace(/[()]/g, '').toLowerCase()}`));
    }
  }
  if (isSet(record.danger) || record.danger_list) tags.push('in_danger');
  if (isSet(record.transboundary)) tags.push('transboundary');
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
 * Whose photograph this is, from the two fields the export carries beside it.
 *
 * `author` is the photographer, `copyright` the holder, and they are often the
 * same string — "Museum Mors" is both for the Limfjord fossils. Kept apart
 * anyway: where they differ, both are part of the credit, and collapsing them
 * here would decide that for a reader we cannot see.
 */
export function imageCreditOf(record: UnescoApiRecord, imageUrl: string | null): ImageCredit | null {
  // No picture, no credit. The portal fills the author on records whose image
  // is missing, and storing a photographer's name against no photograph leaves
  // it waiting to be printed under whichever one somebody adds later.
  if (!imageUrl) return null;
  const author = record.main_image_author?.trim() || null;
  const license = record.main_image_copyright?.trim() || null;
  if (!author && !license) return null;
  return {
    author,
    license: license ? `© ${license}` : null,
    licenseUrl: null,
    detailsUrl: `https://whc.unesco.org/en/list/${record.id_no}`,
  };
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

  const imageUrl = extractRemoteImageUrl(record.main_image_url);

  const metadata: Record<string, unknown> = {
    dateInscribed: record.date_inscribed,
    inDanger: isSet(record.danger),
    dangerList: record.danger_list || null,
    criteria: record.criteria_txt,
    region: record.region,
    areaHectares: record.area_hectares,
    transboundary: isSet(record.transboundary),
    website: `https://whc.unesco.org/en/list/${record.id_no}`,
    wikipediaUrl: wikipediaUrl || null,
    // The picture is served from whc.unesco.org, so the line under it has to
    // say whose it is. The site's own page for the property is where the terms
    // are, which is the same URL as `website` — named separately because a
    // credit that pointed at our own page would be a credit to nobody.
    //
    // Through `creditToWrite` like the other two collectors, and for the reason
    // this source makes sharpest: it carries more of the catalogue's photographs
    // than any other, and a curator replacing one of them with a picture of their
    // own would otherwise have UNESCO's photographer printed underneath it at
    // the next run — one person's name under another person's photograph.
    ...creditToWrite(
      imageCreditOf(record, imageUrl) ?? undefined,
      storedCredits.get(String(record.id_no)),
      imageUrl,
    ),
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
    imageUrl,
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
        // Read for the fixture too: the delisting tests run against real rows,
        // and a stale map from a previous run would decide who owns their
        // pictures.
        storedCredits = await readStoredCredits(UNESCO_CATEGORY_ID);
        return { items: fixture, fetchedCount: fixture.length };
      }

      // One patience for the run, spent by whichever of its two sources needs
      // it: a portal having a bad day and a query service having a bad day are
      // the same fifteen minutes as far as the person watching is concerned.
      const budget = new WaitBudget(SPARQL_WAIT_BUDGET_MS);
      storedCredits = await readStoredCredits(UNESCO_CATEGORY_ID);
      const records = await fetchUnescoRecords(progress, budget);

      // Fetch Wikipedia URLs from Wikidata (fails open -- sync continues without them)
      progress.statusMessage = 'Fetching Wikipedia URLs from Wikidata...';
      wikipediaUrls = await fetchWikipediaUrls(progress, budget);

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
