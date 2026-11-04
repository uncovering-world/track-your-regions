/**
 * One place's picture and its credit, for the world map's hover card (#927).
 *
 * The world layer's points carry no picture: a URL and a credit per point
 * across the viewport would be most of the marker read, and the picture is the
 * object's, shared by every place of a serial site. Measured on the development
 * catalogue on 2026-11-04, a central-European box holds 2,564 objects with a
 * picture, about 315 characters of URL and credit each: some 800 kB before
 * compression beside a 33 kB marker read. So the card asks for the one object
 * the pointer rests on, here, and the marker read does not grow.
 *
 * The card is on one point, and a serial site's part has a picture of its
 * own (ADR-0156): the Church of the Intercession on the Nerl is not its site's
 * montage. So the read names the point too (`locationId`) and answers its own
 * picture beside the object's, by the rule every point read uses
 * (`pointPictureSql`); the web picks between them with `pointPicture`, as a
 * region's card does, and says when the picture is the whole site's.
 *
 * A point is a part only beside another: the one point of a place is the
 * place itself (Timbuktu, whose one point is called Timbuktu), so it answers no
 * point, and the card shows the place's picture without calling it the whole
 * site's — as a region's card names no part for a museum's one point.
 *
 * A stranger reads only what a reader is offered (`readableByIdSql`, as the
 * object's other reads): a refused or unread place answers 404, and a point
 * the place does not show a reader answers no point.
 */

import type { z } from 'zod/v4';
import type { ExperiencePicture } from '../../api/responses/experiences.js';
import type { experiencePictureQuerySchema, idParamSchema } from '../../types/index.js';
import { pool } from '../../db/index.js';
import { offeredLocationSql, publishedContentSql, readableByIdSql } from '../../db/readerPredicates.js';
import { pointPictureSql, shownBySql } from '../../db/placePoints.js';
import { notFound } from '../../middleware/errorHandler.js';

type Picture = Omit<ExperiencePicture, 'point'>;

export async function getExperiencePicture(
  { params: { id }, query: { locationId } }: {
    params: z.output<typeof idParamSchema>;
    query: z.output<typeof experiencePictureQuerySchema>;
  },
): Promise<ExperiencePicture> {
  const result = await pool.query<Picture>(
    `SELECT e.image_url, e.metadata->'imageCredit' AS image_credit
       FROM experiences e
      WHERE e.id = $1 AND ${readableByIdSql('false')}`,
    [id],
  );
  const row = result.rows[0];
  if (!row) throw notFound('Experience not found');
  return {
    image_url: row.image_url ?? null,
    image_credit: row.image_credit ?? null,
    point: locationId === undefined ? null : await pointPicture(id, locationId),
  };
}

/** What a reader may see of the point `alias` of the place `$1`. */
function shownPointSql(alias: string): string {
  return `${shownBySql(alias, 'ARRAY[$1::int]')} AND ${offeredLocationSql(alias)} AND ${publishedContentSql(alias)}`;
}

/** The point's own picture, where the place shows a reader that point and another. */
async function pointPicture(placeId: number, locationId: number): Promise<Picture | null> {
  const result = await pool.query<Picture>(
    `SELECT ${pointPictureSql('el')}
       FROM experience_locations el
      WHERE el.id = $2 AND ${shownPointSql('el')}
        AND EXISTS (SELECT 1 FROM experience_locations other WHERE other.id <> el.id AND ${shownPointSql('other')})`,
    [placeId, locationId],
  );
  const point = result.rows[0];
  return point ? { image_url: point.image_url ?? null, image_credit: point.image_credit ?? null } : null;
}
