/**
 * A region's reference map in the Create Subregions dialog (#595, ADR-0113):
 * the image an admin lays under the divisions and calibrates by its corners,
 * kept in `region_image_overlays`, one per region. Admin-only working material,
 * never shown to a visitor.
 */

import type { z } from 'zod/v4';
import { NO_CONTENT } from '../../api/route.js';
import type { RegionImageOverlay } from '../../api/responses/regions.js';
import { pool } from '../../db/index.js';
import type { RegionImageOverlaysRow } from '../../db/schema.generated.js';
import { badRequest, notFound } from '../../middleware/errorHandler.js';
import { OVERLAY_IMAGE_MAX_BYTES, type regionIdParamSchema, type regionImageOverlayBodySchema } from '../../types/index.js';

type RegionParams = z.output<typeof regionIdParamSchema>;
type OverlayBody = z.output<typeof regionImageOverlayBodySchema>;
type OverlayType = 'image/png' | 'image/jpeg' | 'image/webp';

/** Whether `bytes` begin with the signature of `type`: what the file is, whatever it was called. */
function hasSignature(bytes: Buffer, type: OverlayType): boolean {
  switch (type) {
    case 'image/png':
      return bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    case 'image/jpeg':
      return bytes.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]));
    case 'image/webp':
      return bytes.subarray(0, 4).toString('latin1') === 'RIFF' && bytes.subarray(8, 12).toString('latin1') === 'WEBP';
  }
}

/**
 * The bytes and type of a reference map's data URL, refused unless they are
 * the raster image the URL says, within the cap. Security Rule 4: the content
 * is checked, not the name or the declared type alone — an SVG, which can
 * carry script, never reaches the table.
 */
export function decodeOverlayImage(dataUrl: string): { bytes: Buffer; type: OverlayType } {
  const match = /^data:(image\/(?:png|jpeg|webp));base64,(.+)$/.exec(dataUrl);
  if (!match) throw badRequest('imageDataUrl must be a base64 PNG, JPEG or WebP data URL');
  const type = match[1] as OverlayType;
  const bytes = Buffer.from(match[2], 'base64');
  if (bytes.length === 0) throw badRequest('The image is empty');
  if (bytes.length > OVERLAY_IMAGE_MAX_BYTES) {
    throw badRequest(`The image is ${bytes.length} bytes; a reference map may hold at most ${OVERLAY_IMAGE_MAX_BYTES}`);
  }
  if (!hasSignature(bytes, type)) throw badRequest(`The image is not the ${type} its data URL says it is`);
  return { bytes, type };
}

type OverlayRow = Pick<RegionImageOverlaysRow,
  'region_id' | 'image' | 'image_type' | 'image_name' | 'image_width' | 'image_height' | 'corners' | 'opacity' | 'updated_at'>;

function overlayOf(row: OverlayRow): RegionImageOverlay {
  return {
    regionId: row.region_id,
    imageDataUrl: `data:${row.image_type};base64,${row.image.toString('base64')}`,
    imageName: row.image_name,
    imageWidth: row.image_width,
    imageHeight: row.image_height,
    corners: row.corners as RegionImageOverlay['corners'],
    opacity: row.opacity,
    updatedAt: row.updated_at.toISOString(),
  };
}

const OVERLAY_COLUMNS = 'region_id, image, image_type, image_name, image_width, image_height, corners, opacity, updated_at';

/** A region's reference map, or none (204) where it has not been given one. */
export async function getRegionImageOverlay(
  { params: { regionId } }: { params: RegionParams },
): Promise<RegionImageOverlay | typeof NO_CONTENT> {
  const result = await pool.query<OverlayRow>(
    `SELECT ${OVERLAY_COLUMNS} FROM region_image_overlays WHERE region_id = $1`, [regionId],
  );
  return result.rows[0] ? overlayOf(result.rows[0]) : NO_CONTENT;
}

/**
 * Keep a region's reference map, replacing the one it had. Answers 204: the
 * caller holds the image it sent, and a body would send up to 10 MB back.
 */
export async function saveRegionImageOverlay(
  { params: { regionId }, body, caller }: { params: RegionParams; body: OverlayBody; caller: Express.User },
): Promise<typeof NO_CONTENT> {
  const { bytes, type } = decodeOverlayImage(body.imageDataUrl);
  // The region is asked for in the same statement, so one deleted meanwhile
  // writes nothing rather than failing on its foreign key.
  const result = await pool.query(
    `INSERT INTO region_image_overlays
       (region_id, image, image_type, image_name, image_width, image_height, corners, opacity, updated_by, updated_at)
     SELECT r.id, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, NOW() FROM regions r WHERE r.id = $1
     ON CONFLICT (region_id) DO UPDATE SET
       image = EXCLUDED.image, image_type = EXCLUDED.image_type, image_name = EXCLUDED.image_name,
       image_width = EXCLUDED.image_width, image_height = EXCLUDED.image_height, corners = EXCLUDED.corners,
       opacity = EXCLUDED.opacity, updated_by = EXCLUDED.updated_by, updated_at = EXCLUDED.updated_at`,
    [regionId, bytes, type, body.imageName, body.imageWidth, body.imageHeight,
      JSON.stringify(body.corners), body.opacity, caller.id],
  );
  if (result.rowCount === 0) throw notFound('Region not found');
  return NO_CONTENT;
}

/** Take a region's reference map away; a region without one is answered the same. */
export async function deleteRegionImageOverlay(
  { params: { regionId } }: { params: RegionParams },
): Promise<typeof NO_CONTENT> {
  await pool.query('DELETE FROM region_image_overlays WHERE region_id = $1', [regionId]);
  return NO_CONTENT;
}
