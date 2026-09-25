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
import type { GetGeometryQuery } from '../../types/index.js';

/**
 * This read answers with GADM's own boundary — the same shape for every
 * caller, at full resolution by default: 2.8 MB of GeoJSON text for France
 * alone, which is what the cutting tools take. It sits
 * behind `requireAuth` + `requireAdmin` (`routes/index.ts`) because only the
 * editor asks for it, not because the answer is anyone's own, so it says what
 * that makes it — see `middleware/cacheHeaders.ts` for the rule and its
 * reasons, including why the `Vary: Authorization` the middleware appended is
 * left alone.
 */

/**
 * The column each detail level reads. A preview asks for a stored
 * simplification: France is 2.9 million characters of GeoJSON in full, 103 000
 * at `medium` and 90 000 at `low` (#1010). A row without one falls back to the
 * full shape.
 */
const DETAIL_COLUMN: Record<GetGeometryQuery['detail'], string> = {
  low: 'COALESCE(geom_simplified_low, geom)',
  medium: 'COALESCE(geom_simplified_medium, geom)',
  high: 'geom',
};

/**
 * Get geometry for a division, at the detail the caller asks for: `high`, the
 * full shape, unless it names a lower one.
 */
export async function getGeometry(req: Request, res: Response): Promise<void> {
  markPublicReferenceBody(res);

  const divisionId = parseInt(String(req.params.divisionId || req.params.regionId));
  const { detail } = req.query as unknown as GetGeometryQuery;

  const result = await pool.query<{ geometry: MultiPolygon }>(
    `SELECT ST_AsGeoJSON(${DETAIL_COLUMN[detail] ?? DETAIL_COLUMN.high})::json as geometry
     FROM administrative_divisions WHERE id = $1 AND geom IS NOT NULL`,
    [divisionId]
  );

  if (result.rows.length === 0) {
    res.status(204).send();
    return;
  }

  respond(res, DivisionGeometry, divisionGeometryOf(divisionId, result.rows[0].geometry));
}
