/**
 * UNESCO World Heritage Sites Sync Service
 *
 * Fetches data from UNESCO's official API and syncs to local database.
 * API docs: https://data.unesco.org/api/explore/v2.1/console
 */

import {
  writeExperienceLocations,
  type LocationWriteResult,
  type LocationWriteRun,
} from './locationWriter.js';
import type { IncomingLocation } from './locationIncoming.js';
import { upsertExperienceRecord } from './syncUtils.js';
import { orchestrateSync, getSyncStatus, cancelSync } from './syncOrchestrator.js';
import type { ProcessItemResult, SyncRunContext } from './syncOrchestrator.js';
import { readFixtureRecords } from './fixtureSource.js';
import { fetchUnescoRecords } from './unescoApi.js';
import {
  creditToWrite,
  fetchCommonsCredits,
  readStoredCredits,
  type ImageCredit,
  type StoredCredit,
} from './imageCredit.js';
import {
  delay, waitMessage, SPARQL_DELAY_MS, SPARQL_WAIT_BUDGET_MS, WIKIDATA_USER_AGENT,
} from './wikidataUtils.js';
import {
  factsForSite, fetchWorldHeritageFacts, indexWorldHeritageFacts,
  type SiteFacts, type WorldHeritageIndex,
} from './unescoWikidata.js';
import { pool } from '../../db/index.js';
import { isCommonsPictureUrl } from '../../types/urlSafety.js';
import { WaitBudget } from './sourceRetry.js';
import { longitudeDelta } from './longitude.js';
import { parseDangerListing } from './dangerListing.js';
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
 * Who took the pictures this run is about to put on cards, for the pictures
 * that are new to it.
 *
 * Every picture here is a Commons file, so the credit comes from Commons — and
 * asking about all 1220 of them on every run would be twenty-five batches of
 * somebody else's server answering a question this database already holds. The
 * files that have to be asked about are the ones new to a row: a first run
 * after ADR-0043, a site whose Wikidata picture changed, one that had none.
 * `creditToWrite` reuses a stored credit while the row still shows the same
 * file, which is what makes the narrowing safe.
 *
 * A picture a curator owns is not asked about at all — the run may not describe
 * it, and `creditToWrite` would discard the answer.
 */
async function creditsForNewPictures(
  records: UnescoApiRecord[],
  facts: WorldHeritageIndex,
  progress: SyncProgress,
  budget: WaitBudget,
): Promise<Map<string, ImageCredit>> {
  const wanted = new Set<string>();
  for (const record of records) {
    const picture = factsForSite(facts, String(record.id_no)).picture;
    if (!picture) continue;
    const stored = storedCredits.get(String(record.id_no));
    if (stored?.imageClaimed) continue;
    if (stored?.credit && stored.imageUrl === picture.url) continue;
    wanted.add(picture.url);
  }
  if (wanted.size === 0) return new Map();

  progress.statusMessage = `Asking Commons who took ${wanted.size} pictures...`;
  return fetchCommonsCredits([...wanted], {
    userAgent: WIKIDATA_USER_AGENT,
    budget,
    isCancelled: () => progress.cancel,
    onWait: (wait) => { progress.statusMessage = waitMessage('Commons', wait, budget); },
    pause: () => delay(SPARQL_DELAY_MS),
  });
}

/**
 * What the rows already hold, in the shape Wikidata's answer takes, for a run
 * Wikidata did not answer.
 *
 * Read from the rows rather than remembered from the last run, and keyed the way
 * the index is keyed, so `transformRecord` needs no second path: a site's
 * stored picture and article are offered back as its facts, and the upsert
 * reports nothing changed. A picture stored in a form a run may not write is
 * not offered back — the writer would refuse it anyway, and the refusal is the
 * right answer for it (ADR-0043).
 */
export async function indexOfWhatIsStored(): Promise<WorldHeritageIndex> {
  const stored = await pool.query(
    `SELECT external_id, image_url, metadata->>'wikipediaUrl' AS article
       FROM experiences WHERE category_id = $1`,
    [UNESCO_CATEGORY_ID],
  );
  return indexWorldHeritageFacts(stored.rows.map((row: { external_id: string; image_url: string | null; article: string | null }) => ({
    whc: { value: row.external_id },
    ...(row.article ? { article: { value: row.article } } : {}),
    ...(row.image_url && isCommonsPictureUrl(row.image_url) ? { image: { value: row.image_url } } : {}),
  })));
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
  if (isInDanger(record)) tags.push('in_danger');
  if (isSet(record.transboundary)) tags.push('transboundary');
  return tags;
}

/**
 * Whether the site is on the List of World Heritage in Danger, from both fields
 * the export states it in.
 *
 * One predicate, because the answer is stored twice -- as the `in_danger` tag
 * and as the `metadata.inDanger` flag the badge keys on -- and a catalogue whose
 * tag and whose flag disagree about Aleppo has no way to say which is right.
 * They did disagree, on every row: the flag was read from `danger` alone and
 * `danger` was compared against the number 1 while the portal sends the string
 * "True", so 58 danger-listed sites carried the tag and not one carried the flag
 * (#600). Widening `isSet` fixed the reading; taking both fields is what keeps
 * one of them emptied from ending the answer.
 *
 * Not merely "the dated field is filled in": that field's vocabulary is Y/N, and
 * a site the source has taken off the list must not be badged as on it. It is
 * emptied rather than negated today -- Belize Barrier Reef, delisted in 2018,
 * answers `danger: "False"` with `danger_list: null` -- so the distinction costs
 * nothing and is what an N would need.
 */
export function isInDanger(record: UnescoApiRecord): boolean {
  return isSet(record.danger) || parseDangerListing(record.danger_list)?.listed === true;
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

/**
 * Transform UNESCO API record to our internal format.
 *
 * The record's own `main_image_url` is deliberately not read, and neither are
 * `main_image_author` and `main_image_copyright` beside it. Those name a
 * photograph on `whc.unesco.org`, and the World Heritage Centre's terms say its
 * photographs "may not be copied or retransmitted by any means without explicit
 * authorisation" — they are third parties' property, licensed to the Centre —
 * and that a site may "only link to, not replicate" its content. So the picture
 * comes from Wikimedia Commons through `unescoWikidata.ts`, whose licences are
 * written to be reused with the author named, and the link the terms invite is
 * `metadata.website`, which every one of these rows carries (ADR-0043, #557).
 */
export function transformRecord(
  record: UnescoApiRecord,
  facts: SiteFacts = { article: null, picture: null },
  credits: Map<string, ImageCredit> = new Map(),
): ProcessedExperience | null {
  const locations = parseComponentsList(record.components_list);
  const point = resolveMainPoint(record, locations);
  if (!point) {
    console.log(`[UNESCO Sync] Skipping ${record.id_no} - no coordinates`);
    return null;
  }

  const imageUrl = facts.picture?.url ?? null;

  const metadata: Record<string, unknown> = {
    dateInscribed: record.date_inscribed,
    inDanger: isInDanger(record),
    dangerList: record.danger_list || null,
    criteria: record.criteria_txt,
    region: record.region,
    areaHectares: record.area_hectares,
    transboundary: isSet(record.transboundary),
    website: `https://whc.unesco.org/en/list/${record.id_no}`,
    wikipediaUrl: facts.article,
    // Through `creditToWrite` like the other two collectors, and for the reason
    // this source makes sharpest: it carries more of the catalogue's photographs
    // than any other, and a curator replacing one of them with a picture of their
    // own would otherwise have the Commons photographer printed underneath it at
    // the next run — one person's name under another person's photograph.
    ...creditToWrite(
      imageUrl ? credits.get(imageUrl) : undefined,
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
    const written = await upsertExperienceLocations(
      experienceId, exp, { syncLogId: context.syncLogId },
    );
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
  run: LocationWriteRun,
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

  return writeExperienceLocations(experienceId, incoming, run);
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
  let facts: WorldHeritageIndex;
  let credits: Map<string, ImageCredit>;

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
        // Wikidata is not consulted for a fixture either, and the answer is the
        // same as for a day it did not answer: keep what the rows hold. An
        // empty index would offer every record no picture and no article, and
        // a fixture run against a dev database — the documented way to exercise
        // delisting against real rows — would propose stripping all of them.
        facts = await indexOfWhatIsStored();
        credits = new Map();
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

      // The article and the picture, from the one join that answers both. A
      // site Wikidata states nothing for is a site with neither, not a failed
      // import — but Wikidata *not answering* is a different thing from that,
      // and the run then keeps what every row already holds rather than
      // proposing to take a thousand pictures and links away because a query
      // service had a bad afternoon.
      progress.statusMessage = 'Asking Wikidata about the properties...';
      const answered = await fetchWorldHeritageFacts(progress, budget);
      facts = answered ?? await indexOfWhatIsStored();
      if (!answered) console.warn('[UNESCO Sync] Keeping the stored pictures and articles for this run');

      credits = answered
        ? await creditsForNewPictures(records, facts, progress, budget)
        : new Map();

      return { items: records, fetchedCount: records.length };
    },
    processItem: async (record, _progress, context) => {
      const processed = transformRecord(record, factsForSite(facts, String(record.id_no)), credits);
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
