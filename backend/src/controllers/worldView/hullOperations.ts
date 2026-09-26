/**
 * Hull preview and save operations for regions
 */

import type { z } from 'zod/v4';
import type { HullPreview, HullSaved, SavedHullParams } from '../../api/responses/geometry.js';
import { badRequest, failure, notFound } from '../../middleware/errorHandler.js';
import type { hullPreviewBodySchema, hullSaveBodySchema, regionIdParamSchema } from '../../types/index.js';
import { pool } from '../../db/index.js';
import type { RegionsRow } from '../../db/schema.generated.js';
import { previewHull, previewHullFromGeometry, generateSingleHull, DEFAULT_HULL_PARAMS } from '../../services/hull/index.js';
import type { HullParams, PreviewHullResult } from '../../services/hull/index.js';

type RegionParams = z.output<typeof regionIdParamSchema>;

/**
 * Preview hull with custom parameters without saving.
 * POST /api/world-views/regions/:regionId/hull/preview
 * Body: { bufferKm: number, concavity: number, simplifyTolerance: number, customGeometry?: GeoJSON.Geometry }
 * If customGeometry is provided, it will be used instead of fetching from DB.
 */
export async function previewHullGeometry(
  { params: { regionId }, body: { bufferKm, concavity, simplifyTolerance, customGeometry } }: {
    params: RegionParams;
    body: z.output<typeof hullPreviewBodySchema>;
  },
): Promise<HullPreview> {
  const params: HullParams = {
    bufferKm: bufferKm ?? DEFAULT_HULL_PARAMS.bufferKm,
    concavity: concavity ?? DEFAULT_HULL_PARAMS.concavity,
    simplifyTolerance: simplifyTolerance ?? DEFAULT_HULL_PARAMS.simplifyTolerance,
  };

  // nosemgrep: javascript.lang.security.audit.unsafe-formatstring.unsafe-formatstring -- regionId is a number
  console.log(`[Hull] Preview request for region ${regionId} with params:`, params, customGeometry ? '(with custom geometry)' : '');

  let result: PreviewHullResult;
  try {
    // If customGeometry provided, use it instead of fetching from DB
    result = customGeometry
      ? await previewHullFromGeometry(customGeometry, params)
      : await previewHull(regionId, params);
  } catch (e) {
    console.error(`[Hull] Preview error:`, e);
    throw failure('Failed to preview hull', 500);
  }

  if (result.error) throw badRequest(result.error);

  // The source bounds the preview also returns are logged by the service and
  // not sent: no reader draws them.
  return {
    geometry: result.geometry,
    pointCount: result.pointCount,
    crossesDateline: result.crossesDateline,
    params,
  };
}

/**
 * Save hull with custom parameters.
 * POST /api/world-views/regions/:regionId/hull/save
 * Body: { bufferKm: number, concavity: number, simplifyTolerance: number }
 */
export async function saveHullGeometry(
  { params: { regionId }, body: { bufferKm, concavity, simplifyTolerance } }: {
    params: RegionParams;
    body: z.output<typeof hullSaveBodySchema>;
  },
): Promise<HullSaved> {
  const params: HullParams = {
    bufferKm: bufferKm ?? DEFAULT_HULL_PARAMS.bufferKm,
    concavity: concavity ?? DEFAULT_HULL_PARAMS.concavity,
    simplifyTolerance: simplifyTolerance ?? DEFAULT_HULL_PARAMS.simplifyTolerance,
  };

  // nosemgrep: javascript.lang.security.audit.unsafe-formatstring.unsafe-formatstring -- regionId is a number
  console.log(`[Hull] Save request for region ${regionId} with params:`, params);

  let result: Awaited<ReturnType<typeof generateSingleHull>>;
  try {
    result = await generateSingleHull(regionId, params);
  } catch (e) {
    console.error(`[Hull] Save error:`, e);
    throw failure('Failed to save hull', 500);
  }

  if (result.error) throw badRequest(result.error);

  return {
    saved: result.generated,
    pointCount: result.pointCount ?? 0,
    crossesDateline: result.crossesDateline ?? false,
    params,
  };
}

/**
 * Get saved hull parameters for a region.
 * GET /api/world-views/regions/:regionId/hull/params
 */
export async function getSavedHullParams(
  { params: { regionId } }: { params: RegionParams },
): Promise<SavedHullParams> {
  let rows: Pick<RegionsRow, 'hull_params'>[];
  try {
    const result = await pool.query<Pick<RegionsRow, 'hull_params'>>(
      'SELECT hull_params FROM regions WHERE id = $1',
      [regionId]
    );
    rows = result.rows;
  } catch (e) {
    console.error(`[Hull] Error fetching params:`, e);
    throw failure('Failed to fetch hull params', 500);
  }

  if (rows.length === 0) throw notFound('Region not found');
  const saved = rows[0].hull_params as HullParams | null;

  // Stored JSON reaches a reader only through the keys its schema names.
  return {
    params: saved
      ? { bufferKm: saved.bufferKm, concavity: saved.concavity, simplifyTolerance: saved.simplifyTolerance }
      : null,
  };
}
