/**
 * WorldView Import Coverage Compare Controller
 *
 * Coverage comparison endpoints: children coverage stats, coverage geometry,
 * gap analysis, and per-child region geometry.
 */

import { Response } from 'express';
import { pool } from '../../db/index.js';
import type { AuthenticatedRequest } from '../../middleware/auth.js';
import { computeMultiDivisionCoverage } from '../../services/worldViewImport/geoshapeCache.js';

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
    // 1. Get all regions with their parent_region_id, name, and assigned division IDs
    const regionsResult = await pool.query(`
      SELECT r.id, r.name, r.parent_region_id,
             COALESCE(array_agg(rm.division_id) FILTER (WHERE rm.division_id IS NOT NULL), '{}') AS division_ids
      FROM regions r
      LEFT JOIN region_members rm ON rm.region_id = r.id
      WHERE r.world_view_id = $1
      GROUP BY r.id, r.name, r.parent_region_id
    `, [worldViewId]);

    // 2. Build parent-child map and division assignments
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

    // Determine which regions to compute coverage for
    let targetAncestorIds: Set<number> | null = null;
    if (onlyId != null) {
      // Single-region mode: compute only for this one region
      targetAncestorIds = new Set([onlyId]);
    } else if (targetRegionId != null) {
      // Ancestor mode: compute for all ancestors of the given region
      targetAncestorIds = new Set<number>();
      let current: number | null = targetRegionId;
      while (current != null) {
        targetAncestorIds.add(current);
        current = parentOf.get(current) ?? null;
      }
    }

    // 3. Collect descendant division IDs for ALL container regions via SQL recursive CTE.
    //    Uses the same approach as the gap analysis / coverage geometry endpoints for consistency.
    const descendantDivsByContainer = new Map<number, number[]>();
    {
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
      for (const row of descResult.rows) {
        descendantDivsByContainer.set(
          row.container_id as number,
          (row.desc_div_ids as number[]).filter(d => d != null),
        );
      }
    }

    // 4. Find container nodes that have descendants with divisions
    //    Parent divIds come from region_members; if empty, fallback to GADM name match
    const coverageCandidates: Array<{ regionId: number; parentDivIds: number[]; descendantDivIds: number[] }> = [];
    const needsNameLookup: Array<{ regionId: number; name: string; descendantDivIds: number[] }> = [];
    const zeroCoverageIds: number[] = [];

    for (const [regionId, divIds] of divisionsByRegion) {
      // Skip regions not in target ancestors when doing incremental update
      if (targetAncestorIds && !targetAncestorIds.has(regionId)) continue;

      const children = childrenOf.get(regionId);
      if (!children || children.length === 0) continue;
      const descendantDivIds = descendantDivsByContainer.get(regionId) ?? [];
      if (descendantDivIds.length === 0) {
        // Children exist but none have divisions yet → 0% coverage
        zeroCoverageIds.push(regionId);
        continue;
      }
      if (divIds.length > 0) {
        coverageCandidates.push({ regionId, parentDivIds: divIds, descendantDivIds });
      } else {
        // No own divisions — try GADM name match
        const name = nameByRegion.get(regionId);
        if (name) needsNameLookup.push({ regionId, name, descendantDivIds });
      }
    }

    // Batch GADM name lookups for regions without own divisions
    for (const { regionId, name, descendantDivIds } of needsNameLookup) {
      const cleanName = name.replace(/\s*\(.*\)\s*$/, '');
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
      }
    }

    // 5. Compute coverage for each candidate (parallel with concurrency limit)
    const coverage: Record<string, number> = {};
    // Regions with children but no descendant divisions → 0% coverage
    for (const id of zeroCoverageIds) coverage[String(id)] = 0;
    const CONCURRENCY = 10;
    for (let i = 0; i < coverageCandidates.length; i += CONCURRENCY) {
      const batch = coverageCandidates.slice(i, i + CONCURRENCY);
      const results = await Promise.all(
        batch.map(async ({ regionId, parentDivIds, descendantDivIds }) => {
          const cov = await computeMultiDivisionCoverage(parentDivIds, descendantDivIds);
          return { regionId, cov };
        }),
      );
      for (const { regionId, cov } of results) {
        if (cov != null) {
          coverage[String(regionId)] = cov;
        }
      }
    }

    // 6. Compute geoshape coverage: how well assigned divisions cover the source geoshape
    //    For any region with assigned divisions AND a Wikidata geoshape
    const geoshapeCoverage: Record<string, number> = {};

    // Find regions with assigned divisions that also have a geoshape
    const regionsWithDivisions: Array<{ regionId: number; divisionIds: number[] }> = [];
    for (const [regionId, divIds] of divisionsByRegion) {
      if (targetAncestorIds && !targetAncestorIds.has(regionId)) continue;
      if (divIds.length === 0) continue;
      regionsWithDivisions.push({ regionId, divisionIds: divIds });
    }

    if (regionsWithDivisions.length > 0) {
      // Batch: get all region IDs that have a geoshape
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

      // Compute coverage for each region with geoshape
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
          if (cov != null) {
            geoshapeCoverage[String(regionId)] = cov;
          }
        }
      }
    }

    res.json({ coverage, geoshapeCoverage });
  } catch (err) {
    console.error('[WV Import] Children coverage failed:', err);
    res.status(500).json({ error: err instanceof Error ? err.message : 'Children coverage failed' });
  }
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
    // 1. Get parent's own division IDs (from region_members, or fallback to GADM name match)
    const parentDivsResult = await pool.query(
      `SELECT rm.division_id FROM region_members rm
       JOIN regions r ON r.id = rm.region_id
       WHERE rm.region_id = $1 AND r.world_view_id = $2`,
      [regionId, worldViewId],
    );
    let parentDivIds = parentDivsResult.rows.map(r => r.division_id as number);

    if (parentDivIds.length === 0) {
      const regionNameResult = await pool.query(
        'SELECT name FROM regions WHERE id = $1',
        [regionId],
      );
      const regionName = regionNameResult.rows[0]?.name as string | undefined;
      if (regionName) {
        const nameMatchResult = await pool.query(`
          SELECT id FROM administrative_divisions
          WHERE name_normalized = lower(immutable_unaccent($1))
            AND geom_simplified_medium IS NOT NULL
          ORDER BY geom_area_km2 DESC NULLS LAST
          LIMIT 1
        `, [regionName.replace(/\s*\(.*\)\s*$/, '')]);
        if (nameMatchResult.rows.length > 0) {
          parentDivIds = [nameMatchResult.rows[0].id as number];
        }
      }
    }

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
 * Analyze coverage gaps: find GADM divisions that fall in the uncovered area
 * between a parent's own divisions and its descendants' divisions.
 * For each gap division, suggest the nearest child region to assign it to.
 * POST /api/admin/wv-import/matches/:worldViewId/coverage-gap-analysis/:regionId
 */
export async function analyzeCoverageGaps(req: AuthenticatedRequest, res: Response): Promise<void> {
  const worldViewId = parseInt(String(req.params.worldViewId));
  const regionId = parseInt(String(req.params.regionId));
  console.log(`[WV Import] POST /matches/${worldViewId}/coverage-gap-analysis/${regionId}`);

  try {
    const t0 = Date.now();
    const logTiming = (label: string) => console.log(`  [CoverageGap] ${label} — ${Date.now() - t0}ms`);

    // 1. Get parent's own division IDs (from region_members, or fallback to GADM name match)
    const parentDivsResult = await pool.query(
      `SELECT rm.division_id FROM region_members rm
       JOIN regions r ON r.id = rm.region_id
       WHERE rm.region_id = $1 AND r.world_view_id = $2`,
      [regionId, worldViewId],
    );
    let parentDivIds = parentDivsResult.rows.map(r => r.division_id as number);

    // Fallback: if no region_members, find a GADM division by name match
    if (parentDivIds.length === 0) {
      const regionNameResult = await pool.query(
        'SELECT name FROM regions WHERE id = $1',
        [regionId],
      );
      const regionName = regionNameResult.rows[0]?.name as string | undefined;
      if (regionName) {
        // Try exact name match, then trigram similarity
        const nameMatchResult = await pool.query(`
          SELECT id FROM administrative_divisions
          WHERE name_normalized = lower(immutable_unaccent($1))
            AND geom_simplified_medium IS NOT NULL
          ORDER BY geom_area_km2 DESC NULLS LAST
          LIMIT 1
        `, [regionName.replace(/\s*\(.*\)\s*$/, '')]); // strip parenthetical like "(Argentina)"
        if (nameMatchResult.rows.length > 0) {
          parentDivIds = [nameMatchResult.rows[0].id as number];
        }
      }
    }

    if (parentDivIds.length === 0) {
      res.json({ gapDivisions: [], siblingRegions: [], message: 'Region has no assigned divisions and no GADM name match found' });
      return;
    }

    logTiming(`Step 1: parent divs (${parentDivIds.length} divisions)`);

    // 2. Get all descendant regions and their division IDs
    const descendantsResult = await pool.query(`
      WITH RECURSIVE descendants AS (
        SELECT id, name FROM regions WHERE parent_region_id = $1 AND world_view_id = $2
        UNION ALL
        SELECT r.id, r.name FROM regions r JOIN descendants d ON r.parent_region_id = d.id
      )
      SELECT d.id, d.name,
             COALESCE(array_agg(rm.division_id) FILTER (WHERE rm.division_id IS NOT NULL), '{}') AS division_ids
      FROM descendants d
      LEFT JOIN region_members rm ON rm.region_id = d.id
      GROUP BY d.id, d.name
    `, [regionId, worldViewId]);

    const allDescendantDivIds: number[] = [];
    for (const row of descendantsResult.rows) {
      const divIds = (row.division_ids as number[]).filter(d => d != null);
      allDescendantDivIds.push(...divIds);
    }

    logTiming(`Step 2: descendants (${descendantsResult.rows.length} regions, ${allDescendantDivIds.length} divs)`);

    // 3. Get direct children (for suggesting targets)
    const directChildrenResult = await pool.query(
      `SELECT id, name FROM regions WHERE parent_region_id = $1 AND world_view_id = $2 ORDER BY name`,
      [regionId, worldViewId],
    );
    const directChildren = directChildrenResult.rows as Array<{ id: number; name: string }>;

    logTiming(`Step 3: direct children (${directChildren.length} children)`);

    // 4. Find GADM divisions in the gap using PostGIS difference
    // Uses geom_simplified_medium for performance
    const gapResult = await pool.query(`
      WITH parent_union AS (
        SELECT ST_ForcePolygonCCW(ST_CollectionExtract(
          ST_MakeValid(ST_Union(ad.geom_simplified_medium)), 3
        )) AS geom
        FROM administrative_divisions ad
        WHERE ad.id = ANY($1) AND ad.geom_simplified_medium IS NOT NULL
      ),
      descendant_union AS (
        SELECT ST_ForcePolygonCCW(ST_CollectionExtract(
          ST_MakeValid(ST_Union(ad.geom_simplified_medium)), 3
        )) AS geom
        FROM administrative_divisions ad
        WHERE ad.id = ANY($2) AND ad.geom_simplified_medium IS NOT NULL
      ),
      gap AS (
        SELECT ST_MakeValid(ST_Difference(
          p.geom,
          COALESCE(du.geom, ST_GeomFromText('GEOMETRYCOLLECTION EMPTY', 4326))
        )) AS geom
        FROM parent_union p
        CROSS JOIN (SELECT geom FROM descendant_union UNION ALL SELECT NULL WHERE NOT EXISTS (SELECT 1 FROM descendant_union)) du
        LIMIT 1
      )
      SELECT
        d.id, d.name, d.parent_id,
        safe_geo_area(d.geom_simplified_medium) / 1e6 AS area_km2,
        safe_geo_area(ST_Intersection(d.geom_simplified_medium, g.geom)) /
          NULLIF(safe_geo_area(d.geom_simplified_medium), 0) AS overlap_pct,
        ST_AsGeoJSON(ST_SimplifyPreserveTopology(d.geom_simplified_medium, 0.01)) AS geojson
      FROM administrative_divisions d
      CROSS JOIN gap g
      WHERE NOT ST_IsEmpty(g.geom)
        AND ST_Intersects(d.geom_simplified_medium, g.geom)
        AND d.id != ALL($3)
        AND safe_geo_area(ST_Intersection(d.geom_simplified_medium, g.geom)) /
            NULLIF(safe_geo_area(d.geom_simplified_medium), 0) > 0.3
      ORDER BY area_km2 DESC
      LIMIT 30
    `, [parentDivIds, allDescendantDivIds.length > 0 ? allDescendantDivIds : [0], allDescendantDivIds.length > 0 ? allDescendantDivIds : [0]]);

    logTiming(`Step 4: gap query (${gapResult.rows.length} gap divisions, parent=${parentDivIds.length} divs, desc=${allDescendantDivIds.length} divs)`);

    // 5. Build name paths for gap divisions by walking parent_id chains
    const divIdsForPath = gapResult.rows.map(r => r.id as number);
    const pathMap = new Map<number, { path: string; level: number }>();
    if (divIdsForPath.length > 0) {
      // Collect all ancestor IDs we might need
      const allAncestorIds = new Set<number>();
      const parentIdMap = new Map<number, number | null>();
      const nameMap = new Map<number, string>();
      for (const row of gapResult.rows) {
        parentIdMap.set(row.id as number, row.parent_id as number | null);
        nameMap.set(row.id as number, row.name as string);
        if (row.parent_id != null) allAncestorIds.add(row.parent_id as number);
      }
      // Fetch ancestors in batches until we reach roots
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
      // Build paths
      for (const divId of divIdsForPath) {
        const parts: string[] = [];
        let cur: number | null = divId;
        while (cur != null) {
          parts.unshift(nameMap.get(cur) ?? '?');
          cur = parentIdMap.get(cur) ?? null;
        }
        pathMap.set(divId, { path: parts.join(' > '), level: parts.length - 1 });
      }
    }

    logTiming(`Step 5: name paths (${divIdsForPath.length} divisions)`);

    // 5b. Build per-child-region geometries for the map context.
    // For each direct child, collect its own + descendant division IDs, then union them.
    const childRegionDivIds = new Map<number, number[]>();
    {
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

      for (const row of perChildResult.rows) {
        const rootId = row.root_child_id as number;
        const divIds = (row.div_ids as number[] | null) ?? [];
        if (divIds.length > 0) childRegionDivIds.set(rootId, divIds);
      }
    }

    // Fetch union geometry per direct child in a single query
    const siblingRegions: Array<{ regionId: number; name: string; geometry: GeoJSON.Geometry }> = [];
    if (childRegionDivIds.size > 0) {
      // Build a values list: (child_region_id, div_id_array)
      const entries = [...childRegionDivIds.entries()];
      const allDivIdsFlat: number[] = [];
      const regionIdByDivId = new Map<number, number>();
      for (const [rId, divIds] of entries) {
        for (const dId of divIds) {
          allDivIdsFlat.push(dId);
          regionIdByDivId.set(dId, rId);
        }
      }

      // Single query: group divisions by their root child, union geometries
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
      `, [
        allDivIdsFlat,
        allDivIdsFlat.map(dId => regionIdByDivId.get(dId)!),
      ]);

      const nameMap = new Map(directChildren.map(c => [c.id, c.name]));
      for (const row of geoResult.rows) {
        const rId = row.root_child_id as number;
        if (row.geojson) {
          siblingRegions.push({
            regionId: rId,
            name: nameMap.get(rId) ?? `Region ${rId}`,
            geometry: JSON.parse(row.geojson as string),
          });
        }
      }
    }

    logTiming(`Step 5b: sibling geometries (${siblingRegions.length} siblings)`);

    // 6. For each gap division, find the nearest direct child by boundary distance
    const gapDivisions: Array<{
      divisionId: number;
      gadmParentId: number | null;
      name: string;
      path: string;
      level: number;
      areaKm2: number;
      overlapWithGap: number;
      geometry: GeoJSON.Geometry | null;
      suggestedTarget: { regionId: number; regionName: string } | null;
    }> = [];

    // Batch-find nearest child region for all gap divisions in one query
    // instead of N+1 individual ST_Distance queries.
    const gapDivIds = gapResult.rows.map(r => r.id as number);
    const suggestedTargets = new Map<number, { regionId: number; regionName: string }>();

    if (directChildren.length > 0 && gapDivIds.length > 0) {
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
    }

    for (const row of gapResult.rows) {
      const pathInfo = pathMap.get(row.id as number);
      gapDivisions.push({
        divisionId: row.id as number,
        gadmParentId: (row.parent_id as number | null) ?? null,
        name: row.name as string,
        path: pathInfo?.path ?? (row.name as string),
        level: pathInfo?.level ?? 0,
        areaKm2: Math.round(row.area_km2 as number),
        overlapWithGap: Math.round((row.overlap_pct as number) * 100) / 100,
        geometry: row.geojson ? JSON.parse(row.geojson as string) : null,
        suggestedTarget: suggestedTargets.get(row.id as number) ?? null,
      });
    }

    logTiming(`Step 6: nearest-child KNN (${gapDivIds.length} gaps × ${directChildren.length} children)`);

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
    // Get direct children
    const childrenResult = await pool.query(
      'SELECT id, name FROM regions WHERE parent_region_id = $1 AND world_view_id = $2 ORDER BY name',
      [regionId, worldViewId],
    );
    if (childrenResult.rows.length === 0) {
      res.json({ childRegions: [] });
      return;
    }

    // Collect division IDs per direct child via recursive descendant walk
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
      const divIds = (row.div_ids as number[] | null) ?? [];
      if (divIds.length > 0) childRegionDivIds.set(row.root_child_id as number, divIds);
    }

    // Union geometry per child
    const childRegions: Array<{ regionId: number; name: string; geometry: GeoJSON.Geometry }> = [];
    if (childRegionDivIds.size > 0) {
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

      const nameMap = new Map(childrenResult.rows.map(r => [r.id as number, r.name as string]));
      for (const row of geoResult.rows) {
        const rId = row.root_child_id as number;
        if (row.geojson) {
          childRegions.push({
            regionId: rId,
            name: nameMap.get(rId) ?? `Region ${rId}`,
            geometry: JSON.parse(row.geojson as string),
          });
        }
      }
    }

    res.json({ childRegions });
  } catch (err) {
    console.error('[WV Import] Children region geometry failed:', err);
    res.status(500).json({ error: err instanceof Error ? err.message : 'Children region geometry failed' });
  }
}
