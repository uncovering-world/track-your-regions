/**
 * Museum Sync Service
 *
 * Fetches the world's top museums from Wikidata, ranked by artwork fame (sitelinks count).
 * Algorithm:
 *   1. Fetch famous paintings and sculptures from Wikidata SPARQL
 *   2. Group by collection (museum), taking top 100 unique museums
 *   3. Fetch museum details (coordinates, country, image)
 *   4. Resolve department collections to parent museums
 *   5. Upsert museums as experiences, artworks as experience_contents
 */

import { pool } from '../../db/index.js';
import type {
  SyncProgress,
  WikidataArtwork,
  WikidataMuseum,
  ProcessedContent,
  CollectedMuseum,
} from './types.js';
import { runningSyncs } from './types.js';
// Museums use remote Wikimedia URLs, no local image storage

const MUSEUM_SOURCE_ID = 2;
const TARGET_MUSEUM_COUNT = 115; // Overshoot: some collections lack coordinates
const WIKIDATA_ENDPOINT = 'https://query.wikidata.org/sparql';
const USER_AGENT = 'TrackYourRegions/1.0 (https://github.com/trackyourregions; contact@trackyourregions.com)';
const SPARQL_DELAY_MS = 1000;
const SPARQL_TIMEOUT_MS = 130000; // Client-side abort — slightly above server-side limit
const SPARQL_SERVER_TIMEOUT_MS = 120000; // Ask Wikidata for 120s server-side timeout
const SPARQL_MAX_RETRIES = 4;

type SparqlBinding = Record<string, { value: string } | undefined>;

/**
 * Delay helper for rate limiting
 */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Execute a SPARQL query against Wikidata with retry for transient errors
 */
async function sparqlQuery(query: string, retries: number = SPARQL_MAX_RETRIES): Promise<SparqlBinding[]> {
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
            `[Museum Sync] SPARQL ${response.status}, retrying in ${Math.round(backoff / 1000)}s (attempt ${attempt + 1}/${maxAttempts})`
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
          `[Museum Sync] SPARQL ${isAbort ? 'timeout' : 'network error'}, retrying in ${Math.round(backoff / 1000)}s (attempt ${attempt + 1}/${maxAttempts})`
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

/**
 * Extract QID from Wikidata entity URI (e.g., "http://www.wikidata.org/entity/Q12418" -> "Q12418")
 */
function extractQid(uri: string): string {
  return uri.replace('http://www.wikidata.org/entity/', '');
}

/**
 * Check if a string is a valid Wikidata QID (e.g., "Q12418")
 * Filters out blank nodes like ".well-known/genid/..."
 */
function isValidQid(qid: string): boolean {
  return /^Q\d+$/.test(qid);
}

/**
 * Parse WKT Point coordinates: "Point(lon lat)" -> { lat, lon }
 */
function parseWktPoint(wkt: string): { lat: number; lon: number } | null {
  const match = wkt.match(/Point\(([-\d.]+)\s+([-\d.]+)\)/i);
  if (!match) return null;
  const lon = parseFloat(match[1]);
  const lat = parseFloat(match[2]);
  if (isNaN(lat) || isNaN(lon)) return null;
  return { lat, lon };
}

/**
 * Fetch artworks of a given type from Wikidata
 * @param typeQid - Q3305213 for paintings, Q860861 for sculptures
 * @param typeName - 'painting' or 'sculpture'
 */
/**
 * Build a SPARQL query for artworks of a given type
 */
function buildArtworkQuery(typeQid: string, minSitelinks: number, limit: number): string {
  // No museum-subclass filter (wdt:P279*) — that traversal is the #1 cause of
  // Wikidata 504 timeouts. Instead we rely on downstream filtering:
  // fetchMuseumDetails() requires coordinates, resolveDepartments() handles
  // departments, and the final slice caps at 100 museums.
  return `
    SELECT ?artwork ?artworkLabel ?collection ?collectionLabel ?image ?creatorLabel
           (YEAR(?inception) AS ?year) ?sitelinks
    WHERE {
      ?artwork wdt:P31 wd:${typeQid} .
      ?artwork wdt:P195 ?collection .
      ?artwork wikibase:sitelinks ?sitelinks .
      FILTER(?sitelinks > ${minSitelinks})
      OPTIONAL { ?artwork wdt:P18 ?image }
      OPTIONAL { ?artwork wdt:P170 ?creator }
      OPTIONAL { ?artwork wdt:P571 ?inception }
      SERVICE wikibase:label { bd:serviceParam wikibase:language "en" }
    }
    ORDER BY DESC(?sitelinks)
    LIMIT ${limit}
  `;
}

/**
 * Parse SPARQL bindings into WikidataArtwork objects
 */
function parseArtworkBindings(bindings: SparqlBinding[], typeName: 'painting' | 'sculpture'): WikidataArtwork[] {
  return bindings
    .filter((b) => b.collection && isValidQid(extractQid(b.collection.value)))
    .map((b) => ({
      artworkQid: extractQid(b.artwork!.value),
      artworkLabel: b.artworkLabel?.value || 'Unknown',
      collectionQid: extractQid(b.collection!.value),
      collectionLabel: b.collectionLabel?.value || 'Unknown Collection',
      imageUrl: b.image?.value || null,
      creatorLabel: b.creatorLabel?.value || null,
      year: b.year?.value ? parseInt(b.year.value) : null,
      sitelinks: parseInt(b.sitelinks?.value || '0'),
      artworkType: typeName,
    }));
}

/**
 * Fetch artworks of a given type from Wikidata.
 * Falls back to split queries (high/low sitelinks) if the full query times out.
 */
async function fetchArtworks(
  typeQid: string,
  typeName: 'painting' | 'sculpture',
  progress: SyncProgress
): Promise<WikidataArtwork[]> {
  progress.statusMessage = `Fetching ${typeName}s from Wikidata...`;

  const limit = typeName === 'painting' ? 2000 : 500;

  // Try the full query first
  try {
    const bindings = await sparqlQuery(buildArtworkQuery(typeQid, 10, limit));
    const artworks = parseArtworkBindings(bindings, typeName);
    console.log(`[Museum Sync] Fetched ${artworks.length} ${typeName}s from Wikidata`);
    return artworks;
  } catch (primaryError) {
    const message = primaryError instanceof Error ? primaryError.message : String(primaryError);
    console.warn(`[Museum Sync] ${typeName} primary query failed: ${message}`);
    console.warn(`[Museum Sync] Falling back to split queries for ${typeName}s`);
  }

  // Fallback: split into two ranges to reduce query complexity
  const collected = new Map<string, SparqlBinding>();
  const ranges = typeName === 'painting'
    ? [{ min: 30, limit: 1200 }, { min: 10, limit: 1500 }]  // high fame first, then wider net
    : [{ min: 15, limit: 300 }, { min: 10, limit: 300 }];
  let successCount = 0;

  for (const range of ranges) {
    try {
      await delay(SPARQL_DELAY_MS * 2); // Extra delay between fallback queries
      progress.statusMessage = `Fetching ${typeName}s (fallback, sitelinks>${range.min})...`;
      const bindings = await sparqlQuery(buildArtworkQuery(typeQid, range.min, range.limit), 2);
      successCount++;
      for (const b of bindings) {
        const key = b.artwork?.value;
        if (key && !collected.has(key)) {
          collected.set(key, b);
        }
      }
      console.log(`[Museum Sync] Fallback query (sitelinks>${range.min}): ${bindings.length} ${typeName}s`);
    } catch (fallbackError) {
      const msg = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
      console.warn(`[Museum Sync] Fallback query failed for ${typeName}s (sitelinks>${range.min}): ${msg}`);
    }
  }

  if (successCount === 0) {
    throw new Error(`Failed to fetch ${typeName}s from Wikidata (primary + fallback)`);
  }

  const artworks = parseArtworkBindings([...collected.values()], typeName);
  console.log(`[Museum Sync] Fetched ${artworks.length} ${typeName}s via fallback queries`);
  return artworks;
}

/**
 * Fetch museum details from Wikidata for a batch of QIDs
 */
async function fetchMuseumDetails(qids: string[]): Promise<Map<string, WikidataMuseum>> {
  const results = new Map<string, WikidataMuseum>();

  // Process in batches of 50
  for (let i = 0; i < qids.length; i += 50) {
    const batch = qids.slice(i, i + 50);
    const values = batch.map((q) => `wd:${q}`).join(' ');

    const query = `
      SELECT ?museum ?museumLabel ?museumDescription ?coord ?countryLabel ?image ?website ?article
      WHERE {
        VALUES ?museum { ${values} }
        OPTIONAL { ?museum wdt:P625 ?coord }
        OPTIONAL { ?museum wdt:P17 ?country }
        OPTIONAL { ?museum wdt:P18 ?image }
        OPTIONAL { ?museum wdt:P856 ?website }
        OPTIONAL { ?article schema:about ?museum ; schema:isPartOf <https://en.wikipedia.org/> }
        SERVICE wikibase:label { bd:serviceParam wikibase:language "en" }
      }
    `;

    const bindings = await sparqlQuery(query);

    // Deduplicate: first row per QID wins (Map.set skips if already present)
    for (const b of bindings) {
      if (!b.museum) continue;
      const qid = extractQid(b.museum.value);
      if (results.has(qid)) continue;

      const coord = b.coord?.value ? parseWktPoint(b.coord.value) : null;

      results.set(qid, {
        museumQid: qid,
        museumLabel: b.museumLabel?.value || 'Unknown Museum',
        description: b.museumDescription?.value || null,
        lat: coord?.lat || null,
        lon: coord?.lon || null,
        countryLabel: b.countryLabel?.value || null,
        imageUrl: b.image?.value || null,
        website: b.website?.value || null,
        articleUrl: b.article?.value || null,
      });
    }

    if (i + 50 < qids.length) {
      await delay(SPARQL_DELAY_MS);
    }
  }

  return results;
}

/**
 * Resolve collections without coordinates to physical locations.
 * Tries multiple strategies:
 *   1. P361 (part of) chain — for departments within a museum
 *   2. P159 (headquarters) / P276 (location) — for umbrella orgs like "Tate"
 */
async function resolveDepartments(
  collectionQids: string[]
): Promise<Map<string, { museumQid: string; museumLabel: string; lat: number; lon: number }>> {
  const results = new Map<string, { museumQid: string; museumLabel: string; lat: number; lon: number }>();

  // Strategy 1: P361 (part of) chain
  for (let i = 0; i < collectionQids.length; i += 50) {
    const batch = collectionQids.slice(i, i + 50);
    const values = batch.map((q) => `wd:${q}`).join(' ');

    const query = `
      SELECT ?collection ?museum ?museumLabel ?coord
      WHERE {
        VALUES ?collection { ${values} }
        ?collection wdt:P361+ ?museum .
        ?museum wdt:P625 ?coord .
        SERVICE wikibase:label { bd:serviceParam wikibase:language "en" }
      }
    `;

    const bindings = await sparqlQuery(query);

    for (const b of bindings) {
      if (!b.collection || !b.coord) continue;
      const collectionQid = extractQid(b.collection.value);
      const coord = parseWktPoint(b.coord.value);
      if (coord && !results.has(collectionQid)) {
        results.set(collectionQid, {
          museumQid: extractQid(b.museum!.value),
          museumLabel: b.museumLabel?.value || 'Unknown Museum',
          lat: coord.lat,
          lon: coord.lon,
        });
      }
    }

    if (i + 50 < collectionQids.length) {
      await delay(SPARQL_DELAY_MS);
    }
  }

  // Strategy 2: P159 (headquarters) or P276 (location) for unresolved QIDs
  const unresolved = collectionQids.filter((q) => !results.has(q));
  if (unresolved.length > 0) {
    await delay(SPARQL_DELAY_MS);

    for (let i = 0; i < unresolved.length; i += 50) {
      const batch = unresolved.slice(i, i + 50);
      const values = batch.map((q) => `wd:${q}`).join(' ');

      const query = `
        SELECT ?collection ?collectionLabel ?coord
        WHERE {
          VALUES ?collection { ${values} }
          {
            ?collection wdt:P159 ?hq .
            ?hq wdt:P625 ?coord .
          } UNION {
            ?collection wdt:P276 ?loc .
            ?loc wdt:P625 ?coord .
          }
          SERVICE wikibase:label { bd:serviceParam wikibase:language "en" }
        }
      `;

      const bindings = await sparqlQuery(query);

      for (const b of bindings) {
        if (!b.collection || !b.coord) continue;
        const qid = extractQid(b.collection.value);
        const coord = parseWktPoint(b.coord.value);
        if (coord && !results.has(qid)) {
          results.set(qid, {
            museumQid: qid,
            museumLabel: b.collectionLabel?.value || 'Unknown',
            lat: coord.lat,
            lon: coord.lon,
          });
        }
      }

      if (i + 50 < unresolved.length) {
        await delay(SPARQL_DELAY_MS);
      }
    }
  }

  return results;
}

/**
 * Upsert a museum as an experience
 */
async function upsertMuseumExperience(
  museum: CollectedMuseum,
): Promise<{ experienceId: number; isCreated: boolean }> {
  const details = museum.details!;

  // Total sitelinks across all artworks as a ranking metric
  const totalSitelinks = museum.artworks.reduce((sum, a) => sum + a.sitelinksCount, 0);

  const metadata = {
    wikidataQid: museum.qid,
    country: details.countryLabel,
    website: details.website,
    wikipediaUrl: details.articleUrl || null,
    artworkCount: museum.artworks.length,
    totalArtworkSitelinks: totalSitelinks,
    topArtwork: museum.artworks[0]?.name || null,
  };

  // Store remote Wikimedia URL directly (thumbnailing handled by frontend)
  const imageUrl = details.imageUrl || null;

  const result = await pool.query(
    `INSERT INTO experiences (
      source_id, external_id, name, name_local, description, short_description,
      category, tags, location, country_codes, country_names, image_url, metadata,
      created_at, updated_at
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8,
      ST_SetSRID(ST_MakePoint($9, $10), 4326),
      $11, $12, $13, $14, NOW(), NOW()
    )
    ON CONFLICT (source_id, external_id) DO UPDATE SET
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
      MUSEUM_SOURCE_ID,
      museum.qid,
      details.museumLabel,
      JSON.stringify({ en: details.museumLabel }),
      details.description,
      null, // short_description
      'cultural',
      JSON.stringify(['museum']),
      details.lon, // ST_MakePoint(lon, lat)
      details.lat,
      details.countryLabel ? [] : [],
      details.countryLabel ? [details.countryLabel] : [],
      imageUrl,
      JSON.stringify(metadata),
    ]
  );

  const experienceId = result.rows[0].id;
  const isCreated = result.rows[0].inserted;

  // Upsert single location for the museum
  await pool.query(
    `DELETE FROM experience_locations WHERE experience_id = $1`,
    [experienceId]
  );
  await pool.query(
    `INSERT INTO experience_locations (experience_id, name, external_ref, ordinal, location)
     VALUES ($1, NULL, $2, 1, ST_SetSRID(ST_MakePoint($3, $4), 4326))`,
    [experienceId, museum.qid, details.lon, details.lat]
  );

  return { experienceId, isCreated };
}

/**
 * Upsert artworks as experience_contents for a museum
 */
async function upsertMuseumContents(
  experienceId: number,
  artworks: ProcessedContent[]
): Promise<void> {
  for (const artwork of artworks) {
    await pool.query(
      `INSERT INTO experience_contents (
        experience_id, external_id, name, content_type, artist, year,
        image_url, sitelinks_count, metadata, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW())
      ON CONFLICT (experience_id, external_id) DO UPDATE SET
        name = EXCLUDED.name,
        content_type = EXCLUDED.content_type,
        artist = EXCLUDED.artist,
        year = EXCLUDED.year,
        image_url = EXCLUDED.image_url,
        sitelinks_count = EXCLUDED.sitelinks_count,
        metadata = EXCLUDED.metadata,
        updated_at = NOW()`,
      [
        experienceId,
        artwork.externalId,
        artwork.name,
        artwork.contentType,
        artwork.artist,
        artwork.year,
        artwork.imageUrl,
        artwork.sitelinksCount,
        null, // metadata
      ]
    );
  }
}

/**
 * Create a sync log entry
 */
async function createSyncLog(triggeredBy: number | null): Promise<number> {
  const result = await pool.query(
    `INSERT INTO experience_sync_logs (source_id, triggered_by, status)
     VALUES ($1, $2, 'running')
     RETURNING id`,
    [MUSEUM_SOURCE_ID, triggeredBy]
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
    [logId, status, stats.fetched, stats.created, stats.updated, stats.errors,
     errorDetails ? JSON.stringify(errorDetails) : null]
  );

  await pool.query(
    `UPDATE experience_sources SET
      last_sync_at = NOW(),
      last_sync_status = $2,
      last_sync_error = $3
     WHERE id = $1`,
    [MUSEUM_SOURCE_ID, status, status === 'failed' ? 'See sync log for details' : null]
  );
}

/**
 * Delete all museum data (for force sync)
 */
async function cleanupMuseumData(progress: SyncProgress): Promise<void> {
  progress.statusMessage = 'Cleaning up existing museum data...';

  // Delete in correct order due to foreign key constraints
  await pool.query(`
    DELETE FROM experience_contents
    WHERE experience_id IN (SELECT id FROM experiences WHERE source_id = $1)
  `, [MUSEUM_SOURCE_ID]);

  await pool.query(`
    DELETE FROM user_visited_locations
    WHERE location_id IN (
      SELECT el.id FROM experience_locations el
      JOIN experiences e ON el.experience_id = e.id
      WHERE e.source_id = $1
    )
  `, [MUSEUM_SOURCE_ID]);

  await pool.query(`
    DELETE FROM user_visited_experiences
    WHERE experience_id IN (SELECT id FROM experiences WHERE source_id = $1)
  `, [MUSEUM_SOURCE_ID]);

  await pool.query(`
    DELETE FROM experience_location_regions
    WHERE assignment_type = 'auto'
      AND location_id IN (
        SELECT el.id FROM experience_locations el
        JOIN experiences e ON el.experience_id = e.id
        WHERE e.source_id = $1
      )
  `, [MUSEUM_SOURCE_ID]);

  await pool.query(`
    DELETE FROM experience_regions
    WHERE assignment_type = 'auto'
      AND experience_id IN (SELECT id FROM experiences WHERE source_id = $1)
  `, [MUSEUM_SOURCE_ID]);

  await pool.query(`
    DELETE FROM experience_locations
    WHERE experience_id IN (SELECT id FROM experiences WHERE source_id = $1)
  `, [MUSEUM_SOURCE_ID]);

  const result = await pool.query(`
    DELETE FROM experiences WHERE source_id = $1
  `, [MUSEUM_SOURCE_ID]);

  // No need to clear images from disk — museums use remote Wikimedia URLs

  console.log(`[Museum Sync] Cleaned up ${result.rowCount} existing museums`);
  progress.statusMessage = `Cleaned up ${result.rowCount} existing museums`;
}

/**
 * Main sync function - fetches top museums from Wikidata and upserts to database
 */
export async function syncMuseums(triggeredBy: number | null, force: boolean = false): Promise<void> {
  // Check if already running
  const existing = runningSyncs.get(MUSEUM_SOURCE_ID);
  if (existing && existing.status !== 'complete' && existing.status !== 'failed' && existing.status !== 'cancelled') {
    throw new Error('Museum sync already in progress');
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
  runningSyncs.set(MUSEUM_SOURCE_ID, progress);

  const errorDetails: { externalId: string; error: string }[] = [];

  try {
    progress.logId = await createSyncLog(triggeredBy);
    console.log(`[Museum Sync] Started sync (log ID: ${progress.logId})${force ? ' [FORCE MODE]' : ''}`);

    if (force) {
      await cleanupMuseumData(progress);
    }

    // Phase 1: Fetch artworks
    if (progress.cancel) throw new Error('Sync cancelled');
    const paintings = await fetchArtworks('Q3305213', 'painting', progress);
    await delay(SPARQL_DELAY_MS);

    if (progress.cancel) throw new Error('Sync cancelled');
    const sculptures = await fetchArtworks('Q860861', 'sculpture', progress);
    await delay(SPARQL_DELAY_MS);

    // Phase 2: Merge and sort all artworks by sitelinks
    const allArtworks = [...paintings, ...sculptures].sort((a, b) => b.sitelinks - a.sitelinks);
    console.log(`[Museum Sync] Total artworks: ${allArtworks.length} (${paintings.length} paintings, ${sculptures.length} sculptures)`);

    // Phase 3: Collect top museums by iterating artworks top-down
    progress.statusMessage = 'Identifying top museums...';
    const museumMap = new Map<string, CollectedMuseum>();

    for (const artwork of allArtworks) {
      // Get or create museum entry
      let museum = museumMap.get(artwork.collectionQid);
      if (!museum) {
        if (museumMap.size >= TARGET_MUSEUM_COUNT) {
          continue; // Already have enough museums, skip artworks for new museums
        }
        museum = {
          qid: artwork.collectionQid,
          label: artwork.collectionLabel,
          artworks: [],
        };
        museumMap.set(artwork.collectionQid, museum);
      }

      museum.artworks.push({
        externalId: artwork.artworkQid,
        name: artwork.artworkLabel,
        contentType: artwork.artworkType,
        artist: artwork.creatorLabel,
        year: artwork.year,
        imageUrl: artwork.imageUrl,
        sitelinksCount: artwork.sitelinks,
      });
    }

    console.log(`[Museum Sync] Identified ${museumMap.size} unique museums`);

    // Phase 4: Fetch museum details
    if (progress.cancel) throw new Error('Sync cancelled');
    progress.statusMessage = 'Fetching museum details from Wikidata...';
    const museumQids = Array.from(museumMap.keys());
    const museumDetails = await fetchMuseumDetails(museumQids);
    await delay(SPARQL_DELAY_MS);

    // Apply details to museums
    for (const [qid, museum] of museumMap) {
      museum.details = museumDetails.get(qid);
    }

    // Phase 5: Resolve departments without coordinates
    const noCoordQids = museumQids.filter((qid) => {
      const details = museumDetails.get(qid);
      return !details?.lat || !details?.lon;
    });

    if (noCoordQids.length > 0) {
      if (progress.cancel) throw new Error('Sync cancelled');
      progress.statusMessage = `Resolving ${noCoordQids.length} department collections...`;
      console.log(`[Museum Sync] Resolving ${noCoordQids.length} collections without coordinates`);

      const resolved = await resolveDepartments(noCoordQids);
      await delay(SPARQL_DELAY_MS);

      for (const [collectionQid, parent] of resolved) {
        const museum = museumMap.get(collectionQid);
        if (museum && museum.details) {
          // Update coordinates from parent museum
          museum.details.lat = parent.lat;
          museum.details.lon = parent.lon;
          // If the museum name is just a department, use parent name
          if (!museum.details.museumLabel || museum.details.museumLabel === 'Unknown Museum') {
            museum.details.museumLabel = parent.museumLabel;
          }
        }
      }
    }

    // Phase 6: Upsert museums and their contents (cap at 100)
    progress.status = 'processing';
    const validMuseums = Array.from(museumMap.values())
      .filter((m) => {
        if (!m.details?.lat || !m.details?.lon) {
          console.log(`[Museum Sync] Skipping ${m.qid} (${m.label}) - no coordinates`);
          errorDetails.push({ externalId: m.qid, error: 'No valid coordinates after resolution' });
          return false;
        }
        return true;
      })
      .slice(0, 100); // Cap at exactly 100 museums

    progress.total = validMuseums.length;
    progress.progress = 0;

    for (let i = 0; i < validMuseums.length; i++) {
      if (progress.cancel) throw new Error('Sync cancelled');

      const museum = validMuseums[i];
      progress.currentItem = museum.details!.museumLabel;
      progress.statusMessage = `Processing ${i + 1}/${validMuseums.length}: ${museum.details!.museumLabel}`;

      try {
        const { experienceId, isCreated } = await upsertMuseumExperience(museum);
        await upsertMuseumContents(experienceId, museum.artworks);

        if (isCreated) {
          progress.created++;
        } else {
          progress.updated++;
        }
      } catch (err) {
        progress.errors++;
        const errorMsg = err instanceof Error ? err.message : String(err);
        errorDetails.push({ externalId: museum.qid, error: errorMsg });
        console.error(`[Museum Sync] Error processing ${museum.qid}:`, errorMsg);
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
      fetched: allArtworks.length,
      created: progress.created,
      updated: progress.updated,
      errors: progress.errors,
    }, errorDetails.length > 0 ? errorDetails : undefined);

    console.log(`[Museum Sync] Complete: created=${progress.created}, updated=${progress.updated}, errors=${progress.errors}`);
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

    console.error(`[Museum Sync] Failed:`, errorMsg);
    throw err;
  } finally {
    // Clean up after delay, but only if this sync's progress is still current
    const thisProgress = progress;
    setTimeout(() => {
      if (runningSyncs.get(MUSEUM_SOURCE_ID) === thisProgress) {
        runningSyncs.delete(MUSEUM_SOURCE_ID);
      }
    }, 30000);
  }
}

/**
 * Get current museum sync status
 */
export function getMuseumSyncStatus(): SyncProgress | null {
  return runningSyncs.get(MUSEUM_SOURCE_ID) || null;
}

/**
 * Cancel running museum sync
 */
export function cancelMuseumSync(): boolean {
  const progress = runningSyncs.get(MUSEUM_SOURCE_ID);
  if (progress && progress.status !== 'complete' && progress.status !== 'failed') {
    progress.cancel = true;
    progress.statusMessage = 'Cancelling...';
    return true;
  }
  return false;
}

/**
 * Fix missing museum images - re-download images for museums that have a
 * Wikidata image URL but no local image file.
 */
export async function fixMuseumImages(_triggeredBy: number | null): Promise<void> {
  // Check if already running
  const existing = runningSyncs.get(MUSEUM_SOURCE_ID);
  if (existing && existing.status !== 'complete' && existing.status !== 'failed' && existing.status !== 'cancelled') {
    throw new Error('Museum sync already in progress');
  }

  const progress: SyncProgress = {
    cancel: false,
    status: 'processing',
    statusMessage: 'Fixing missing museum images...',
    progress: 0,
    total: 0,
    created: 0,
    updated: 0,
    errors: 0,
    currentItem: '',
    logId: null,
  };
  runningSyncs.set(MUSEUM_SOURCE_ID, progress);

  try {
    // Find museums missing images or with old local paths
    const result = await pool.query(`
      SELECT id, external_id, name, metadata
      FROM experiences
      WHERE source_id = $1
        AND (image_url IS NULL OR image_url = '' OR image_url LIKE '/images/%')
        AND metadata IS NOT NULL
    `, [MUSEUM_SOURCE_ID]);

    const museums = result.rows;
    progress.total = museums.length;
    progress.statusMessage = `Found ${museums.length} museums without images`;
    console.log(`[Museum Sync] Fix images: ${museums.length} museums missing images`);

    if (museums.length === 0) {
      progress.status = 'complete';
      progress.statusMessage = 'All museums already have images';
      return;
    }

    // Re-fetch image URLs from Wikidata for these museums
    const qids = museums.map((m: { external_id: string }) => m.external_id);
    progress.statusMessage = 'Fetching image URLs from Wikidata...';
    const museumDetails = await fetchMuseumDetails(qids);

    let fixed = 0;
    let failed = 0;

    for (let i = 0; i < museums.length; i++) {
      if (progress.cancel) throw new Error('Sync cancelled');

      const museum = museums[i];
      const qid = museum.external_id;
      const details = museumDetails.get(qid);
      progress.currentItem = museum.name;
      progress.statusMessage = `Fixing ${i + 1}/${museums.length}: ${museum.name}`;
      progress.progress = i + 1;

      if (!details?.imageUrl) {
        failed++;
        continue;
      }

      // Store remote Wikimedia URL directly
      await pool.query(
        'UPDATE experiences SET image_url = $1, updated_at = NOW() WHERE id = $2',
        [details.imageUrl, museum.id]
      );
      fixed++;
    }

    progress.status = 'complete';
    progress.created = fixed;
    progress.errors = failed;
    progress.statusMessage = `Fixed images: ${fixed} updated, ${failed} no image found`;
    console.log(`[Museum Sync] Fix images complete: ${fixed} updated, ${failed} no image found`);
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    progress.status = progress.cancel ? 'cancelled' : 'failed';
    progress.statusMessage = errorMsg;
    console.error(`[Museum Sync] Fix images failed:`, errorMsg);
    throw err;
  } finally {
    const thisProgress = progress;
    setTimeout(() => {
      if (runningSyncs.get(MUSEUM_SOURCE_ID) === thisProgress) {
        runningSyncs.delete(MUSEUM_SOURCE_ID);
      }
    }, 30000);
  }
}
