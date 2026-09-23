/**
 * Division geometry operations
 */

import { Request, Response } from 'express';
import { respond } from '../../api/respond.js';
import { DivisionGeometry } from '../../api/responses/divisions.js';
import type { MultiPolygon } from '../../api/responses/experiences.js';
import { pool } from '../../db/index.js';
import { divisionGeometryOf } from './divisionAnswerRows.js';
import { markPublicReferenceBody } from '../../middleware/cacheHeaders.js';

/**
 * These three reads answer with GADM's own boundaries — the same shapes for
 * every caller, at full resolution: 2.8 MB of GeoJSON text for France alone,
 * and the whole world for `/root/geometries`. They sit behind `requireAuth` +
 * `requireAdmin` (`routes/index.ts`) because only the editor asks for them,
 * not because the answer is anyone's own, so each says what that makes it —
 * see `middleware/cacheHeaders.ts` for the rule and its reasons, including
 * why the `Vary: Authorization` the middleware appended is left alone.
 */

/**
 * Get geometry for a division
 */
export async function getGeometry(req: Request, res: Response): Promise<void> {
  markPublicReferenceBody(res);

  const divisionId = parseInt(String(req.params.divisionId || req.params.regionId));

  const result = await pool.query<{ geometry: MultiPolygon }>(
    `SELECT ST_AsGeoJSON(geom)::json as geometry FROM administrative_divisions WHERE id = $1 AND geom IS NOT NULL`,
    [divisionId]
  );

  if (result.rows.length === 0) {
    res.status(204).send();
    return;
  }

  respond(res, DivisionGeometry, divisionGeometryOf(divisionId, result.rows[0].geometry));
}

/**
 * Get geometries for all direct subdivisions of a division
 */
export async function getSubdivisionGeometries(req: Request, res: Response): Promise<void> {
  markPublicReferenceBody(res);

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
  markPublicReferenceBody(res);

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
