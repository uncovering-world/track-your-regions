/**
 * Landmark Sync Service
 *
 * Fetches notable outdoor sculptures and monuments from Wikidata.
 * Each item becomes a direct experience with its own map marker.
 * No grouping, no treasures — simpler than museums.
 */

import { upsertExperienceRecord, upsertSingleLocation, createSyncLog, updateSyncLog, cleanupCategoryData } from './syncUtils.js';
import type { SyncProgress, WikidataLandmark } from './types.js';
import { runningSyncs } from './types.js';
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

/**
 * Fetch monuments from Wikidata (monuments, memorials, war memorials)
 */
async function fetchMonuments(progress: SyncProgress): Promise<WikidataLandmark[]> {
  progress.statusMessage = 'Fetching monuments from Wikidata...';

  const queryPrimary = `
    SELECT ?item ?itemLabel ?itemDescription ?coord ?image ?creatorLabel
           (YEAR(?inception) AS ?year) ?sitelinks ?countryLabel ?article ?website
    WHERE {
      VALUES ?type { wd:Q4989906 wd:Q575759 wd:Q721747 wd:Q5003624 }
      ?item wdt:P31 ?type .
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
    LIMIT 300
  `;

  try {
    const bindings = await sparqlQuery(queryPrimary, LOG_PREFIX, SPARQL_MAX_RETRIES);
    const landmarks = bindingsToLandmarks(bindings, 'monument');
    console.log(`[Landmark Sync] Fetched ${landmarks.length} monuments from Wikidata`);
    return landmarks;
  } catch (primaryError) {
    console.warn('[Landmark Sync] Monument primary query failed, falling back to per-type queries');

    const fallbackTypes = ['Q4989906', 'Q575759', 'Q721747', 'Q5003624'];
    const collected = new Map<string, SparqlBinding>();
    let successfulFallbackQueries = 0;

    for (const typeQid of fallbackTypes) {
      const fallbackQuery = `
        SELECT ?item ?itemLabel ?itemDescription ?coord ?image ?creatorLabel
               (YEAR(?inception) AS ?year) ?sitelinks ?countryLabel ?article ?website
        WHERE {
          ?item wdt:P31 wd:${typeQid} .
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
        LIMIT 160
      `;

      try {
        const bindings = await sparqlQuery(fallbackQuery, LOG_PREFIX, 2);
        successfulFallbackQueries++;
        for (const b of bindings) {
          const key = b.item?.value;
          if (key && !collected.has(key)) {
            collected.set(key, b);
          }
        }
      } catch (fallbackError) {
        const message = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
        console.warn(`[Landmark Sync] Monument fallback query failed for ${typeQid}: ${message}`);
      }

      await delay(SPARQL_DELAY_MS);
    }

    const landmarks = bindingsToLandmarks([...collected.values()], 'monument');
    if (successfulFallbackQueries === 0 || landmarks.length === 0) {
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
): Promise<{ experienceId: number; isCreated: boolean }> {
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

  return { experienceId, isCreated };
}


/**
 * Main sync function — fetches outdoor sculptures and monuments from Wikidata
 */
export async function syncLandmarks(triggeredBy: number | null, force: boolean = false): Promise<void> {
  const existing = runningSyncs.get(LANDMARK_CATEGORY_ID);
  if (existing && existing.status !== 'complete' && existing.status !== 'failed' && existing.status !== 'cancelled') {
    throw new Error('Landmark sync already in progress');
  }

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
  runningSyncs.set(LANDMARK_CATEGORY_ID, progress);

  const errorDetails: { externalId: string; error: string }[] = [];

  try {
    progress.logId = await createSyncLog(LANDMARK_CATEGORY_ID, triggeredBy);
    console.log(`[Landmark Sync] Started sync (log ID: ${progress.logId})${force ? ' [FORCE MODE]' : ''}`);

    if (force) {
      progress.statusMessage = 'Cleaning up existing landmark data...';
      await cleanupCategoryData(LANDMARK_CATEGORY_ID, LOG_PREFIX, progress);
    }

    // Phase 1-2: Fetch source datasets (continue if one source fails)
    let sculptures: WikidataLandmark[] = [];
    let monuments: WikidataLandmark[] = [];

    if (progress.cancel) throw new Error('Sync cancelled');
    try {
      sculptures = await fetchSculptures(progress);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      progress.errors++;
      errorDetails.push({ externalId: 'fetch-sculptures', error: message });
      console.warn(`[Landmark Sync] Sculpture fetch failed: ${message}`);
    }

    await delay(SPARQL_DELAY_MS);

    if (progress.cancel) throw new Error('Sync cancelled');
    try {
      monuments = await fetchMonuments(progress);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      progress.errors++;
      errorDetails.push({ externalId: 'fetch-monuments', error: message });
      console.warn(`[Landmark Sync] Monument fetch failed: ${message}`);
    }

    if (sculptures.length === 0 && monuments.length === 0) {
      throw new Error('Landmark sync failed: no data fetched from Wikidata');
    }

    // Phase 3: Merge, deduplicate by QID, sort by sitelinks DESC
    const seen = new Set<string>();
    const allLandmarks: WikidataLandmark[] = [];
    for (const item of [...sculptures, ...monuments].sort((a, b) => b.sitelinks - a.sitelinks)) {
      if (!seen.has(item.qid)) {
        seen.add(item.qid);
        allLandmarks.push(item);
      }
    }

    console.log(`[Landmark Sync] Total after dedup: ${allLandmarks.length} (${sculptures.length} sculptures, ${monuments.length} monuments)`);

    // Take top TARGET_COUNT
    const landmarks = allLandmarks.slice(0, TARGET_COUNT);
    console.log(`[Landmark Sync] Processing top ${landmarks.length} landmarks`);

    // Phase 3b: Disambiguate duplicate names by appending description snippet
    const nameCounts = new Map<string, number>();
    for (const lm of landmarks) {
      nameCounts.set(lm.label, (nameCounts.get(lm.label) || 0) + 1);
    }
    for (const lm of landmarks) {
      if ((nameCounts.get(lm.label) || 0) > 1 && lm.description) {
        // Extract a short location hint from the description (e.g., "in Berlin-Tiergarten")
        const match = lm.description.match(/\bin\s+(.+?)(?:,|\.|$)/i);
        if (match) {
          lm.label = `${lm.label} (${match[1].trim()})`;
        }
      }
    }

    // Phase 4: Upsert each as experience + experience_location
    progress.status = 'processing';
    progress.total = landmarks.length;
    progress.progress = 0;

    for (let i = 0; i < landmarks.length; i++) {
      if (progress.cancel) throw new Error('Sync cancelled');

      const landmark = landmarks[i];
      progress.currentItem = landmark.label;
      progress.statusMessage = `Processing ${i + 1}/${landmarks.length}: ${landmark.label}`;

      try {
        const { isCreated } = await upsertLandmarkExperience(landmark);
        if (isCreated) {
          progress.created++;
        } else {
          progress.updated++;
        }
      } catch (err) {
        progress.errors++;
        const errorMsg = err instanceof Error ? err.message : String(err);
        errorDetails.push({ externalId: landmark.qid, error: errorMsg });
        console.error(`[Landmark Sync] Error processing ${landmark.qid}:`, errorMsg);
      }

      progress.progress = i + 1;
    }

    // Determine final status
    const totalProcessed = progress.created + progress.updated;
    const finalStatus = progress.errors > 0 && totalProcessed === 0
      ? 'failed'
      : progress.errors > 0
      ? 'partial'
      : 'success';

    progress.status = 'complete';
    progress.statusMessage = `Complete: ${progress.created} created, ${progress.updated} updated, ${progress.errors} errors`;

    await updateSyncLog(LANDMARK_CATEGORY_ID, progress.logId, finalStatus, {
      fetched: allLandmarks.length,
      created: progress.created,
      updated: progress.updated,
      errors: progress.errors,
    }, errorDetails.length > 0 ? errorDetails : undefined);

    console.log(`[Landmark Sync] Complete: created=${progress.created}, updated=${progress.updated}, errors=${progress.errors}`);
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    progress.status = progress.cancel ? 'cancelled' : 'failed';
    progress.statusMessage = errorMsg;

    if (progress.logId) {
      await updateSyncLog(LANDMARK_CATEGORY_ID, progress.logId, progress.status, {
        fetched: progress.progress,
        created: progress.created,
        updated: progress.updated,
        errors: progress.errors,
      }, [{ externalId: 'system', error: errorMsg }]);
    }

    console.error(`[Landmark Sync] Failed:`, errorMsg);
    throw err;
  } finally {
    // Clean up after delay, but only if this sync's progress is still current
    const thisProgress = progress;
    setTimeout(() => {
      if (runningSyncs.get(LANDMARK_CATEGORY_ID) === thisProgress) {
        runningSyncs.delete(LANDMARK_CATEGORY_ID);
      }
    }, 30000);
  }
}

/**
 * Get current landmark sync status
 */
export function getLandmarkSyncStatus(): SyncProgress | null {
  return runningSyncs.get(LANDMARK_CATEGORY_ID) || null;
}

/**
 * Cancel running landmark sync
 */
export function cancelLandmarkSync(): boolean {
  const progress = runningSyncs.get(LANDMARK_CATEGORY_ID);
  if (progress && progress.status !== 'complete' && progress.status !== 'failed') {
    progress.cancel = true;
    progress.statusMessage = 'Cancelling...';
    return true;
  }
  return false;
}
