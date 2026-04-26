/**
 * Mapshape Match Controller
 *
 * Extracts {{mapshape}} templates from a Wikivoyage page, fetches their
 * Wikidata geoshapes, and matches them against GADM divisions to produce
 * color-coded region assignments.
 */

/* eslint-disable security/detect-object-injection -- CV pipeline match controller:
 * bracket accesses index mapshape-result / group / assignment arrays by loop
 * counter or internal integer index. No user-controlled keys in this file. */

import { Response } from 'express';
import type { AuthenticatedRequest } from '../../middleware/auth.js';
import { pool } from '../../db/index.js';
import { parseMapshapes } from '../../services/wikivoyageExtract/parser.js';
import { getOrFetchGeoshape, getOrFetchCommonsMapGeoshape } from '../../services/worldViewImport/geoshapeCache.js';

const WV_API_URL = 'https://en.wikivoyage.org/w/api.php';
const USER_AGENT = 'TrackYourRegions/1.0 (https://github.com/nikolay/track-your-regions)';

/**
 * Fetch raw wikitext for a Wikivoyage page.
 */
async function fetchWikitext(pageTitle: string): Promise<string | null> {
  const url = new URL(WV_API_URL);
  url.searchParams.set('action', 'query');
  url.searchParams.set('titles', pageTitle);
  url.searchParams.set('prop', 'revisions');
  url.searchParams.set('rvprop', 'content');
  url.searchParams.set('rvslots', 'main');
  url.searchParams.set('format', 'json');

  const resp = await fetch(url.toString(), {
    headers: { 'User-Agent': USER_AGENT },
    signal: AbortSignal.timeout(15000),
  });
  if (!resp.ok) return null;

  const data = await resp.json() as Record<string, unknown>;
  const pages = (data['query'] as Record<string, unknown>)?.['pages'] as Record<string, Record<string, unknown>> | undefined;
  if (!pages) return null;

  const page = Object.values(pages)[0];
  if (page['missing'] !== undefined) return null;

  const revisions = page['revisions'] as Array<Record<string, unknown>> | undefined;
  const slots = revisions?.[0]?.['slots'] as Record<string, Record<string, unknown>> | undefined;
  return (slots?.['main']?.['*'] as string) ?? null;
}

/** Extract page title from Wikivoyage URL */
function pageNameFromUrl(sourceUrl: string): string | null {
  const idx = sourceUrl.indexOf('/wiki/');
  if (idx < 0) return null;
  const rest = sourceUrl.slice(idx + 6).split('#')[0];
  return rest ? decodeURIComponent(rest) : null;
}

// =============================================================================
// matchRegion and helpers
// =============================================================================

type ChildRegion = { id: number; name: string; wikidataId: string | null };

function matchRegionByWikidata(
  wikidataIds: string[],
  childRegions: ChildRegion[],
): { id: number; name: string } | null {
  const wdIdSet = new Set(wikidataIds);
  for (const child of childRegions) {
    if (child.wikidataId && wdIdSet.has(child.wikidataId)) return child;
  }
  return null;
}

function matchRegionByExactName(
  titleLower: string,
  childRegions: ChildRegion[],
): { id: number; name: string } | null {
  for (const child of childRegions) {
    if (child.name.toLowerCase() === titleLower) return child;
  }
  return null;
}

function matchRegionBySubstring(
  titleLower: string,
  childRegions: ChildRegion[],
): { id: number; name: string } | null {
  for (const child of childRegions) {
    const childLower = child.name.toLowerCase();
    if (titleLower.includes(childLower) || childLower.includes(titleLower)) return child;
  }
  return null;
}

function matchRegionByWordOverlap(
  titleLower: string,
  childRegions: ChildRegion[],
): { id: number; name: string } | null {
  const titleWords = new Set(titleLower.split(/[\s,&-]+/).filter(w => w.length > 2));
  if (titleWords.size === 0) return null;

  let bestMatch: { id: number; name: string } | null = null;
  let bestOverlap = 0;
  for (const child of childRegions) {
    const childWords = new Set(child.name.toLowerCase().split(/[\s,&-]+/).filter(w => w.length > 2));
    const overlap = [...titleWords].filter(w => childWords.has(w)).length;
    const ratio = overlap / Math.max(titleWords.size, childWords.size);
    if (ratio > 0.5 && overlap > bestOverlap) {
      bestOverlap = overlap;
      bestMatch = child;
    }
  }
  return bestMatch;
}

/** Match a mapshape to a child region by name or Wikidata IDs */
function matchRegion(
  title: string,
  wikidataIds: string[],
  childRegions: ChildRegion[],
): { id: number; name: string } | null {
  const titleLower = title.toLowerCase();
  return matchRegionByWikidata(wikidataIds, childRegions)
    ?? matchRegionByExactName(titleLower, childRegions)
    ?? matchRegionBySubstring(titleLower, childRegions)
    ?? matchRegionByWordOverlap(titleLower, childRegions);
}

// =============================================================================
// mapshapeMatchDivisions helpers
// =============================================================================

type ResolvedMapshape = {
  title: string;
  color: string;
  wikidataIds: string[];
  commonsFile?: string | null;
};

type DivisionAssignment = { divisionId: number; name: string; mapshapeIndex: number; coverage: number; isUnsplittable: boolean };

async function resolveCommonsMapshapes(mapshapes: ResolvedMapshape[]): Promise<void> {
  for (const ms of mapshapes) {
    if (!ms.commonsFile) continue;
    const meta = await getOrFetchCommonsMapGeoshape(ms.commonsFile);
    if (meta.available) {
      if (!ms.title && meta.title) ms.title = meta.title;
      if (!ms.color && meta.color) ms.color = meta.color;
      ms.wikidataIds = [`commons:${ms.commonsFile}`];
    }
  }
}

async function determineScopeDivisionIds(regionId: number): Promise<number[]> {
  const scopeResult = await pool.query(
    'SELECT division_id FROM region_members WHERE region_id = $1',
    [regionId],
  );
  let scopeDivisionIds = scopeResult.rows.map(r => r.division_id as number);

  if (scopeDivisionIds.length === 0) {
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

    for (const row of ancestorResult.rows) {
      if ((row.id as number) === regionId) continue;
      const ids = row.division_ids as number[] | null;
      if (ids && ids.length > 0) {
        scopeDivisionIds = ids;
        break;
      }
    }
  }
  return scopeDivisionIds;
}

async function getAvailableWikidataIds(resolvedMapshapes: ResolvedMapshape[]): Promise<Set<string>> {
  const allWikidataIds = [...new Set(resolvedMapshapes.flatMap(m => m.wikidataIds))];
  for (const wdId of allWikidataIds) {
    if (!wdId.startsWith('commons:')) await getOrFetchGeoshape(wdId);
  }

  const availableResult = await pool.query(
    'SELECT wikidata_id FROM wikidata_geoshapes WHERE wikidata_id = ANY($1) AND not_available = FALSE',
    [allWikidataIds],
  );
  return new Set(availableResult.rows.map(r => r.wikidata_id as string));
}

async function getInitialCandidateDivisions(
  scopeDivisionIds: number[],
): Promise<Array<{ id: number; name: string }>> {
  const level1Result = await pool.query(
    `SELECT id, name FROM administrative_divisions
     WHERE parent_id = ANY($1) AND geom_simplified_medium IS NOT NULL`,
    [scopeDivisionIds],
  );
  let currentDivisions = level1Result.rows.map(r => ({ id: r.id as number, name: r.name as string }));

  if (currentDivisions.length === 0) {
    const scopeResult2 = await pool.query(
      'SELECT id, name FROM administrative_divisions WHERE id = ANY($1)',
      [scopeDivisionIds],
    );
    currentDivisions = scopeResult2.rows.map(r => ({ id: r.id as number, name: r.name as string }));
  }
  return currentDivisions;
}

async function computeBestCoveragePerDivision(
  resolvedMapshapes: ResolvedMapshape[],
  mapshapeValidIds: string[][],
  divIds: number[],
): Promise<Map<number, { mapshapeIndex: number; coverage: number }>> {
  type DivCoverage = { divisionId: number; mapshapeIndex: number; coverage: number };
  const coverages: DivCoverage[] = [];

  for (let i = 0; i < resolvedMapshapes.length; i++) {
    const validIds = mapshapeValidIds[i];
    if (validIds.length === 0) continue;

    const coverageResult = await pool.query(`
      WITH mapshape_geom AS (
        SELECT ST_ForcePolygonCCW(ST_CollectionExtract(
          ST_MakeValid(ST_Union(geom)), 3
        )) AS geom
        FROM wikidata_geoshapes
        WHERE wikidata_id = ANY($1) AND not_available = FALSE
      )
      SELECT ad.id,
        safe_geo_area(
          ST_ForcePolygonCCW(ST_CollectionExtract(
            ST_MakeValid(ST_Intersection(mg.geom, ad.geom_simplified_medium)), 3
          ))
        ) / NULLIF(safe_geo_area(ad.geom_simplified_medium), 0) AS fwd_coverage
      FROM administrative_divisions ad, mapshape_geom mg
      WHERE ad.id = ANY($2)
        AND ad.geom_simplified_medium IS NOT NULL
        AND ST_Intersects(ad.geom_simplified_medium, mg.geom)
    `, [validIds, divIds]);

    for (const row of coverageResult.rows) {
      const coverage = row.fwd_coverage as number | null;
      if (coverage != null && coverage > 0.05) {
        coverages.push({ divisionId: row.id as number, mapshapeIndex: i, coverage });
      }
    }
  }

  const bestByDiv = new Map<number, { mapshapeIndex: number; coverage: number }>();
  for (const c of coverages) {
    const existing = bestByDiv.get(c.divisionId);
    if (!existing || c.coverage > existing.coverage) {
      bestByDiv.set(c.divisionId, { mapshapeIndex: c.mapshapeIndex, coverage: c.coverage });
    }
  }
  return bestByDiv;
}

function classifyDivisionsByCoverage(
  currentDivisions: Array<{ id: number; name: string }>,
  bestByDiv: Map<number, { mapshapeIndex: number; coverage: number }>,
  splitThreshold: number,
  finalAssignments: DivisionAssignment[],
): number[] {
  const toSplit: number[] = [];
  for (const div of currentDivisions) {
    const best = bestByDiv.get(div.id);
    if (!best || best.coverage < 0.1) continue;

    if (best.coverage >= splitThreshold) {
      finalAssignments.push({
        divisionId: div.id,
        name: div.name,
        mapshapeIndex: best.mapshapeIndex,
        coverage: best.coverage,
        isUnsplittable: false,
      });
    } else {
      toSplit.push(div.id);
    }
  }
  return toSplit;
}

async function advanceSplitLevel(
  toSplit: number[],
  divNameMap: Map<number, string>,
  bestByDiv: Map<number, { mapshapeIndex: number; coverage: number }>,
  finalAssignments: DivisionAssignment[],
  depth: number,
): Promise<Array<{ id: number; name: string }>> {
  const childrenResult = await pool.query(
    `SELECT id, name FROM administrative_divisions
     WHERE parent_id = ANY($1) AND geom_simplified_medium IS NOT NULL`,
    [toSplit],
  );
  const childDivisions = childrenResult.rows.map(r => ({ id: r.id as number, name: r.name as string }));
  const parentsThatSplit = new Set(childDivisions.length > 0
    ? (await pool.query('SELECT DISTINCT parent_id FROM administrative_divisions WHERE id = ANY($1)', [childDivisions.map(c => c.id)])).rows.map(r => r.parent_id as number)
    : []);

  for (const divId of toSplit) {
    if (!parentsThatSplit.has(divId)) {
      const best = bestByDiv.get(divId);
      if (best) {
        finalAssignments.push({
          divisionId: divId,
          name: divNameMap.get(divId) ?? `#${divId}`,
          mapshapeIndex: best.mapshapeIndex,
          coverage: best.coverage,
          isUnsplittable: true,
        });
      }
    }
  }

  console.log(`[Mapshape Match] Depth ${depth + 1}: ${toSplit.length} divisions split → ${childDivisions.length} children`);
  return childDivisions;
}

function flushUnsplittableAtMaxDepth(
  toSplit: number[],
  divNameMap: Map<number, string>,
  bestByDiv: Map<number, { mapshapeIndex: number; coverage: number }>,
  finalAssignments: DivisionAssignment[],
): void {
  for (const divId of toSplit) {
    const best = bestByDiv.get(divId);
    if (best) {
      finalAssignments.push({
        divisionId: divId,
        name: divNameMap.get(divId) ?? `#${divId}`,
        mapshapeIndex: best.mapshapeIndex,
        coverage: best.coverage,
        isUnsplittable: true,
      });
    }
  }
}

async function runRecursiveSplitMatching(
  resolvedMapshapes: ResolvedMapshape[],
  mapshapeValidIds: string[][],
  initialDivisions: Array<{ id: number; name: string }>,
): Promise<DivisionAssignment[]> {
  const SPLIT_THRESHOLD = 0.9;
  const MAX_SPLIT_DEPTH = 4;
  const finalAssignments: DivisionAssignment[] = [];

  let currentDivisions = initialDivisions;
  for (let depth = 0; depth < MAX_SPLIT_DEPTH && currentDivisions.length > 0; depth++) {
    const divIds = currentDivisions.map(d => d.id);
    const divNameMap = new Map(currentDivisions.map(d => [d.id, d.name]));

    const bestByDiv = await computeBestCoveragePerDivision(resolvedMapshapes, mapshapeValidIds, divIds);
    const toSplit = classifyDivisionsByCoverage(currentDivisions, bestByDiv, SPLIT_THRESHOLD, finalAssignments);

    if (toSplit.length === 0) break;

    if (depth < MAX_SPLIT_DEPTH - 1) {
      currentDivisions = await advanceSplitLevel(toSplit, divNameMap, bestByDiv, finalAssignments, depth);
    } else {
      flushUnsplittableAtMaxDepth(toSplit, divNameMap, bestByDiv, finalAssignments);
    }
  }
  return finalAssignments;
}

type MapshapeResult = {
  title: string;
  color: string;
  wikidataIds: string[];
  matchedRegion: { id: number; name: string } | null;
  divisions: Array<{ id: number; name: string; coverage: number }>;
};

function groupMapshapesByColor(
  mapshapeResults: MapshapeResult[],
): { grouped: MapshapeResult[]; msIndexToGroupIndex: Map<number, number> } {
  const colorGroupMap = new Map<string, number[]>();
  for (let i = 0; i < mapshapeResults.length; i++) {
    const key = mapshapeResults[i].color.toLowerCase();
    if (!colorGroupMap.has(key)) colorGroupMap.set(key, []);
    colorGroupMap.get(key)!.push(i);
  }

  const msIndexToGroupIndex = new Map<number, number>();
  const grouped: MapshapeResult[] = [];
  let groupIdx = 0;
  for (const [, indices] of colorGroupMap) {
    for (const msIdx of indices) {
      msIndexToGroupIndex.set(msIdx, groupIdx);
    }
    const group = indices.map(i => mapshapeResults[i]);
    const matchedRegion = group.find(ms => ms.matchedRegion)?.matchedRegion ?? null;
    grouped.push({
      title: matchedRegion?.name ?? group.map(ms => ms.title).join(', '),
      color: group[0].color,
      wikidataIds: [...new Set(group.flatMap(ms => ms.wikidataIds))],
      matchedRegion,
      divisions: group.flatMap(ms => ms.divisions).sort((a, b) => b.coverage - a.coverage),
    });
    groupIdx++;
  }
  return { grouped, msIndexToGroupIndex };
}

async function buildDivisionPreview(
  divisionBestMap: Map<number, DivisionAssignment>,
  groupedMapshapes: MapshapeResult[],
  msIndexToGroupIndex: Map<number, number>,
): Promise<GeoJSON.FeatureCollection> {
  const allDivisionIds = [...divisionBestMap.keys()];
  if (allDivisionIds.length === 0) {
    return { type: 'FeatureCollection', features: [] };
  }

  const geoResult = await pool.query(
    `SELECT id, ST_AsGeoJSON(geom_simplified_medium, 5) AS geojson
     FROM administrative_divisions
     WHERE id = ANY($1) AND geom_simplified_medium IS NOT NULL`,
    [allDivisionIds],
  );

  const geoJsonMap = new Map<number, string>();
  for (const row of geoResult.rows) {
    geoJsonMap.set(row.id as number, row.geojson as string);
  }

  const features: GeoJSON.Feature[] = [];
  for (const [divId, assignment] of divisionBestMap) {
    const geojson = geoJsonMap.get(divId);
    if (!geojson) continue;

    const gi = msIndexToGroupIndex.get(assignment.mapshapeIndex) ?? 0;
    const grouped = groupedMapshapes[gi];

    features.push({
      type: 'Feature',
      geometry: JSON.parse(geojson) as GeoJSON.Geometry,
      properties: {
        divisionId: divId,
        name: assignment.name,
        color: grouped.color,
        mapshapeTitle: grouped.title,
        regionId: grouped.matchedRegion?.id ?? null,
        regionName: grouped.matchedRegion?.name ?? null,
        coverage: Math.round(assignment.coverage * 1000) / 1000,
        accepted: false,
        isUnsplittable: assignment.isUnsplittable,
        confidence: assignment.coverage,
        clusterId: gi,
      },
    });
  }

  return { type: 'FeatureCollection', features };
}

async function buildWikivoyagePreview(
  resolvedMapshapes: ResolvedMapshape[],
  availableIds: Set<string>,
  msIndexToGroupIndex: Map<number, number>,
): Promise<GeoJSON.FeatureCollection> {
  const features: GeoJSON.Feature[] = [];
  for (let i = 0; i < resolvedMapshapes.length; i++) {
    const ms = resolvedMapshapes[i];
    const validIds = ms.wikidataIds.filter(id => availableIds.has(id));
    if (validIds.length === 0) continue;

    const unionResult = await pool.query(`
      SELECT ST_AsGeoJSON(
        ST_CollectionExtract(ST_MakeValid(ST_Union(geom)), 3), 5
      ) AS geojson
      FROM wikidata_geoshapes
      WHERE wikidata_id = ANY($1) AND not_available = FALSE
    `, [validIds]);

    if (unionResult.rows.length > 0 && unionResult.rows[0].geojson) {
      features.push({
        type: 'Feature',
        geometry: JSON.parse(unionResult.rows[0].geojson as string) as GeoJSON.Geometry,
        properties: {
          mapshapeIndex: msIndexToGroupIndex.get(i) ?? i,
          title: ms.title,
          color: ms.color,
        },
      });
    }
  }
  return { type: 'FeatureCollection', features };
}

/**
 * POST /api/admin/wv-import/matches/:worldViewId/mapshape-match
 *
 * Parses {{mapshape}} templates from a region's Wikivoyage page,
 * resolves Wikidata geoshapes, and finds matching GADM divisions.
 */
export async function mapshapeMatchDivisions(req: AuthenticatedRequest, res: Response): Promise<void> {
  const worldViewId = parseInt(String(req.params.worldViewId));
  const { regionId } = req.body as { regionId: number };

  // 1. Get region info
  const regionResult = await pool.query(
    `SELECT r.name, ris.source_url
     FROM regions r
     JOIN region_import_state ris ON ris.region_id = r.id
     WHERE r.id = $1 AND r.world_view_id = $2`,
    [regionId, worldViewId],
  );

  if (regionResult.rows.length === 0) {
    res.status(404).json({ error: 'Region not found' });
    return;
  }

  const sourceUrl = regionResult.rows[0].source_url as string | null;
  if (!sourceUrl) {
    res.json({ found: false, message: 'Region has no Wikivoyage source URL' });
    return;
  }

  // 2. Fetch wikitext
  const pageTitle = pageNameFromUrl(sourceUrl);
  if (!pageTitle) {
    res.json({ found: false, message: 'Cannot extract page title from source URL' });
    return;
  }

  const wikitext = await fetchWikitext(pageTitle);
  if (!wikitext) {
    res.json({ found: false, message: 'Could not fetch Wikivoyage page wikitext' });
    return;
  }

  // 3. Parse mapshape templates
  const mapshapes = parseMapshapes(wikitext);
  if (mapshapes.length === 0) {
    res.json({ found: false, message: 'No {{mapshape}} templates found on this page' });
    return;
  }

  // 3b. Process Commons map data mapshapes
  await resolveCommonsMapshapes(mapshapes as ResolvedMapshape[]);

  // Filter out entries that couldn't be resolved
  const resolvedMapshapes = mapshapes.filter(ms => ms.wikidataIds.length > 0 && ms.title);
  if (resolvedMapshapes.length === 0) {
    res.json({ found: false, message: 'Mapshape templates found but no geoshapes could be resolved' });
    return;
  }

  console.log(`[Mapshape Match] Found ${resolvedMapshapes.length} mapshapes for region ${regionId} (${pageTitle})`);

  // 4. Get scope: parent region's GADM divisions, walking up if needed
  const scopeDivisionIds = await determineScopeDivisionIds(regionId);
  if (scopeDivisionIds.length === 0) {
    res.json({ found: false, message: 'No GADM divisions in scope for this region' });
    return;
  }

  // 5. Ensure all mapshape geoshapes are cached and filter to available ones
  const availableIds = await getAvailableWikidataIds(resolvedMapshapes);
  const mapshapeValidIds: string[][] = resolvedMapshapes.map(ms =>
    ms.wikidataIds.filter(id => availableIds.has(id)),
  );

  // 6. Recursive split matching
  const initialDivisions = await getInitialCandidateDivisions(scopeDivisionIds);
  const finalAssignments = await runRecursiveSplitMatching(resolvedMapshapes, mapshapeValidIds, initialDivisions);

  // 7. Build the assignment map (divisionId → assignment)
  const divisionBestMap = new Map<number, DivisionAssignment>();
  for (const a of finalAssignments) {
    divisionBestMap.set(a.divisionId, a);
  }

  // Group divisions by mapshape index
  const mapshapeDivisions = new Map<number, Array<{ id: number; name: string; coverage: number }>>();
  for (const a of finalAssignments) {
    if (!mapshapeDivisions.has(a.mapshapeIndex)) {
      mapshapeDivisions.set(a.mapshapeIndex, []);
    }
    mapshapeDivisions.get(a.mapshapeIndex)!.push({
      id: a.divisionId,
      name: a.name,
      coverage: a.coverage,
    });
  }

  // 9. Get child regions and match mapshape titles to them
  const childrenResult = await pool.query(
    `SELECT r.id, r.name, ris.source_external_id AS wikidata_id
     FROM regions r
     LEFT JOIN region_import_state ris ON ris.region_id = r.id
     WHERE r.parent_region_id = $1 AND r.world_view_id = $2
     ORDER BY r.name`,
    [regionId, worldViewId],
  );
  const childRegions = childrenResult.rows.map(r => ({
    id: r.id as number,
    name: r.name as string,
    wikidataId: (r.wikidata_id as string) ?? null,
  }));

  const mapshapeResults: MapshapeResult[] = resolvedMapshapes.map((ms, i) => ({
    title: ms.title,
    color: ms.color,
    wikidataIds: ms.wikidataIds,
    matchedRegion: matchRegion(ms.title, ms.wikidataIds, childRegions),
    divisions: (mapshapeDivisions.get(i) ?? []).sort((a, b) => b.coverage - a.coverage),
  }));

  // --- Group mapshapes by color into composite regions ---
  const { grouped: groupedMapshapes, msIndexToGroupIndex } = groupMapshapesByColor(mapshapeResults);

  // 10. Build GeoJSON for map preview
  const featureCollection = await buildDivisionPreview(divisionBestMap, groupedMapshapes, msIndexToGroupIndex);
  const allDivisionIds = [...divisionBestMap.keys()];

  // Build clusterInfos (compatible with CvMatchMap)
  const clusterInfos = groupedMapshapes.map((r, i) => ({
    clusterId: i,
    color: r.color,
    regionId: r.matchedRegion?.id ?? null,
    regionName: r.matchedRegion?.name ?? null,
  }));

  // 11. Build Wikivoyage preview
  const wikivoyagePreview = await buildWikivoyagePreview(resolvedMapshapes as ResolvedMapshape[], availableIds, msIndexToGroupIndex);

  console.log(`[Mapshape Match] Result: ${resolvedMapshapes.length} mapshapes → ${groupedMapshapes.length} color groups, ${allDivisionIds.length} divisions matched`);

  res.json({
    found: true,
    mapshapes: groupedMapshapes,
    childRegions,
    geoPreview: { featureCollection, clusterInfos },
    wikivoyagePreview,
    stats: {
      totalMapshapes: groupedMapshapes.length,
      matchedMapshapes: groupedMapshapes.filter(r => r.matchedRegion).length,
      totalDivisions: allDivisionIds.length,
    },
  });
}
