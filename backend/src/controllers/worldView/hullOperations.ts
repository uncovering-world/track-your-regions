/**
 * Hull preview and save operations for regions
 */

import { Request, Response } from 'express';
import { pool } from '../../db/index.js';
import { previewHull, previewHullFromGeometry, generateSingleHull, DEFAULT_HULL_PARAMS } from '../../services/hull/index.js';
import type { HullParams } from '../../services/hull/index.js';

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

  console.log(`[Hull] Preview request for region ${regionId} with params:`, params, customGeometry ? '(with custom geometry)' : '');

  try {
    // If customGeometry provided, use it instead of fetching from DB
    let result;
    if (customGeometry) {
      result = previewHullFromGeometry(customGeometry, params);
    } else {
      result = await previewHull(regionId, params);
    }

    if (result.error) {
      res.status(400).json({ error: result.error });
      return;
    }

    res.json({
      geometry: result.geometry,
      pointCount: result.pointCount,
      crossesDateline: result.crossesDateline,
      params,
      // Include source bounds for debugging - shows what geometry was used
      sourceBounds: result.sourceBounds,
    });
  } catch (e) {
    console.error(`[Hull] Preview error:`, e);
    res.status(500).json({ error: 'Failed to preview hull' });
  }
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

  console.log(`[Hull] Save request for region ${regionId} with params:`, params);

  try {
    const result = await generateSingleHull(regionId, params);

    if (result.error) {
      res.status(400).json({ error: result.error });
      return;
    }

    res.json({
      saved: result.generated,
      pointCount: result.pointCount,
      crossesDateline: result.crossesDateline,
      params,
    });
  } catch (e) {
    console.error(`[Hull] Save error:`, e);
    res.status(500).json({ error: 'Failed to save hull' });
  }
}

/**
 * Get saved hull parameters for a region.
 * GET /api/world-views/regions/:regionId/hull/params
 */
export async function getSavedHullParams(req: Request, res: Response): Promise<void> {
  const regionId = parseInt(String(req.params.regionId));

  try {
    const result = await pool.query(
      'SELECT ts_hull_params FROM regions WHERE id = $1',
      [regionId]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Region not found' });
      return;
    }

    res.json({
      params: result.rows[0].ts_hull_params || null,
    });
  } catch (e) {
    console.error(`[Hull] Error fetching params:`, e);
    res.status(500).json({ error: 'Failed to fetch hull params' });
  }
}
