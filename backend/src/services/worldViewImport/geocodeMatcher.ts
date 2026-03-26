/**
 * WorldView Import — Geocode-Based Matching
 *
 * Matches a region by geocoding its name via Nominatim (OpenStreetMap),
 * then finding which GADM division(s) contain the resulting coordinates.
 */

import { pool } from '../../db/index.js';
import type { MatchSuggestion, MatchStatus } from './types.js';

const NOMINATIM_USER_AGENT = 'TrackYourRegions/1.0 (https://github.com/trackyourregions; contact@trackyourregions.com)';
let lastNominatimRequestTime = 0;

/**
 * Match a single region by geocoding its name via Nominatim,
 * then finding which GADM division(s) contain the resulting coordinates.
 */
export async function geocodeMatchRegion(
  worldViewId: number,
  regionId: number,
): Promise<{ found: number; suggestions: MatchSuggestion[]; geocodedName?: string; searchRadiusKm?: number }> {
  // Load region with ancestor path, import state, and suggestions for geo-context
  const result = await pool.query(`
    WITH RECURSIVE ancestors AS (
      SELECT id, name, parent_region_id, id AS leaf_id
      FROM regions WHERE id = $1 AND world_view_id = $2
      UNION ALL
      SELECT r.id, r.name, r.parent_region_id, a.leaf_id
      FROM regions r JOIN ancestors a ON r.id = a.parent_region_id
    )
    SELECT
      r.id, r.name, r.is_leaf,
      (SELECT COALESCE(json_agg(json_build_object(
        'divisionId', rms.division_id,
        'name', rms.name,
        'path', rms.path,
        'score', rms.score
      ) ORDER BY rms.score DESC), '[]'::json)
      FROM region_match_suggestions rms
      WHERE rms.region_id = r.id AND rms.rejected = false) AS suggestions,
      (SELECT COALESCE(json_agg(rms.division_id), '[]'::json)
      FROM region_match_suggestions rms
      WHERE rms.region_id = r.id AND rms.rejected = true) AS rejected_ids,
      (SELECT string_agg(a.name, ' > ' ORDER BY a.id)
       FROM ancestors a WHERE a.leaf_id = r.id AND a.id != r.id) AS ancestor_path
    FROM regions r
    WHERE r.id = $1 AND r.world_view_id = $2
  `, [regionId, worldViewId]);

  if (result.rows.length === 0) {
    throw new Error('Region not found in this world view');
  }

  const row = result.rows[0];
  const regionName = row.name as string;
  const isLeaf = row.is_leaf as boolean;
  const rejectedIds = new Set<number>((row.rejected_ids as number[]) ?? []);
  const existingSuggestions = (row.suggestions as MatchSuggestion[]) ?? [];
  const ancestorPath = (row.ancestor_path as string) ?? '';

  // Load already-assigned member division IDs
  const membersResult = await pool.query(
    `SELECT division_id FROM region_members WHERE region_id = $1`,
    [regionId],
  );
  const assignedIds = new Set<number>(membersResult.rows.map(r => r.division_id as number));

  // Build search queries — try with ancestor context first, fall back to name only
  const ancestors = ancestorPath.split(' > ').filter(Boolean);
  const queries = ancestors.length > 0
    ? [`${regionName}, ${ancestors[ancestors.length - 1]}`, regionName]
    : [regionName];

  let lat: number | undefined;
  let lng: number | undefined;
  let geocodedName: string | undefined;

  for (const searchQuery of queries) {
    // Enforce 1 request/second rate limit (Nominatim policy)
    const now = Date.now();
    const elapsed = now - lastNominatimRequestTime;
    if (elapsed < 1000) {
      await new Promise((resolve) => setTimeout(resolve, 1000 - elapsed));
    }
    lastNominatimRequestTime = Date.now();

    const url = new URL('https://nominatim.openstreetmap.org/search');
    url.searchParams.set('q', searchQuery);
    url.searchParams.set('format', 'json');
    url.searchParams.set('limit', '1');

    const response = await fetch(url.toString(), {
      headers: {
        'User-Agent': NOMINATIM_USER_AGENT,
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`Nominatim request failed: ${response.status}`);
    }

    const data = await response.json() as Array<{
      display_name: string;
      lat: string;
      lon: string;
    }>;

    if (data.length > 0) {
      lat = parseFloat(data[0].lat);
      lng = parseFloat(data[0].lon);
      geocodedName = data[0].display_name;
      console.log(`[Geocode Match] "${regionName}" → query "${searchQuery}" → "${geocodedName}" (${lat}, ${lng})`);
      break;
    }

    console.log(`[Geocode Match] Nominatim returned no results for "${searchQuery}"`);
  }

  if (lat === undefined || lng === undefined) {
    console.log(`[Geocode Match] All queries exhausted for "${regionName}"`);
    return { found: 0, suggestions: [] };
  }

  // Multi-round spatial search: exact containment first, then expanding radius
  // ST_DWithin(geometry, geometry, degrees) uses GIST index AND checks actual geometry (not just bbox)
  const point = `ST_SetSRID(ST_MakePoint($1, $2), 4326)`;
  // Radii in degrees (rough: 1° ≈ 111km at equator)
  const searchRounds = [
    { label: 'exact', expand: 0, radiusKm: 0 },
    { label: '10km', expand: 0.1, radiusKm: 10 },
    { label: '50km', expand: 0.5, radiusKm: 50 },
    { label: '200km', expand: 2.0, radiusKm: 200 },
  ];

  interface SpatialRow { id: number; name: string; depth: string; path: string }
  let spatialRows: SpatialRow[] = [];
  let matchedRadiusKm = 0;

  for (const round of searchRounds) {
    const whereClause = round.expand === 0
      ? `ST_Contains(ad.geom, ${point})`
      : `ST_DWithin(ad.geom, ${point}, ${round.expand})`;

    console.log(`[Geocode Match] Round "${round.label}": searching...`);

    const spatialResult = await pool.query(`
      WITH containing AS (
        SELECT ad.id, ad.name,
          (WITH RECURSIVE anc AS (
            SELECT parent_id FROM administrative_divisions WHERE id = ad.id
            UNION ALL
            SELECT d.parent_id FROM administrative_divisions d JOIN anc ON d.id = anc.parent_id
          ) SELECT COUNT(*) FROM anc WHERE parent_id IS NOT NULL) AS depth,
          (
            WITH RECURSIVE div_ancestors AS (
              SELECT ad.id, ad.name, ad.parent_id
              UNION ALL
              SELECT d.id, d.name, d.parent_id
              FROM administrative_divisions d JOIN div_ancestors da ON d.id = da.parent_id
            )
            SELECT string_agg(name, ' > ' ORDER BY id) FROM div_ancestors
          ) AS path
        FROM administrative_divisions ad
        WHERE ${whereClause}
      )
      SELECT * FROM containing ORDER BY depth DESC
    `, [lng, lat]);

    if (spatialResult.rows.length > 0) {
      spatialRows = spatialResult.rows as SpatialRow[];
      matchedRadiusKm = round.radiusKm;
      console.log(`[Geocode Match] Round "${round.label}": found ${spatialRows.length} division(s):`,
        spatialRows.map(r => `${r.name} (id=${r.id}, depth=${r.depth})`).join(', '));
      break;
    }

    console.log(`[Geocode Match] Round "${round.label}": no results`);
  }

  if (spatialRows.length === 0) {
    console.log(`[Geocode Match] No GADM division found within 200km of (${lat}, ${lng})`);
    return { found: 0, suggestions: [], geocodedName, searchRadiusKm: 200 };
  }

  // Filter out rejected, already-suggested, and already-assigned divisions
  const existingIds = new Set(existingSuggestions.map(s => s.divisionId));
  const newSuggestions: MatchSuggestion[] = [];

  for (const spatialRow of spatialRows) {
    const divId = spatialRow.id;
    if (rejectedIds.has(divId)) {
      console.log(`[Geocode Match]   Skipping ${spatialRow.name} (id=${divId}) — rejected`);
      continue;
    }
    if (assignedIds.has(divId)) {
      console.log(`[Geocode Match]   Skipping ${spatialRow.name} (id=${divId}) — already assigned`);
      continue;
    }
    if (existingIds.has(divId)) {
      console.log(`[Geocode Match]   Skipping ${spatialRow.name} (id=${divId}) — already suggested`);
      continue;
    }
    newSuggestions.push({
      divisionId: divId,
      name: spatialRow.name,
      path: spatialRow.path,
      score: 600, // Geocode-based — needs review
    });
  }

  if (newSuggestions.length === 0) {
    console.log(`[Geocode Match] All ${spatialRows.length} division(s) filtered out`);
    return { found: 0, suggestions: [], geocodedName, searchRadiusKm: matchedRadiusKm };
  }

  // Write new suggestions and update status
  const newStatus: MatchStatus = !isLeaf ? 'suggested' : 'needs_review';

  await pool.query(
    `UPDATE region_import_state SET match_status = $1 WHERE region_id = $2`,
    [newStatus, regionId],
  );

  for (const s of newSuggestions) {
    await pool.query(
      `INSERT INTO region_match_suggestions (region_id, division_id, name, path, score)
       VALUES ($1, $2, $3, $4, $5)`,
      [regionId, s.divisionId, s.name, s.path, s.score],
    );
  }

  console.log(`[Geocode Match] Found ${newSuggestions.length} new GADM division(s) for "${regionName}" (radius=${matchedRadiusKm}km)`);
  return { found: newSuggestions.length, suggestions: newSuggestions, geocodedName, searchRadiusKm: matchedRadiusKm };
}
