/**
 * The Commons files geotagged near one point, offered to a curator picking the
 * point's own picture (#1341).
 *
 * GET /api/experiences/locations/:locationId/nearby-pictures
 *
 * Read only, and only on request: the offer is a list a curator picks from on
 * the point's card, and the pick is the point's edit (`editLocation`), which
 * claims the picture, looks up its credit and logs it. Scoped as that edit is,
 * through the object holding the point, and asked about the point's stored
 * coordinate — never a coordinate the client names.
 */

import type { z } from 'zod/v4';
import type { NearbyPictures } from '../../api/responses/curation.js';
import { userAgent } from '../../config/userAgent.js';
import { pool } from '../../db/index.js';
import { createError, failure, notFound } from '../../middleware/errorHandler.js';
import { commonsPicturesNear, NEARBY_RADIUS_M } from '../../services/sync/commonsNearby.js';
import type { locationIdParamSchema } from '../../types/index.js';
import { resolveExperienceScope } from './experienceScope.js';
import { answeringPlaceSql } from '../../db/placePoints.js';

export async function getNearbyPictures(
  { params: { locationId }, caller }: { params: z.output<typeof locationIdParamSchema>; caller: Express.User },
): Promise<NearbyPictures> {
  const found = await pool.query<{ experience_id: number; lat: number | null; lon: number | null }>(
    `SELECT ${answeringPlaceSql()} AS experience_id, ST_Y(el.location) AS lat, ST_X(el.location) AS lon
       FROM experience_locations el
       JOIN experiences e ON e.id = ${answeringPlaceSql()}
      WHERE el.id = $1`,
    [locationId],
  );
  const point = found.rows[0];
  if (!point) throw notFound('Location not found');
  const { permitted } = await resolveExperienceScope(caller.id, caller.role, point.experience_id, 'place');
  if (!permitted) throw createError('You do not have curator permissions for this experience', 403);
  if (point.lat === null || point.lon === null) return { radiusM: NEARBY_RADIUS_M, pictures: [] };

  try {
    return { radiusM: NEARBY_RADIUS_M, pictures: await commonsPicturesNear(point.lat, point.lon, userAgent()) };
  } catch (error) {
    console.warn('[Nearby pictures] Commons did not answer for location', locationId, error instanceof Error ? error.message : error);
    throw failure('Wikimedia Commons did not answer — try again in a moment', 502);
  }
}
