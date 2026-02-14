/**
 * Geometry read operations for regions
 */

import { Request, Response } from 'express';
import { pool } from '../../db/index.js';

/**
 * Get geometry status for a world view
 * Returns counts of regions with/without geometries
 */
export async function getDisplayGeometryStatus(req: Request, res: Response): Promise<void> {
  const worldViewId = parseInt(String(req.params.worldViewId));

  const result = await pool.query(`
    SELECT
      COUNT(*) as total,
      COUNT(CASE WHEN geom IS NOT NULL THEN 1 END) as with_geom,
      COUNT(CASE WHEN anchor_point IS NOT NULL THEN 1 END) as with_anchor,
      COUNT(CASE WHEN is_archipelago = true THEN 1 END) as archipelagos,
      COUNT(CASE WHEN ts_hull_geom IS NOT NULL THEN 1 END) as with_hull
    FROM regions
    WHERE world_view_id = $1
  `, [worldViewId]);

  const row = result.rows[0];
  const status = {
    total: parseInt(row.total),
    withGeom: parseInt(row.with_geom),
    withAnchor: parseInt(row.with_anchor),
    archipelagos: parseInt(row.archipelagos),
    withHull: parseInt(row.with_hull),
    complete: parseInt(row.with_geom) > 0,
  };
  res.json(status);
}

/**
 * Get geometry for a region
 * Query params:
 * - detail: 'high' (real geom - default), 'display' (user-customized display geom),
 *           'ts_hull' (TypeScript hull with dateline handling), 'anchor' (anchor point only)
 * Returns the cached/stored geometry if it exists, otherwise returns 204 No Content
 * Does NOT auto-compute geometry - use computeWorldViewGeometries for that
 */
export async function getRegionGeometry(req: Request, res: Response): Promise<void> {
  // Support both new (regionId) and legacy (groupId) param names
  const regionId = parseInt(String(req.params.regionId || req.params.groupId));
  const detail = req.query.detail as string | undefined;

  // Get cached geometry (including custom boundaries and anchor point)
  const result = await pool.query(
    `SELECT
       ST_AsGeoJSON(geom)::json as geometry,
       is_custom_boundary as "isCustomBoundary",
       is_archipelago as "isArchipelago",
       ST_X(anchor_point) as "anchorLng",
       ST_Y(anchor_point) as "anchorLat"
     FROM regions
     WHERE id = $1 AND geom IS NOT NULL`,
    [regionId]
  );

  if (result.rows.length === 0 || !result.rows[0].geometry) {
    // No geometry computed yet - return 204 No Content
    res.status(204).send();
    return;
  }

  const { isCustomBoundary, isArchipelago, anchorLng, anchorLat } = result.rows[0];
  const anchorPoint = anchorLng != null && anchorLat != null ? [anchorLng, anchorLat] : null;

  // For detail levels:
  // - high (default): return real geometry
  // - ts_hull: return TypeScript-generated hull (handles dateline properly)
  // - anchor: return anchor point only
  if (detail === 'ts_hull') {
    // Return TypeScript-generated hull (handles dateline properly)
    const tsHullResult = await pool.query(
      `SELECT
         ST_AsGeoJSON(ts_hull_geom)::json as geometry,
         ST_XMin(ts_hull_geom) as min_lng,
         ST_XMax(ts_hull_geom) as max_lng
       FROM regions
       WHERE id = $1 AND ts_hull_geom IS NOT NULL`,
      [regionId]
    );

    if (tsHullResult.rows.length > 0 && tsHullResult.rows[0].geometry) {
      // Check if this is a dateline-crossing geometry (MultiPolygon with parts at both ±180)
      const minLng = tsHullResult.rows[0].min_lng;
      const maxLng = tsHullResult.rows[0].max_lng;
      const crossesDateline = (maxLng - minLng) > 180 || (minLng < -170 && maxLng > 170);

      res.json({
        type: 'Feature',
        properties: {
          id: regionId,
          isCustomBoundary: isCustomBoundary || false,
          isArchipelago: isArchipelago || false,
          anchorPoint,
          displayMode: 'ts_hull',
          crossesDateline,
        },
        geometry: tsHullResult.rows[0].geometry,
      });
    } else {
      // Fallback to real geometry
      res.json({
        type: 'Feature',
        properties: {
          id: regionId,
          isCustomBoundary: isCustomBoundary || false,
          isArchipelago: isArchipelago || false,
          anchorPoint,
          displayMode: 'real',
        },
        geometry: result.rows[0].geometry,
      });
    }
  } else if (detail === 'anchor') {
    // Return anchor point only
    const anchorResult = await pool.query(
      `SELECT ST_AsGeoJSON(anchor_point)::json as geometry
       FROM regions
       WHERE id = $1 AND anchor_point IS NOT NULL`,
      [regionId]
    );

    if (anchorResult.rows.length > 0 && anchorResult.rows[0].geometry) {
      res.json({
        type: 'Feature',
        properties: {
          id: regionId,
          isCustomBoundary: isCustomBoundary || false,
          isArchipelago: isArchipelago || false,
          anchorPoint,
        },
        geometry: anchorResult.rows[0].geometry,
      });
    } else {
      // Fallback to centroid of real geometry
      const centroidResult = await pool.query(
        `SELECT ST_AsGeoJSON(ST_Centroid(geom))::json as geometry
         FROM regions
         WHERE id = $1 AND geom IS NOT NULL`,
        [regionId]
      );
      res.json({
        type: 'Feature',
        properties: {
          id: regionId,
          isCustomBoundary: isCustomBoundary || false,
          isArchipelago: isArchipelago || false,
          anchorPoint,
        },
        geometry: centroidResult.rows[0]?.geometry || { type: 'Point', coordinates: [0, 0] },
      });
    }
  } else {
    // Default: return real geometry (geom)
    res.json({
      type: 'Feature',
      properties: {
        id: regionId,
        isCustomBoundary: isCustomBoundary || false,
        isArchipelago: isArchipelago || false,
        anchorPoint,
      },
      geometry: result.rows[0].geometry,
    });
  }
}

/**
 * Get geometries for all root regions in a world view
 * Computes merged geometry on-the-fly if not cached
 * Includes both direct member regions AND subregion geometries
 */
export async function getRootRegionGeometries(req: Request, res: Response): Promise<void> {
  const worldViewId = parseInt(String(req.params.worldViewId));

  // Get all root groups (including those without cached geometry)
  const groups = await pool.query(`
    SELECT
      cg.id,
      cg.name,
      cg.color,
      (SELECT COUNT(*) FROM regions WHERE parent_region_id = cg.id) > 0 as "hasSubregions",
      ST_AsGeoJSON(cg.geom)::json as geometry
    FROM regions cg
    WHERE cg.world_view_id = $1
      AND cg.parent_region_id IS NULL
  `, [worldViewId]);

  if (groups.rows.length === 0) {
    res.status(204).send();
    return;
  }

  // For groups without cached geometry, compute on-the-fly
  const features = await Promise.all(groups.rows.map(async (group) => {
    let geometry = group.geometry;

    if (!geometry) {
      // Count geometries to merge: direct member regions + child groups with geometry
      const countResult = await pool.query(`
        SELECT (
          (SELECT COUNT(*) FROM region_members rm
           JOIN administrative_divisions ad ON rm.division_id = ad.id
           WHERE rm.region_id = $1 AND ad.geom IS NOT NULL)
          +
          (SELECT COUNT(*) FROM regions
           WHERE parent_region_id = $1 AND geom IS NOT NULL)
        ) as count
      `, [group.id]);

      const memberCount = parseInt(countResult.rows[0].count);

      if (memberCount === 0) {
        // No members, no geometry
        geometry = null;
      } else if (memberCount === 1) {
        // Only 1 geometry source - just copy it directly (no merge needed)
        const singleResult = await pool.query(`
          SELECT COALESCE(
            (SELECT ST_AsGeoJSON(COALESCE(rm.custom_geom, ad.geom))::json
             FROM region_members rm
             JOIN administrative_divisions ad ON rm.division_id = ad.id
             WHERE rm.region_id = $1 AND (rm.custom_geom IS NOT NULL OR ad.geom IS NOT NULL)
             LIMIT 1),
            (SELECT ST_AsGeoJSON(geom)::json
             FROM regions
             WHERE parent_region_id = $1 AND geom IS NOT NULL
             LIMIT 1)
          ) as geometry
        `, [group.id]);

        if (singleResult.rows.length > 0) {
          geometry = singleResult.rows[0].geometry;

          // Cache for next time — trigger handles 3857 + simplified columns
          pool.query(`
            UPDATE regions
            SET geom = ST_GeomFromGeoJSON($1)
            WHERE id = $2
          `, [JSON.stringify(geometry), group.id]).catch(() => {});
        }
      } else {
        // Multiple geometries - need to merge direct members + child group geometries
        const mergedResult = await pool.query(`
          WITH direct_member_geoms AS (
            SELECT COALESCE(rm.custom_geom, ad.geom) AS geom
            FROM region_members rm
            JOIN administrative_divisions ad ON rm.division_id = ad.id
            WHERE rm.region_id = $1 AND (rm.custom_geom IS NOT NULL OR ad.geom IS NOT NULL)
          ),
          child_group_geoms AS (
            SELECT geom
            FROM regions
            WHERE parent_region_id = $1 AND geom IS NOT NULL
          ),
          all_geoms AS (
            SELECT geom FROM direct_member_geoms
            UNION ALL
            SELECT geom FROM child_group_geoms
          ),
          merged AS (
            SELECT ST_Multi(ST_Union(ST_MakeValid(geom))) as merged_geom
            FROM all_geoms
          ),
          validated AS (
            SELECT ST_Multi(ST_CollectionExtract(ST_MakeValid(merged_geom), 3)) as merged_geom
            FROM merged
          ),
          with_tolerance AS (
            SELECT
              merged_geom,
              -- Simple tolerance based on point count only (like Python script)
              CASE
                WHEN ST_NPoints(merged_geom) < 5000 THEN 0
                WHEN ST_NPoints(merged_geom) < 20000 THEN 0.0005
                WHEN ST_NPoints(merged_geom) < 50000 THEN 0.001
                WHEN ST_NPoints(merged_geom) < 100000 THEN 0.005
                ELSE 0.01
              END as tolerance
            FROM validated
          )
          SELECT ST_AsGeoJSON(
            CASE
              WHEN tolerance = 0 THEN merged_geom
              ELSE ST_SimplifyPreserveTopology(merged_geom, tolerance)
            END
          )::json as geometry
          FROM with_tolerance
        `, [group.id]);

        if (mergedResult.rows.length > 0 && mergedResult.rows[0].geometry) {
          geometry = mergedResult.rows[0].geometry;

          // Cache for next time — trigger handles 3857 + simplified columns
          pool.query(`
            UPDATE regions
            SET geom = ST_Multi(ST_CollectionExtract(ST_GeomFromGeoJSON($1), 3))
            WHERE id = $2
          `, [JSON.stringify(geometry), group.id]).catch(() => {});
        }
      }
    }

    return {
      type: 'Feature' as const,
      properties: {
        id: group.id,
        name: group.name,
        color: group.color,
        hasSubgroups: group.hasSubgroups,
      },
      geometry,
    };
  }));

  // Filter out groups with no geometry (no member regions)
  const validFeatures = features.filter(f => f.geometry);

  if (validFeatures.length === 0) {
    res.status(204).send();
    return;
  }

  res.json({
    type: 'FeatureCollection',
    features: validFeatures,
  });
}

/**
 * Get geometries for subregions of a region
 * Computes merged geometry on-the-fly if not cached
 * Includes both direct member regions AND child region geometries
 */
export async function getSubregionGeometries(req: Request, res: Response): Promise<void> {
  // Support both new (regionId) and legacy (groupId) param names
  const regionId = parseInt(String(req.params.regionId || req.params.groupId));

  // Query param: useDisplay=true to use hull geometries (atlas-style) for archipelagos
  const useDisplayGeom = req.query.useDisplay === 'true';

  // Get all subregions (including those without cached geometry)
  // For archipelagos when useDisplay=true:
  // - Main geometry: ts_hull_geom (or fallback to geom)
  // - Real geometry: actual island boundaries for detailed rendering
  const groups = await pool.query(`
    SELECT
      cg.id,
      cg.name,
      cg.color,
      cg.is_archipelago as "isArchipelago",
      ST_X(cg.anchor_point) as "anchorLng",
      ST_Y(cg.anchor_point) as "anchorLat",
      (SELECT COUNT(*) FROM regions WHERE parent_region_id = cg.id) > 0 as "hasSubregions",
      -- Main geometry: prioritize ts_hull_geom for archipelagos
      ST_AsGeoJSON(
        CASE
          WHEN $2 AND cg.is_archipelago AND cg.ts_hull_geom IS NOT NULL
          THEN cg.ts_hull_geom
          ELSE cg.geom
        END
      )::json as geometry,
      -- Also include real geometry for archipelagos (lightly simplified) so we can draw island boundaries
      CASE
        WHEN $2 AND cg.is_archipelago AND cg.ts_hull_geom IS NOT NULL AND cg.geom IS NOT NULL
        THEN ST_AsGeoJSON(
          CASE
            WHEN ST_NPoints(cg.geom) > 50000 THEN ST_SimplifyPreserveTopology(cg.geom, 0.005)
            WHEN ST_NPoints(cg.geom) > 10000 THEN ST_SimplifyPreserveTopology(cg.geom, 0.002)
            ELSE cg.geom
          END
        )::json
        ELSE NULL
      END as "realGeometry",
      ($2 AND cg.is_archipelago AND cg.ts_hull_geom IS NOT NULL) as "usingTsHull"
    FROM regions cg
    WHERE cg.parent_region_id = $1
  `, [regionId, useDisplayGeom]);

  if (groups.rows.length === 0) {
    res.status(204).send();
    return;
  }

  // For groups without cached geometry, compute on-the-fly
  const features = await Promise.all(groups.rows.map(async (group) => {
    let geometry = group.geometry;

    if (!geometry) {
      // Count geometries to merge: direct member regions + child groups with geometry
      const countResult = await pool.query(`
        SELECT (
          (SELECT COUNT(*) FROM region_members rm
           JOIN administrative_divisions ad ON rm.division_id = ad.id
           WHERE rm.region_id = $1 AND ad.geom IS NOT NULL)
          +
          (SELECT COUNT(*) FROM regions
           WHERE parent_region_id = $1 AND geom IS NOT NULL)
        ) as count
      `, [group.id]);

      const memberCount = parseInt(countResult.rows[0].count);

      if (memberCount === 0) {
        // No members, no geometry
        geometry = null;
      } else if (memberCount === 1) {
        // Only 1 geometry source - just copy it directly (no merge needed)
        const singleResult = await pool.query(`
          SELECT COALESCE(
            (SELECT ST_AsGeoJSON(COALESCE(rm.custom_geom, ad.geom))::json
             FROM region_members rm
             JOIN administrative_divisions ad ON rm.division_id = ad.id
             WHERE rm.region_id = $1 AND (rm.custom_geom IS NOT NULL OR ad.geom IS NOT NULL)
             LIMIT 1),
            (SELECT ST_AsGeoJSON(geom)::json
             FROM regions
             WHERE parent_region_id = $1 AND geom IS NOT NULL
             LIMIT 1)
          ) as geometry
        `, [group.id]);

        if (singleResult.rows.length > 0) {
          geometry = singleResult.rows[0].geometry;

          // Cache for next time — trigger handles 3857 + simplified columns
          pool.query(`
            UPDATE regions
            SET geom = ST_GeomFromGeoJSON($1)
            WHERE id = $2
          `, [JSON.stringify(geometry), group.id]).catch(() => {});
        }
      } else {
        // Multiple geometries - need to merge direct members + child group geometries
        const mergedResult = await pool.query(`
          WITH direct_member_geoms AS (
            SELECT COALESCE(rm.custom_geom, ad.geom) AS geom
            FROM region_members rm
            JOIN administrative_divisions ad ON rm.division_id = ad.id
            WHERE rm.region_id = $1 AND (rm.custom_geom IS NOT NULL OR ad.geom IS NOT NULL)
          ),
          child_group_geoms AS (
            SELECT geom
            FROM regions
            WHERE parent_region_id = $1 AND geom IS NOT NULL
          ),
          all_geoms AS (
            SELECT geom FROM direct_member_geoms
            UNION ALL
            SELECT geom FROM child_group_geoms
          ),
          merged AS (
            SELECT ST_Multi(ST_Union(ST_MakeValid(geom))) as merged_geom
            FROM all_geoms
          ),
          validated AS (
            SELECT ST_Multi(ST_CollectionExtract(ST_MakeValid(merged_geom), 3)) as merged_geom
            FROM merged
          ),
          with_tolerance AS (
            SELECT
              merged_geom,
              -- Simple tolerance based on point count only (like Python script)
              CASE
                WHEN ST_NPoints(merged_geom) < 5000 THEN 0
                WHEN ST_NPoints(merged_geom) < 20000 THEN 0.0005
                WHEN ST_NPoints(merged_geom) < 50000 THEN 0.001
                WHEN ST_NPoints(merged_geom) < 100000 THEN 0.005
                ELSE 0.01
              END as tolerance
            FROM validated
          )
          SELECT ST_AsGeoJSON(
            CASE
              WHEN tolerance = 0 THEN merged_geom
              ELSE ST_SimplifyPreserveTopology(merged_geom, tolerance)
            END
          )::json as geometry
          FROM with_tolerance
        `, [group.id]);

        if (mergedResult.rows.length > 0 && mergedResult.rows[0].geometry) {
          geometry = mergedResult.rows[0].geometry;

          // Cache for next time — trigger handles 3857 + simplified columns
          pool.query(`
            UPDATE regions
            SET geom = ST_Multi(ST_CollectionExtract(ST_GeomFromGeoJSON($1), 3))
            WHERE id = $2
          `, [JSON.stringify(geometry), group.id]).catch(() => {});
        }
      }
    }

    return {
      type: 'Feature' as const,
      properties: {
        id: group.id,
        name: group.name,
        color: group.color,
        hasSubgroups: group.hasSubgroups,
        isArchipelago: group.isArchipelago || false,
        usingTsHull: group.usingTsHull || false,
        anchorPoint: group.anchorLng != null && group.anchorLat != null
          ? [group.anchorLng, group.anchorLat]
          : null,
        // Include real geometry for archipelagos so island boundaries can be drawn on top
        realGeometry: group.realGeometry || null,
      },
      geometry,
    };
  }));

  // Filter out groups with no geometry (no member regions)
  const validFeatures = features.filter(f => f.geometry);

  if (validFeatures.length === 0) {
    res.status(204).send();
    return;
  }

  res.json({
    type: 'FeatureCollection',
    features: validFeatures,
  });
}
