/**
 * Division geometry operations
 */

import { Request, Response } from 'express';
import { pool } from '../../db/index.js';

/**
 * Get geometry for a division
 */
export async function getGeometry(req: Request, res: Response): Promise<void> {
  const divisionId = parseInt(String(req.params.divisionId || req.params.regionId));

  const result = await pool.query(
    `SELECT ST_AsGeoJSON(geom)::json as geometry FROM administrative_divisions WHERE id = $1 AND geom IS NOT NULL`,
    [divisionId]
  );

  if (result.rows.length === 0 || !result.rows[0].geometry) {
    res.status(204).send();
    return;
  }

  res.json({
    type: 'Feature',
    properties: { id: divisionId },
    geometry: result.rows[0].geometry,
  });
}

/**
 * Get geometries for all direct subdivisions of a division
 */
export async function getSubdivisionGeometries(req: Request, res: Response): Promise<void> {
  const divisionId = parseInt(String(req.params.divisionId || req.params.regionId));

  const query = `
    SELECT
      id,
      name,
      has_children,
      ST_AsGeoJSON(geom)::json as geometry
    FROM administrative_divisions
    WHERE parent_id = $1
      AND geom IS NOT NULL
  `;

  const result = await pool.query(query, [divisionId]);

  if (result.rows.length === 0) {
    res.status(204).send();
    return;
  }

  const features = result.rows.map(d => ({
    type: 'Feature' as const,
    properties: {
      id: d.id,
      name: d.name,
      hasChildren: d.has_children,
    },
    geometry: d.geometry,
  }));

  res.json({
    type: 'FeatureCollection',
    features,
  });
}

/**
 * Get geometries for root divisions (continents)
 */
export async function getRootGeometries(req: Request, res: Response): Promise<void> {
  const query = `
    SELECT
      id,
      name,
      has_children,
      ST_AsGeoJSON(geom)::json as geometry
    FROM administrative_divisions
    WHERE parent_id IS NULL
      AND geom IS NOT NULL
  `;

  const result = await pool.query(query);

  if (result.rows.length === 0) {
    res.status(204).send();
    return;
  }

  const features = result.rows.map(d => ({
    type: 'Feature' as const,
    properties: {
      id: d.id,
      name: d.name,
      hasChildren: d.has_children,
    },
    geometry: d.geometry,
  }));

  res.json({
    type: 'FeatureCollection',
    features,
  });
}
