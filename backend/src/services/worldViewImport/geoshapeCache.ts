import { pool } from '../../db/index.js';
import type { PoolClient } from 'pg';

const GEOSHAPE_URL = 'https://maps.wikimedia.org/geoshape';
const USER_AGENT = 'TrackYourRegions/1.0 (https://github.com/nikolay/track-your-regions)';
const FETCH_DELAY_MS = 1500;

let lastFetchTime = 0;

/**
 * Get or fetch a Wikidata geoshape geometry.
 * Caches results (including "not available") in wikidata_geoshapes table.
 * Returns true if geoshape is available, false otherwise.
 */
export async function getOrFetchGeoshape(wikidataId: string): Promise<boolean> {
  // Check cache first
  const cached = await pool.query(
    'SELECT not_available FROM wikidata_geoshapes WHERE wikidata_id = $1',
    [wikidataId],
  );
  if (cached.rows.length > 0) {
    return !cached.rows[0].not_available;
  }

  // Rate limit
  const now = Date.now();
  const elapsed = now - lastFetchTime;
  if (elapsed < FETCH_DELAY_MS) {
    await new Promise(resolve => setTimeout(resolve, FETCH_DELAY_MS - elapsed));
  }
  lastFetchTime = Date.now();

  // Fetch from Wikimedia
  try {
    const url = `${GEOSHAPE_URL}?getgeojson=1&ids=${wikidataId}`;
    const response = await fetch(url, {
      headers: {
        'User-Agent': USER_AGENT,
        'Referer': 'https://en.wikivoyage.org/',
      },
    });

    if (!response.ok) {
      console.warn(`[GeoshapeCache] HTTP ${response.status} for ${wikidataId}`);
      await pool.query(
        `INSERT INTO wikidata_geoshapes (wikidata_id, not_available) VALUES ($1, TRUE)
         ON CONFLICT (wikidata_id) DO NOTHING`,
        [wikidataId],
      );
      return false;
    }

    const geojson = await response.json() as { features?: Array<{ geometry?: unknown }> };

    // Extract geometry from FeatureCollection
    const features = geojson?.features;
    if (!features || features.length === 0 || !features[0]?.geometry) {
      await pool.query(
        `INSERT INTO wikidata_geoshapes (wikidata_id, not_available) VALUES ($1, TRUE)
         ON CONFLICT (wikidata_id) DO NOTHING`,
        [wikidataId],
      );
      return false;
    }

    const geometry = features[0].geometry;
    const geomJson = JSON.stringify(geometry);

    // Store with validation — use ST_Buffer(geom, 0) instead of ST_MakeValid
    // because ST_MakeValid can collapse self-intersecting archipelago polygons
    // into a single merged shape (destroying island boundaries), while Buffer(0)
    // preserves individual polygon parts and gives correct overlap with GADM.
    await pool.query(
      `INSERT INTO wikidata_geoshapes (wikidata_id, geom)
       VALUES ($1, ST_Multi(ST_CollectionExtract(ST_Buffer(ST_SetSRID(ST_GeomFromGeoJSON($2), 4326), 0), 3)))
       ON CONFLICT (wikidata_id) DO UPDATE SET
         geom = EXCLUDED.geom,
         not_available = FALSE`,
      [wikidataId, geomJson],
    );

    return true;
  } catch (err) {
    console.error(`[GeoshapeCache] Failed to fetch geoshape for ${wikidataId}:`, err);
    await pool.query(
      `INSERT INTO wikidata_geoshapes (wikidata_id, not_available) VALUES ($1, TRUE)
       ON CONFLICT (wikidata_id) DO NOTHING`,
      [wikidataId],
    );
    return false;
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
 * Compute what fraction of a single GADM division's area is covered
 * by the union of other GADM divisions (the children's matches).
 * Returns a number 0–1, or null if geometries are missing.
 */
export async function computeDivisionCoverage(
  divisionId: number,
  childDivisionIds: number[],
): Promise<number | null> {
  if (childDivisionIds.length === 0) return 0;

  const result = await pool.query(`
    WITH child_union AS (
      SELECT ST_ForcePolygonCCW(ST_CollectionExtract(
        ST_MakeValid(ST_Union(ad.geom_simplified_medium)), 3
      )) AS geom
      FROM administrative_divisions ad
      WHERE ad.id = ANY($2) AND ad.geom_simplified_medium IS NOT NULL
    ),
    target AS (
      SELECT ST_ForcePolygonCCW(ad.geom_simplified_medium) AS geom
      FROM administrative_divisions ad
      WHERE ad.id = $1 AND ad.geom_simplified_medium IS NOT NULL
    )
    SELECT
      safe_geo_area(ST_ForcePolygonCCW(ST_CollectionExtract(
        ST_MakeValid(ST_Intersection(t.geom, cu.geom)), 3
      ))) /
      NULLIF(safe_geo_area(t.geom), 0) AS coverage
    FROM target t, child_union cu
  `, [divisionId, childDivisionIds]);

  if (result.rows.length === 0) return null;
  const coverage = result.rows[0].coverage as number | null;
  return coverage != null ? Math.round(coverage * 1000) / 1000 : null;
}

/**
 * Compute what fraction of multiple parent divisions is covered by
 * multiple child divisions. Unions both sets, then computes
 * intersection_area / parent_total_area.
 */
export async function computeMultiDivisionCoverage(
  parentDivisionIds: number[],
  childDivisionIds: number[],
): Promise<number | null> {
  if (parentDivisionIds.length === 0 || childDivisionIds.length === 0) return null;

  const result = await pool.query(`
    WITH parent_union AS (
      SELECT ST_ForcePolygonCCW(ST_CollectionExtract(
        ST_MakeValid(ST_Union(ad.geom_simplified_medium)), 3
      )) AS geom
      FROM administrative_divisions ad
      WHERE ad.id = ANY($1) AND ad.geom_simplified_medium IS NOT NULL
    ),
    child_union AS (
      SELECT ST_ForcePolygonCCW(ST_CollectionExtract(
        ST_MakeValid(ST_Union(ad.geom_simplified_medium)), 3
      )) AS geom
      FROM administrative_divisions ad
      WHERE ad.id = ANY($2) AND ad.geom_simplified_medium IS NOT NULL
    )
    SELECT
      safe_geo_area(ST_ForcePolygonCCW(ST_CollectionExtract(
        ST_MakeValid(ST_Intersection(p.geom, c.geom)), 3
      ))) /
      NULLIF(safe_geo_area(p.geom), 0) AS coverage
    FROM parent_union p, child_union c
  `, [parentDivisionIds, childDivisionIds]);

  if (result.rows.length === 0) return null;
  const coverage = result.rows[0].coverage as number | null;
  return coverage != null ? Math.round(coverage * 100000) / 100000 : null;
}

interface CoverageEntry {
  coverage: number;
  intersectionArea: number;
  gadmArea: number;
}

type CandidateInfo = {
  id: number;
  name: string;
  path: string;
  parentId: number | null;
  gadmDepth: number;
  coverage: number;
  intersectionArea: number;
  gadmArea: number;
};

/**
 * Refine a covering set by drilling down imprecise divisions.
 *
 * For each division in the covering set, computes precision = intersectionArea / gadmArea.
 * If precision < 0.5 (the geoshape covers less than half the GADM division), replaces
 * that division with its children that intersect the geoshape — recursively up to maxDepth.
 * This handles cases like a Wikivoyage island region matching a whole GADM province.
 */
async function refineCoveringSet(
  coveringSet: CandidateInfo[],
  wikidataId: string,
  wikiArea: number,
  depth: number = 0,
  maxDepth: number = 3,
): Promise<CandidateInfo[]> {
  const result: CandidateInfo[] = [];

  for (const entry of coveringSet) {
    const precision = entry.gadmArea > 0 ? entry.intersectionArea / entry.gadmArea : 1;

    if (precision >= 0.5 || depth >= maxDepth) {
      result.push(entry);
      continue;
    }

    console.log(
      `[Geoshape Refine] ${entry.name} (id=${entry.id}): precision=${(precision * 100).toFixed(1)}% — drilling down to children`,
    );

    // Query children of this division that intersect the geoshape
    const childResult = await pool.query(`
      WITH wiki AS (
        SELECT ST_ForcePolygonCCW(geom) AS geom
        FROM wikidata_geoshapes
        WHERE wikidata_id = $1 AND not_available = FALSE
      )
      SELECT ad.id, ad.name, ad.parent_id,
        safe_geo_area(
          ST_ForcePolygonCCW(ST_CollectionExtract(
            ST_MakeValid(ST_Intersection(w.geom, ad.geom_simplified_medium)), 3
          ))
        ) AS intersection_area,
        safe_geo_area(ad.geom_simplified_medium) AS gadm_area,
        (WITH RECURSIVE div_ancestors AS (
          SELECT ad.id AS aid, ad.name AS aname, ad.parent_id AS apid
          UNION ALL
          SELECT d.id, d.name, d.parent_id
          FROM administrative_divisions d JOIN div_ancestors da ON d.id = da.apid
        )
        SELECT string_agg(aname, ' > ' ORDER BY aid) FROM div_ancestors) AS path
      FROM administrative_divisions ad, wiki w
      WHERE ad.parent_id = $2
        AND ad.geom_simplified_medium IS NOT NULL
        AND ST_Intersects(ad.geom_simplified_medium, w.geom)
    `, [wikidataId, entry.id]);

    // Build child candidates, filtering tiny overlaps (< 1% of wiki area)
    const children: CandidateInfo[] = [];
    for (const row of childResult.rows) {
      const childIntersectionArea = (row.intersection_area as number | null) ?? 0;
      const childGadmArea = (row.gadm_area as number | null) ?? 0;
      const childCoverage = wikiArea > 0 ? childIntersectionArea / wikiArea : 0;
      if (childCoverage < 0.01) continue;
      children.push({
        id: row.id as number,
        name: row.name as string,
        path: row.path as string,
        parentId: row.parent_id as number | null,
        gadmDepth: entry.gadmDepth + 1,
        coverage: childCoverage,
        intersectionArea: childIntersectionArea,
        gadmArea: childGadmArea,
      });
    }

    // Check if children adequately cover the parent's intersection
    const childIntersectionSum = children.reduce((sum, c) => sum + c.intersectionArea, 0);
    const childCoverageRatio = entry.intersectionArea > 0
      ? childIntersectionSum / entry.intersectionArea
      : 0;

    if (childCoverageRatio >= 0.8 && children.length > 0) {
      console.log(
        `[Geoshape Refine] Replacing ${entry.name} with ${children.length} children (childCoverageRatio=${(childCoverageRatio * 100).toFixed(1)}%)`,
      );
      // Recurse on children to refine further
      const refinedChildren = await refineCoveringSet(children, wikidataId, wikiArea, depth + 1, maxDepth);
      result.push(...refinedChildren);
    } else {
      console.log(
        `[Geoshape Refine] Keeping ${entry.name} — children insufficient (${children.length} children, childCoverageRatio=${(childCoverageRatio * 100).toFixed(1)}%)`,
      );
      result.push(entry);
    }
  }

  return result;
}

/**
 * Match a region by comparing its Wikidata geoshape against GADM divisions.
 *
 * Finds a minimal covering set of the highest-level GADM divisions that together
 * cover ~100% of the source geoshape. Prefers shallowest divisions in the GADM
 * hierarchy — if a province covers part of the shape, its districts are not listed.
 *
 * Strategy:
 * 1. Fetch/cache the region's Wikidata geoshape
 * 2. Scope search: walk up the region tree to find nearest ancestor with assigned
 *    GADM divisions, then get all GADM descendants
 * 3. Find candidate GADM divisions via ST_Intersects, with GADM depth
 * 4. Compute coverage (intersection_area / wiki_area) for each candidate in batch
 * 5. Build covering set: shallowest first, skip children of already-selected divisions
 * 6. Return covering set as suggestions with total coverage
 */
export async function geoshapeMatchRegion(
  worldViewId: number,
  regionId: number,
): Promise<{ found: number; suggestions: Array<{ divisionId: number; name: string; path: string; score: number }>; totalCoverage?: number }> {
  // 1. Get region's Wikidata ID
  const wdResult = await pool.query(
    `SELECT ris.source_external_id, r.is_leaf
     FROM region_import_state ris
     JOIN regions r ON r.id = ris.region_id
     WHERE ris.region_id = $1 AND r.world_view_id = $2`,
    [regionId, worldViewId],
  );
  const wikidataId = wdResult.rows[0]?.source_external_id as string | undefined;
  const isLeaf = wdResult.rows[0]?.is_leaf as boolean | undefined;
  if (!wikidataId) {
    return { found: 0, suggestions: [] };
  }

  // 2. Fetch/cache geoshape and update geo_available flag
  const available = await getOrFetchGeoshape(wikidataId);
  await pool.query(
    'UPDATE region_import_state SET geo_available = $1 WHERE region_id = $2',
    [available, regionId],
  );
  if (!available) {
    return { found: 0, suggestions: [] };
  }

  // 3. Scope: walk up the region tree to find nearest ancestor with assigned GADM divisions
  const ancestorResult = await pool.query(`
    WITH RECURSIVE ancestors AS (
      SELECT id, parent_region_id, 0 AS depth FROM regions WHERE id = $1
      UNION ALL
      SELECT r.id, r.parent_region_id, a.depth + 1
      FROM regions r JOIN ancestors a ON r.id = a.parent_region_id
    )
    SELECT a.id,
      (SELECT array_agg(rm.division_id) FROM region_members rm WHERE rm.region_id = a.id) AS division_ids
    FROM ancestors a
    ORDER BY a.depth
  `, [regionId]);

  // Find the nearest ancestor (excluding self) that has assigned divisions
  let scopeDivisionIds: number[] = [];
  for (const row of ancestorResult.rows) {
    if ((row.id as number) === regionId) continue;
    const ids = row.division_ids as number[] | null;
    if (ids && ids.length > 0) {
      scopeDivisionIds = ids;
      break;
    }
  }

  // 4. Find candidate GADM divisions within scope via spatial intersection
  // Include GADM depth (distance from scope root) and parent_id for hierarchy navigation
  const scopeRootIds = new Set(scopeDivisionIds);

  let candidateQuery: string;
  let candidateParams: unknown[];

  if (scopeDivisionIds.length > 0) {
    candidateQuery = `
      WITH RECURSIVE scope_descendants AS (
        SELECT id, parent_id, 0 AS gadm_depth FROM administrative_divisions WHERE id = ANY($2)
        UNION ALL
        SELECT ad.id, ad.parent_id, sd.gadm_depth + 1
        FROM administrative_divisions ad
        JOIN scope_descendants sd ON ad.parent_id = sd.id
      ),
      candidates AS (
        SELECT ad.id, ad.name, ad.parent_id, sd.gadm_depth
        FROM administrative_divisions ad
        JOIN scope_descendants sd ON ad.id = sd.id
        WHERE ad.geom_simplified_medium IS NOT NULL
          AND ST_Intersects(
            ad.geom_simplified_medium,
            (SELECT geom FROM wikidata_geoshapes WHERE wikidata_id = $1 AND not_available = FALSE)
          )
      )
      SELECT c.id, c.name, c.parent_id, c.gadm_depth,
        (WITH RECURSIVE div_ancestors AS (
          SELECT c.id AS aid, c.name AS aname, c.parent_id AS apid
          UNION ALL
          SELECT d.id, d.name, d.parent_id
          FROM administrative_divisions d JOIN div_ancestors da ON d.id = da.apid
        )
        SELECT string_agg(aname, ' > ' ORDER BY aid) FROM div_ancestors) AS path
      FROM candidates c
    `;
    candidateParams = [wikidataId, scopeDivisionIds];
  } else {
    candidateQuery = `
      WITH candidates AS (
        SELECT ad.id, ad.name, ad.parent_id, 0 AS gadm_depth
        FROM administrative_divisions ad
        WHERE ad.geom_simplified_medium IS NOT NULL
          AND ST_Intersects(
            ad.geom_simplified_medium,
            (SELECT geom FROM wikidata_geoshapes WHERE wikidata_id = $1 AND not_available = FALSE)
          )
        LIMIT 200
      )
      SELECT c.id, c.name, c.parent_id, c.gadm_depth,
        (WITH RECURSIVE div_ancestors AS (
          SELECT c.id AS aid, c.name AS aname, c.parent_id AS apid
          UNION ALL
          SELECT d.id, d.name, d.parent_id
          FROM administrative_divisions d JOIN div_ancestors da ON d.id = da.apid
        )
        SELECT string_agg(aname, ' > ' ORDER BY aid) FROM div_ancestors) AS path
      FROM candidates c
    `;
    candidateParams = [wikidataId];
  }

  const candidateResult = await pool.query(candidateQuery, candidateParams);

  if (candidateResult.rows.length === 0) {
    console.log(`[Geoshape Match] No spatial candidates for region ${regionId} (${wikidataId})`);
    return { found: 0, suggestions: [] };
  }

  console.log(`[Geoshape Match] Found ${candidateResult.rows.length} spatial candidates for region ${regionId} (${wikidataId})`);

  // 5. Load already-rejected, already-suggested, and already-assigned division IDs
  const [rejectedResult, existingResult, assignedResult] = await Promise.all([
    pool.query(
      `SELECT division_id FROM region_match_suggestions WHERE region_id = $1 AND rejected = true`,
      [regionId],
    ),
    pool.query(
      `SELECT division_id FROM region_match_suggestions WHERE region_id = $1 AND rejected = false`,
      [regionId],
    ),
    pool.query(
      `SELECT division_id FROM region_members WHERE region_id = $1`,
      [regionId],
    ),
  ]);
  const rejectedIds = new Set<number>(rejectedResult.rows.map(r => r.division_id as number));
  const existingIds = new Set<number>(existingResult.rows.map(r => r.division_id as number));
  const assignedIds = new Set<number>(assignedResult.rows.map(r => r.division_id as number));

  // 6. Compute coverage (intersection_area / wiki_area) for each candidate in batch
  const candidateIds = candidateResult.rows
    .map(r => r.id as number)
    .filter(id => !rejectedIds.has(id) && !existingIds.has(id) && !assignedIds.has(id));

  if (candidateIds.length === 0) {
    console.log(`[Geoshape Match] All candidates already handled for region ${regionId}`);
    return { found: 0, suggestions: [] };
  }

  // Batch coverage query: for each candidate, compute what fraction of the wiki shape it covers
  const coverageResult = await pool.query(`
    WITH wiki AS (
      SELECT ST_ForcePolygonCCW(geom) AS geom
      FROM wikidata_geoshapes
      WHERE wikidata_id = $1 AND not_available = FALSE
    ),
    wiki_area AS (
      SELECT safe_geo_area(geom) AS area FROM wiki
    )
    SELECT ad.id AS division_id,
      safe_geo_area(
        ST_ForcePolygonCCW(ST_CollectionExtract(
          ST_MakeValid(ST_Intersection(w.geom, ad.geom_simplified_medium)), 3
        ))
      ) / NULLIF(wa.area, 0) AS coverage,
      safe_geo_area(
        ST_ForcePolygonCCW(ST_CollectionExtract(
          ST_MakeValid(ST_Intersection(w.geom, ad.geom_simplified_medium)), 3
        ))
      ) AS intersection_area,
      safe_geo_area(ad.geom_simplified_medium) AS gadm_area
    FROM administrative_divisions ad, wiki w, wiki_area wa
    WHERE ad.id = ANY($2)
      AND ad.geom_simplified_medium IS NOT NULL
  `, [wikidataId, candidateIds]);

  // Build coverage map
  const coverageMap = new Map<number, CoverageEntry>();
  for (const row of coverageResult.rows) {
    const coverage = row.coverage as number | null;
    if (coverage != null && coverage > 0.01) { // Filter tiny overlaps (< 1%)
      coverageMap.set(row.division_id as number, {
        coverage,
        intersectionArea: (row.intersection_area as number | null) ?? 0,
        gadmArea: (row.gadm_area as number | null) ?? 0,
      });
    }
  }

  if (coverageMap.size === 0) {
    console.log(`[Geoshape Match] No candidates with significant coverage for region ${regionId}`);
    return { found: 0, suggestions: [] };
  }

  // Compute wiki geoshape area for refinement precision checks
  const wikiAreaResult = await pool.query(`
    SELECT safe_geo_area(ST_ForcePolygonCCW(geom)) AS area
    FROM wikidata_geoshapes
    WHERE wikidata_id = $1 AND not_available = FALSE
  `, [wikidataId]);
  const wikiArea = (wikiAreaResult.rows[0]?.area as number) ?? 0;

  // 7. Build hierarchy-aware covering set
  const candidateInfoMap = new Map<number, CandidateInfo>();
  for (const row of candidateResult.rows) {
    const id = row.id as number;
    const entry = coverageMap.get(id);
    if (!entry) continue;
    candidateInfoMap.set(id, {
      id,
      name: row.name as string,
      path: row.path as string,
      parentId: row.parent_id as number | null,
      gadmDepth: row.gadm_depth as number,
      coverage: entry.coverage,
      intersectionArea: entry.intersectionArea,
      gadmArea: entry.gadmArea,
    });
  }

  // Sort by GADM depth ASC (shallowest first), then by coverage DESC
  const sortedCandidates = [...candidateInfoMap.values()]
    .filter(c => !scopeRootIds.has(c.id)) // Exclude scope roots (already assigned to ancestor)
    .sort((a, b) => a.gadmDepth - b.gadmDepth || b.coverage - a.coverage);

  // Greedy covering set: pick shallowest divisions, skip if any ancestor already selected
  const selectedIds = new Set<number>();
  const coveringSet: CandidateInfo[] = [];

  for (const candidate of sortedCandidates) {
    // Check if any ancestor of this candidate is already in the covering set
    let ancestorSelected = false;
    let walkId: number | null = candidate.parentId;
    while (walkId != null) {
      if (selectedIds.has(walkId)) {
        ancestorSelected = true;
        break;
      }
      const parent = candidateInfoMap.get(walkId);
      walkId = parent?.parentId ?? null;
      if (!parent) break;
    }

    if (!ancestorSelected) {
      selectedIds.add(candidate.id);
      coveringSet.push(candidate);
    }
  }

  if (coveringSet.length === 0) {
    console.log(`[Geoshape Match] No covering set candidates for region ${regionId}`);
    return { found: 0, suggestions: [] };
  }

  // 7b. Refine covering set: drill down imprecise divisions into their children
  const refinedCoveringSet = await refineCoveringSet(coveringSet, wikidataId, wikiArea);

  if (refinedCoveringSet.length === 0) {
    console.log(`[Geoshape Match] No refined covering set candidates for region ${regionId}`);
    return { found: 0, suggestions: [] };
  }

  // 8. Compute total coverage of the covering set (union of selected / wiki area)
  const selectedDivisionIds = refinedCoveringSet.map(c => c.id);
  const totalCoverageResult = await pool.query(`
    WITH wiki AS (
      SELECT ST_ForcePolygonCCW(geom) AS geom
      FROM wikidata_geoshapes
      WHERE wikidata_id = $1 AND not_available = FALSE
    ),
    selected_union AS (
      SELECT ST_ForcePolygonCCW(ST_CollectionExtract(
        ST_MakeValid(ST_Union(ad.geom_simplified_medium)), 3
      )) AS geom
      FROM administrative_divisions ad
      WHERE ad.id = ANY($2) AND ad.geom_simplified_medium IS NOT NULL
    )
    SELECT
      safe_geo_area(
        ST_ForcePolygonCCW(ST_CollectionExtract(
          ST_MakeValid(ST_Intersection(w.geom, su.geom)), 3
        ))
      ) / NULLIF(safe_geo_area(w.geom), 0) AS total_coverage
    FROM wiki w, selected_union su
  `, [wikidataId, selectedDivisionIds]);

  const totalCoverage = totalCoverageResult.rows[0]?.total_coverage as number | null;
  const roundedTotalCoverage = totalCoverage != null ? Math.round(totalCoverage * 1000) / 1000 : undefined;

  // 9. Write suggestions with per-division coverage as geo_similarity
  const newStatus = !isLeaf ? 'suggested' : 'needs_review';
  const suggestions: Array<{ divisionId: number; name: string; path: string; score: number }> = [];

  await pool.query(
    `UPDATE region_import_state SET match_status = $1 WHERE region_id = $2`,
    [newStatus, regionId],
  );

  for (const c of refinedCoveringSet) {
    const score = Math.round(c.coverage * 1000); // Score based on coverage of wiki shape
    // For covering sets, geo_similarity = per-division coverage of the wiki shape.
    // Using IoU here would be misleading: each division's IoU inflates via the
    // sqrt(rev_coverage) penalty, so 4 divisions at ~25% coverage each would
    // show ~50% IoU each (summing to ~200%), instead of ~25% each (summing to ~100%).
    const geoSimilarity = Math.round(c.coverage * 1000) / 1000;

    suggestions.push({
      divisionId: c.id,
      name: c.name,
      path: c.path,
      score,
    });

    await pool.query(
      `INSERT INTO region_match_suggestions (region_id, division_id, name, path, score, geo_similarity)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [regionId, c.id, c.name, c.path, score, geoSimilarity],
    );
  }

  // Sort suggestions by coverage descending for display
  suggestions.sort((a, b) => b.score - a.score);

  console.log(`[Geoshape Match] Covering set for region ${regionId}: ${suggestions.map(s => `${s.name} (${(s.score / 10).toFixed(1)}%)`).join(', ')} — total coverage: ${roundedTotalCoverage != null ? (roundedTotalCoverage * 100).toFixed(1) : '?'}%`);
  return { found: suggestions.length, suggestions, totalCoverage: roundedTotalCoverage };
}

/**
 * Compute geo similarity for a region's suggestions.
 * Fetches/caches the Wikidata geoshape, then computes IoU for each suggestion.
 * Updates region_import_state.geo_available and region_match_suggestions.geo_similarity.
 *
 * Auto-accept: if exactly one suggestion has IoU = 1.0, auto-match it.
 * Auto-reject: suggestions with IoU = 0.0 are marked as rejected.
 */
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

  const available = await getOrFetchGeoshape(wikidataId);
  await client.query(
    'UPDATE region_import_state SET geo_available = $1 WHERE region_id = $2',
    [available, regionId],
  );

  if (!available) return;

  // Compute IoU for each suggestion
  const scores: Array<{ divisionId: number; iou: number }> = [];
  for (const suggestion of suggestions) {
    try {
      const iou = await computeIoU(wikidataId, suggestion.divisionId);
      if (iou != null) {
        scores.push({ divisionId: suggestion.divisionId, iou });
        await client.query(
          `UPDATE region_match_suggestions SET geo_similarity = $1
           WHERE region_id = $2 AND division_id = $3`,
          [iou, regionId, suggestion.divisionId],
        );
      }
    } catch (err) {
      console.warn(`[GeoSim] IoU failed for region ${regionId}, division ${suggestion.divisionId}:`, err instanceof Error ? err.message : err);
    }
  }

  // Auto-reject suggestions with strictly zero overlap (no geographic intersection at all).
  // Exception: keep zero-overlap suggestions that share the same GADM division name
  // as a suggestion with non-zero overlap. This handles multi-territory countries
  // (e.g., Chile has GADM divisions in South America + other continents).
  const zeroScores = scores.filter(s => s.iou === 0);
  if (zeroScores.length > 0) {
    const nonZeroDivIds = scores.filter(s => s.iou > 0).map(s => s.divisionId);
    const allDivIds = [...nonZeroDivIds, ...zeroScores.map(s => s.divisionId)];
    const namesResult = await client.query(
      `SELECT id, LOWER(name) AS name FROM administrative_divisions WHERE id = ANY($1)`,
      [allDivIds],
    );
    const nameById = new Map<number, string>();
    for (const row of namesResult.rows) {
      nameById.set(row.id as number, row.name as string);
    }
    const nonZeroNames = new Set(nonZeroDivIds.map(id => nameById.get(id)).filter(Boolean));

    for (const s of zeroScores) {
      const name = nameById.get(s.divisionId);
      // Keep if same name as a non-zero suggestion (multi-territory country)
      if (name && nonZeroNames.has(name)) {
        continue;
      }
      await client.query(
        `UPDATE region_match_suggestions SET rejected = TRUE
         WHERE region_id = $1 AND division_id = $2`,
        [regionId, s.divisionId],
      );
    }
  }

  // Auto-matched regions with zero geo overlap: revoke the auto-match.
  // This catches bad text matches (e.g., UK→Guernsey→Herm matching a French commune).
  // Keeps the suggestion visible (un-rejected) for admin review.
  if (scores.length > 0 && scores.every(s => s.iou === 0)) {
    const statusResult = await client.query(
      'SELECT match_status FROM region_import_state WHERE region_id = $1',
      [regionId],
    );
    if (statusResult.rows[0]?.match_status === 'auto_matched') {
      // Un-reject suggestions so admin can review them
      await client.query(
        `UPDATE region_match_suggestions SET rejected = FALSE WHERE region_id = $1`,
        [regionId],
      );
      // Remove the auto-assigned division
      await client.query('DELETE FROM region_members WHERE region_id = $1', [regionId]);
      // Set to needs_review for admin attention
      await client.query(
        `UPDATE region_import_state SET match_status = 'needs_review' WHERE region_id = $1`,
        [regionId],
      );
      console.log(`[GeoSim] Revoked auto-match for region ${regionId} (zero geo overlap)`);
      return;
    }
  }

  // Auto-accept: if exactly one suggestion displays as 100%, auto-match it
  const perfectScores = scores.filter(s => Math.round(s.iou * 100) >= 100);
  if (perfectScores.length === 1) {
    const bestDiv = perfectScores[0].divisionId;
    await client.query(
      `INSERT INTO region_members (region_id, division_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [regionId, bestDiv],
    );
    await client.query(
      `UPDATE region_import_state SET match_status = 'auto_matched' WHERE region_id = $1`,
      [regionId],
    );
    // Reject remaining non-perfect suggestions
    await client.query(
      `UPDATE region_match_suggestions SET rejected = TRUE
       WHERE region_id = $1 AND division_id != $2 AND rejected = FALSE`,
      [regionId, bestDiv],
    );
    console.log(`[GeoSim] Auto-matched region ${regionId} → division ${bestDiv} (100% IoU)`);
  }

  // If all suggestions ended up rejected (and no auto-accept), update status to no_candidates
  if (perfectScores.length !== 1) {
    const remaining = await client.query(
      `SELECT COUNT(*) FROM region_match_suggestions WHERE region_id = $1 AND rejected = FALSE`,
      [regionId],
    );
    if (parseInt(remaining.rows[0].count as string) === 0) {
      await client.query(
        `UPDATE region_import_state SET match_status = 'no_candidates' WHERE region_id = $1`,
        [regionId],
      );
      console.log(`[GeoSim] All suggestions rejected for region ${regionId}, set to no_candidates`);
    }
  }
}
