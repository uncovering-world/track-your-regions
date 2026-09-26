/**
 * The URL field schemas every request surface shares (#933): a stored http(s)
 * url, a picture url on a host we may draw (ADR-0043), and the two required
 * forms. In a module of their own because the world-view import schemas
 * (`worldViewImportSchemas.ts`) and the catalogue's own (`index.ts`) both
 * read them, and a barrel that imports from a module it re-exports is a
 * cycle.
 */

import { z } from 'zod/v4';
import { COLUMN_WIDTHS } from '../db/schema.generated.js';
import {
  isStorableHttpUrl,
  isDisplayablePictureUrl,
  normalizeStorableUrl,
  STORABLE_HTTP_URL_MESSAGE,
  DISPLAYABLE_PICTURE_URL_MESSAGE,
} from './urlSafety.js';

/**
 * A URL field bounded by whatever holds it, kept to the shapes that field can
 * legitimately take. Most of these end up inside the `metadata` JSONB, which
 * has no width, so they keep the generic 2000; `imageUrl` is stored in
 * `experiences.image_url` and `treasures.image_url`, and takes the narrower
 * of the two widths instead.
 *
 * The value is judged, then rewritten to the form the parser read, and that is
 * what gets stored: `validate()` puts the parsed object back on the request, so
 * no consumer downstream sees a spelling this rule did not read. The width is
 * measured last, on that stored form, because percent-encoding can make it
 * longer than what arrived.
 */
const boundedUrl = (max: number, isStorable: (value: string) => boolean, message: string) =>
  z.string().trim().optional()
    .refine((val) => !val || isStorable(val), { message })
    .transform((val) => (val === undefined ? val : normalizeStorableUrl(val)))
    .refine((val) => !val || val.length <= max, {
      message: `URL must be at most ${max} characters once normalised`,
    });

export const safeUrlSchema = boundedUrl(2000, isStorableHttpUrl, STORABLE_HTTP_URL_MESSAGE);
export const safeImageUrlSchema = boundedUrl(
  Math.min(COLUMN_WIDTHS.experiences.image_url, COLUMN_WIDTHS.treasures.image_url),
  isDisplayablePictureUrl,
  DISPLAYABLE_PICTURE_URL_MESSAGE,
);

/**
 * The same rule for a url that has to be there: an element of a list, or a
 * value a route acts on at once. `boundedUrl` reads an absent or empty value
 * as "leave the field alone" or "clear it", which an element of a list cannot
 * mean -- a candidate that is nothing is not a candidate.
 */
const requiredUrl = (max: number, isStorable: (value: string) => boolean, message: string) =>
  z.string().trim()
    .refine(isStorable, { message })
    .transform(normalizeStorableUrl)
    .refine((val) => val.length <= max, {
      message: `URL must be at most ${max} characters once normalised`,
    });

export const requiredSafeUrlSchema = requiredUrl(2000, isStorableHttpUrl, STORABLE_HTTP_URL_MESSAGE);

/**
 * A link that may be left unsaid but not emptied: a region's source page
 * (#703). `safeUrlSchema` reads '' as "clear the field", which fits a curator's
 * form, where the controller turns it into NULL. Nothing does for
 * `source_url` -- the rename handler writes the value it is given, and every
 * reader of the column tests it for truthiness -- so a page is either named or
 * not sent, and '' stays refused, the way `z.string().url()` refused it.
 */
export const optionalSafeUrlSchema = requiredSafeUrlSchema.optional();
