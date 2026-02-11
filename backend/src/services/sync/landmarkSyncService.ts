/**
 * Landmark Sync Service
 *
 * Fetches notable outdoor sculptures and monuments from Wikidata.
 * Each item becomes a direct experience with its own map marker.
 * No grouping, no treasures — simpler than museums.
 */

import { pool } from '../../db/index.js';
import type { SyncProgress, WikidataLandmark } from './types.js';
import { runningSyncs } from './types.js';

const LANDMARK_CATEGORY_ID = 3;
const WIKIDATA_ENDPOINT = 'https://query.wikidata.org/sparql';
const USER_AGENT = 'TrackYourRegions/1.0 (https://github.com/trackyourregions; contact@trackyourregions.com)';
const SPARQL_DELAY_MS = 1000;
const SPARQL_TIMEOUT_MS = 130000; // Client-side abort — slightly above server-side limit
const SPARQL_SERVER_TIMEOUT_MS = 120000; // Ask Wikidata for 120s server-side timeout
const SPARQL_MAX_RETRIES = 4;
const TARGET_COUNT = 200;

type SparqlBinding = Record<string, { value: string } | undefined>;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function sparqlQuery(query: string, retries: number = 2): Promise<SparqlBinding[]> {
  const maxAttempts = retries + 1;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), SPARQL_TIMEOUT_MS);

    try {
      const response = await fetch(WIKIDATA_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': 'application/sparql-results+json',
          'User-Agent': USER_AGENT,
        },
        body: `query=${encodeURIComponent(query)}&timeout=${SPARQL_SERVER_TIMEOUT_MS}`,
        signal: controller.signal,
      });

      if (!response.ok) {
        const text = await response.text();
        const retriable = response.status >= 500 || response.status === 429;
        if (attempt < retries && retriable) {
          const retryAfter = Number(response.headers.get('retry-after'));
          const backoff = Number.isFinite(retryAfter) && retryAfter > 0
            ? retryAfter * 1000
            : Math.min(30000, 5000 * Math.pow(2, attempt));
          console.warn(
            `[Landmark Sync] SPARQL ${response.status}, retrying in ${Math.round(backoff / 1000)}s (attempt ${attempt + 1}/${maxAttempts})`
          );
          await delay(backoff);
          continue;
        }
        throw new Error(`Wikidata SPARQL error ${response.status}: ${text.substring(0, 500)}`);
      }

      const data = await response.json() as {
        results: { bindings: Record<string, { type: string; value: string }>[] };
      };
      return data.results.bindings;
    } catch (error) {
      const isAbort = error instanceof Error && error.name === 'AbortError';
      if (attempt < retries && (isAbort || error instanceof TypeError)) {
        const backoff = Math.min(30000, 5000 * Math.pow(2, attempt));
        console.warn(
          `[Landmark Sync] SPARQL ${isAbort ? 'timeout' : 'network error'}, retrying in ${Math.round(backoff / 1000)}s (attempt ${attempt + 1}/${maxAttempts})`
        );
        await delay(backoff);
        continue;
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Wikidata SPARQL request failed: ${message}`);
    } finally {
      clearTimeout(timeout);
    }
  }

  throw new Error('SPARQL query failed after all retries');
}

function extractQid(uri: string): string {
  return uri.replace('http://www.wikidata.org/entity/', '');
}

function parseWktPoint(wkt: string): { lat: number; lon: number } | null {
  const match = wkt.match(/Point\(([-\d.]+)\s+([-\d.]+)\)/i);
  if (!match) return null;
  const lon = parseFloat(match[1]);
  const lat = parseFloat(match[2]);
  if (isNaN(lat) || isNaN(lon)) return null;
  return { lat, lon };
}

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

  const bindings = await sparqlQuery(query, SPARQL_MAX_RETRIES);
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
    const bindings = await sparqlQuery(queryPrimary, SPARQL_MAX_RETRIES);
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
        const bindings = await sparqlQuery(fallbackQuery, 2);
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

  const category = landmark.type;
  const tags = JSON.stringify(['outdoor', landmark.type]);

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
      LANDMARK_CATEGORY_ID,
      landmark.qid,
      landmark.label,
      JSON.stringify({ en: landmark.label }),
      landmark.description,
      null,
      category,
      tags,
      landmark.lon,
      landmark.lat,
      [],
      landmark.countryLabel ? [landmark.countryLabel] : [],
      imageUrl,
      JSON.stringify(metadata),
    ]
  );

  const experienceId = result.rows[0].id;
  const isCreated = result.rows[0].inserted;

  // Upsert single location
  await pool.query(
    `DELETE FROM experience_locations WHERE experience_id = $1`,
    [experienceId]
  );
  await pool.query(
    `INSERT INTO experience_locations (experience_id, name, external_ref, ordinal, location)
     VALUES ($1, NULL, $2, 1, ST_SetSRID(ST_MakePoint($3, $4), 4326))`,
    [experienceId, landmark.qid, landmark.lon, landmark.lat]
  );

  return { experienceId, isCreated };
}

async function createSyncLog(triggeredBy: number | null): Promise<number> {
  const result = await pool.query(
    `INSERT INTO experience_sync_logs (category_id, triggered_by, status)
     VALUES ($1, $2, 'running')
     RETURNING id`,
    [LANDMARK_CATEGORY_ID, triggeredBy]
  );
  return result.rows[0].id;
}

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
    [logId, status, stats.fetched, stats.created, stats.updated, stats.errors,
     errorDetails ? JSON.stringify(errorDetails) : null]
  );

  await pool.query(
    `UPDATE experience_categories SET
      last_sync_at = NOW(),
      last_sync_status = $2,
      last_sync_error = $3
     WHERE id = $1`,
    [LANDMARK_CATEGORY_ID, status, status === 'failed' ? 'See sync log for details' : null]
  );
}

async function cleanupLandmarkData(progress: SyncProgress): Promise<void> {
  progress.statusMessage = 'Cleaning up existing landmark data...';

  await pool.query(`
    DELETE FROM user_visited_locations
    WHERE location_id IN (
      SELECT el.id FROM experience_locations el
      JOIN experiences e ON el.experience_id = e.id
      WHERE e.category_id = $1
    )
  `, [LANDMARK_CATEGORY_ID]);

  await pool.query(`
    DELETE FROM user_visited_experiences
    WHERE experience_id IN (SELECT id FROM experiences WHERE category_id = $1)
  `, [LANDMARK_CATEGORY_ID]);

  await pool.query(`
    DELETE FROM experience_location_regions
    WHERE assignment_type = 'auto'
      AND location_id IN (
        SELECT el.id FROM experience_locations el
        JOIN experiences e ON el.experience_id = e.id
        WHERE e.category_id = $1
      )
  `, [LANDMARK_CATEGORY_ID]);

  await pool.query(`
    DELETE FROM experience_regions
    WHERE assignment_type = 'auto'
      AND experience_id IN (SELECT id FROM experiences WHERE category_id = $1)
  `, [LANDMARK_CATEGORY_ID]);

  await pool.query(`
    DELETE FROM experience_locations
    WHERE experience_id IN (SELECT id FROM experiences WHERE category_id = $1)
  `, [LANDMARK_CATEGORY_ID]);

  const result = await pool.query(`
    DELETE FROM experiences WHERE category_id = $1
  `, [LANDMARK_CATEGORY_ID]);

  console.log(`[Landmark Sync] Cleaned up ${result.rowCount} existing landmarks`);
  progress.statusMessage = `Cleaned up ${result.rowCount} existing landmarks`;
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
    progress.logId = await createSyncLog(triggeredBy);
    console.log(`[Landmark Sync] Started sync (log ID: ${progress.logId})${force ? ' [FORCE MODE]' : ''}`);

    if (force) {
      await cleanupLandmarkData(progress);
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

    await updateSyncLog(progress.logId, finalStatus, {
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
      await updateSyncLog(progress.logId, progress.status, {
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
