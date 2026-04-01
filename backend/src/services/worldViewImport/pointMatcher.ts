/**
 * Point-based region matcher.
 *
 * Fetches Wikivoyage page wikitext, parses {{marker}} templates for POI
 * coordinates, resolves missing coords via Wikidata P625, then finds GADM
 * divisions containing those points via ST_DWithin (5km buffer for coastal POIs).
 *
 * Less precise than geoshape matching (score base = 500 vs 1000).
 */

import { pool } from '../../db/index.js';
import { parseMarkers, parseGeoTag } from '../wikivoyageExtract/markerParser.js';
import type { ParsedMarker } from '../wikivoyageExtract/markerParser.js';

const WIKIVOYAGE_API = 'https://en.wikivoyage.org/w/api.php';
const WIKIDATA_API = 'https://www.wikidata.org/w/api.php';
const USER_AGENT = 'TrackYourRegions/1.0 (https://github.com/nikolay/track-your-regions)';

export interface ResolvedPoint {
  name: string;
  lat: number;
  lon: number;
  wikidataId: string | null;
}

/**
 * Resolve coordinates for parsed markers.
 * Markers with explicit lat/lon are used directly.
 * Markers with only a Wikidata ID get their P625 coordinate claim fetched.
 */
export async function resolveMarkerCoordinates(markers: ParsedMarker[]): Promise<ResolvedPoint[]> {
  const resolved: ResolvedPoint[] = [];
  const needsWikidata: ParsedMarker[] = [];

  for (const m of markers) {
    if (m.lat != null && m.lon != null) {
      resolved.push({ name: m.name, lat: m.lat, lon: m.lon, wikidataId: m.wikidataId });
    } else if (m.wikidataId) {
      needsWikidata.push(m);
    }
  }

  // Batch-fetch Wikidata P625 coordinates (max 50 per request)
  for (let i = 0; i < needsWikidata.length; i += 50) {
    const batch = needsWikidata.slice(i, i + 50);
    const ids = batch.map(m => m.wikidataId!).join('|');

    try {
      const url = new URL(WIKIDATA_API);
      url.searchParams.set('action', 'wbgetentities');
      url.searchParams.set('ids', ids);
      url.searchParams.set('props', 'claims');
      url.searchParams.set('format', 'json');

      const resp = await fetch(url.toString(), {
        headers: { 'User-Agent': USER_AGENT },
        signal: AbortSignal.timeout(30000),
      });

      if (!resp.ok) {
        console.warn(`[PointMatcher] Wikidata API HTTP ${resp.status}`);
        continue;
      }

      const data = await resp.json() as {
        entities?: Record<string, {
          claims?: {
            P625?: Array<{
              mainsnak?: {
                datavalue?: {
                  value?: { latitude: number; longitude: number };
                };
              };
            }>;
          };
        }>;
      };

      if (!data.entities) continue;

      for (const m of batch) {
        const entity = data.entities[m.wikidataId!];
        const coord = entity?.claims?.P625?.[0]?.mainsnak?.datavalue?.value;
        if (coord && typeof coord.latitude === 'number' && typeof coord.longitude === 'number') {
          resolved.push({
            name: m.name,
            lat: coord.latitude,
            lon: coord.longitude,
            wikidataId: m.wikidataId,
          });
        }
      }
    } catch (err) {
      console.warn(`[PointMatcher] Failed to fetch Wikidata P625 batch:`, err instanceof Error ? err.message : err);
    }
  }

  return resolved;
}

/**
 * Match a region to GADM divisions using point-in-polygon containment.
 *
 * Fetches the Wikivoyage page, extracts marker/geo coordinates, then finds
 * GADM divisions containing those points. Builds a covering set of the
 * shallowest divisions, excluding sibling-assigned ones.
 */
export async function pointMatchRegion(
  worldViewId: number,
  regionId: number,
  scopeAncestorId?: number,
): Promise<{
  found: number;
  suggestions: Array<{
    divisionId: number; name: string; path: string; score: number;
    conflict?: { type: 'direct' | 'split'; donorRegionId: number; donorRegionName: string; donorDivisionId: number; donorDivisionName: string };
  }>;
  scopeAncestorName?: string;
  nextScope?: { ancestorId: number; ancestorName: string };
}> {
  // 1. Get region info
  const regionResult = await pool.query(
    `SELECT ris.source_url, r.is_leaf, r.parent_region_id
     FROM region_import_state ris
     JOIN regions r ON r.id = ris.region_id
     WHERE ris.region_id = $1 AND r.world_view_id = $2`,
    [regionId, worldViewId],
  );

  const sourceUrl = regionResult.rows[0]?.source_url as string | undefined;
  const isLeaf = regionResult.rows[0]?.is_leaf as boolean | undefined;
  const parentRegionId = regionResult.rows[0]?.parent_region_id as number | null | undefined;

  if (!sourceUrl) {
    return { found: 0, suggestions: [] };
  }

  // 2. Extract page title from source URL
  const titleMatch = sourceUrl.replace('https://en.wikivoyage.org/wiki/', '');
  const pageTitle = decodeURIComponent(titleMatch);

  if (!pageTitle) {
    return { found: 0, suggestions: [] };
  }

  // 3. Fetch wikitext via MediaWiki API
  let wikitext: string;
  try {
    const url = new URL(WIKIVOYAGE_API);
    url.searchParams.set('action', 'parse');
    url.searchParams.set('page', pageTitle);
    url.searchParams.set('prop', 'wikitext');
    url.searchParams.set('format', 'json');

    const resp = await fetch(url.toString(), {
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(30000),
    });

    if (!resp.ok) {
      console.warn(`[PointMatcher] Wikivoyage API HTTP ${resp.status} for "${pageTitle}"`);
      return { found: 0, suggestions: [] };
    }

    const data = await resp.json() as {
      parse?: { wikitext?: { '*': string } };
    };

    wikitext = data.parse?.wikitext?.['*'] ?? '';
    if (!wikitext) {
      console.log(`[PointMatcher] No wikitext for "${pageTitle}"`);
      return { found: 0, suggestions: [] };
    }
  } catch (err) {
    console.warn(`[PointMatcher] Failed to fetch wikitext for "${pageTitle}":`, err instanceof Error ? err.message : err);
    return { found: 0, suggestions: [] };
  }

  // 4. Parse markers and resolve coordinates
  const markers = parseMarkers(wikitext);
  let points = await resolveMarkerCoordinates(markers);

  // 5. Fallback to {{geo}} tag if no markers resolved
  if (points.length === 0) {
    const geo = parseGeoTag(wikitext);
    if (geo) {
      points = [{ name: pageTitle, lat: geo.lat, lon: geo.lon, wikidataId: null }];
    }
  }

  if (points.length === 0) {
    console.log(`[PointMatcher] No points found for region ${regionId} ("${pageTitle}")`);
    return { found: 0, suggestions: [] };
  }

  console.log(`[PointMatcher] ${points.length} points for region ${regionId} ("${pageTitle}")`);

  // 5b. Store resolved marker points for preview
  await pool.query(
    `UPDATE region_import_state SET marker_points = $1 WHERE region_id = $2`,
    [JSON.stringify(points.map(p => ({ name: p.name, lat: p.lat, lon: p.lon }))), regionId],
  );

  // 6. Get sibling-assigned division IDs (divisions assigned to siblings under same parent)
  let siblingDivisionIds = new Set<number>();
  if (parentRegionId != null) {
    const siblingResult = await pool.query(
      `SELECT rm.division_id
       FROM region_members rm
       JOIN regions r ON r.id = rm.region_id
       WHERE r.parent_region_id = $1 AND r.id != $2`,
      [parentRegionId, regionId],
    );
    siblingDivisionIds = new Set(siblingResult.rows.map(r => r.division_id as number));
  }

  // 7. Walk up region tree to find scope ancestor and next scope
  const ancestorResult = await pool.query(`
    WITH RECURSIVE ancestors AS (
      SELECT id, name, parent_region_id, 0 AS depth FROM regions WHERE id = $1
      UNION ALL
      SELECT r.id, r.name, r.parent_region_id, a.depth + 1
      FROM regions r JOIN ancestors a ON r.id = a.parent_region_id
    )
    SELECT a.id, a.name,
      (SELECT array_agg(rm.division_id) FROM region_members rm WHERE rm.region_id = a.id) AS division_ids
    FROM ancestors a
    ORDER BY a.depth
  `, [regionId]);

  let scopeDivisionIds: number[] = [];
  let scopeAncestorName: string | undefined;
  let nextScope: { ancestorId: number; ancestorName: string } | undefined;
  let foundScope = false;
  const skipUntilPassed = scopeAncestorId != null;
  let passedRequestedAncestor = false;

  for (const row of ancestorResult.rows) {
    const rowId = row.id as number;
    const rowName = row.name as string;
    const ids = row.division_ids as number[] | null;
    const hasDivisions = ids != null && ids.length > 0;

    if (rowId === regionId) continue;

    if (skipUntilPassed && !passedRequestedAncestor) {
      if (rowId === scopeAncestorId) {
        passedRequestedAncestor = true;
        if (hasDivisions) {
          scopeDivisionIds = ids;
          scopeAncestorName = rowName;
          foundScope = true;
          continue;
        }
      }
      continue;
    }

    if (!foundScope) {
      if (hasDivisions) {
        scopeDivisionIds = ids;
        scopeAncestorName = rowName;
        foundScope = true;
        continue;
      }
    } else {
      if (hasDivisions) {
        nextScope = { ancestorId: rowId, ancestorName: rowName };
        break;
      }
    }
  }

  // 8. For each point, find containing GADM divisions via ST_Contains
  const pointDivisionMap = new Map<number, { id: number; name: string; parentId: number | null; gadmDepth: number; path: string }>();

  for (const point of points) {
    let containsQuery: string;
    let containsParams: unknown[];

    if (scopeDivisionIds.length > 0) {
      containsQuery = `
        WITH RECURSIVE scope_descendants AS (
          SELECT id, parent_id, 0 AS gadm_depth FROM administrative_divisions WHERE id = ANY($3)
          UNION ALL
          SELECT ad.id, ad.parent_id, sd.gadm_depth + 1
          FROM administrative_divisions ad
          JOIN scope_descendants sd ON ad.parent_id = sd.id
        )
        SELECT ad.id, ad.name, ad.parent_id, sd.gadm_depth,
          (WITH RECURSIVE div_ancestors AS (
            SELECT ad.id AS aid, ad.name AS aname, ad.parent_id AS apid
            UNION ALL
            SELECT d.id, d.name, d.parent_id
            FROM administrative_divisions d JOIN div_ancestors da ON d.id = da.apid
          )
          SELECT string_agg(aname, ' > ' ORDER BY aid) FROM div_ancestors) AS path
        FROM administrative_divisions ad
        JOIN scope_descendants sd ON ad.id = sd.id
        WHERE ad.geom_simplified_medium IS NOT NULL
          AND ST_DWithin(ad.geom_simplified_medium::geography, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography, 5000)
      `;
      containsParams = [point.lon, point.lat, scopeDivisionIds];
    } else {
      containsQuery = `
        SELECT ad.id, ad.name, ad.parent_id, 0 AS gadm_depth,
          (WITH RECURSIVE div_ancestors AS (
            SELECT ad.id AS aid, ad.name AS aname, ad.parent_id AS apid
            UNION ALL
            SELECT d.id, d.name, d.parent_id
            FROM administrative_divisions d JOIN div_ancestors da ON d.id = da.apid
          )
          SELECT string_agg(aname, ' > ' ORDER BY aid) FROM div_ancestors) AS path
        FROM administrative_divisions ad
        WHERE ad.geom_simplified_medium IS NOT NULL
          AND ST_DWithin(ad.geom_simplified_medium::geography, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography, 5000)
      `;
      containsParams = [point.lon, point.lat];
    }

    const result = await pool.query(containsQuery, containsParams);

    for (const row of result.rows) {
      const id = row.id as number;
      if (!pointDivisionMap.has(id)) {
        pointDivisionMap.set(id, {
          id,
          name: row.name as string,
          parentId: row.parent_id as number | null,
          gadmDepth: row.gadm_depth as number,
          path: row.path as string,
        });
      }
    }
  }

  // 8b. Conflict detection for wider scope
  const conflictMap = new Map<number, { type: 'direct' | 'split'; donorRegionId: number; donorRegionName: string; donorDivisionId: number; donorDivisionName: string }>();
  if (scopeAncestorId != null && pointDivisionMap.size > 0) {
    const candidateIds = [...pointDivisionMap.keys()];
    const conflictResult = await pool.query(`
      WITH RECURSIVE candidate_ancestors AS (
        SELECT ad.id AS candidate_id, ad.id AS ancestor_id, ad.name AS ancestor_name, ad.parent_id, 0 AS depth
        FROM administrative_divisions ad
        WHERE ad.id = ANY($1)
        UNION ALL
        SELECT ca.candidate_id, ad.id, ad.name, ad.parent_id, ca.depth + 1
        FROM administrative_divisions ad
        JOIN candidate_ancestors ca ON ad.id = ca.parent_id
      )
      SELECT DISTINCT ON (ca.candidate_id)
        ca.candidate_id,
        ca.ancestor_id AS donor_division_id,
        ca.ancestor_name AS donor_division_name,
        ca.depth,
        rm.region_id AS donor_region_id,
        r.name AS donor_region_name
      FROM candidate_ancestors ca
      JOIN region_members rm ON rm.division_id = ca.ancestor_id
      JOIN regions r ON r.id = rm.region_id AND r.world_view_id = $2
      WHERE rm.region_id != $3
      ORDER BY ca.candidate_id, ca.depth ASC
    `, [candidateIds, worldViewId, regionId]);

    for (const row of conflictResult.rows) {
      const candidateId = row.candidate_id as number;
      const donorDivisionId = row.donor_division_id as number;
      conflictMap.set(candidateId, {
        type: candidateId === donorDivisionId ? 'direct' : 'split',
        donorRegionId: row.donor_region_id as number,
        donorRegionName: row.donor_region_name as string,
        donorDivisionId,
        donorDivisionName: row.donor_division_name as string,
      });
    }
  }

  if (pointDivisionMap.size === 0) {
    console.log(`[PointMatcher] No GADM divisions contain any points for region ${regionId}`);
    return { found: 0, suggestions: [], scopeAncestorName, nextScope };
  }

  // 9. Build covering set: shallowest divisions first, exclude sibling-assigned, skip children of already-selected
  const scopeRootIds = new Set(scopeDivisionIds);
  const sortedCandidates = [...pointDivisionMap.values()]
    .filter(c => !scopeRootIds.has(c.id) && !siblingDivisionIds.has(c.id))
    .sort((a, b) => a.gadmDepth - b.gadmDepth);

  const selectedIds = new Set<number>();
  const coveringSet: Array<{ id: number; name: string; path: string; parentId: number | null }> = [];

  for (const candidate of sortedCandidates) {
    // Check if any ancestor of this candidate is already selected
    let ancestorSelected = false;
    let walkId: number | null = candidate.parentId;
    while (walkId != null) {
      if (selectedIds.has(walkId)) {
        ancestorSelected = true;
        break;
      }
      const parent = pointDivisionMap.get(walkId);
      walkId = parent?.parentId ?? null;
      if (!parent) break;
    }

    if (!ancestorSelected) {
      selectedIds.add(candidate.id);
      coveringSet.push(candidate);
    }
  }

  if (coveringSet.length === 0) {
    console.log(`[PointMatcher] No covering set after filtering for region ${regionId}`);
    return { found: 0, suggestions: [], scopeAncestorName, nextScope };
  }

  // 10. Filter already-rejected/suggested/assigned division IDs (including descendants)
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
      `WITH RECURSIVE assigned_tree AS (
        SELECT division_id AS id FROM region_members WHERE region_id = $1
        UNION ALL
        SELECT ad.id FROM administrative_divisions ad JOIN assigned_tree at ON ad.parent_id = at.id
      )
      SELECT id AS division_id FROM assigned_tree`,
      [regionId],
    ),
  ]);
  const rejectedIds = new Set<number>(rejectedResult.rows.map(r => r.division_id as number));
  const existingIds = new Set<number>(existingResult.rows.map(r => r.division_id as number));
  const assignedIds = new Set<number>(assignedResult.rows.map(r => r.division_id as number));

  const filteredSet = coveringSet.filter(
    c => !rejectedIds.has(c.id) && !existingIds.has(c.id) && !assignedIds.has(c.id),
  );

  if (filteredSet.length === 0) {
    console.log(`[PointMatcher] All candidates already handled for region ${regionId}`);
    return { found: 0, suggestions: [], scopeAncestorName, nextScope };
  }

  // 11. Write suggestions and update status
  const newStatus = !isLeaf ? 'suggested' : 'needs_review';
  const suggestions: Array<{ divisionId: number; name: string; path: string; score: number }> = [];

  await pool.query(
    `UPDATE region_import_state SET match_status = $1 WHERE region_id = $2`,
    [newStatus, regionId],
  );

  for (const c of filteredSet) {
    const score = 500; // Point-based is less precise than geoshape

    suggestions.push({
      divisionId: c.id,
      name: c.name,
      path: c.path,
      score,
    });

    const conflict = conflictMap.get(c.id);
    await pool.query(
      `INSERT INTO region_match_suggestions (region_id, division_id, name, path, score, conflict_type, donor_region_id, donor_division_id, donor_region_name, donor_division_name)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [regionId, c.id, c.name, c.path, score, conflict?.type ?? null, conflict?.donorRegionId ?? null, conflict?.donorDivisionId ?? null, conflict?.donorRegionName ?? null, conflict?.donorDivisionName ?? null],
    );
  }

  const suggestionsWithConflict = suggestions.map(s => ({
    ...s,
    conflict: conflictMap.get(s.divisionId),
  }));

  console.log(`[PointMatcher] ${suggestionsWithConflict.length} suggestions for region ${regionId}: ${suggestionsWithConflict.map(s => s.name).join(', ')}`);
  return { found: suggestionsWithConflict.length, suggestions: suggestionsWithConflict, scopeAncestorName, nextScope };
}
