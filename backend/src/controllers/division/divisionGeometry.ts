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
 * This read answers with GADM's own boundary — the same shape for every
 * caller, at full resolution: 2.8 MB of GeoJSON text for France alone. It sits
 * behind `requireAuth` + `requireAdmin` (`routes/index.ts`) because only the
 * editor asks for it, not because the answer is anyone's own, so it says what
 * that makes it — see `middleware/cacheHeaders.ts` for the rule and its
 * reasons, including why the `Vary: Authorization` the middleware appended is
 * left alone.
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
