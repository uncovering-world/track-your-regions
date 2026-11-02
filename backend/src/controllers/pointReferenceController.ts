/**
 * What stands at a point, and where a place's article says it is (#2206): the
 * two references a point dialog draws beside the claims it compares, read when
 * a curator opens it.
 *
 * Both ask a third party on the product's behalf, so both are the curator's,
 * and both run while a curator waits: OpenStreetMap through the one Nominatim
 * door (`services/nominatim.ts`, its usage policy held there), Wikipedia through
 * `services/wikipediaCoordinate.ts`. Neither answer is stored; each is cached
 * for a day where it is read.
 */

import type { z } from 'zod/v4';
import type { ArticlePoint, PlaceAtPoint } from '../api/responses/geocode.js';
import type { ExperiencesRow } from '../db/schema.generated.js';
import { pool } from '../db/index.js';
import { failure, notFound } from '../middleware/errorHandler.js';
import type { idParamSchema, placeAtPointQuerySchema } from '../types/index.js';
import { userAgent } from '../config/userAgent.js';
import { NominatimError, reverseNominatim, type NominatimAtPoint } from '../services/nominatim.js';
import { articleCoordinate } from '../services/wikipediaCoordinate.js';

// No bot marker: a curator opened the dialog and waits on it.
const USER_AGENT = userAgent();
/** Past this a label is no help to a dialog already on screen; the queue's own ceiling is longer. */
const REVERSE_TIMEOUT_MS = 10000;
const OSM_TYPES: Record<string, string> = { node: 'node', way: 'way', relation: 'relation' };
/** The address parts that say where a point is, narrowest first. */
const AREA_KEYS = ['neighbourhood', 'quarter', 'suburb', 'hamlet', 'village', 'town', 'city_district', 'city'];

/** Nominatim's answer as the dialog reads it: a name, an address, an area and a kind. */
export function placeAtPointOf(found: NominatimAtPoint): PlaceAtPoint {
  const address = found.address ?? {};
  const street = address.road
    ? [address.house_number, address.road].filter(Boolean).join(' ')
    : (address.pedestrian ?? address.footway ?? null);
  const area = AREA_KEYS.map(key => address[key]).find(Boolean) ?? null;
  const osmType = found.osm_type ? OSM_TYPES[found.osm_type] : undefined;
  return {
    name: found.name?.trim() || null,
    street,
    area,
    category: found.category ?? null,
    type: found.type ?? null,
    osmUrl: osmType && Number.isInteger(found.osm_id) ? `https://www.openstreetmap.org/${osmType}/${found.osm_id}` : null,
  };
}

/** GET /api/geocode/reverse — what OpenStreetMap holds at a point. */
export async function placeAtPoint(
  { query: { lat, lon } }: { query: z.output<typeof placeAtPointQuerySchema> },
): Promise<PlaceAtPoint> {
  try {
    return placeAtPointOf(await reverseNominatim(lat, lon, {
      userAgent: USER_AGENT, signal: AbortSignal.timeout(REVERSE_TIMEOUT_MS),
    }));
  } catch (error) {
    if (error instanceof NominatimError) throw failure('Nominatim request failed', error.status);
    console.error('Nominatim reverse error:', error);
    throw failure('Reverse lookup failed', 500);
  }
}

/** GET /api/geocode/article-point/:id — where the place's Wikipedia article says it stands. */
export async function articlePoint(
  { params: { id } }: { params: z.output<typeof idParamSchema> },
): Promise<ArticlePoint> {
  const result = await pool.query<Pick<ExperiencesRow, 'id'> & { article: string | null }>(
    `SELECT id, metadata->>'wikipediaUrl' AS article FROM experiences WHERE id = $1`, [id],
  );
  const row = result.rows[0];
  if (!row) throw notFound('Experience not found');
  const article = row.article?.trim() || null;
  return { article, coordinate: article ? await articleCoordinate(article) : null };
}
