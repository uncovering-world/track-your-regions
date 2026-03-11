/**
 * Mapshape Match Controller
 *
 * Extracts {{mapshape}} templates from a Wikivoyage page, fetches their
 * Wikidata geoshapes, and matches them against GADM divisions to produce
 * color-coded region assignments.
 */
import { Response } from 'express';
import type { AuthenticatedRequest } from '../../middleware/auth.js';
import { pool } from '../../db/index.js';
import { parseMapshapes } from '../../services/wikivoyageExtract/parser.js';
import { getOrFetchGeoshape } from '../../services/worldViewImport/geoshapeCache.js';

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
  const match = sourceUrl.match(/\/wiki\/(.+?)(?:#.*)?$/);
  return match ? decodeURIComponent(match[1]) : null;
}

/** Match a mapshape to a child region by name or Wikidata IDs */
function matchRegion(
  title: string,
  wikidataIds: string[],
  childRegions: Array<{ id: number; name: string; wikidataId: string | null }>,
): { id: number; name: string } | null {
  // 1. Wikidata ID match: if any of the mapshape's Wikidata IDs match a child's wikidataId
  const wdIdSet = new Set(wikidataIds);
  for (const child of childRegions) {
    if (child.wikidataId && wdIdSet.has(child.wikidataId)) return child;
  }

  const titleLower = title.toLowerCase();
  // 2. Exact name match
  for (const child of childRegions) {
    if (child.name.toLowerCase() === titleLower) return child;
  }
  // 3. Substring match (either direction)
  for (const child of childRegions) {
    const childLower = child.name.toLowerCase();
    if (titleLower.includes(childLower) || childLower.includes(titleLower)) return child;
  }
  // 4. Word overlap: >50% of words in common
  const titleWords = new Set(titleLower.split(/[\s,&-]+/).filter(w => w.length > 2));
  if (titleWords.size > 0) {
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
    if (bestMatch) return bestMatch;
  }
  return null;
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

  console.log(`[Mapshape Match] Found ${mapshapes.length} mapshapes for region ${regionId} (${pageTitle})`);

  // 4. Get scope: parent region's GADM divisions, walking up if needed
  let scopeDivisionIds: number[] = [];

  const scopeResult = await pool.query(
    'SELECT division_id FROM region_members WHERE region_id = $1',
    [regionId],
  );
  scopeDivisionIds = scopeResult.rows.map(r => r.division_id as number);

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

  if (scopeDivisionIds.length === 0) {
    res.json({ found: false, message: 'No GADM divisions in scope for this region' });
    return;
  }

  // 5. Ensure all mapshape geoshapes are cached
  const allWikidataIds = [...new Set(mapshapes.flatMap(m => m.wikidataIds))];
  for (const wdId of allWikidataIds) {
    await getOrFetchGeoshape(wdId);
  }

  const availableResult = await pool.query(
    'SELECT wikidata_id FROM wikidata_geoshapes WHERE wikidata_id = ANY($1) AND not_available = FALSE',
    [allWikidataIds],
  );
  const availableIds = new Set(availableResult.rows.map(r => r.wikidata_id as string));

  // Build mapshape union geometries (one per mapshape) for coverage queries
  // Store the valid Wikidata IDs per mapshape for reuse
  const mapshapeValidIds: string[][] = mapshapes.map(ms =>
    ms.wikidataIds.filter(id => availableIds.has(id)),
  );

  // 6. Recursive split matching — like CV match but using geometry coverage
  //    Start with immediate children of scope, split deeper only if coverage < 90%
  const SPLIT_THRESHOLD = 0.9;
  const MAX_SPLIT_DEPTH = 4;

  type DivisionAssignment = { divisionId: number; name: string; mapshapeIndex: number; coverage: number; isUnsplittable: boolean };
  const finalAssignments: DivisionAssignment[] = [];

  // Get immediate children of scope divisions as starting candidates
  const level1Result = await pool.query(
    `SELECT id, name FROM administrative_divisions
     WHERE parent_id = ANY($1) AND geom_simplified_medium IS NOT NULL`,
    [scopeDivisionIds],
  );
  let currentDivisions = level1Result.rows.map(r => ({ id: r.id as number, name: r.name as string }));

  // If scope divisions have no children, use the scope divisions themselves
  if (currentDivisions.length === 0) {
    const scopeResult2 = await pool.query(
      'SELECT id, name FROM administrative_divisions WHERE id = ANY($1)',
      [scopeDivisionIds],
    );
    currentDivisions = scopeResult2.rows.map(r => ({ id: r.id as number, name: r.name as string }));
  }

  for (let depth = 0; depth < MAX_SPLIT_DEPTH && currentDivisions.length > 0; depth++) {
    const divIds = currentDivisions.map(d => d.id);
    const divNameMap = new Map(currentDivisions.map(d => [d.id, d.name]));

    // For each division, compute coverage by each mapshape
    type DivCoverage = { divisionId: number; mapshapeIndex: number; coverage: number };
    const coverages: DivCoverage[] = [];

    for (let i = 0; i < mapshapes.length; i++) {
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

    // For each division, find the best-covering mapshape
    const bestByDiv = new Map<number, { mapshapeIndex: number; coverage: number }>();
    for (const c of coverages) {
      const existing = bestByDiv.get(c.divisionId);
      if (!existing || c.coverage > existing.coverage) {
        bestByDiv.set(c.divisionId, { mapshapeIndex: c.mapshapeIndex, coverage: c.coverage });
      }
    }

    // Divisions that need splitting (best coverage < threshold)
    const toSplit: number[] = [];

    for (const div of currentDivisions) {
      const best = bestByDiv.get(div.id);
      if (!best || best.coverage < 0.1) continue; // No significant overlap — skip

      if (best.coverage >= SPLIT_THRESHOLD) {
        // Well-fitting — assign directly
        finalAssignments.push({
          divisionId: div.id,
          name: div.name,
          mapshapeIndex: best.mapshapeIndex,
          coverage: best.coverage,
          isUnsplittable: false,
        });
      } else {
        // Needs splitting
        toSplit.push(div.id);
      }
    }

    if (toSplit.length === 0) break;

    // Get children of divisions that need splitting
    if (depth < MAX_SPLIT_DEPTH - 1) {
      const childrenResult = await pool.query(
        `SELECT id, name FROM administrative_divisions
         WHERE parent_id = ANY($1) AND geom_simplified_medium IS NOT NULL`,
        [toSplit],
      );
      const childDivisions = childrenResult.rows.map(r => ({ id: r.id as number, name: r.name as string }));
      const parentsThatSplit = new Set(childDivisions.length > 0
        ? (await pool.query('SELECT DISTINCT parent_id FROM administrative_divisions WHERE id = ANY($1)', [childDivisions.map(c => c.id)])).rows.map(r => r.parent_id as number)
        : []);

      // Unsplittable divisions: those that need splitting but have no children
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

      currentDivisions = childDivisions;
      console.log(`[Mapshape Match] Depth ${depth + 1}: ${toSplit.length} divisions split → ${childDivisions.length} children`);
    } else {
      // Max depth — assign remaining as unsplittable
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
  }

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

  const mapshapeResults = mapshapes.map((ms, i) => ({
    title: ms.title,
    color: ms.color,
    wikidataIds: ms.wikidataIds,
    matchedRegion: matchRegion(ms.title, ms.wikidataIds, childRegions),
    divisions: (mapshapeDivisions.get(i) ?? []).sort((a, b) => b.coverage - a.coverage),
  }));

  // 10. Build GeoJSON for map preview
  const allDivisionIds = [...divisionBestMap.keys()];
  let featureCollection: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };

  if (allDivisionIds.length > 0) {
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

      const ms = mapshapes[assignment.mapshapeIndex];
      const matchedRegion = matchRegion(ms.title, ms.wikidataIds, childRegions);

      features.push({
        type: 'Feature',
        geometry: JSON.parse(geojson) as GeoJSON.Geometry,
        properties: {
          divisionId: divId,
          name: assignment.name,
          color: ms.color,
          mapshapeTitle: ms.title,
          regionId: matchedRegion?.id ?? null,
          regionName: matchedRegion?.name ?? null,
          coverage: Math.round(assignment.coverage * 1000) / 1000,
          accepted: false,
          isUnsplittable: assignment.isUnsplittable,
          confidence: assignment.coverage,
          clusterId: assignment.mapshapeIndex,
        },
      });
    }

    featureCollection = { type: 'FeatureCollection', features };
  }

  // Build clusterInfos (compatible with CvMatchMap)
  const clusterInfos = mapshapeResults.map((r, i) => ({
    clusterId: i,
    color: r.color,
    regionId: r.matchedRegion?.id ?? null,
    regionName: r.matchedRegion?.name ?? null,
  }));

  // 11. Build Wikivoyage preview — geoshape boundaries per mapshape for side-by-side comparison
  const wvPreviewFeatures: GeoJSON.Feature[] = [];
  for (let i = 0; i < mapshapes.length; i++) {
    const ms = mapshapes[i];
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
      wvPreviewFeatures.push({
        type: 'Feature',
        geometry: JSON.parse(unionResult.rows[0].geojson as string) as GeoJSON.Geometry,
        properties: {
          mapshapeIndex: i,
          title: ms.title,
          color: ms.color,
        },
      });
    }
  }

  const wikivoyagePreview: GeoJSON.FeatureCollection = {
    type: 'FeatureCollection',
    features: wvPreviewFeatures,
  };

  console.log(`[Mapshape Match] Result: ${mapshapeResults.length} mapshapes, ${allDivisionIds.length} divisions matched`);

  res.json({
    found: true,
    mapshapes: mapshapeResults,
    childRegions,
    geoPreview: { featureCollection, clusterInfos },
    wikivoyagePreview,
    stats: {
      totalMapshapes: mapshapes.length,
      matchedMapshapes: mapshapeResults.filter(r => r.matchedRegion).length,
      totalDivisions: allDivisionIds.length,
    },
  });
}
