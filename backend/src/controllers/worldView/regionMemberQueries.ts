/**
 * Region Member Queries
 *
 * Read-only operations for region members and their geometries.
 */

import { Request, Response } from 'express';
import { pool } from '../../db/index.js';

/**
 * Get all member admin divisions of a region, plus any subregions
 * Includes full path for admin divisions to distinguish duplicates like Russia in Asia vs Europe
 * Excludes admin divisions that are already represented as subregions (to avoid duplicates)
 */
export async function getRegionMembers(req: Request, res: Response): Promise<void> {
  const regionId = parseInt(String(req.params.regionId || req.params.groupId));

  // Get subregions first (child regions of this region)
  const subregions = await pool.query(`
    SELECT id, name, NULL as "parentId",
           false as "hasChildren",
           'subregion' as "memberType",
           color,
           name as path
    FROM regions cg
    WHERE parent_region_id = $1
    ORDER BY name
  `, [regionId]);

  // Get the names of subregions to filter out matching admin divisions
  const subregionNames = new Set(subregions.rows.map(r => r.name));

  // Get admin division members with their full path, excluding those that match subregion names
  // Also include whether they have a custom geometry (partial admin division)
  const divisions = await pool.query(`
    WITH RECURSIVE division_path AS (
      -- Start with the member admin divisions
      SELECT
        cgm.id as member_row_id,
        ad.id as member_id,
        ad.id as current_id,
        COALESCE(cgm.custom_name, ad.name) as name,
        ad.parent_id,
        ad.has_children,
        COALESCE(cgm.custom_name, ad.name)::text as path,
        1 as depth,
        cgm.custom_geom IS NOT NULL as has_custom_geom
      FROM region_members cgm
      JOIN administrative_divisions ad ON cgm.division_id = ad.id
      WHERE cgm.region_id = $1

      UNION ALL

      -- Recursively get parents
      SELECT
        dp.member_row_id,
        dp.member_id,
        p.id as current_id,
        dp.name,
        p.parent_id,
        dp.has_children,
        (p.name || ' > ' || dp.path)::text as path,
        dp.depth + 1,
        dp.has_custom_geom
      FROM division_path dp
      JOIN administrative_divisions p ON dp.parent_id = p.id
    )
    SELECT DISTINCT ON (member_row_id)
      member_id as id,
      member_row_id as "memberRowId",
      name,
      has_children as "hasChildren",
      'division' as "memberType",
      path,
      has_custom_geom as "hasCustomGeometry"
    FROM division_path
    ORDER BY member_row_id, depth DESC
  `, [regionId]);

  // Filter out admin divisions that have a matching subregion (added with checkbox)
  const filteredDivisions = divisions.rows.filter(d => !subregionNames.has(d.name));

  // Combine and return both
  const allMembers = [
    ...subregions.rows.map(r => ({ ...r, isSubregion: true })),
    ...filteredDivisions.map(d => ({ ...d, isSubregion: false })),
  ];

  res.json(allMembers);
}

/**
 * Get geometries for all division members of a region
 * Returns a GeoJSON FeatureCollection with geometries (using custom_geom if available)
 */
export async function getRegionMemberGeometries(req: Request, res: Response): Promise<void> {
  const regionId = parseInt(String(req.params.regionId || req.params.groupId));

  const result = await pool.query(`
    SELECT
      cgm.id as member_row_id,
      ad.id as division_id,
      COALESCE(cgm.custom_name, ad.name) as name,
      ST_AsGeoJSON(
        ST_Simplify(
          CASE
            -- Custom cut geometries may be invalid and need normalization
            WHEN cgm.custom_geom IS NOT NULL THEN ST_MakeValid(cgm.custom_geom)
            -- Administrative boundaries are preloaded and should not pay ST_MakeValid cost per row
            ELSE ad.geom
          END,
          0.001
        )
      )::json as geometry,
      cgm.custom_geom IS NOT NULL as has_custom_geom
    FROM region_members cgm
    JOIN administrative_divisions ad ON cgm.division_id = ad.id
    WHERE cgm.region_id = $1
      AND (cgm.custom_geom IS NOT NULL OR ad.geom IS NOT NULL)
  `, [regionId]);

  const features = result.rows
    .filter(row => row.geometry)
    .map(row => ({
      type: 'Feature',
      properties: {
        memberRowId: row.member_row_id,
        divisionId: row.division_id,
        name: row.name,
        hasCustomGeom: row.has_custom_geom,
      },
      geometry: row.geometry,
    }));

  res.json({
    type: 'FeatureCollection',
    features,
  });
}
