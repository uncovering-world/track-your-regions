/**
 * Division geometry operations
 */

import type { z } from 'zod/v4';
import { NO_CONTENT } from '../../api/route.js';
import type { DivisionGeometry } from '../../api/responses/divisions.js';
import type { MultiPolygon } from '../../api/responses/experiences.js';
import { pool } from '../../db/index.js';
import { divisionGeometryOf } from './divisionAnswerRows.js';
import type { divisionIdParamSchema, GetGeometryQuery } from '../../types/index.js';

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
 * full shape, unless it names a lower one. A division with no geometry answers
 * 204.
 */
export async function getGeometry(
  { params: { divisionId }, query: { detail } }: {
    params: z.output<typeof divisionIdParamSchema>;
    query: GetGeometryQuery;
  },
): Promise<DivisionGeometry | typeof NO_CONTENT> {

  const result = await pool.query<{ geometry: MultiPolygon }>(
    `SELECT ST_AsGeoJSON(${DETAIL_COLUMN[detail] ?? DETAIL_COLUMN.high})::json as geometry
     FROM administrative_divisions WHERE id = $1 AND geom IS NOT NULL`,
    [divisionId]
  );

  if (result.rows.length === 0) return NO_CONTENT;

  return divisionGeometryOf(divisionId, result.rows[0].geometry);
}
