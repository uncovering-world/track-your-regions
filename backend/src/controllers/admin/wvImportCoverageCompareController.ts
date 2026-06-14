/**
 * WorldView Import Coverage Compare Controller
 *
 * Coverage comparison endpoints: children coverage stats, coverage geometry,
 * gap analysis, and per-child region geometry.
 */

import { Response } from 'express';
import { pool } from '../../db/index.js';
import type { AuthenticatedRequest } from '../../middleware/auth.js';
import { computeMultiDivisionCoverage } from '../../services/worldViewImport/geoshapeCoverage.js';
import { resolveReference, getCoverageBoundaries } from '../../services/worldViewImport/verifyWorkUnit.js';

const CONCURRENCY = 10;

/**
 * Strip a trailing " (…)" suffix from a region name for GADM matching.
 * Uses plain string scanning to avoid regex backtracking risk.
 * Example: "Córdoba (Argentina)" → "Córdoba"
 */
function stripParentheticalSuffix(name: string): string {
  const trimmed = name.trimEnd();
  if (!trimmed.endsWith(')')) return name;
  const openIdx = trimmed.lastIndexOf('(');
  if (openIdx <= 0) return name;
  let end = openIdx;
  while (end > 0 && trimmed.charCodeAt(end - 1) <= 32) end--;
  return trimmed.slice(0, end);
}

interface RegionTopology {
  divisionsByRegion: Map<number, number[]>;
  nameByRegion: Map<number, string>;
  childrenOf: Map<number, number[]>;
  parentOf: Map<number, number | null>;
}

/** Load all regions for a world view and build parent/child/division maps. */
async function loadRegionTopology(worldViewId: number): Promise<RegionTopology> {
  const regionsResult = await pool.query(`
    SELECT r.id, r.name, r.parent_region_id,
           COALESCE(array_agg(rm.division_id) FILTER (WHERE rm.division_id IS NOT NULL), '{}') AS division_ids
    FROM regions r
    LEFT JOIN region_members rm ON rm.region_id = r.id
    WHERE r.world_view_id = $1
    GROUP BY r.id, r.name, r.parent_region_id
  `, [worldViewId]);

  const divisionsByRegion = new Map<number, number[]>();
  const nameByRegion = new Map<number, string>();
  const childrenOf = new Map<number, number[]>();
  const parentOf = new Map<number, number | null>();

  for (const row of regionsResult.rows) {
    const id = row.id as number;
    const parentId = row.parent_region_id as number | null;
    const divIds = (row.division_ids as number[]).filter(d => d != null);
    divisionsByRegion.set(id, divIds);
    nameByRegion.set(id, row.name as string);
    parentOf.set(id, parentId);
    if (parentId != null) {
      const siblings = childrenOf.get(parentId) ?? [];
      siblings.push(id);
      childrenOf.set(parentId, siblings);
    }
  }

  return { divisionsByRegion, nameByRegion, childrenOf, parentOf };
}

/**
 * Determine which regions to compute coverage for.
 * Returns null when computing coverage for ALL regions.
 */
function computeTargetAncestors(
  onlyId: number | null,
  targetRegionId: number | null,
  parentOf: Map<number, number | null>,
): Set<number> | null {
  if (onlyId != null) {
    return new Set([onlyId]);
  }
  if (targetRegionId != null) {
    const ancestors = new Set<number>();
    let current: number | null = targetRegionId;
    while (current != null) {
      ancestors.add(current);
      current = parentOf.get(current) ?? null;
    }
    return ancestors;
  }
  return null;
}

/** Collect descendant division IDs for each container region. */
async function loadDescendantDivsByContainer(worldViewId: number): Promise<Map<number, number[]>> {
  const descResult = await pool.query(`
    WITH RECURSIVE descendants AS (
      SELECT r.parent_region_id AS root_id, r.id AS region_id
      FROM regions r
      WHERE r.world_view_id = $1 AND r.parent_region_id IS NOT NULL
      UNION ALL
      SELECT d.root_id, r.id
      FROM descendants d
      JOIN regions r ON r.parent_region_id = d.region_id
    )
    SELECT d.root_id AS container_id,
           array_agg(DISTINCT rm.division_id) AS desc_div_ids
    FROM descendants d
    JOIN region_members rm ON rm.region_id = d.region_id
    GROUP BY d.root_id
  `, [worldViewId]);

  const descendantDivsByContainer = new Map<number, number[]>();
  for (const row of descResult.rows) {
    descendantDivsByContainer.set(
      row.container_id as number,
      (row.desc_div_ids as number[]).filter(d => d != null),
    );
  }
  return descendantDivsByContainer;
}

interface CoverageCandidate {
  regionId: number;
  parentDivIds: number[];
  descendantDivIds: number[];
}

interface NameLookupEntry {
  regionId: number;
  name: string;
  descendantDivIds: number[];
}

interface BuildCandidatesResult {
  coverageCandidates: CoverageCandidate[];
  needsNameLookup: NameLookupEntry[];
  zeroCoverageIds: number[];
}

/**
 * Partition container regions into: coverage candidates, name-lookup-pending,
 * and zero-coverage (container with children but no descendant divisions).
 */
function buildCoverageCandidates(
  topology: RegionTopology,
  descendantDivsByContainer: Map<number, number[]>,
  targetAncestorIds: Set<number> | null,
): BuildCandidatesResult {
  const { divisionsByRegion, nameByRegion, childrenOf } = topology;
  const coverageCandidates: CoverageCandidate[] = [];
  const needsNameLookup: NameLookupEntry[] = [];
  const zeroCoverageIds: number[] = [];

  for (const [regionId, divIds] of divisionsByRegion) {
    if (targetAncestorIds && !targetAncestorIds.has(regionId)) continue;

    const children = childrenOf.get(regionId);
    if (!children || children.length === 0) continue;
    const descendantDivIds = descendantDivsByContainer.get(regionId) ?? [];
    if (descendantDivIds.length === 0) {
      zeroCoverageIds.push(regionId);
      continue;
    }
    if (divIds.length > 0) {
      coverageCandidates.push({ regionId, parentDivIds: divIds, descendantDivIds });
    } else {
      const name = nameByRegion.get(regionId);
      if (name) needsNameLookup.push({ regionId, name, descendantDivIds });
    }
  }

  return { coverageCandidates, needsNameLookup, zeroCoverageIds };
}

/**
 * For regions without own divisions, attempt a GADM name match.
 * Pushes matched regions into `coverageCandidates`; returns those still unresolved.
 */
async function resolveByGadmName(
  needsNameLookup: NameLookupEntry[],
  coverageCandidates: CoverageCandidate[],
): Promise<Array<{ regionId: number; descendantDivIds: number[] }>> {
  const unresolved: Array<{ regionId: number; descendantDivIds: number[] }> = [];
  for (const { regionId, name, descendantDivIds } of needsNameLookup) {
    const cleanName = stripParentheticalSuffix(name);
    const nameMatchResult = await pool.query(`
      SELECT id FROM administrative_divisions
      WHERE name_normalized = lower(immutable_unaccent($1))
        AND geom_simplified_medium IS NOT NULL
      ORDER BY geom_area_km2 DESC NULLS LAST
      LIMIT 1
    `, [cleanName]);
    if (nameMatchResult.rows.length > 0) {
      coverageCandidates.push({
        regionId,
        parentDivIds: [nameMatchResult.rows[0].id as number],
        descendantDivIds,
      });
    } else {
      unresolved.push({ regionId, descendantDivIds });
    }
  }
  return unresolved;
}

/** Filter unresolved regions to those with a Wikidata geoshape available. */
async function findGeoshapeCandidates(
  unresolved: Array<{ regionId: number; descendantDivIds: number[] }>,
): Promise<Array<{ regionId: number; descendantDivIds: number[] }>> {
  if (unresolved.length === 0) return [];

  const unresolvedIds = unresolved.map(u => u.regionId);
  const gsResult = await pool.query(`
    SELECT ris.region_id
    FROM region_import_state ris
    JOIN wikidata_geoshapes wg ON wg.wikidata_id = ris.source_external_id
    WHERE ris.region_id = ANY($1)
      AND wg.not_available = FALSE
      AND wg.geom IS NOT NULL
  `, [unresolvedIds]);
  const withGeoshape = new Set<number>(gsResult.rows.map(r => r.region_id as number));

  const geoshapeCandidates: Array<{ regionId: number; descendantDivIds: number[] }> = [];
  for (const { regionId, descendantDivIds } of unresolved) {
    if (withGeoshape.has(regionId)) {
      geoshapeCandidates.push({ regionId, descendantDivIds });
    }
  }
  return geoshapeCandidates;
}

/** Compute division-to-division coverage in batches of CONCURRENCY. */
async function computeCoverageBatch(
  candidates: CoverageCandidate[],
  coverage: Record<string, number>,
): Promise<void> {
  for (let i = 0; i < candidates.length; i += CONCURRENCY) {
    const batch = candidates.slice(i, i + CONCURRENCY);
    const results = await Promise.all(
      batch.map(async ({ regionId, parentDivIds, descendantDivIds }) => {
        const cov = await computeMultiDivisionCoverage(parentDivIds, descendantDivIds);
        return { regionId, cov };
      }),
    );
    for (const { regionId, cov } of results) {
      if (cov != null) coverage[String(regionId)] = cov;
    }
  }
}

/** Compute how well descendant divisions cover the Wikidata geoshape (in batches). */
async function computeGeoshapeCoverageBatch(
  candidates: Array<{ regionId: number; descendantDivIds: number[] }>,
  coverage: Record<string, number>,
): Promise<void> {
  for (let i = 0; i < candidates.length; i += CONCURRENCY) {
    const batch = candidates.slice(i, i + CONCURRENCY);
    const results = await Promise.all(
      batch.map(async ({ regionId, descendantDivIds }) => {
        const covResult = await pool.query(`
          WITH wiki AS (
            SELECT ST_ForcePolygonCCW(wg.geom) AS geom
            FROM wikidata_geoshapes wg
            JOIN region_import_state ris ON ris.source_external_id = wg.wikidata_id
            WHERE ris.region_id = $1 AND wg.not_available = FALSE
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
              ST_MakeValid(ST_Intersection(w.geom, cu.geom)), 3
            ))) /
            NULLIF(safe_geo_area(w.geom), 0) AS coverage
          FROM wiki w, child_union cu
        `, [regionId, descendantDivIds]);
        const cov = covResult.rows[0]?.coverage as number | null;
        return { regionId, cov: cov != null ? Math.round(cov * 1000) / 1000 : null };
      }),
    );
    for (const { regionId, cov } of results) {
      if (cov != null) coverage[String(regionId)] = cov;
    }
  }
}

/**
 * Compute geoshape coverage for regions that have assigned divisions AND a Wikidata geoshape.
 * Measures how well the assigned divisions cover the source geoshape.
 */
async function computeAssignedGeoshapeCoverage(
  topology: RegionTopology,
  targetAncestorIds: Set<number> | null,
): Promise<Record<string, number>> {
  const geoshapeCoverage: Record<string, number> = {};

  const regionsWithDivisions: Array<{ regionId: number; divisionIds: number[] }> = [];
  for (const [regionId, divIds] of topology.divisionsByRegion) {
    if (targetAncestorIds && !targetAncestorIds.has(regionId)) continue;
    if (divIds.length === 0) continue;
    regionsWithDivisions.push({ regionId, divisionIds: divIds });
  }

  if (regionsWithDivisions.length === 0) return geoshapeCoverage;

  const allRegionIds = regionsWithDivisions.map(r => r.regionId);
  const geoshapeResult = await pool.query(`
    SELECT ris.region_id
    FROM region_import_state ris
    JOIN wikidata_geoshapes wg ON wg.wikidata_id = ris.source_external_id
    WHERE ris.region_id = ANY($1)
      AND wg.not_available = FALSE
      AND wg.geom IS NOT NULL
  `, [allRegionIds]);
  const regionsWithGeoshape = new Set<number>(geoshapeResult.rows.map(r => r.region_id as number));

  const geoshapeCandidates = regionsWithDivisions.filter(r => regionsWithGeoshape.has(r.regionId));
  for (let i = 0; i < geoshapeCandidates.length; i += CONCURRENCY) {
    const batch = geoshapeCandidates.slice(i, i + CONCURRENCY);
    const results = await Promise.all(
      batch.map(async ({ regionId, divisionIds }) => {
        const covResult = await pool.query(`
          WITH wiki AS (
            SELECT ST_ForcePolygonCCW(wg.geom) AS geom
            FROM wikidata_geoshapes wg
            JOIN region_import_state ris ON ris.source_external_id = wg.wikidata_id
            WHERE ris.region_id = $1 AND wg.not_available = FALSE
          ),
          assigned AS (
            SELECT ST_ForcePolygonCCW(ST_CollectionExtract(
              ST_MakeValid(ST_Union(ad.geom_simplified_medium)), 3
            )) AS geom
            FROM administrative_divisions ad
            WHERE ad.id = ANY($2) AND ad.geom_simplified_medium IS NOT NULL
          )
          SELECT
            safe_geo_area(ST_ForcePolygonCCW(ST_CollectionExtract(
              ST_MakeValid(ST_Intersection(w.geom, a.geom)), 3
            ))) / NULLIF(safe_geo_area(w.geom), 0) AS cov
          FROM wiki w, assigned a
        `, [regionId, divisionIds]);
        const cov = covResult.rows[0]?.cov as number | null;
        return { regionId, cov: cov != null ? Math.round(cov * 1000) / 1000 : null };
      }),
    );
    for (const { regionId, cov } of results) {
      if (cov != null) geoshapeCoverage[String(regionId)] = cov;
    }
  }

  return geoshapeCoverage;
}

/** Log containers with unexpectedly low coverage for debugging. */
function logLowCoverage(
  coverage: Record<string, number>,
  topology: RegionTopology,
  descendantDivsByContainer: Map<number, number[]>,
): void {
  for (const [id, cov] of Object.entries(coverage)) {
    if (cov < 0.9 && cov > 0) {
      const name = topology.nameByRegion.get(Number(id)) ?? '?';
      const parentDivs = topology.divisionsByRegion.get(Number(id)) ?? [];
      const descDivs = descendantDivsByContainer.get(Number(id)) ?? [];
      console.log(`  [Coverage] "${name}" (${id}): ${(cov * 100).toFixed(2)}% — parentDivs=[${parentDivs}] descDivs=[${descDivs.join(',')}]`);
    }
  }
}

/**
 * Compute children coverage % for container nodes.
 * GET /api/admin/wv-import/matches/:worldViewId/children-coverage
 *
 * Without ?regionId: computes for ALL container nodes (initial load).
 * With ?regionId=X: computes only for ancestors of region X (fast incremental update).
 */
export async function getChildrenCoverage(req: AuthenticatedRequest, res: Response): Promise<void> {
  const worldViewId = parseInt(String(req.params.worldViewId));
  const targetRegionId = req.query.regionId ? parseInt(String(req.query.regionId)) : null;
  const onlyId = req.query.onlyId ? parseInt(String(req.query.onlyId)) : null;

  try {
    const topology = await loadRegionTopology(worldViewId);
    const targetAncestorIds = computeTargetAncestors(onlyId, targetRegionId, topology.parentOf);
    const descendantDivsByContainer = await loadDescendantDivsByContainer(worldViewId);

    const { coverageCandidates, needsNameLookup, zeroCoverageIds } =
      buildCoverageCandidates(topology, descendantDivsByContainer, targetAncestorIds);

    const unresolvedAfterName = await resolveByGadmName(needsNameLookup, coverageCandidates);
    const geoshapeCoverageCandidates = await findGeoshapeCandidates(unresolvedAfterName);

    const coverage: Record<string, number> = {};
    for (const id of zeroCoverageIds) coverage[String(id)] = 0;

    await computeCoverageBatch(coverageCandidates, coverage);
    await computeGeoshapeCoverageBatch(geoshapeCoverageCandidates, coverage);

    const geoshapeCoverage = await computeAssignedGeoshapeCoverage(topology, targetAncestorIds);

    console.log(`[WV Import] Children coverage: ${Object.keys(coverage).length} containers computed, ${zeroCoverageIds.length} zero-coverage` +
      (targetRegionId ? ` (target=${targetRegionId})` : '') +
      (onlyId ? ` (onlyId=${onlyId})` : ''));
    logLowCoverage(coverage, topology, descendantDivsByContainer);

    res.json({ coverage, geoshapeCoverage });
  } catch (err) {
    console.error('[WV Import] Children coverage failed:', err);
    res.status(500).json({ error: err instanceof Error ? err.message : 'Children coverage failed' });
  }
}

/**
 * Resolve a region's own parent division IDs: from region_members first,
 * falling back to GADM name match when no members exist.
 */
async function loadParentDivIdsWithFallback(worldViewId: number, regionId: number): Promise<number[]> {
  const parentDivsResult = await pool.query(
    `SELECT rm.division_id FROM region_members rm
     JOIN regions r ON r.id = rm.region_id
     WHERE rm.region_id = $1 AND r.world_view_id = $2`,
    [regionId, worldViewId],
  );
  const parentDivIds = parentDivsResult.rows.map(r => r.division_id as number);
  if (parentDivIds.length > 0) return parentDivIds;

  const regionNameResult = await pool.query('SELECT name FROM regions WHERE id = $1', [regionId]);
  const regionName = regionNameResult.rows[0]?.name as string | undefined;
  if (!regionName) return [];

  const nameMatchResult = await pool.query(`
    SELECT id FROM administrative_divisions
    WHERE name_normalized = lower(immutable_unaccent($1))
      AND geom_simplified_medium IS NOT NULL
    ORDER BY geom_area_km2 DESC NULLS LAST
    LIMIT 1
  `, [stripParentheticalSuffix(regionName)]);

  if (nameMatchResult.rows.length > 0) {
    return [nameMatchResult.rows[0].id as number];
  }
  return [];
}

/**
 * Return GeoJSON geometries for a coverage comparison:
 *   parentGeometry = union of divisions assigned directly to this region
 *   childrenGeometry = union of all descendant regions' divisions
 * GET /api/admin/wv-import/matches/:worldViewId/coverage-geometry/:regionId
 */
export async function getCoverageGeometry(req: AuthenticatedRequest, res: Response): Promise<void> {
  const worldViewId = parseInt(String(req.params.worldViewId));
  const regionId = parseInt(String(req.params.regionId));

  try {
    const parentDivIds = await loadParentDivIdsWithFallback(worldViewId, regionId);

    // 2. Collect all descendant division IDs
    const descendantDivsResult = await pool.query(`
      WITH RECURSIVE descendants AS (
        SELECT id FROM regions WHERE parent_region_id = $1 AND world_view_id = $2
        UNION ALL
        SELECT r.id FROM regions r JOIN descendants d ON r.parent_region_id = d.id
      )
      SELECT rm.division_id
      FROM descendants d
      JOIN region_members rm ON rm.region_id = d.id
    `, [regionId, worldViewId]);
    const childDivIds = descendantDivsResult.rows.map(r => r.division_id as number);

    // 3. Get the Wikidata geoshape if available
    const geoshapeQuery = pool.query(`
      SELECT ST_AsGeoJSON(wg.geom) AS geojson
      FROM wikidata_geoshapes wg
      JOIN region_import_state ris ON ris.source_external_id = wg.wikidata_id
      WHERE ris.region_id = $1 AND wg.not_available = FALSE AND wg.geom IS NOT NULL
    `, [regionId]);

    // 4. Fetch union geometries as GeoJSON
    const [parentGeo, childrenGeo, geoshapeGeo] = await Promise.all([
      parentDivIds.length > 0
        ? pool.query(`
            SELECT ST_AsGeoJSON(
              ST_ForcePolygonCCW(ST_CollectionExtract(ST_MakeValid(ST_Union(ad.geom_simplified_medium)), 3))
            ) AS geojson
            FROM administrative_divisions ad
            WHERE ad.id = ANY($1) AND ad.geom_simplified_medium IS NOT NULL
          `, [parentDivIds])
        : null,
      childDivIds.length > 0
        ? pool.query(`
            SELECT ST_AsGeoJSON(
              ST_ForcePolygonCCW(ST_CollectionExtract(ST_MakeValid(ST_Union(ad.geom_simplified_medium)), 3))
            ) AS geojson
            FROM administrative_divisions ad
            WHERE ad.id = ANY($1) AND ad.geom_simplified_medium IS NOT NULL
          `, [childDivIds])
        : null,
      geoshapeQuery,
    ]);

    const parentGeometry = parentGeo?.rows[0]?.geojson
      ? JSON.parse(parentGeo.rows[0].geojson as string) as GeoJSON.Geometry
      : null;
    const childrenGeometry = childrenGeo?.rows[0]?.geojson
      ? JSON.parse(childrenGeo.rows[0].geojson as string) as GeoJSON.Geometry
      : null;
    const geoshapeGeometry = geoshapeGeo?.rows[0]?.geojson
      ? JSON.parse(geoshapeGeo.rows[0].geojson as string) as GeoJSON.Geometry
      : null;

    res.json({ parentGeometry, childrenGeometry, geoshapeGeometry });
  } catch (err) {
    console.error('[WV Import] Coverage geometry failed:', err);
    res.status(500).json({ error: err instanceof Error ? err.message : 'Coverage geometry failed' });
  }
}

/**
 * Resolve full name paths (e.g. "Europe > France > Provence") for GADM divisions
 * by walking parent_id chains.
 */
async function buildGapNamePaths(
  gapRows: Array<{ id: number; name: string; parent_id: number | null }>,
): Promise<Map<number, { path: string; level: number }>> {
  const pathMap = new Map<number, { path: string; level: number }>();
  if (gapRows.length === 0) return pathMap;

  const allAncestorIds = new Set<number>();
  const parentIdMap = new Map<number, number | null>();
  const nameMap = new Map<number, string>();
  for (const row of gapRows) {
    parentIdMap.set(row.id, row.parent_id);
    nameMap.set(row.id, row.name);
    if (row.parent_id != null) allAncestorIds.add(row.parent_id);
  }

  let toFetch = [...allAncestorIds].filter(id => !nameMap.has(id));
  while (toFetch.length > 0) {
    const ancestorRows = await pool.query(
      'SELECT id, name, parent_id FROM administrative_divisions WHERE id = ANY($1)',
      [toFetch],
    );
    const nextFetch = new Set<number>();
    for (const row of ancestorRows.rows) {
      nameMap.set(row.id as number, row.name as string);
      parentIdMap.set(row.id as number, row.parent_id as number | null);
      if (row.parent_id != null && !nameMap.has(row.parent_id as number)) {
        nextFetch.add(row.parent_id as number);
      }
    }
    toFetch = [...nextFetch];
  }

  for (const row of gapRows) {
    const parts: string[] = [];
    let cur: number | null = row.id;
    while (cur != null) {
      parts.unshift(nameMap.get(cur) ?? '?');
      cur = parentIdMap.get(cur) ?? null;
    }
    pathMap.set(row.id, { path: parts.join(' > '), level: parts.length - 1 });
  }
  return pathMap;
}

/** Map from direct-child root ID to the set of its descendant division IDs. */
async function loadChildRegionDivIds(
  worldViewId: number,
  regionId: number,
): Promise<Map<number, number[]>> {
  const perChildResult = await pool.query(`
    WITH RECURSIVE tree AS (
      SELECT r.id, r.id AS root_child_id
      FROM regions r
      WHERE r.parent_region_id = $1 AND r.world_view_id = $2
      UNION ALL
      SELECT r.id, t.root_child_id
      FROM regions r JOIN tree t ON r.parent_region_id = t.id
    )
    SELECT t.root_child_id, array_agg(DISTINCT rm.division_id) FILTER (WHERE rm.division_id IS NOT NULL) AS div_ids
    FROM tree t
    JOIN region_members rm ON rm.region_id = t.id
    GROUP BY t.root_child_id
  `, [regionId, worldViewId]);

  const childRegionDivIds = new Map<number, number[]>();
  for (const row of perChildResult.rows) {
    const rootId = row.root_child_id as number;
    const divIds = (row.div_ids as number[] | null) ?? [];
    if (divIds.length > 0) childRegionDivIds.set(rootId, divIds);
  }
  return childRegionDivIds;
}

/**
 * Union simplified GADM geometries per root-child region and return GeoJSON
 * metadata per child.
 */
async function buildChildRegionGeometries(
  childRegionDivIds: Map<number, number[]>,
  childNames: Map<number, string>,
): Promise<Array<{ regionId: number; name: string; geometry: GeoJSON.Geometry }>> {
  const results: Array<{ regionId: number; name: string; geometry: GeoJSON.Geometry }> = [];
  if (childRegionDivIds.size === 0) return results;

  const allDivIdsFlat: number[] = [];
  const rootIds: number[] = [];
  for (const [rId, divIds] of childRegionDivIds) {
    for (const dId of divIds) {
      allDivIdsFlat.push(dId);
      rootIds.push(rId);
    }
  }

  const geoResult = await pool.query(`
    WITH input AS (
      SELECT unnest($1::int[]) AS div_id, unnest($2::int[]) AS root_child_id
    )
    SELECT i.root_child_id,
           ST_AsGeoJSON(
             ST_SimplifyPreserveTopology(
               ST_ForcePolygonCCW(ST_CollectionExtract(ST_MakeValid(ST_Union(ad.geom_simplified_medium)), 3)),
               0.01
             )
           ) AS geojson
    FROM input i
    JOIN administrative_divisions ad ON ad.id = i.div_id AND ad.geom_simplified_medium IS NOT NULL
    GROUP BY i.root_child_id
  `, [allDivIdsFlat, rootIds]);

  for (const row of geoResult.rows) {
    const rId = row.root_child_id as number;
    if (row.geojson) {
      results.push({
        regionId: rId,
        name: childNames.get(rId) ?? `Region ${rId}`,
        geometry: JSON.parse(row.geojson as string),
      });
    }
  }
  return results;
}

/** Find the nearest direct child region for each gap division (KNN in PostGIS). */
async function findNearestChildPerGapDivision(
  gapDivIds: number[],
  regionId: number,
  directChildrenCount: number,
): Promise<Map<number, { regionId: number; regionName: string }>> {
  const suggestedTargets = new Map<number, { regionId: number; regionName: string }>();
  if (directChildrenCount === 0 || gapDivIds.length === 0) return suggestedTargets;

  const nearestResult = await pool.query(`
    WITH child_descendants AS (
      SELECT child.id AS child_id, child.name AS child_name, descendant.id AS desc_id
      FROM regions child
      LEFT JOIN LATERAL (
        WITH RECURSIVE tree AS (
          SELECT child.id AS id
          UNION ALL
          SELECT r.id FROM regions r JOIN tree t ON r.parent_region_id = t.id
        )
        SELECT id FROM tree
      ) descendant ON true
      WHERE child.parent_region_id = $2
    ),
    child_divs AS (
      SELECT cd.child_id, cd.child_name, ad.geom_simplified_medium AS geom
      FROM child_descendants cd
      JOIN region_members rm ON rm.region_id = cd.desc_id
      JOIN administrative_divisions ad ON ad.id = rm.division_id AND ad.geom_simplified_medium IS NOT NULL
    )
    SELECT DISTINCT ON (gap.id)
      gap.id AS gap_div_id,
      cd.child_id AS region_id,
      cd.child_name AS name
    FROM unnest($1::int[]) AS gap(id)
    JOIN administrative_divisions gd ON gd.id = gap.id
    CROSS JOIN child_divs cd
    ORDER BY gap.id, cd.geom <-> gd.geom_simplified_medium
  `, [gapDivIds, regionId]);

  for (const row of nearestResult.rows) {
    suggestedTargets.set(row.gap_div_id as number, {
      regionId: row.region_id as number,
      regionName: row.name as string,
    });
  }
  return suggestedTargets;
}

interface GapDivision {
  divisionId: number;
  gadmParentId: number | null;
  name: string;
  path: string;
  level: number;
  areaKm2: number;
  overlapWithGap: number;
  geometry: GeoJSON.Geometry | null;
  suggestedTarget: { regionId: number; regionName: string } | null;
}

/**
 * Analyze coverage gaps: return the minimal set of highest-level uncovered
 * GADM divisions (gap boundaries) between a region and its descendants.
 * A boundary is the highest-level division that is entirely uncovered AND
 * whose parent already has partial coverage — assigning it covers the whole
 * subtree in one action. Uses the same boundary logic as verifyWorkUnit so
 * the panel count equals the ChecksBar chip count.
 * POST /api/admin/wv-import/matches/:worldViewId/coverage-gap-analysis/:regionId
 */
export async function analyzeCoverageGaps(req: AuthenticatedRequest, res: Response): Promise<void> {
  const worldViewId = parseInt(String(req.params.worldViewId));
  const regionId = parseInt(String(req.params.regionId));
  console.log(`[WV Import] POST /matches/${worldViewId}/coverage-gap-analysis/${regionId}`);

  try {
    const t0 = Date.now();
    const logTiming = (label: string) => console.log(`  [CoverageGap] ${label} — ${Date.now() - t0}ms`);

    // Step 1: resolve the reference territory (members or reference_division_ids)
    const reference = await resolveReference(regionId);
    if (reference.source === null) {
      res.json({ gapDivisions: [], siblingRegions: [], message: 'No reference territory' });
      return;
    }
    logTiming(`Step 1: reference resolved (source=${reference.source}, ${reference.divisionIds.length} divs)`);

    // Step 2: get boundary divisions using the shared tree-based helper
    const boundaries = await getCoverageBoundaries(regionId, reference.divisionIds);
    logTiming(`Step 2: boundary query (${boundaries.length} boundaries)`);

    const directChildrenResult = await pool.query(
      `SELECT id, name FROM regions WHERE parent_region_id = $1 AND world_view_id = $2 ORDER BY name`,
      [regionId, worldViewId],
    );
    const directChildren = directChildrenResult.rows as Array<{ id: number; name: string }>;
    logTiming(`Step 3: direct children (${directChildren.length} children)`);

    const childRegionDivIds = await loadChildRegionDivIds(worldViewId, regionId);
    const childNames = new Map(directChildren.map(c => [c.id, c.name]));
    const siblingRegions = await buildChildRegionGeometries(childRegionDivIds, childNames);
    logTiming(`Step 3b: sibling geometries (${siblingRegions.length} siblings)`);

    if (boundaries.length === 0) {
      res.json({ gapDivisions: [], siblingRegions });
      return;
    }

    // Step 4: enrich boundary ids with geometry, area, and parent_id
    const boundaryIds = boundaries.map(b => b.id);
    const enrichResult = await pool.query(`
      SELECT id, name, parent_id,
             safe_geo_area(geom_simplified_medium) / 1e6 AS area_km2,
             ST_AsGeoJSON(ST_SimplifyPreserveTopology(geom_simplified_medium, 0.01)) AS geojson
      FROM administrative_divisions
      WHERE id = ANY($1)
    `, [boundaryIds]);
    logTiming(`Step 4: boundary enrichment (${enrichResult.rows.length} rows)`);

    const enrichRows = enrichResult.rows as Array<{
      id: number;
      name: string;
      parent_id: number | null;
      area_km2: number;
      geojson: string | null;
    }>;

    // Step 5: build full ancestor paths via parent-name walk
    const pathMap = await buildGapNamePaths(enrichRows);
    logTiming(`Step 5: name paths (${enrichRows.length} divisions)`);

    // Step 6: find nearest child region per gap boundary
    const suggestedTargets = await findNearestChildPerGapDivision(boundaryIds, regionId, directChildren.length);

    // Build an enrichment lookup keyed by id
    const enrichById = new Map(enrichRows.map(r => [r.id, r]));

    const gapDivisions: GapDivision[] = boundaries.map((boundary) => {
      const enrich = enrichById.get(boundary.id);
      const pathInfo = pathMap.get(boundary.id);
      return {
        divisionId: boundary.id,
        gadmParentId: enrich?.parent_id ?? null,
        name: boundary.name,
        path: pathInfo?.path ?? boundary.name,
        level: pathInfo?.level ?? 0,
        areaKm2: Math.round(enrich?.area_km2 ?? 0),
        overlapWithGap: 1,
        geometry: enrich?.geojson ? JSON.parse(enrich.geojson) as GeoJSON.Geometry : null,
        suggestedTarget: suggestedTargets.get(boundary.id) ?? null,
      };
    });

    logTiming(`Step 6: nearest-child KNN (${boundaryIds.length} boundaries × ${directChildren.length} children)`);

    res.json({ gapDivisions, siblingRegions });
  } catch (err) {
    console.error('[WV Import] Coverage gap analysis failed:', err);
    res.status(500).json({ error: err instanceof Error ? err.message : 'Coverage gap analysis failed' });
  }
}

/**
 * Get per-child region geometries for a given parent region.
 * Used to drill down into sibling regions on the gap context map.
 * GET /api/admin/wv-import/matches/:worldViewId/children-geometry/:regionId
 */
export async function getChildrenRegionGeometry(req: AuthenticatedRequest, res: Response): Promise<void> {
  const worldViewId = parseInt(String(req.params.worldViewId));
  const regionId = parseInt(String(req.params.regionId));

  try {
    const childrenResult = await pool.query(
      'SELECT id, name FROM regions WHERE parent_region_id = $1 AND world_view_id = $2 ORDER BY name',
      [regionId, worldViewId],
    );
    if (childrenResult.rows.length === 0) {
      res.json({ childRegions: [] });
      return;
    }

    const childRegionDivIds = await loadChildRegionDivIds(worldViewId, regionId);
    const childNames = new Map(
      childrenResult.rows.map(r => [r.id as number, r.name as string]),
    );
    const childRegions = await buildChildRegionGeometries(childRegionDivIds, childNames);

    res.json({ childRegions });
  } catch (err) {
    console.error('[WV Import] Children region geometry failed:', err);
    res.status(500).json({ error: err instanceof Error ? err.message : 'Children region geometry failed' });
  }
}
