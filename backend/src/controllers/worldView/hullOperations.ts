/**
 * Hull preview and save operations for regions
 */

import { Request, Response } from 'express';
import { respond } from '../../api/respond.js';
import { HullPreview, HullSaved, SavedHullParams } from '../../api/responses/geometry.js';
import { pool } from '../../db/index.js';
import type { RegionsRow } from '../../db/schema.generated.js';
import { previewHull, previewHullFromGeometry, generateSingleHull, DEFAULT_HULL_PARAMS } from '../../services/hull/index.js';
import type { HullParams, PreviewHullResult } from '../../services/hull/index.js';

// Each handler answers after its try: the catch answers with a message of its
// own, and a body that fails its schema must reach the error handler as the
// named 500 instead (development guide § API Layer).

/**
 * Preview hull with custom parameters without saving.
 * POST /api/world-views/regions/:regionId/hull/preview
 * Body: { bufferKm: number, concavity: number, simplifyTolerance: number, customGeometry?: GeoJSON.Geometry }
 * If customGeometry is provided, it will be used instead of fetching from DB.
 */
export async function previewHullGeometry(req: Request, res: Response): Promise<void> {
  const regionId = parseInt(String(req.params.regionId));
  const { bufferKm, concavity, simplifyTolerance, customGeometry } = req.body;

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
    res.status(500).json({ error: 'Failed to preview hull' });
    return;
  }

  if (result.error) {
    res.status(400).json({ error: result.error });
    return;
  }

  // The source bounds the preview also returns are logged by the service and
  // not sent: no reader draws them.
  respond(res, HullPreview, {
    geometry: result.geometry,
    pointCount: result.pointCount,
    crossesDateline: result.crossesDateline,
    params,
  });
}

/**
 * Save hull with custom parameters.
 * POST /api/world-views/regions/:regionId/hull/save
 * Body: { bufferKm: number, concavity: number, simplifyTolerance: number }
 */
export async function saveHullGeometry(req: Request, res: Response): Promise<void> {
  const regionId = parseInt(String(req.params.regionId));
  const { bufferKm, concavity, simplifyTolerance } = req.body;

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
    res.status(500).json({ error: 'Failed to save hull' });
    return;
  }

  if (result.error) {
    res.status(400).json({ error: result.error });
    return;
  }

  respond(res, HullSaved, {
    saved: result.generated,
    pointCount: result.pointCount ?? 0,
    crossesDateline: result.crossesDateline ?? false,
    params,
  });
}

/**
 * Get saved hull parameters for a region.
 * GET /api/world-views/regions/:regionId/hull/params
 */
export async function getSavedHullParams(req: Request, res: Response): Promise<void> {
  const regionId = parseInt(String(req.params.regionId));

  let saved: HullParams | null;
  try {
    const result = await pool.query<Pick<RegionsRow, 'hull_params'>>(
      'SELECT hull_params FROM regions WHERE id = $1',
      [regionId]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Region not found' });
      return;
    }
    saved = result.rows[0].hull_params as HullParams | null;
  } catch (e) {
    console.error(`[Hull] Error fetching params:`, e);
    res.status(500).json({ error: 'Failed to fetch hull params' });
    return;
  }

  // Stored JSON reaches a reader only through the keys its schema names.
  respond(res, SavedHullParams, {
    params: saved
      ? { bufferKm: saved.bufferKm, concavity: saved.concavity, simplifyTolerance: saved.simplifyTolerance }
      : null,
  });
}
