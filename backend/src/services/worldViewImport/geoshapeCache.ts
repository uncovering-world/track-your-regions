import { pool } from '../../db/index.js';
import type { PoolClient } from 'pg';
import { userAgent } from '../../config/userAgent.js';
import { assertRobotsAllow, RobotsRefusal } from '../robots/robotsSignals.js';

// World-view import machinery, and it says so wherever it is called from: an
// unattended run walking every region, or one Commons map an admin's review
// asked for. The marker names the traffic rather than who is watching it, which is
// why a single admin click can emit both markers — see `config/userAgent.ts`.
const USER_AGENT = userAgent({ bot: true });
const FETCH_DELAY_MS = 1500;

// Serialising rate limiter shared by both fetch entry points (#346).
//
// The previous bare-variable form (`let lastFetchTime = 0`) was racy: two
// concurrent calls both observed the variable at the same value, both
// computed elapsed >= FETCH_DELAY_MS, both skipped the delay and fired
// simultaneously — defeating the limiter.
//
// fetchChain serialises slot acquisition: every caller awaits the previous
// caller's slot before checking elapsed time, so the (read elapsed → maybe
// wait → write lastFetchTime) sequence runs strictly one at a time.
//
// Preserves the original optimisation: a cold first call (or one made well
// after the previous fetch) still fires without artificial delay.
let lastFetchTime = 0;
let fetchChain: Promise<void> = Promise.resolve();

export async function acquireFetchSlot(): Promise<void> {
  const prev = fetchChain;
  fetchChain = (async () => {
    await prev;
    const elapsed = Date.now() - lastFetchTime;
    if (elapsed < FETCH_DELAY_MS) {
      await new Promise(resolve => setTimeout(resolve, FETCH_DELAY_MS - elapsed));
    }
    lastFetchTime = Date.now();
  })();
  return fetchChain;
}

/**
 * Whether the store holds a shape for a Wikidata item. Nothing is fetched: Wikimedia Maps (`maps.wikimedia.org`) draws
 * an item's shape, and its Maps Terms of Use do not allow third-party services
 * to use it (#2084). A region whose item has no shape here is matched by its
 * points instead.
 */
export async function geoshapeHeld(wikidataId: string): Promise<boolean> {
  const held = await pool.query<{ held: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM wikidata_geoshapes
       WHERE wikidata_id = $1 AND not_available = FALSE AND geom IS NOT NULL
     ) AS held`,
    [wikidataId],
  );
  return held.rows[0]?.held === true;
}

/** Metadata returned from a fetched Wikimedia Commons map data file */
export interface CommonsMapMeta {
  available: boolean;
  title?: string;
  color?: string;
}

/**
 * Fetch and cache a Wikimedia Commons map data file (e.g. "North_Sea_Coast_region.map").
 *
 * These files contain GeoJSON FeatureCollections with polygon geometries, fill colors,
 * and titles. Used by Wikivoyage pages that reference `wikicommons=` in {{mapshape}}
 * templates instead of `wikidata=`.
 *
 * Stores geometry in wikidata_geoshapes using "commons:{filename}" as the key.
 */
export async function getOrFetchCommonsMapGeoshape(commonsFile: string): Promise<CommonsMapMeta> {
  const cacheKey = `commons:${commonsFile}`;

  // Check cache first
  const cached = await pool.query(
    'SELECT not_available FROM wikidata_geoshapes WHERE wikidata_id = $1',
    [cacheKey],
  );
  if (cached.rows.length > 0) {
    return { available: !cached.rows[0].not_available };
  }

  await acquireFetchSlot();

  try {
    const url = `https://commons.wikimedia.org/wiki/Data:${encodeURIComponent(commonsFile)}?action=raw`;
    await assertRobotsAllow(url);
    const response = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      console.warn(`[GeoshapeCache] Commons HTTP ${response.status} for ${commonsFile}`);
      // Don't poison the cache for transient errors (429 rate limit, 5xx server errors).
      const transient = response.status === 429 || response.status >= 500;
      if (!transient) {
        await pool.query(
          `INSERT INTO wikidata_geoshapes (wikidata_id, not_available) VALUES ($1, TRUE)
           ON CONFLICT (wikidata_id) DO NOTHING`,
          [cacheKey],
        );
      }
      return { available: false };
    }

    const data = await response.json() as {
      data?: { features?: Array<{ geometry?: unknown; properties?: Record<string, string> }> };
    };

    const features = data?.data?.features;
    if (!features || features.length === 0 || !features[0]?.geometry) {
      await pool.query(
        `INSERT INTO wikidata_geoshapes (wikidata_id, not_available) VALUES ($1, TRUE)
         ON CONFLICT (wikidata_id) DO NOTHING`,
        [cacheKey],
      );
      return { available: false };
    }

    // Extract metadata from first feature's properties
    const props = features[0].properties ?? {};
    const rawTitle = props['title'] ?? '';
    // eslint-disable-next-line security/detect-unsafe-regex, sonarjs/slow-regex -- pattern matches wikilinks [[target|label]]; negated classes are bounded by ']' which prevents exponential backtracking
    const title = rawTitle.replace(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g, '$1').trim();
    const color = props['fill'] ?? '';

    // Store geometry — pipeline for hand-drawn Commons shapes:
    //   ST_Force2D: strip Z coordinates (Commons GeoJSON often has [lon,lat,0])
    //   Buffer expand/shrink (0.00001°): resolves GEOS TopologyExceptions from
    //     near-touching edges in hand-drawn shapes — ~1m precision loss is
    //     irrelevant for region-level matching
    const geomJson = JSON.stringify(features[0].geometry);
    if (features.length === 1) {
      await pool.query(
        `INSERT INTO wikidata_geoshapes (wikidata_id, geom)
         VALUES ($1, ST_Multi(ST_CollectionExtract(
           ST_Buffer(ST_Buffer(ST_Force2D(ST_SetSRID(ST_GeomFromGeoJSON($2), 4326)), 0.00001), -0.00001), 3)))
         ON CONFLICT (wikidata_id) DO UPDATE SET geom = EXCLUDED.geom, not_available = FALSE`,
        [cacheKey, geomJson],
      );
    } else {
      // Multiple features — buffer each feature BEFORE union to fix per-feature
      // topology issues that make ST_Union fail with TopologyException
      const geomJsons = features
        .map(f => f.geometry ? JSON.stringify(f.geometry) : null)
        .filter(Boolean) as string[];
      await pool.query(
        `INSERT INTO wikidata_geoshapes (wikidata_id, geom)
         VALUES ($1, ST_Multi(ST_CollectionExtract(
           (SELECT ST_Union(
             ST_Buffer(ST_Buffer(ST_Force2D(ST_SetSRID(ST_GeomFromGeoJSON(g), 4326)), 0.00001), -0.00001)
           ) FROM unnest($2::text[]) AS g), 3)))
         ON CONFLICT (wikidata_id) DO UPDATE SET geom = EXCLUDED.geom, not_available = FALSE`,
        [cacheKey, geomJsons],
      );
    }

    return { available: true, title, color };
  } catch (err) {
    console.error('[GeoshapeCache] Failed to fetch Commons map %s:', commonsFile, err);
    // A host's refusal says nothing about the map, and is asked again next time.
    if (err instanceof RobotsRefusal) return { available: false };
    await pool.query(
      `INSERT INTO wikidata_geoshapes (wikidata_id, not_available) VALUES ($1, TRUE)
       ON CONFLICT (wikidata_id) DO NOTHING`,
      [cacheKey],
    );
    return { available: false };
  }
}

/**
 * Compute geo similarity between a cached Wikidata geoshape and a GADM division.
 * Uses geom_simplified_medium for performance.
 *
 * Computes max(IoU, adjusted_coverage) where:
 *   - IoU = intersection / union — standard metric, works when shapes are similar size
 *   - Forward coverage = intersection / GADM area — handles Wikidata hulls wrapping
 *     precise GADM boundaries (e.g., archipelagos like Guadeloupe)
 *   - Reverse coverage = intersection / wiki area — how much of the wiki shape is
 *     accounted for by this GADM division
 *
 * The forward coverage is scaled by sqrt(reverse coverage) to penalize GADM
 * subdivisions that are much smaller than the wiki shape. Using sqrt gives a
 * continuous penalty that prevents child divisions from inflating to 100%
 * while still boosting archipelago hull matches above raw IoU.
 */
export async function computeIoU(
  wikidataId: string,
  divisionId: number,
): Promise<number | null> {
  // Pipeline: ST_MakeValid → ST_CollectionExtract(3) → ST_ForcePolygonCCW → ::geography
  // - ST_MakeValid fixes self-intersections
  // - ST_CollectionExtract(3) strips non-polygon parts (points/lines from tangent edges)
  //   that ST_Intersection/ST_Union can produce as GeometryCollections
  // - ST_ForcePolygonCCW normalizes winding order (geography requires CCW exterior rings,
  //   wrong winding causes "lwgeom_area_spher returned area < 0")
  // - safe_geo_area() wraps ST_Area(::geography) to return NULL on polar/extreme geometries
  //   (e.g. Antarctica union) where spheroidal area computation fails
  const result = await pool.query(`
    WITH geoms AS (
      SELECT
        ST_ForcePolygonCCW(ST_CollectionExtract(ST_MakeValid(ST_Intersection(wg.geom, ad.geom_simplified_medium)), 3)) AS isect,
        ST_ForcePolygonCCW(ST_CollectionExtract(ST_MakeValid(ST_Union(wg.geom, ad.geom_simplified_medium)), 3)) AS unioned,
        ST_ForcePolygonCCW(ad.geom_simplified_medium) AS gadm,
        ST_ForcePolygonCCW(wg.geom) AS wiki
      FROM wikidata_geoshapes wg, administrative_divisions ad
      WHERE wg.wikidata_id = $1
        AND wg.not_available = FALSE
        AND ad.id = $2
        AND ad.geom_simplified_medium IS NOT NULL
    )
    SELECT
      safe_geo_area(isect) /
        NULLIF(safe_geo_area(unioned), 0) AS iou,
      safe_geo_area(isect) /
        NULLIF(safe_geo_area(gadm), 0) AS fwd_coverage,
      safe_geo_area(isect) /
        NULLIF(safe_geo_area(wiki), 0) AS rev_coverage
    FROM geoms
  `, [wikidataId, divisionId]);

  if (result.rows.length === 0) return null;
  const iou = result.rows[0].iou as number | null;
  const fwd = result.rows[0].fwd_coverage as number | null;
  const rev = result.rows[0].rev_coverage as number | null;

  // Scale forward coverage by sqrt(reverse coverage): continuous penalty that
  // prevents child divisions from inflating to 100%. Only reaches 100% when
  // rev ≈ 1.0 (correct match), while a child covering 25% of the wiki shape
  // gets sqrt(0.25) = 0.5 penalty → 50% instead of 100%.
  const revPenalty = Math.sqrt(rev ?? 0);
  const adjustedCoverage = (fwd ?? 0) * revPenalty;

  const best = Math.max(iou ?? 0, adjustedCoverage);
  // Return 0 for zero overlap (meaningful result: no geographic intersection).
  // Only return null when data is missing (rows.length === 0 above).
  return best > 0 ? Math.round(best * 1000) / 1000 : 0;
}


/**
 * Compute geo similarity for a region's suggestions.
 * Reads the stored geoshape, then computes IoU for each suggestion.
 * Updates region_import_state.geo_available and region_match_suggestions.geo_similarity.
 *
 * Auto-accept: if exactly one suggestion has IoU = 1.0, auto-match it.
 * Auto-reject: suggestions with IoU = 0.0 are marked as rejected.
 */
interface IouScore { divisionId: number; iou: number }

async function computeAndPersistIous(
  client: PoolClient,
  regionId: number,
  wikidataId: string,
  suggestions: Array<{ divisionId: number }>,
): Promise<IouScore[]> {
  const scores: IouScore[] = [];
  for (const suggestion of suggestions) {
    try {
      const iou = await computeIoU(wikidataId, suggestion.divisionId);
      if (iou == null) continue;
      scores.push({ divisionId: suggestion.divisionId, iou });
      await client.query(
        `UPDATE region_match_suggestions SET geo_similarity = $1
         WHERE region_id = $2 AND division_id = $3`,
        [iou, regionId, suggestion.divisionId],
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[GeoSim] IoU failed for region ${regionId}, division ${suggestion.divisionId}: ${msg}`);
    }
  }
  return scores;
}

/**
 * Reject zero-overlap suggestions, except when they share a GADM name with a
 * non-zero candidate (multi-territory countries like Chile keep both rows).
 */
async function rejectZeroOverlapSuggestions(
  client: PoolClient,
  regionId: number,
  scores: IouScore[],
): Promise<void> {
  const zeroScores = scores.filter(s => s.iou === 0);
  if (zeroScores.length === 0) return;

  const nonZeroDivIds = scores.filter(s => s.iou > 0).map(s => s.divisionId);
  const allDivIds = [...nonZeroDivIds, ...zeroScores.map(s => s.divisionId)];
  const namesResult = await client.query(
    `SELECT id, LOWER(name) AS name FROM administrative_divisions WHERE id = ANY($1)`,
    [allDivIds],
  );
  const nameById = new Map<number, string>();
  for (const row of namesResult.rows) nameById.set(row.id as number, row.name as string);
  const nonZeroNames = new Set(nonZeroDivIds.map(id => nameById.get(id)).filter(Boolean));

  for (const s of zeroScores) {
    const name = nameById.get(s.divisionId);
    if (name && nonZeroNames.has(name)) continue;
    await client.query(
      `UPDATE region_match_suggestions SET rejected = TRUE
       WHERE region_id = $1 AND division_id = $2`,
      [regionId, s.divisionId],
    );
  }
}

/**
 * If an auto_matched region has zero geo overlap with all suggestions, revoke
 * the auto-match. Catches bad text matches (e.g., UK→Guernsey→Herm matched
 * to a French commune). Returns true when revocation happened so the caller
 * can short-circuit further auto-accept logic.
 */
async function revokeAutoMatchOnZeroOverlap(
  client: PoolClient,
  regionId: number,
  scores: IouScore[],
): Promise<boolean> {
  if (scores.length === 0 || scores.some(s => s.iou !== 0)) return false;
  const statusResult = await client.query(
    'SELECT match_status FROM region_import_state WHERE region_id = $1',
    [regionId],
  );
  if (statusResult.rows[0]?.match_status !== 'auto_matched') return false;

  // One active suggestion per division (#1620): a rejection beside an active
  // twin stays, and of two rejections of one division only the first returns.
  await client.query(
    `UPDATE region_match_suggestions s SET rejected = FALSE
     WHERE s.id IN (
       SELECT DISTINCT ON (division_id) id FROM region_match_suggestions
       WHERE region_id = $1 AND rejected ORDER BY division_id, id
     )
     AND NOT EXISTS (
       SELECT 1 FROM region_match_suggestions a
       WHERE a.region_id = s.region_id AND a.division_id = s.division_id AND NOT a.rejected
     )`,
    [regionId],
  );
  await client.query('DELETE FROM region_members WHERE region_id = $1', [regionId]);
  await client.query(
    `UPDATE region_import_state SET match_status = 'needs_review' WHERE region_id = $1`,
    [regionId],
  );
  console.log(`[GeoSim] Revoked auto-match for region ${regionId} (zero geo overlap)`);
  return true;
}

async function autoAcceptPerfectMatch(
  client: PoolClient,
  regionId: number,
  perfectScores: IouScore[],
): Promise<void> {
  if (perfectScores.length !== 1) return;
  const bestDiv = perfectScores[0].divisionId;
  await client.query(
    `INSERT INTO region_members (region_id, division_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
    [regionId, bestDiv],
  );
  await client.query(
    `UPDATE region_import_state SET match_status = 'auto_matched' WHERE region_id = $1`,
    [regionId],
  );
  await client.query(
    `UPDATE region_match_suggestions SET rejected = TRUE
     WHERE region_id = $1 AND division_id != $2 AND rejected = FALSE`,
    [regionId, bestDiv],
  );
  console.log(`[GeoSim] Auto-matched region ${regionId} → division ${bestDiv} (100% IoU)`);
}

async function markNoCandidatesIfAllRejected(
  client: PoolClient,
  regionId: number,
): Promise<void> {
  const remaining = await client.query(
    `SELECT COUNT(*) FROM region_match_suggestions WHERE region_id = $1 AND rejected = FALSE`,
    [regionId],
  );
  if (parseInt(remaining.rows[0].count as string) !== 0) return;
  // A region that already holds divisions is matched, whatever a later search
  // found and rejected: the same rule the review applies to a rejection
  // (`computeRejectStatus` in the frontend's `useTreeMutations.ts`).
  const members = await client.query(
    'SELECT EXISTS (SELECT 1 FROM region_members WHERE region_id = $1) AS held',
    [regionId],
  );
  const status = members.rows[0]?.held ? 'manual_matched' : 'no_candidates';
  await client.query(
    'UPDATE region_import_state SET match_status = $2 WHERE region_id = $1',
    [regionId, status],
  );
  console.log('[GeoSim] All suggestions rejected for region %d, set to %s', regionId, status);
}

export async function computeGeoSimilarityForRegion(
  client: PoolClient,
  regionId: number,
  suggestions: Array<{ divisionId: number }>,
): Promise<void> {
  const wdResult = await client.query(
    'SELECT source_external_id FROM region_import_state WHERE region_id = $1',
    [regionId],
  );
  const wikidataId = wdResult.rows[0]?.source_external_id as string | undefined;
  if (!wikidataId) return;

  const available = await geoshapeHeld(wikidataId);
  await client.query(
    'UPDATE region_import_state SET geo_available = $1 WHERE region_id = $2',
    [available, regionId],
  );
  if (!available) return;

  const scores = await computeAndPersistIous(client, regionId, wikidataId, suggestions);
  await rejectZeroOverlapSuggestions(client, regionId, scores);

  if (await revokeAutoMatchOnZeroOverlap(client, regionId, scores)) return;

  const perfectScores = scores.filter(s => Math.round(s.iou * 100) >= 100);
  await autoAcceptPerfectMatch(client, regionId, perfectScores);

  if (perfectScores.length !== 1) {
    await markNoCandidatesIfAllRejected(client, regionId);
  }
}

/**
 * After a search or match adds suggestions, compute geo similarity for every
 * suggestion not rejected. The manual match buttons and the automatic spatial
 * pass (`spatialPass.ts`, #622) both call it, so a suggestion is scored, and a
 * perfect one auto-accepted, the same way whoever asked — a region's only
 * suggestion included (#1629): a perfect match is no less perfect for having no
 * rival.
 */
export async function computeGeoSimilarityIfNeeded(regionId: number): Promise<void> {
  const sugResult = await pool.query(
    `SELECT division_id AS "divisionId" FROM region_match_suggestions WHERE region_id = $1 AND rejected = false`,
    [regionId],
  );
  if (sugResult.rows.length === 0) return;

  const client = await pool.connect();
  try {
    await computeGeoSimilarityForRegion(client, regionId, sugResult.rows as Array<{ divisionId: number }>);
  } finally {
    client.release();
  }
}
