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
      COUNT(CASE WHEN uses_hull = true THEN 1 END) as hull_regions,
      COUNT(CASE WHEN hull_geom IS NOT NULL THEN 1 END) as with_hull
    FROM regions
    WHERE world_view_id = $1
  `, [worldViewId]);

  const row = result.rows[0];
  const status = {
    total: parseInt(row.total),
    withGeom: parseInt(row.with_geom),
    withAnchor: parseInt(row.with_anchor),
    hullRegions: parseInt(row.hull_regions),
    withHull: parseInt(row.with_hull),
    complete: parseInt(row.with_geom) > 0,
  };
  res.json(status);
}

/**
 * Get geometry for a region
 * Query params:
 * - detail: 'high' (real geom - default), 'display' (user-customized display geom),
 *           'hull' (hull with dateline handling), 'anchor' (anchor point only)
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
       uses_hull as "usesHull",
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

  const { isCustomBoundary, usesHull, anchorLng, anchorLat } = result.rows[0];
  const anchorPoint = anchorLng != null && anchorLat != null ? [anchorLng, anchorLat] : null;

  // For detail levels:
  // - high (default): return real geometry
  // - hull: return hull geometry (handles dateline properly)
  // - anchor: return anchor point only
  if (detail === 'hull') {
    // Return hull geometry (handles dateline properly)
    const hullResult = await pool.query(
      `SELECT
         ST_AsGeoJSON(hull_geom)::json as geometry,
         ST_XMin(hull_geom) as min_lng,
         ST_XMax(hull_geom) as max_lng
       FROM regions
       WHERE id = $1 AND hull_geom IS NOT NULL`,
      [regionId]
    );

    if (hullResult.rows.length > 0 && hullResult.rows[0].geometry) {
      // Check if this is a dateline-crossing geometry (MultiPolygon with parts at both ±180)
      const minLng = hullResult.rows[0].min_lng;
      const maxLng = hullResult.rows[0].max_lng;
      const crossesDateline = (maxLng - minLng) > 180 || (minLng < -170 && maxLng > 170);

      res.json({
        type: 'Feature',
        properties: {
          id: regionId,
          isCustomBoundary: isCustomBoundary || false,
          usesHull: usesHull || false,
          anchorPoint,
          displayMode: 'hull',
          crossesDateline,
        },
        geometry: hullResult.rows[0].geometry,
      });
    } else {
      // Fallback to real geometry
      res.json({
        type: 'Feature',
        properties: {
          id: regionId,
          isCustomBoundary: isCustomBoundary || false,
          usesHull: usesHull || false,
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
          usesHull: usesHull || false,
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
          usesHull: usesHull || false,
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
        usesHull: usesHull || false,
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
            SET geom = validate_multipolygon(ST_GeomFromGeoJSON($1))
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
            SELECT validate_multipolygon(ST_Union(ST_MakeValid(geom))) as merged_geom
            FROM all_geoms
          )
          SELECT ST_AsGeoJSON(merged_geom)::json as geometry
          FROM merged
          WHERE merged_geom IS NOT NULL
        `, [group.id]);

        if (mergedResult.rows.length > 0 && mergedResult.rows[0].geometry) {
          geometry = mergedResult.rows[0].geometry;

          // Cache for next time — trigger handles 3857 + simplified columns
          pool.query(`
            UPDATE regions
            SET geom = validate_multipolygon(ST_GeomFromGeoJSON($1))
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

  // Query param: useDisplay=true to use hull geometries (atlas-style) for hull regions
  const useDisplayGeom = req.query.useDisplay === 'true';

  // Get all subregions (including those without cached geometry)
  // For hull regions when useDisplay=true:
  // - Main geometry: hull_geom (or fallback to geom)
  // - Real geometry: actual island boundaries for detailed rendering
  const groups = await pool.query(`
    SELECT
      cg.id,
      cg.name,
      cg.color,
      cg.uses_hull as "usesHull",
      ST_X(cg.anchor_point) as "anchorLng",
      ST_Y(cg.anchor_point) as "anchorLat",
      (SELECT COUNT(*) FROM regions WHERE parent_region_id = cg.id) > 0 as "hasSubregions",
      -- Main geometry: prioritize hull_geom for hull regions
      ST_AsGeoJSON(
        CASE
          WHEN $2 AND cg.uses_hull AND cg.hull_geom IS NOT NULL
          THEN cg.hull_geom
          ELSE cg.geom
        END
      )::json as geometry,
      -- Also include real geometry for hull regions (lightly simplified) so we can draw island boundaries
      CASE
        WHEN $2 AND cg.uses_hull AND cg.hull_geom IS NOT NULL AND cg.geom IS NOT NULL
        THEN ST_AsGeoJSON(
          CASE
            WHEN ST_NPoints(cg.geom) > 50000 THEN ST_SimplifyPreserveTopology(cg.geom, 0.005)
            WHEN ST_NPoints(cg.geom) > 10000 THEN ST_SimplifyPreserveTopology(cg.geom, 0.002)
            ELSE cg.geom
          END
        )::json
        ELSE NULL
      END as "realGeometry",
      ($2 AND cg.uses_hull AND cg.hull_geom IS NOT NULL) as "usingHull"
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
            SET geom = validate_multipolygon(ST_GeomFromGeoJSON($1))
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
            SELECT validate_multipolygon(ST_Union(ST_MakeValid(geom))) as merged_geom
            FROM all_geoms
          )
          SELECT ST_AsGeoJSON(merged_geom)::json as geometry
          FROM merged
          WHERE merged_geom IS NOT NULL
        `, [group.id]);

        if (mergedResult.rows.length > 0 && mergedResult.rows[0].geometry) {
          geometry = mergedResult.rows[0].geometry;

          // Cache for next time — trigger handles 3857 + simplified columns
          pool.query(`
            UPDATE regions
            SET geom = validate_multipolygon(ST_GeomFromGeoJSON($1))
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
        usesHull: group.usesHull || false,
        usingHull: group.usingHull || false,
        anchorPoint: group.anchorLng != null && group.anchorLat != null
          ? [group.anchorLng, group.anchorLat]
          : null,
        // Include real geometry for hull regions so island boundaries can be drawn on top
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
