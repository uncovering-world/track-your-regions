/**
 * What a colour match is allowed to look at, and the picture it starts from.
 *
 * Before a pixel is read the run has to know the region it is matching, the
 * divisions already assigned to it, the countries it covers and the depth to
 * go to — and it draws the border preview a reviewer sees first, with every
 * division's outline and a dot saying whether it is already held.
 *
 * Split out of `wvImportMatchPipeline.ts`, which had reached the length the
 * lint draws the line at (#933).
 */

import type { SendEvent } from './wvImportMatchContext.js';
import { Response } from 'express';
import sharp from 'sharp';
import { pool } from '../../db/index.js';
import { pictureFetchUrl } from '../../types/urlSafety.js';


/** Load region name + map URL. Writes an error event and ends the response on failure. */
export async function loadRegionAndMap(
  regionId: number, worldViewId: number, sendEvent: SendEvent, res: Response,
): Promise<{ regionName: string; regionMapUrl: string } | null> {
  const regionResult = await pool.query(`
    SELECT r.name, ris.region_map_url
    FROM regions r
    LEFT JOIN region_import_state ris ON ris.region_id = r.id
    WHERE r.id = $1 AND r.world_view_id = $2
  `, [regionId, worldViewId]);

  if (regionResult.rows.length === 0) {
    sendEvent({ type: 'error', message: 'Region not found' });
    res.end();
    return null;
  }
  const regionName = regionResult.rows[0].name as string;
  const regionMapUrl = regionResult.rows[0].region_map_url as string | null;
  if (!regionMapUrl) {
    sendEvent({ type: 'error', message: 'No map image selected for this region' });
    res.end();
    return null;
  }
  // The map is a node of an admin's import tree, stored as any absolute http(s)
  // url (#694). Whether this server will fetch it is known now, so it is asked
  // now, before the division queries and the first debug image are paid for —
  // the same rule `fetchPicture` holds every hop to (#706).
  if (!pictureFetchUrl(regionMapUrl)) {
    sendEvent({ type: 'error', message: `This region's map is not a Wikimedia Commons file the server can fetch: ${regionMapUrl}` });
    res.end();
    return null;
  }
  return { regionName, regionMapUrl };
}

/**
 * Load the set of known-member divisions for a region and partition them into
 * parent-level vs. child-region divisions.
 */
export async function loadKnownDivisionIds(
  regionId: number, worldViewId: number,
): Promise<{ knownDivisionIds: Set<number>; childRegionMemberIds: Set<number> }> {
  const knownMemberResult = await pool.query(`
    SELECT DISTINCT division_id AS id, region_id FROM region_members
    WHERE region_id = $1 OR region_id IN (
      SELECT id FROM regions WHERE parent_region_id = $1 AND world_view_id = $2
    )
  `, [regionId, worldViewId]);

  const knownDivisionIds = new Set<number>();
  const childRegionMemberIds = new Set<number>();
  for (const r of knownMemberResult.rows) {
    knownDivisionIds.add(r.id as number);
    if ((r.region_id as number) !== regionId) {
      childRegionMemberIds.add(r.id as number);
    }
  }
  return { knownDivisionIds, childRegionMemberIds };
}

/**
 * Determine the GADM scope roots ("countryIds") for the region:
 *  - if its own divisions have GADM children, use them,
 *  - else walk up to the common GADM ancestor of child-region divisions.
 */
export async function resolveCountryIds(
  knownDivisionIds: Set<number>, childRegionMemberIds: Set<number>,
): Promise<number[]> {
  const parentDivIds = new Set<number>();
  for (const id of knownDivisionIds) {
    if (!childRegionMemberIds.has(id)) parentDivIds.add(id);
  }

  let countryIds: number[] = [];
  if (parentDivIds.size >= 1) {
    const childrenCheck = await pool.query(
      'SELECT parent_id, COUNT(*)::int AS cnt FROM administrative_divisions WHERE parent_id = ANY($1) GROUP BY parent_id',
      [[...parentDivIds]],
    );
    const withChildren = new Set(childrenCheck.rows.map(r => r.parent_id as number));
    if (withChildren.size > 0) {
      countryIds = [...withChildren];
      const childSummary = childrenCheck.rows.map(r => `${r.parent_id}→${r.cnt} children`).join(', ');
      console.log(`  [CV] Using region division(s) [${countryIds.join(', ')}] as scope roots (${childSummary})`);
    }
  }

  if (countryIds.length === 0 && childRegionMemberIds.size > 0) {
    const sampleDivId = [...childRegionMemberIds][0];
    const parentResult = await pool.query(
      'SELECT parent_id FROM administrative_divisions WHERE id = $1',
      [sampleDivId],
    );
    const gadmParentId = parentResult.rows[0]?.parent_id as number | null;
    if (gadmParentId != null) {
      countryIds = [gadmParentId];
      console.log(`  [CV] Region has no own division — scoping to GADM parent ${gadmParentId} of child divisions`);
    }
  }
  return countryIds;
}

/** Count child regions (used for K-means cap and adaptive depth selection). */
export async function countChildRegions(regionId: number, worldViewId: number): Promise<number> {
  const childCountResult = await pool.query(
    `SELECT COUNT(*) FROM regions WHERE parent_region_id = $1 AND world_view_id = $2`,
    [regionId, worldViewId],
  );
  return parseInt(childCountResult.rows[0].count as string);
}

/** Pick an appropriate GADM descent depth from the scope roots. */
function pickTargetDepth(
  countryIds: number[], expectedRegionCount: number, countryDepth: number,
): number {
  if (countryIds.length > 1 && countryIds.length >= expectedRegionCount) {
    console.log(`  [CV] Using scope roots directly as divisions (${countryIds.length} roots ≥ ${expectedRegionCount} expected regions)`);
    return 0;
  }
  return countryDepth === 0 ? 1 : countryDepth;
}

async function queryDescendantsAtDepth(countryIds: number[], depth: number): Promise<number[]> {
  const res = await pool.query(`
    WITH RECURSIVE descendants AS (
      SELECT id, 0 AS depth FROM administrative_divisions WHERE id = ANY($1)
      UNION ALL
      SELECT ad.id, d.depth + 1 FROM administrative_divisions ad
      JOIN descendants d ON ad.parent_id = d.id
      WHERE d.depth < $2
    )
    SELECT id FROM descendants WHERE depth = $2
  `, [countryIds, depth]);
  return res.rows.map(r => r.id as number);
}

/** Resolve the list of division IDs to consider, unioning GADM walk with known members. */
export async function loadAllDivisionIds(
  countryIds: number[], knownDivisionIds: Set<number>,
  expectedRegionCount: number, countryDepth: number,
): Promise<number[]> {
  let targetDepth = pickTargetDepth(countryIds, expectedRegionCount, countryDepth);
  let walkedIds = await queryDescendantsAtDepth(countryIds, targetDepth);
  if (walkedIds.length <= 1 && targetDepth === countryDepth) {
    targetDepth = countryDepth + 1;
    walkedIds = await queryDescendantsAtDepth(countryIds, targetDepth);
  }
  const allDivisionIdSet = new Set<number>();
  for (const id of walkedIds) allDivisionIdSet.add(id);
  for (const id of knownDivisionIds) allDivisionIdSet.add(id);
  return [...allDivisionIdSet];
}

interface DivPath { id: number; svgPath: string }
interface Centroid { id: number; name: string; cx: number; cy: number; assigned: { regionId: number; regionName: string } | null }

/** Load per-child assignments so the debug preview can color assigned centroids green. */
export async function loadAssignedMap(
  regionId: number, worldViewId: number,
): Promise<Map<number, { regionId: number; regionName: string }>> {
  const assignedResult = await pool.query(`
    SELECT rm.division_id, rm.region_id, r.name AS region_name
    FROM region_members rm
    JOIN regions r ON r.id = rm.region_id
    WHERE rm.region_id IN (
      SELECT id FROM regions WHERE parent_region_id = $1 AND world_view_id = $2
    )
  `, [regionId, worldViewId]);

  const assignedMap = new Map<number, { regionId: number; regionName: string }>();
  for (const r of assignedResult.rows) {
    assignedMap.set(r.division_id as number, {
      regionId: r.region_id as number,
      regionName: r.region_name as string,
    });
  }
  return assignedMap;
}

/** Fetch per-division centroids and annotate with `assigned` region info. */
export async function loadCentroids(
  allDivisionIds: number[],
  assignedMap: Map<number, { regionId: number; regionName: string }>,
): Promise<Centroid[]> {
  const centroidResult = await pool.query(`
    SELECT id, name,
      ST_X(ST_Centroid(geom_simplified_medium)) AS cx,
      ST_Y(ST_Centroid(geom_simplified_medium)) AS cy
    FROM administrative_divisions
    WHERE id = ANY($1) AND geom_simplified_medium IS NOT NULL
  `, [allDivisionIds]);
  return centroidResult.rows.map(r => ({
    id: r.id as number,
    name: r.name as string,
    cx: parseFloat(r.cx as string),
    cy: parseFloat(r.cy as string),
    assigned: assignedMap.get(r.id as number) ?? null,
  }));
}

interface BorderData {
  divPaths: DivPath[];
  countryPath: string;
  externalBorder: string | null;
  internalBorder: string | null;
  cMinX: number; cMinY: number; cMaxX: number; cMaxY: number;
}

/** Fetch per-division SVG paths + union border classification in parallel. */
export async function loadDivPathsAndBorders(allDivisionIds: number[]): Promise<BorderData | null> {
  const [divPathsResult, borderResult] = await Promise.all([
    pool.query(`
      SELECT id, ST_AsSVG(geom_simplified_medium, 0, 4) AS svg_path
      FROM administrative_divisions
      WHERE id = ANY($1) AND geom_simplified_medium IS NOT NULL
    `, [allDivisionIds]),
    pool.query(`
      WITH subset AS (
        SELECT ST_Union(geom_simplified_medium) AS geom
        FROM administrative_divisions
        WHERE id = ANY($1) AND geom_simplified_medium IS NOT NULL
      ),
      all_borders AS (
        SELECT ST_Union(ST_Boundary(geom_simplified_medium)) AS geom
        FROM administrative_divisions
        WHERE id = ANY($1) AND geom_simplified_medium IS NOT NULL
      )
      SELECT
        ST_AsSVG(subset.geom, 0, 4) AS country_path,
        ST_AsSVG(
          ST_Intersection(all_borders.geom, ST_Buffer(ST_Boundary(subset.geom), 0.001)), 0, 4
        ) AS external_border,
        ST_AsSVG(
          ST_Difference(all_borders.geom, ST_Buffer(ST_Boundary(subset.geom), 0.001)), 0, 4
        ) AS internal_border,
        ST_XMin(subset.geom) AS country_min_x,
        ST_YMin(subset.geom) AS country_min_y,
        ST_XMax(subset.geom) AS country_max_x,
        ST_YMax(subset.geom) AS country_max_y
      FROM subset, all_borders
    `, [allDivisionIds]),
  ]);
  if (borderResult.rows.length === 0) return null;

  const divPaths = divPathsResult.rows.map(r => ({
    id: r.id as number,
    svgPath: r.svg_path as string,
  }));
  const row = borderResult.rows[0];
  return {
    divPaths,
    countryPath: row.country_path as string,
    externalBorder: row.external_border as string | null,
    internalBorder: row.internal_border as string | null,
    cMinX: parseFloat(row.country_min_x as string),
    cMinY: parseFloat(row.country_min_y as string),
    cMaxX: parseFloat(row.country_max_x as string),
    cMaxY: parseFloat(row.country_max_y as string),
  };
}

/** Render the "Step 1" debug image (GADM divisions + classified borders) to PNG. */
export async function renderBorderDebugPng(data: BorderData, centroids: Centroid[]): Promise<Buffer> {
  const { divPaths, countryPath, externalBorder, internalBorder, cMinX, cMinY, cMaxX, cMaxY } = data;
  const pad = 0.5;
  const vbX = cMinX - pad;
  const vbY = -(cMaxY + pad);
  const vbW = (cMaxX - cMinX) + 2 * pad;
  const vbH = (cMaxY - cMinY) + 2 * pad;
  const ss = Math.max(vbW, vbH) / 800;

  const divisionShapes = divPaths.map(d =>
    `<path d="${d.svgPath}" fill="#ddeeff" stroke="#90a4ae" stroke-width="${ss}" fill-opacity="0.7"/>`
  ).join('\n');
  const dots = centroids.map(c => {
    const color = c.assigned ? '#2e7d32' : '#e65100';
    return `<circle cx="${c.cx}" cy="${-c.cy}" r="${ss * 4}" fill="${color}" stroke="white" stroke-width="${ss * 0.5}"/>`;
  }).join('\n');
  const externalPath = externalBorder
    ? `<path d="${externalBorder}" fill="none" stroke="#d32f2f" stroke-width="${ss * 3}" stroke-linecap="round"/>`
    : '';
  const internalPath = internalBorder
    ? `<path d="${internalBorder}" fill="none" stroke="#1565c0" stroke-width="${ss * 2}" stroke-dasharray="${ss * 4},${ss * 3}" stroke-linecap="round"/>`
    : '';

  const borderSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vbX} ${vbY} ${vbW} ${vbH}" width="1600">
    <rect x="${vbX}" y="${vbY}" width="${vbW}" height="${vbH}" fill="#f0f2f5"/>
    <path d="${countryPath}" fill="#e8e8e8" stroke="#bbb" stroke-width="${ss * 0.5}"/>
    ${divisionShapes}
    ${externalPath}
    ${internalPath}
    ${dots}
  </svg>`;
  return sharp(Buffer.from(borderSvg))
    .flatten({ background: '#f0f2f5' })
    .png()
    .toBuffer();
}
