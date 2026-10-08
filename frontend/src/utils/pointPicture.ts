/**
 * The picture a card shows for one of an object's points (#1270).
 *
 * **A point shows its own picture where it has one** — a World Heritage
 * component's Wikidata picture, credited like every picture on the site — and
 * its object's otherwise. The fallback is flagged, so a card naming a part
 * can say the photograph is of the whole site rather than let a picture of one
 * pile dwelling stand for another. A museum's one point is the museum, and its
 * card names no part, so the flag says nothing there.
 */

import type { ExperienceLocation, ImageCredit } from '../api/experiences';

export interface PointPicture {
  imageUrl: string | null;
  imageCredit: ImageCredit | null;
  /** The picture is the object's, shown for a point that has none of its own. */
  pictureOfObject: boolean;
}

export function pointPicture(
  object: { image_url: string | null; image_credit?: ImageCredit | null },
  point: Pick<ExperienceLocation, 'image_url' | 'image_credit'> | null | undefined,
): PointPicture {
  if (point?.image_url) {
    return { imageUrl: point.image_url, imageCredit: point.image_credit ?? null, pictureOfObject: false };
  }
  return { imageUrl: object.image_url, imageCredit: object.image_credit ?? null, pictureOfObject: Boolean(point) };
}
