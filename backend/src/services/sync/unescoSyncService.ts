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
import { feedText } from './unescoText.js';
import { recordComponentItemsReport, upsertExperienceRecord } from './syncUtils.js';
import {
  componentPicturesToCredit, finishComponentReport, newComponentReport, resolveSiteComponents,
} from './unescoComponents.js';
import { orchestrateSync, getSyncStatus, cancelSync } from './syncOrchestrator.js';
import type { ProcessItemResult, SyncRunContext } from './syncContract.js';
import { readFixtureRecords } from './fixtureSource.js';
import { fetchUnescoRecords, namesAsText } from './unescoApi.js';
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
  factsForSite, fetchWorldHeritageFacts, indexWorldHeritageFacts, siteItems,
  type SiteFacts, type WorldHeritageIndex,
} from './unescoWikidata.js';
import { pool } from '../../db/index.js';
import { sourcePlacesSql } from '../../db/membership.js';
import { isCommonsPictureUrl } from '../../types/urlSafety.js';
import { WaitBudget } from './sourceRetry.js';
import { longitudeDelta } from './longitude.js';
import { parseDangerListing } from './dangerListing.js';
import { UnplaceableRecord } from './itemOutcome.js';
import type {
  SyncProgress,
  UnescoApiRecord,
  ProcessedExperience,
  ParsedLocation,
  ContentsByKind,
  SyncRunOptions,
} from './types.js';

const UNESCO_SOURCE_ID = 1; // Seeded in migration

/**
 * What each site's row already says about who took its picture.
 *
 * Read once per run, like the other two collectors: `creditToWrite` needs it to
 * know whether a curator owns the photograph, and asking per site would be 1272
 * queries inside the write loop.
 */
let storedCredits = new Map<string, StoredCredit>();

/**
 * A component's name: everything between `name:` and the `ref:` that follows
 * it, commas included — "Villa Mairea, Pori", "Experimental House, Muuratsalo,
 * Jyväskylä" (#1279). Null where the entry has no `ref:` after its `name:`
 * — no ref at all, or the ref written first — and the component is skipped;
 * every entry of the dataset writes the name first and the ref after it.
 */
function componentName(entry: string): string | null {
  // Searched in the entry itself rather than in a lowercased copy: lowercasing
  // "İ" makes two code units of one, so a copy's positions would cut the
  // original one character late for every such letter before the ref.
  const name = /name:/i.exec(entry);
  if (!name) return null;
  const ref = /ref:/gi;
  ref.lastIndex = name.index + name[0].length;
  const refFound = ref.exec(entry);
  if (!refFound) return null;
  return feedText(readOnce(entry.slice(name.index + name[0].length, refFound.index).trim().replace(/,$/, '').trim()));
}

/**
 * A name the portal sends decoded twice, read once (#1405): Birka and
 * Hovgården's component comes as "HovgÃ¥rden", the two UTF-8 bytes of "å"
 * read as two Latin-1 characters. A name with such a pair, every character of
 * it a byte, whose bytes are well-formed UTF-8, is that UTF-8; anything else —
 * a name that merely holds an "Ã", or bytes that do not decode — is kept.
 */
function readOnce(name: string): string {
  if (!/[\u00C2-\u00DF][\u0080-\u00BF]/.test(name) || /[^\u0000-\u00FF]/.test(name)) return name;
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.from(name, 'latin1'));
  } catch {
    return name;
  }
}

/** A component's latitude or longitude: a number, or NaN where the entry has none (`null` is not 0). */
function coordinateOf(value: unknown): number {
  return typeof value === 'number' ? value : NaN;
}

/**
 * The components of a site, from `components_list`: a JSON array the dataset
 * writes one entry per component, `[{"name": "Hanklit", "ref": "1758-001",
 * "latitude": 56.895649, "longitude": 8.751962}, …]` (#1803). An entry with no
 * ref or no point on the globe is skipped. The form before it, `{name: …, ref:
 * …, latitude: …, longitude: …}`, is still read (`parseFormerComponentsList`).
 * Anything else throws, so the site fails the run by name rather than losing its
 * components in silence: the dataset rewrote this field on 2026-10-20, and the
 * parser of the former form read every serial site as having none.
 */
function parseComponentsList(componentsList: string | undefined): ParsedLocation[] {
  if (!componentsList) return [];
  let entries: unknown;
  try {
    entries = JSON.parse(componentsList);
  } catch {
    if (componentsList.trimStart().startsWith('{name:')) return parseFormerComponentsList(componentsList);
    throw new Error('Components list is not JSON');
  }
  if (!Array.isArray(entries)) throw new Error('Components list is not a list');

  const locations: ParsedLocation[] = [];
  for (const entry of entries as Array<Record<string, unknown> | null>) {
    const ref = typeof entry?.ref === 'string' ? entry.ref.trim() : '';
    const lat = coordinateOf(entry?.latitude);
    const lon = coordinateOf(entry?.longitude);
    if (ref === '' || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) continue;
    // Via Appia's 1708-003 has an empty name, which stays empty.
    const name = typeof entry?.name === 'string' ? entry.name.trim() : '';
    locations.push({ name: feedText(readOnce(name)), externalRef: ref, lat, lon });
  }
  return locations;
}

/**
 * The components list as the dataset wrote it before 2026-10-20:
 * `{name: Fort Name, ref: 1739-005, latitude: 18.236, longitude: 73.444}`, one
 * brace per component (#1803).
 */
function parseFormerComponentsList(componentsList: string): ParsedLocation[] {
  const locations: ParsedLocation[] = [];

  // Format: {name: ..., ref: ..., latitude: ..., longitude: ...}. Split into
  // two passes — find each `{…}` first, then extract fields from inside —
  // so each individual regex is bounded and not catastrophic.
  // eslint-disable-next-line sonarjs/slow-regex -- negated class `[^}]+` cannot match past `}`, so the `+` quantifier is committed and there's no backtracking across object boundaries
  const objectRegex = /\{[^}]+\}/g;
  const fieldRef = /ref:\s*([^,}]+)/i;
  const fieldLat = /latitude:\s*([\d.-]+)/i;
  const fieldLon = /longitude:\s*([\d.-]+)/i;

  for (const objMatch of componentsList.matchAll(objectRegex)) {
    const obj = objMatch[0];
    const name = componentName(obj);
    const refMatch = obj.match(fieldRef);
    const latMatch = obj.match(fieldLat);
    const lonMatch = obj.match(fieldLon);
    if (name === null || !refMatch || !latMatch || !lonMatch) continue;

    const lat = parseFloat(latMatch[1]);
    const lon = parseFloat(lonMatch[1]);
    if (!isNaN(lat) && !isNaN(lon) && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180) {
      locations.push({
        name,
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
  // The components' own pictures too (#1270), the ones no point holds a credit
  // for: one batch of questions to Commons for the run.
  const wanted = new Set<string>(await componentPicturesToCredit(facts, records.map(record => record.id_no)));
  for (const record of records) {
    const picture = factsForSite(facts, String(record.id_no), record.name_en).picture;
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
    `SELECT sm.external_id, e.image_url, e.metadata->>'wikipediaUrl' AS article
       FROM ${sourcePlacesSql('e', 'sm')} WHERE sm.source_id = $1`,
    [UNESCO_SOURCE_ID],
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

/**
 * A site's countries, in whichever shape the portal sends the field.
 *
 * Since 2026-10-20 the dataset writes the list as JSON text, `["FR", "BE"]` for
 * `iso_codes`, and the portal splits a text field on its commas into an array,
 * so `states_names` comes as `['["France"', '"Belgium"]']`, each piece trimmed.
 * The pieces are joined again on ", " and the JSON read as the list it is. The
 * forms before it, "FR,ES" and ["FR","ES"], are still read. JSON text that is
 * not a list throws, so the site fails by name rather than carrying a wrong
 * country.
 */
export function parseDelimitedField(value: unknown): string[] {
  const text = Array.isArray(value) ? value.map(String).join(', ') : value;
  if (typeof text === 'string' && text.trimStart().startsWith('[')) {
    const list: unknown = JSON.parse(text);
    if (!Array.isArray(list)) throw new Error('Country list is not a list');
    return list.map(entry => String(entry).trim()).filter(Boolean);
  }
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
 * The site's point: its own where it is one place, and where it is made of
 * several, the anchor the run derives from them (ADR-0095).
 *
 * A site of several components has no coordinate of its own. UNESCO asks a
 * nomination for "a point at the approximate centre" of the property beside
 * each component's, publishes none on the Danube Limes' page, and the
 * export's value jumps when the list is reordered: Carnuntum to Linz, 180 km,
 * a held move a curator could answer nothing about. Regions and markers are
 * read from the components; the stored point only says which component
 * stands for the place where one has to, so it is the most central
 * component whatever the export's value, written past the gate
 * (`locationIsAnchor`).
 *
 * The site's own point is `geo_point_2d`, the portal's point of `coordinates`,
 * which since 2026-10-20 is a shape holding every component's point (#1803):
 * for a site of one component, that component's point.
 *
 * UNESCO leaves the point null on serial nominations and carries the real
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
  const { lat, lon } = record.geo_point_2d ?? {};
  if (locations.length <= 1 && Number.isFinite(lat) && Number.isFinite(lon)) {
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
 * `metadata.unescoUrl`, which every one of these rows carries (ADR-0043, #557).
 * It is UNESCO's page about the site, never the site's own: that is
 * `metadata.website`, which the Wikidata kinds bring (#1538).
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
    unescoUrl: `https://whc.unesco.org/en/list/${record.id_no}`,
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
    sourceId: UNESCO_SOURCE_ID,
    externalId: String(record.id_no),
    name: record.name_en || `Site ${record.id_no}`,
    nameLocal: buildMultilingualNames(record),
    subtitle: null, // UNESCO gives a paragraph, not a one-line subtitle
    description: record.short_description_en || null,
    // The portal's field is `category`, its own word and not this catalogue's:
    // on our side it is the type within the World Heritage kind — cultural,
    // natural or mixed (ADR-0045, #814). The name is the portal's to choose,
    // and `EXPORT_FIELDS` asks for it by that name (`unescoApi.ts`).
    type: normalizeCategory(record.category),
    tags: buildUnescoTags(record),
    lat: point.lat,
    lon: point.lon,
    locationIsAnchor: locations.length > 1,
    countryCodes: parseDelimitedField(record.iso_codes),
    countryNames: parseDelimitedField(record.states_names),
    imageUrl,
    itemPictures: facts.picture?.itemPictures ?? [],
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
  wikidataItems: string[] | null = null,
): Promise<ProcessItemResult> {
  const { experienceId, changeSet, nameSnapshot, returnedFromMissing } = await upsertExperienceRecord({
    sourceId: exp.sourceId,
    externalId: exp.externalId,
    name: exp.name,
    nameLocal: exp.nameLocal,
    subtitle: exp.subtitle,
    description: exp.description,
    type: exp.type,
    tags: exp.tags,
    lon: exp.lon,
    lat: exp.lat,
    locationIsAnchor: exp.locationIsAnchor,
    countryCodes: exp.countryCodes,
    countryNames: exp.countryNames,
    imageUrl: exp.imageUrl,
    itemPictures: exp.itemPictures,
    metadata: exp.metadata,
    wikidataItems,
  }, { dryRun: context.dryRun, syncLogId: context.syncLogId });

  // A preview writes nothing downstream either: locations would belong to a row
  // that was never touched.
  let contents: ContentsByKind | undefined;
  if (!context.dryRun) {
    const written = await upsertExperienceLocations(
      experienceId, exp, { syncLogId: context.syncLogId, sourceId: UNESCO_SOURCE_ID, components: true },
    );
    if (written.needsAssignment.length > 0 || written.unoffered > 0) {
      context.onLocationsChanged(experienceId);
    }
    // The serial sites are here — hundreds of objects hold more than one point, and a
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
  options: SyncRunOptions = {},
): Promise<void> {
  // Shared state between fetchItems and processItem via closure
  let facts: WorldHeritageIndex;
  let credits: Map<string, ImageCredit>;
  // Components are resolved to their items only from an index Wikidata
  // answered: one read back from the rows knows none (#1269).
  let factsAnswered = false;
  const components = newComponentReport();

  return orchestrateSync<UnescoApiRecord>({
    sourceId: UNESCO_SOURCE_ID,
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
        storedCredits = await readStoredCredits(UNESCO_SOURCE_ID);
        // A fixture saved from the feed carries its markup: read as the feed is (#1610).
        return { items: fixture.map(namesAsText), fetchedCount: fixture.length };
      }

      // One patience for the run, spent by whichever of its two sources needs
      // it: a portal having a bad day and a query service having a bad day are
      // the same fifteen minutes as far as the person watching is concerned.
      const budget = new WaitBudget(SPARQL_WAIT_BUDGET_MS);
      storedCredits = await readStoredCredits(UNESCO_SOURCE_ID);
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
      factsAnswered = answered !== null;
      if (!answered) console.warn('[UNESCO Sync] Keeping the stored pictures and articles for this run');

      credits = answered
        ? await creditsForNewPictures(records, facts, progress, budget)
        : new Map();

      return { items: records, fetchedCount: records.length };
    },
    processItem: async (record, _progress, context) => {
      const processed = transformRecord(record, factsForSite(facts, String(record.id_no), record.name_en), credits);
      if (!processed) {
        throw new UnplaceableRecord('UNESCO sends this site with no point and no component');
      }
      // The site's Wikidata items (#1248), only from an index Wikidata answered.
      const items = factsAnswered ? siteItems(facts, String(record.id_no), record.name_en) : null;
      const result = await upsertExperience(processed, context, items);
      if (!context.dryRun && factsAnswered && result.experienceId) {
        const changed = await resolveSiteComponents(
          facts, record, processed, result.experienceId, components,
          { syncLogId: context.syncLogId, sourceId: UNESCO_SOURCE_ID }, credits,
        );
        // A component's new picture or description is a change to a point the
        // run already holds, reported with the points it wrote (ADR-0026).
        const locations = result.contents?.locations;
        if (changed.length > 0 && locations) {
          return { ...result, contents: { ...result.contents, locations: { ...locations, changed: [...locations.changed, ...changed] } } };
        }
      }
      return result;
    },
    afterItems: async (_progress, context) => {
      // Written where anything was counted, the failures included: a run whose
      // every site failed to record is the one the failure count is for.
      if (!context.dryRun && context.syncLogId !== null && (components.total > 0 || components.failedSites > 0)) {
        await recordComponentItemsReport(context.syncLogId, finishComponentReport(components));
      }
    },
    getItemName: (record) => record.name_en || `Site ${record.id_no}`,
    getItemId: (record) => String(record.id_no),
  }, triggeredBy, options);
}

/**
 * Get current sync status
 */
export function getUnescoSyncStatus() {
  return getSyncStatus(UNESCO_SOURCE_ID);
}

/**
 * Cancel running sync
 */
export function cancelUnescoSync() {
  return cancelSync(UNESCO_SOURCE_ID);
}
