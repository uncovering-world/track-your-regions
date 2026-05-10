/**
 * Landmark Sync Service
 *
 * Fetches notable outdoor sculptures and monuments from Wikidata.
 * Each item becomes a direct experience with its own map marker.
 * No grouping, no treasures — simpler than museums.
 */

import { upsertExperienceRecord, upsertSingleLocation } from './syncUtils.js';
import type { SyncProgress, WikidataLandmark } from './types.js';
import { orchestrateSync, getSyncStatus, cancelSync, type ErrorDetail } from './syncOrchestrator.js';
import {
  sparqlQuery,
  extractQid,
  parseWktPoint,
  delay,
  SPARQL_DELAY_MS,
  SPARQL_MAX_RETRIES,
  type SparqlBinding,
} from './wikidataUtils.js';

const LANDMARK_CATEGORY_ID = 3;
const TARGET_COUNT = 200;

const LOG_PREFIX = '[Landmark Sync]';

function bindingsToLandmarks(bindings: SparqlBinding[], type: 'sculpture' | 'monument'): WikidataLandmark[] {
  const landmarks: WikidataLandmark[] = [];

  for (const b of bindings) {
    const coord = b.coord?.value ? parseWktPoint(b.coord.value) : null;
    if (!coord || !b.item) continue;

    const qid = extractQid(b.item.value);
    landmarks.push({
      qid,
      label: b.itemLabel?.value || 'Unknown',
      description: b.itemDescription?.value || null,
      lat: coord.lat,
      lon: coord.lon,
      imageUrl: b.image?.value || null,
      creatorLabel: b.creatorLabel?.value || null,
      year: b.year?.value ? parseInt(b.year.value) : null,
      sitelinks: parseInt(b.sitelinks?.value || '0'),
      countryLabel: b.countryLabel?.value || null,
      type,
      articleUrl: b.article?.value || null,
      website: b.website?.value || null,
    });
  }

  return landmarks;
}

/**
 * Fetch outdoor sculptures from Wikidata (famous sculptures with own coordinates, NOT in museum collections)
 */
async function fetchSculptures(progress: SyncProgress): Promise<WikidataLandmark[]> {
  progress.statusMessage = 'Fetching outdoor sculptures from Wikidata...';

  const query = `
    SELECT ?item ?itemLabel ?itemDescription ?coord ?image ?creatorLabel
           (YEAR(?inception) AS ?year) ?sitelinks ?countryLabel ?article ?website
    WHERE {
      ?item wdt:P31 wd:Q860861 .
      ?item wdt:P625 ?coord .
      ?item wikibase:sitelinks ?sitelinks .
      FILTER(?sitelinks > 15)
      FILTER NOT EXISTS { ?item wdt:P195 ?coll . ?coll wdt:P31/wdt:P279* wd:Q33506 }
      OPTIONAL { ?item wdt:P18 ?image }
      OPTIONAL { ?item wdt:P170 ?creator }
      OPTIONAL { ?item wdt:P571 ?inception }
      OPTIONAL { ?item wdt:P17 ?country }
      OPTIONAL { ?item wdt:P856 ?website }
      OPTIONAL { ?article schema:about ?item ; schema:isPartOf <https://en.wikipedia.org/> }
      SERVICE wikibase:label { bd:serviceParam wikibase:language "en" }
    }
    ORDER BY DESC(?sitelinks)
    LIMIT 300
  `;

  const bindings = await sparqlQuery(query, LOG_PREFIX, SPARQL_MAX_RETRIES);
  const landmarks = bindingsToLandmarks(bindings, 'sculpture');

  console.log(`[Landmark Sync] Fetched ${landmarks.length} outdoor sculptures from Wikidata`);
  return landmarks;
}

const MONUMENT_TYPE_QIDS = ['Q4989906', 'Q575759', 'Q721747', 'Q5003624'];

function buildMonumentQuery(typeFilter: string, limit: number): string {
  return `
    SELECT ?item ?itemLabel ?itemDescription ?coord ?image ?creatorLabel
           (YEAR(?inception) AS ?year) ?sitelinks ?countryLabel ?article ?website
    WHERE {
      ${typeFilter}
      ?item wdt:P625 ?coord .
      ?item wikibase:sitelinks ?sitelinks .
      FILTER(?sitelinks > 20)
      OPTIONAL { ?item wdt:P18 ?image }
      OPTIONAL { ?item wdt:P170 ?creator }
      OPTIONAL { ?item wdt:P571 ?inception }
      OPTIONAL { ?item wdt:P17 ?country }
      OPTIONAL { ?item wdt:P856 ?website }
      OPTIONAL { ?article schema:about ?item ; schema:isPartOf <https://en.wikipedia.org/> }
      SERVICE wikibase:label { bd:serviceParam wikibase:language "en" }
    }
    ORDER BY DESC(?sitelinks)
    LIMIT ${limit}
  `;
}

async function fetchMonumentsViaFallback(): Promise<{ landmarks: WikidataLandmark[]; succeeded: number }> {
  const collected = new Map<string, SparqlBinding>();
  let succeeded = 0;
  for (const typeQid of MONUMENT_TYPE_QIDS) {
    const query = buildMonumentQuery(`?item wdt:P31 wd:${typeQid} .`, 160);
    try {
      const bindings = await sparqlQuery(query, LOG_PREFIX, 2);
      succeeded++;
      for (const b of bindings) {
        const key = b.item?.value;
        if (key && !collected.has(key)) collected.set(key, b);
      }
    } catch (fallbackError) {
      const message = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
      console.warn(`[Landmark Sync] Monument fallback query failed for ${typeQid}: ${message}`);
    }
    await delay(SPARQL_DELAY_MS);
  }
  return {
    landmarks: bindingsToLandmarks([...collected.values()], 'monument'),
    succeeded,
  };
}

/**
 * Fetch monuments from Wikidata (monuments, memorials, war memorials)
 */
async function fetchMonuments(progress: SyncProgress): Promise<WikidataLandmark[]> {
  progress.statusMessage = 'Fetching monuments from Wikidata...';

  const queryPrimary = buildMonumentQuery(
    `VALUES ?type { wd:Q4989906 wd:Q575759 wd:Q721747 wd:Q5003624 }
       ?item wdt:P31 ?type .`,
    300,
  );

  try {
    const bindings = await sparqlQuery(queryPrimary, LOG_PREFIX, SPARQL_MAX_RETRIES);
    const landmarks = bindingsToLandmarks(bindings, 'monument');
    console.log(`[Landmark Sync] Fetched ${landmarks.length} monuments from Wikidata`);
    return landmarks;
  } catch (primaryError) {
    console.warn('[Landmark Sync] Monument primary query failed, falling back to per-type queries');
    const { landmarks, succeeded } = await fetchMonumentsViaFallback();
    if (succeeded === 0 || landmarks.length === 0) {
      const primaryMessage = primaryError instanceof Error ? primaryError.message : String(primaryError);
      throw new Error(`Monument fetch failed (primary + fallback): ${primaryMessage}`);
    }
    console.log(`[Landmark Sync] Fetched ${landmarks.length} monuments via fallback queries`);
    return landmarks;
  }
}

/**
 * Upsert a landmark as an experience + experience_location
 */
async function upsertLandmarkExperience(
  landmark: WikidataLandmark
): Promise<'created' | 'updated'> {
  const metadata = {
    wikidataQid: landmark.qid,
    creator: landmark.creatorLabel,
    year: landmark.year,
    sitelinksCount: landmark.sitelinks,
    type: landmark.type,
    wikipediaUrl: landmark.articleUrl || null,
    website: landmark.website || null,
  };

  const imageUrl = landmark.imageUrl || null;

  const { experienceId, isCreated } = await upsertExperienceRecord({
    categoryId: LANDMARK_CATEGORY_ID,
    externalId: landmark.qid,
    name: landmark.label,
    nameLocal: { en: landmark.label },
    description: landmark.description,
    shortDescription: null,
    category: landmark.type,
    tags: ['outdoor', landmark.type],
    lon: landmark.lon,
    lat: landmark.lat,
    countryCodes: [],
    countryNames: landmark.countryLabel ? [landmark.countryLabel] : [],
    imageUrl,
    metadata,
  });

  await upsertSingleLocation(experienceId, landmark.qid, landmark.lon, landmark.lat);

  return isCreated ? 'created' : 'updated';
}

async function tryFetchSource(
  progress: SyncProgress,
  errorDetails: ErrorDetail[],
  sourceName: string,
  fetcher: (p: SyncProgress) => Promise<WikidataLandmark[]>,
): Promise<WikidataLandmark[]> {
  if (progress.cancel) throw new Error('Sync cancelled');
  try {
    return await fetcher(progress);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    progress.errors++;
    errorDetails.push({ externalId: `fetch-${sourceName}`, error: message });
    console.warn(`[Landmark Sync] ${sourceName} fetch failed: ${message}`);
    return [];
  }
}

function dedupeBySitelinks(...lists: WikidataLandmark[][]): WikidataLandmark[] {
  const seen = new Set<string>();
  const merged: WikidataLandmark[] = [];
  for (const item of lists.flat().sort((a, b) => b.sitelinks - a.sitelinks)) {
    if (!seen.has(item.qid)) {
      seen.add(item.qid);
      merged.push(item);
    }
  }
  return merged;
}

function disambiguateDuplicateNames(landmarks: WikidataLandmark[]): void {
  const nameCounts = new Map<string, number>();
  for (const lm of landmarks) {
    nameCounts.set(lm.label, (nameCounts.get(lm.label) || 0) + 1);
  }
  for (const lm of landmarks) {
    if ((nameCounts.get(lm.label) || 0) <= 1 || !lm.description) continue;
    // Extract a short location hint from the description (e.g., "in Berlin-Tiergarten").
    // Negated class avoids backtracking across stop chars.
    const match = lm.description.match(/\bin\s+([^,.\n]+)/i);
    if (match) lm.label = `${lm.label} (${match[1].trim()})`;
  }
}

/**
 * Fetch, merge, deduplicate, and disambiguate landmarks from Wikidata.
 */
async function fetchLandmarkItems(
  progress: SyncProgress,
  errorDetails: ErrorDetail[],
): Promise<{ items: WikidataLandmark[]; fetchedCount: number }> {
  const sculptures = await tryFetchSource(progress, errorDetails, 'sculptures', fetchSculptures);
  await delay(SPARQL_DELAY_MS);
  const monuments = await tryFetchSource(progress, errorDetails, 'monuments', fetchMonuments);

  if (sculptures.length === 0 && monuments.length === 0) {
    throw new Error('Landmark sync failed: no data fetched from Wikidata');
  }

  const allLandmarks = dedupeBySitelinks(sculptures, monuments);
  console.log(`[Landmark Sync] Total after dedup: ${allLandmarks.length} (${sculptures.length} sculptures, ${monuments.length} monuments)`);

  const landmarks = allLandmarks.slice(0, TARGET_COUNT);
  console.log(`[Landmark Sync] Processing top ${landmarks.length} landmarks`);

  disambiguateDuplicateNames(landmarks);

  return { items: landmarks, fetchedCount: allLandmarks.length };
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Main sync function — fetches outdoor sculptures and monuments from Wikidata
 */
export function syncLandmarks(triggeredBy: number | null, force: boolean = false): Promise<void> {
  return orchestrateSync<WikidataLandmark>({
    categoryId: LANDMARK_CATEGORY_ID,
    logPrefix: LOG_PREFIX,
    fetchItems: fetchLandmarkItems,
    processItem: upsertLandmarkExperience,
    getItemName: (lm) => lm.label,
    getItemId: (lm) => lm.qid,
  }, triggeredBy, force);
}

/**
 * Get current landmark sync status
 */
export function getLandmarkSyncStatus() {
  return getSyncStatus(LANDMARK_CATEGORY_ID);
}

/**
 * Cancel running landmark sync
 */
export function cancelLandmarkSync() {
  return cancelSync(LANDMARK_CATEGORY_ID);
}
