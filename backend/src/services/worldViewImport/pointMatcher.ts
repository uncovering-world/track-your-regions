/**
 * Point-based region matcher.
 *
 * Fetches Wikivoyage page wikitext, parses {{marker}} templates for POI
 * coordinates, resolves missing coords via Wikidata P625, then finds GADM
 * divisions containing those points via ST_Contains.
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

interface WikidataEntities {
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
}

async function fetchWikidataP625Batch(qids: string[]): Promise<WikidataEntities | null> {
  const url = new URL(WIKIDATA_API);
  url.searchParams.set('action', 'wbgetentities');
  url.searchParams.set('ids', qids.join('|'));
  url.searchParams.set('props', 'claims');
  url.searchParams.set('format', 'json');

  const resp = await fetch(url.toString(), {
    headers: { 'User-Agent': USER_AGENT },
    signal: AbortSignal.timeout(30000),
  });
  if (!resp.ok) {
    console.warn(`[PointMatcher] Wikidata API HTTP ${resp.status}`);
    return null;
  }
  return await resp.json() as WikidataEntities;
}

function extractCoordsFromBatch(
  batch: ParsedMarker[],
  data: WikidataEntities,
  resolved: ResolvedPoint[],
): void {
  if (!data.entities) return;
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

  for (let i = 0; i < needsWikidata.length; i += 50) {
    const batch = needsWikidata.slice(i, i + 50);
    try {
      const data = await fetchWikidataP625Batch(batch.map(m => m.wikidataId!));
      if (data) extractCoordsFromBatch(batch, data, resolved);
    } catch (err) {
      console.warn(`[PointMatcher] Failed to fetch Wikidata P625 batch:`, err instanceof Error ? err.message : err);
    }
  }

  return resolved;
}

interface RegionImportInfo {
  sourceUrl?: string;
  isLeaf?: boolean;
  parentRegionId?: number | null;
}

interface DivisionConflict {
  type: 'direct' | 'split';
  donorRegionId: number;
  donorRegionName: string;
  donorDivisionId: number;
  donorDivisionName: string;
}

interface CandidateDivision {
  id: number;
  name: string;
  parentId: number | null;
  gadmDepth: number;
  path: string;
}

interface ScopeWalkResult {
  scopeDivisionIds: number[];
  scopeAncestorName?: string;
  nextScope?: { ancestorId: number; ancestorName: string };
}

async function loadRegionImportInfo(
  worldViewId: number,
  regionId: number,
): Promise<RegionImportInfo> {
  const regionResult = await pool.query(
    `SELECT ris.source_url, r.is_leaf, r.parent_region_id
     FROM region_import_state ris
     JOIN regions r ON r.id = ris.region_id
     WHERE ris.region_id = $1 AND r.world_view_id = $2`,
    [regionId, worldViewId],
  );
  return {
    sourceUrl: regionResult.rows[0]?.source_url as string | undefined,
    isLeaf: regionResult.rows[0]?.is_leaf as boolean | undefined,
    parentRegionId: regionResult.rows[0]?.parent_region_id as number | null | undefined,
  };
}

async function fetchWikitextForPage(pageTitle: string): Promise<string> {
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
      return '';
    }
    const data = await resp.json() as { parse?: { wikitext?: { '*': string } } };
    return data.parse?.wikitext?.['*'] ?? '';
  } catch (err) {
    console.warn(
      `[PointMatcher] Failed to fetch wikitext for "${pageTitle}":`,
      err instanceof Error ? err.message : err,
    );
    return '';
  }
}

async function fetchSiblingDivisionIds(
  regionId: number,
  parentRegionId: number | null | undefined,
): Promise<Set<number>> {
  if (parentRegionId == null) return new Set<number>();
  const siblingResult = await pool.query(
    `SELECT rm.division_id
     FROM region_members rm
     JOIN regions r ON r.id = rm.region_id
     WHERE r.parent_region_id = $1 AND r.id != $2`,
    [parentRegionId, regionId],
  );
  return new Set(siblingResult.rows.map(r => r.division_id as number));
}

interface AncestorRow {
  id: number;
  name: string;
  ids: number[] | null;
  hasDivisions: boolean;
}

interface ScopeWalkState {
  result: ScopeWalkResult;
  foundScope: boolean;
  passedRequestedAncestor: boolean;
}

/**
 * Mutate `state` for one ancestor row. Returns true to break out of the loop,
 * false to continue.
 */
function applyAncestorRow(
  row: AncestorRow,
  scopeAncestorId: number | undefined,
  state: ScopeWalkState,
): boolean {
  const skipUntilPassed = scopeAncestorId != null;
  if (skipUntilPassed && !state.passedRequestedAncestor) {
    if (row.id === scopeAncestorId) {
      state.passedRequestedAncestor = true;
      if (row.hasDivisions) {
        state.result.scopeDivisionIds = row.ids!;
        state.result.scopeAncestorName = row.name;
        state.foundScope = true;
      }
    }
    return false;
  }

  if (!state.foundScope && row.hasDivisions) {
    state.result.scopeDivisionIds = row.ids!;
    state.result.scopeAncestorName = row.name;
    state.foundScope = true;
    return false;
  }
  if (state.foundScope && row.hasDivisions) {
    state.result.nextScope = { ancestorId: row.id, ancestorName: row.name };
    return true;
  }
  return false;
}

async function walkScopeAncestors(
  regionId: number,
  scopeAncestorId?: number,
): Promise<ScopeWalkResult> {
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

  const state: ScopeWalkState = {
    result: { scopeDivisionIds: [] },
    foundScope: false,
    passedRequestedAncestor: false,
  };

  for (const raw of ancestorResult.rows) {
    const rowId = raw.id as number;
    if (rowId === regionId) continue;
    const ids = raw.division_ids as number[] | null;
    const row: AncestorRow = {
      id: rowId,
      name: raw.name as string,
      ids,
      hasDivisions: ids != null && ids.length > 0,
    };
    if (applyAncestorRow(row, scopeAncestorId, state)) break;
  }

  return state.result;
}

const DIVISION_CONTAINS_SQL_WITH_SCOPE = `
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
    AND ST_Contains(ad.geom_simplified_medium, ST_SetSRID(ST_MakePoint($1, $2), 4326))
`;

const DIVISION_CONTAINS_SQL_NO_SCOPE = `
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
    AND ST_Contains(ad.geom_simplified_medium, ST_SetSRID(ST_MakePoint($1, $2), 4326))
`;

async function collectPointDivisions(
  points: ResolvedPoint[],
  scopeDivisionIds: number[],
): Promise<Map<number, CandidateDivision>> {
  const pointDivisionMap = new Map<number, CandidateDivision>();
  const useScope = scopeDivisionIds.length > 0;

  for (const point of points) {
    const result = await pool.query(
      useScope ? DIVISION_CONTAINS_SQL_WITH_SCOPE : DIVISION_CONTAINS_SQL_NO_SCOPE,
      useScope ? [point.lon, point.lat, scopeDivisionIds] : [point.lon, point.lat],
    );
    for (const row of result.rows) {
      const id = row.id as number;
      if (pointDivisionMap.has(id)) continue;
      pointDivisionMap.set(id, {
        id,
        name: row.name as string,
        parentId: row.parent_id as number | null,
        gadmDepth: row.gadm_depth as number,
        path: row.path as string,
      });
    }
  }
  return pointDivisionMap;
}

async function detectScopeConflicts(
  candidateIds: number[],
  worldViewId: number,
  regionId: number,
): Promise<Map<number, DivisionConflict>> {
  const conflictMap = new Map<number, DivisionConflict>();
  if (candidateIds.length === 0) return conflictMap;

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
  return conflictMap;
}

function buildCoveringSet(
  pointDivisionMap: Map<number, CandidateDivision>,
  scopeRootIds: Set<number>,
  siblingDivisionIds: Set<number>,
): CandidateDivision[] {
  const sortedCandidates = [...pointDivisionMap.values()]
    .filter(c => !scopeRootIds.has(c.id) && !siblingDivisionIds.has(c.id))
    .sort((a, b) => a.gadmDepth - b.gadmDepth);

  const selectedIds = new Set<number>();
  const coveringSet: CandidateDivision[] = [];

  for (const candidate of sortedCandidates) {
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
  return coveringSet;
}

async function loadFilterIds(regionId: number): Promise<{
  rejected: Set<number>;
  existing: Set<number>;
  assigned: Set<number>;
}> {
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
  return {
    rejected: new Set<number>(rejectedResult.rows.map(r => r.division_id as number)),
    existing: new Set<number>(existingResult.rows.map(r => r.division_id as number)),
    assigned: new Set<number>(assignedResult.rows.map(r => r.division_id as number)),
  };
}

async function persistPointSuggestions(
  regionId: number,
  isLeaf: boolean | undefined,
  filteredSet: CandidateDivision[],
  conflictMap: Map<number, DivisionConflict>,
): Promise<Array<{ divisionId: number; name: string; path: string; score: number; conflict?: DivisionConflict }>> {
  const newStatus = !isLeaf ? 'suggested' : 'needs_review';
  const suggestions: Array<{ divisionId: number; name: string; path: string; score: number; conflict?: DivisionConflict }> = [];

  // Run the status update + per-suggestion inserts on a single client inside a
  // transaction so a failure mid-loop can't leave match_status updated while
  // only a partial set of region_match_suggestions is written.
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `UPDATE region_import_state SET match_status = $1 WHERE region_id = $2`,
      [newStatus, regionId],
    );
    for (const c of filteredSet) {
      const score = 500; // Point-based is less precise than geoshape
      const conflict = conflictMap.get(c.id);
      suggestions.push({ divisionId: c.id, name: c.name, path: c.path, score, conflict });
      await client.query(
        `INSERT INTO region_match_suggestions (region_id, division_id, name, path, score, conflict_type, donor_region_id, donor_division_id, donor_region_name, donor_division_name)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          regionId, c.id, c.name, c.path, score,
          conflict?.type ?? null, conflict?.donorRegionId ?? null,
          conflict?.donorDivisionId ?? null, conflict?.donorRegionName ?? null,
          conflict?.donorDivisionName ?? null,
        ],
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
  return suggestions;
}

async function findRegionPoints(sourceUrl: string, regionId: number): Promise<{ pageTitle: string; points: ResolvedPoint[] }> {
  const titleMatch = sourceUrl.replace('https://en.wikivoyage.org/wiki/', '');
  const pageTitle = decodeURIComponent(titleMatch);
  if (!pageTitle) return { pageTitle: '', points: [] };

  const wikitext = await fetchWikitextForPage(pageTitle);
  if (!wikitext) {
    console.log(`[PointMatcher] No wikitext for "${pageTitle}"`);
    return { pageTitle, points: [] };
  }

  let points = await resolveMarkerCoordinates(parseMarkers(wikitext));
  if (points.length === 0) {
    const geo = parseGeoTag(wikitext);
    if (geo) points = [{ name: pageTitle, lat: geo.lat, lon: geo.lon, wikidataId: null }];
  }

  if (points.length === 0) {
    console.log(`[PointMatcher] No points found for region ${regionId} ("${pageTitle}")`);
    return { pageTitle, points: [] };
  }

  console.log(`[PointMatcher] ${points.length} points for region ${regionId} ("${pageTitle}")`);
  await pool.query(
    `UPDATE region_import_state SET marker_points = $1 WHERE region_id = $2`,
    [JSON.stringify(points.map(p => ({ name: p.name, lat: p.lat, lon: p.lon }))), regionId],
  );
  return { pageTitle, points };
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
  suggestions: Array<{ divisionId: number; name: string; path: string; score: number; conflict?: DivisionConflict }>;
  scopeAncestorName?: string;
  nextScope?: { ancestorId: number; ancestorName: string };
}> {
  const { sourceUrl, isLeaf, parentRegionId } = await loadRegionImportInfo(worldViewId, regionId);
  if (!sourceUrl) return { found: 0, suggestions: [] };

  const { points } = await findRegionPoints(sourceUrl, regionId);
  if (points.length === 0) return { found: 0, suggestions: [] };

  const siblingDivisionIds = await fetchSiblingDivisionIds(regionId, parentRegionId);
  const { scopeDivisionIds, scopeAncestorName, nextScope } =
    await walkScopeAncestors(regionId, scopeAncestorId);

  const pointDivisionMap = await collectPointDivisions(points, scopeDivisionIds);

  const conflictMap = scopeAncestorId != null
    ? await detectScopeConflicts([...pointDivisionMap.keys()], worldViewId, regionId)
    : new Map<number, DivisionConflict>();

  if (pointDivisionMap.size === 0) {
    console.log(`[PointMatcher] No GADM divisions contain any points for region ${regionId}`);
    return { found: 0, suggestions: [], scopeAncestorName, nextScope };
  }

  const coveringSet = buildCoveringSet(
    pointDivisionMap,
    new Set(scopeDivisionIds),
    siblingDivisionIds,
  );
  if (coveringSet.length === 0) {
    console.log(`[PointMatcher] No covering set after filtering for region ${regionId}`);
    return { found: 0, suggestions: [], scopeAncestorName, nextScope };
  }

  const { rejected, existing, assigned } = await loadFilterIds(regionId);
  const filteredSet = coveringSet.filter(
    c => !rejected.has(c.id) && !existing.has(c.id) && !assigned.has(c.id),
  );

  if (filteredSet.length === 0) {
    console.log(`[PointMatcher] All candidates already handled for region ${regionId}`);
    return { found: 0, suggestions: [], scopeAncestorName, nextScope };
  }

  const suggestions = await persistPointSuggestions(regionId, isLeaf, filteredSet, conflictMap);
  console.log(`[PointMatcher] ${suggestions.length} suggestions for region ${regionId}: ${suggestions.map(s => s.name).join(', ')}`);
  return { found: suggestions.length, suggestions, scopeAncestorName, nextScope };
}
