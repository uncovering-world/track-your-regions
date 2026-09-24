/**
 * The geometry a candidate division carries, and the two ways of finding more
 * candidates when the ones on offer do not fit.
 *
 * A reviewer asks three things of a region here: draw me what these divisions
 * are, go one level deeper than the match did — with the points a Wikivoyage
 * article marks, where a deeper shape does not exist — and, failing both, look
 * at the pictures and say which divisions a map shows.
 *
 * Its own file beside `wvImportMatchController.ts`, which had reached the
 * length the lint draws the line at (#933); the review's own endpoints stay
 * there and re-export these, so no route moves.
 */

import { Response } from 'express';
import sharp from 'sharp';
import { pool } from '../../db/index.js';
import type { AuthenticatedRequest } from '../../middleware/auth.js';
import { matchDivisionsByVision } from '../../services/ai/openaiService.js';
import {
  type PointInfo,
  generateDivisionsSvg,
  fetchMarkersForDivisions,
} from './wvImportMatchHelpers.js';
import { respond } from '../../api/respond.js';
import type { AreaGeometry } from '../../api/responses/regions.js';
import {
  SplitDeeperResult, UnionGeometryResult, VisionMatchResult, type DivisionPreview, type DivisionShapeFeature,
} from '../../api/responses/wvImportCoverage.js';

/**
 * Return per-division geometries as a FeatureCollection with assignment info.
 * POST /api/admin/wv-import/matches/:worldViewId/union-geometry
 */
export async function getUnionGeometry(req: AuthenticatedRequest, res: Response): Promise<void> {
  const worldViewId = parseInt(String(req.params.worldViewId));
  const { divisionIds, regionId } = req.body as { divisionIds: number[]; regionId?: number };

  // Check which divisions are already assigned to regions in this world view
  const assignedResult = await pool.query(`
    SELECT rm.division_id, r.name AS region_name
    FROM region_members rm
    JOIN regions r ON r.id = rm.region_id
    WHERE rm.division_id = ANY($1) AND r.world_view_id = $2
  `, [divisionIds, worldViewId]);
  const assignedMap = new Map<number, string>();
  for (const row of assignedResult.rows) {
    assignedMap.set(row.division_id as number, row.region_name as string);
  }

  const result = await pool.query(`
    SELECT ad.id, ad.name, ST_AsGeoJSON(
      ST_ForcePolygonCCW(ST_CollectionExtract(
        ST_MakeValid(ad.geom_simplified_medium), 3
      ))
    ) AS geojson
    FROM administrative_divisions ad
    WHERE ad.id = ANY($1) AND ad.geom_simplified_medium IS NOT NULL
  `, [divisionIds]);

  // Fetch markers when regionId is provided
  const { points, divisionsWithPoints } = regionId
    ? await fetchMarkersForDivisions(regionId, divisionIds)
    : { points: [] as PointInfo[], divisionsWithPoints: new Set<number>() };

  const features: DivisionPreview['features'] = [];
  for (const row of result.rows) {
    if (row.geojson) {
      const divId = row.id as number;
      const assignedTo = assignedMap.get(divId);
      features.push({
        type: 'Feature',
        properties: {
          name: row.name as string,
          divisionId: divId,
          hasPoints: divisionsWithPoints.has(divId),
          ...(assignedTo ? { assignedTo } : {}),
        },
        geometry: JSON.parse(row.geojson as string) as AreaGeometry,
      });
    }
  }

  // Add point markers
  for (const p of points) {
    features.push({
      type: 'Feature',
      properties: { name: p.name, isMarker: true },
      geometry: { type: 'Point', coordinates: [p.lon, p.lat] },
    });
  }

  if (features.length === 0) {
    res.status(404).json({ error: 'No geometry found for given divisions' });
    return;
  }
  respond(res, UnionGeometryResult, { geometry: { type: 'FeatureCollection', features } });
}

/**
 * Check whether a geoshape is available for spatial filtering.
 */
async function hasAvailableGeoshape(wikidataId: string): Promise<boolean> {
  const geoCheck = await pool.query(
    `SELECT EXISTS(SELECT 1 FROM wikidata_geoshapes WHERE wikidata_id = $1 AND not_available = FALSE AND geom IS NOT NULL) AS available`,
    [wikidataId],
  );
  return geoCheck.rows[0]?.available as boolean;
}

/**
 * Query the split-deeper results for divisions, either with geoshape-based coverage
 * or without spatial filtering.
 */
async function queryDeeperDivisions(
  divisionIds: number[],
  wikidataId: string,
  hasGeoshape: boolean,
): Promise<{ rows: Array<Record<string, unknown>> }> {
  if (hasGeoshape) {
    return pool.query(`
      WITH wiki AS (
        SELECT ST_ForcePolygonCCW(geom) AS geom
        FROM wikidata_geoshapes
        WHERE wikidata_id = $2 AND not_available = FALSE
      ),
      wiki_area AS (
        SELECT safe_geo_area(geom) AS area FROM wiki
      ),
      parent_children AS (
        SELECT child.id, child.name, child.parent_id,
          safe_geo_area(
            ST_ForcePolygonCCW(ST_CollectionExtract(
              ST_MakeValid(ST_Intersection(w.geom, child.geom_simplified_medium)), 3
            ))
          ) / NULLIF(wa.area, 0) AS coverage
        FROM administrative_divisions child, wiki w, wiki_area wa
        WHERE child.parent_id = ANY($1)
          AND child.geom_simplified_medium IS NOT NULL
          AND ST_Intersects(child.geom_simplified_medium, w.geom)
      ),
      leaf_divisions AS (
        SELECT ad.id, ad.name, ad.parent_id,
          safe_geo_area(
            ST_ForcePolygonCCW(ST_CollectionExtract(
              ST_MakeValid(ST_Intersection(w.geom, ad.geom_simplified_medium)), 3
            ))
          ) / NULLIF(wa.area, 0) AS coverage
        FROM administrative_divisions ad, wiki w, wiki_area wa
        WHERE ad.id = ANY($1)
          AND NOT ad.has_children
          AND ad.geom_simplified_medium IS NOT NULL
      ),
      all_results AS (
        SELECT * FROM parent_children
        UNION ALL
        SELECT * FROM leaf_divisions
      )
      SELECT r.id, r.name, r.parent_id,
        ROUND(r.coverage::numeric, 4) AS coverage,
        (WITH RECURSIVE div_ancestors AS (
          SELECT r.id AS aid, r.name AS aname, r.parent_id AS apid
          UNION ALL
          SELECT d.id, d.name, d.parent_id
          FROM administrative_divisions d JOIN div_ancestors da ON d.id = da.apid
        )
        SELECT string_agg(aname, ' > ' ORDER BY aid) FROM div_ancestors) AS path
      FROM all_results r
      WHERE r.coverage > 0.005
      ORDER BY r.coverage DESC
    `, [divisionIds, wikidataId]);
  }
  return pool.query(`
    WITH parent_children AS (
      SELECT child.id, child.name, child.parent_id, NULL::numeric AS coverage
      FROM administrative_divisions child
      WHERE child.parent_id = ANY($1)
        AND child.geom_simplified_medium IS NOT NULL
    ),
    leaf_divisions AS (
      SELECT ad.id, ad.name, ad.parent_id, NULL::numeric AS coverage
      FROM administrative_divisions ad
      WHERE ad.id = ANY($1)
        AND NOT ad.has_children
    ),
    all_results AS (
      SELECT * FROM parent_children
      UNION ALL
      SELECT * FROM leaf_divisions
    )
    SELECT r.id, r.name, r.parent_id, r.coverage,
      (WITH RECURSIVE div_ancestors AS (
        SELECT r.id AS aid, r.name AS aname, r.parent_id AS apid
        UNION ALL
        SELECT d.id, d.name, d.parent_id
        FROM administrative_divisions d JOIN div_ancestors da ON d.id = da.apid
      )
      SELECT string_agg(aname, ' > ' ORDER BY aid) FROM div_ancestors) AS path
    FROM all_results r
    ORDER BY r.name
  `, [divisionIds]);
}

/**
 * Fetch per-division geometry features and populate the assigned-to map.
 */
async function loadDivisionGeometries(
  resultIds: number[],
  worldViewId: number,
  assignedMap: Map<number, string>,
): Promise<DivisionShapeFeature[]> {
  const features: DivisionShapeFeature[] = [];
  if (resultIds.length === 0) return features;

  const assignedResult = await pool.query(`
    SELECT rm.division_id, r.name AS region_name
    FROM region_members rm
    JOIN regions r ON r.id = rm.region_id
    WHERE rm.division_id = ANY($1) AND r.world_view_id = $2
  `, [resultIds, worldViewId]);
  for (const row of assignedResult.rows) {
    assignedMap.set(row.division_id as number, row.region_name as string);
  }

  const geoResult = await pool.query(`
    SELECT ad.id, ad.name, ST_AsGeoJSON(
      ST_ForcePolygonCCW(ST_CollectionExtract(
        ST_MakeValid(ad.geom_simplified_medium), 3
      ))
    ) AS geojson
    FROM administrative_divisions ad
    WHERE ad.id = ANY($1) AND ad.geom_simplified_medium IS NOT NULL
  `, [resultIds]);
  for (const row of geoResult.rows) {
    if (!row.geojson) continue;
    const divId = row.id as number;
    const assignedTo = assignedMap.get(divId);
    features.push({
      type: 'Feature',
      properties: {
        name: row.name as string,
        divisionId: divId,
        hasPoints: false,
        ...(assignedTo ? { assignedTo } : {}),
      },
      geometry: JSON.parse(row.geojson as string) as AreaGeometry,
    });
  }
  return features;
}

/**
 * Find markers that landed outside the parent scope (e.g. Kythira under Attica)
 * and append those divisions to the result set.
 */
async function appendExternalPointMatches(
  points: PointInfo[],
  resultIds: number[],
  rows: Array<Record<string, unknown>>,
  features: DivisionShapeFeature[],
  assignedMap: Map<number, string>,
  divisionsWithPoints: Set<number>,
  worldViewId: number,
): Promise<void> {
  const externalResult = await pool.query(`
    WITH pts AS (
      SELECT p.lon, p.lat, p.name
      FROM unnest($1::double precision[], $2::double precision[], $3::text[]) AS p(lon, lat, name)
    ),
    matches AS (
      SELECT DISTINCT ON (p.lon, p.lat) p.lon, p.lat, p.name AS pname,
        ad.id AS div_id, ad.name AS div_name, ad.parent_id
      FROM pts p
      JOIN administrative_divisions ad
        ON ad.geom_simplified_medium IS NOT NULL
        AND NOT ad.has_children
        AND ST_DWithin(ad.geom_simplified_medium::geography, ST_SetSRID(ST_MakePoint(p.lon, p.lat), 4326)::geography, 5000)
      ORDER BY p.lon, p.lat, ST_Distance(ad.geom_simplified_medium::geography, ST_SetSRID(ST_MakePoint(p.lon, p.lat), 4326)::geography)
    )
    SELECT m.div_id, m.div_name, m.parent_id,
      (WITH RECURSIVE anc AS (
        SELECT m.div_id AS aid, m.div_name AS aname, m.parent_id AS apid
        UNION ALL
        SELECT d.id, d.name, d.parent_id FROM administrative_divisions d JOIN anc a ON d.id = a.apid
      ) SELECT string_agg(aname, ' > ' ORDER BY aid) FROM anc) AS path
    FROM matches m
    WHERE m.div_id != ALL($4)
  `, [points.map(p => p.lon), points.map(p => p.lat), points.map(p => p.name), resultIds]);

  for (const row of externalResult.rows) {
    const divId = row.div_id as number;
    if (resultIds.includes(divId)) continue; // already in result
    // Check assignment
    const assignCheck = await pool.query(
      `SELECT r.name FROM region_members rm JOIN regions r ON r.id = rm.region_id WHERE rm.division_id = $1 AND r.world_view_id = $2`,
      [divId, worldViewId],
    );
    const assignedTo = assignCheck.rows[0]?.name as string | undefined;
    if (assignedTo) assignedMap.set(divId, assignedTo);

    // Add to result rows
    rows.push({ id: divId, name: row.div_name, parent_id: row.parent_id, coverage: null, path: row.path });
    resultIds.push(divId);
    divisionsWithPoints.add(divId);

    // Fetch geometry
    const geoRow = await pool.query(`
      SELECT ST_AsGeoJSON(ST_ForcePolygonCCW(ST_CollectionExtract(ST_MakeValid(geom_simplified_medium), 3))) AS geojson
      FROM administrative_divisions WHERE id = $1 AND geom_simplified_medium IS NOT NULL
    `, [divId]);
    if (geoRow.rows[0]?.geojson) {
      features.push({
        type: 'Feature',
        properties: {
          name: row.div_name as string,
          divisionId: divId,
          hasPoints: true,
          ...(assignedTo ? { assignedTo } : {}),
        },
        geometry: JSON.parse(geoRow.rows[0].geojson as string) as AreaGeometry,
      });
    }
  }
}

/**
 * Split divisions deeper: replace each given division with its GADM children
 * that intersect the region's geoshape. Returns the new set of division IDs
 * with their coverage and union geometry.
 *
 * POST /api/admin/wv-import/matches/:worldViewId/split-deeper
 */
export async function splitDivisionsDeeper(req: AuthenticatedRequest, res: Response): Promise<void> {
  const worldViewId = parseInt(String(req.params.worldViewId));
  const { divisionIds, wikidataId, regionId, source } = req.body as { divisionIds: number[]; wikidataId: string; regionId: number; source?: 'geoshape' | 'points' | 'image' };

  // When source is 'points', filter children by marker point containment instead of geoshape
  const usePointFilter = source === 'points';

  // Check if geoshape is available for spatial filtering (skip when using point filter)
  const hasGeoshape = usePointFilter ? false : await hasAvailableGeoshape(wikidataId);

  // For each input division, find its children.
  // When geoshape is available, filter by spatial intersection and compute coverage.
  // When not, return all children (no spatial filter).
  // Divisions without children (leaves) are kept as-is.
  const result = await queryDeeperDivisions(divisionIds, wikidataId, hasGeoshape);

  const resultIds = result.rows.map(r => r.id as number);

  // Check which divisions are already assigned to regions in this world view
  const assignedMap = new Map<number, string>(); // divisionId → regionName
  const features = await loadDivisionGeometries(resultIds, worldViewId, assignedMap);

  // Fetch Wikivoyage markers and check which divisions contain points
  const { points, divisionsWithPoints } = await fetchMarkersForDivisions(regionId, resultIds);

  // When filtering by points, also find markers that landed outside the parent scope
  // (e.g., Kythira marker is under Attica, not under Ionian Islands GADM)
  if (usePointFilter && points.length > 0) {
    await appendExternalPointMatches(
      points, resultIds, result.rows, features, assignedMap, divisionsWithPoints, worldViewId,
    );
  }

  // When filtering by points, keep only divisions that contain markers
  const filteredRows = usePointFilter
    ? result.rows.filter(r => divisionsWithPoints.has(r.id as number))
    : result.rows;
  const divisionFeatures = usePointFilter
    ? features.filter(f => divisionsWithPoints.has(f.properties.divisionId))
    : features;

  // Mark features that contain points
  for (const f of divisionFeatures) {
    if (divisionsWithPoints.has(f.properties.divisionId)) {
      f.properties.hasPoints = true;
    }
  }

  // Add point markers as features
  const filteredFeatures: DivisionPreview['features'] = [
    ...divisionFeatures,
    ...points.map(p => ({
      type: 'Feature' as const,
      properties: { name: p.name, isMarker: true as const },
      geometry: { type: 'Point' as const, coordinates: [p.lon, p.lat] as [number, number] },
    })),
  ];

  respond(res, SplitDeeperResult, {
    divisions: filteredRows.map(r => ({
      divisionId: r.id as number,
      name: r.name as string,
      path: r.path as string,
      parentId: r.parent_id as number | null,
      coverage: r.coverage != null ? parseFloat(r.coverage as string) : null,
      hasPoints: divisionsWithPoints.has(r.id as number),
      assignedTo: assignedMap.get(r.id as number) ?? null,
    })),
    geometry: filteredFeatures.length > 0
      ? { type: 'FeatureCollection', features: filteredFeatures }
      : null,
    ...(points.length > 0 ? { points: points.map(p => ({ name: p.name, lat: p.lat, lon: p.lon })) } : {}),
  });
}

/**
 * Use AI vision to suggest which divisions belong to a region based on its map image.
 * POST /api/admin/wv-import/matches/:worldViewId/vision-match
 */
export async function visionMatchDivisions(req: AuthenticatedRequest, res: Response): Promise<void> {
  const worldViewId = parseInt(String(req.params.worldViewId));
  const { divisionIds, regionId, imageUrl } = req.body as { divisionIds: number[]; regionId: number; imageUrl: string };

  // Get the region name
  const regionResult = await pool.query(
    `SELECT name FROM regions WHERE id = $1 AND world_view_id = $2`,
    [regionId, worldViewId],
  );

  if (regionResult.rows.length === 0) {
    res.status(404).json({ error: 'Region not found' });
    return;
  }

  const regionName = regionResult.rows[0].name as string;
  const regionMapUrl = imageUrl;

  // Fetch division SVG paths, centroids, and bounding boxes
  const divResult = await pool.query(`
    SELECT id, name,
      ST_AsSVG(geom_simplified_medium, 0, 2) AS svg_path,
      ST_X(ST_Centroid(geom_simplified_medium)) AS cx,
      ST_Y(ST_Centroid(geom_simplified_medium)) AS cy
    FROM administrative_divisions
    WHERE id = ANY($1) AND geom_simplified_medium IS NOT NULL
  `, [divisionIds]);

  if (divResult.rows.length === 0) {
    res.status(400).json({ error: 'No valid divisions found' });
    return;
  }

  const divisions = divResult.rows.map(r => ({
    id: r.id as number,
    name: r.name as string,
    svgPath: r.svg_path as string,
    cx: parseFloat(r.cx as string),
    cy: parseFloat(r.cy as string),
  }));

  // Generate numbered SVG map of all candidate divisions
  const divisionsSvg = generateDivisionsSvg(divisions);
  // Convert SVG to PNG (OpenAI doesn't accept SVG)
  const pngBuffer = await sharp(Buffer.from(divisionsSvg)).flatten({ background: '#f0f2f5' }).png().toBuffer();
  const pngBase64 = `data:image/png;base64,${pngBuffer.toString('base64')}`;

  // Use a high-res version of the region map image. Use URL+searchParams so an
  // already-parameterised URL (e.g. one already carrying `?width=...`) is
  // updated correctly instead of producing a malformed `?foo=bar?width=1280`.
  const urlObj = new URL(regionMapUrl);
  urlObj.searchParams.set('width', '1280');
  const hiresImageUrl = urlObj.toString();

  const result = await matchDivisionsByVision(regionName, hiresImageUrl, pngBase64, divisions);

  respond(res, VisionMatchResult, {
    suggestedIds: result.suggestedIds,
    rejectedIds: result.rejectedIds,
    unclearIds: result.unclearIds,
    reasoning: result.reasoning,
    cost: result.usage.cost.totalCost,
    debugImages: {
      regionMap: hiresImageUrl,
      divisionsMap: pngBase64,
    },
  });
}
