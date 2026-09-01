/**
 * Putting a picture on a row that has none, or has one the product may not show.
 *
 * The write both repair actions share — the museums' "fix missing images" and
 * the World Heritage one that answers #557 — so a rule about who owns a
 * photograph is spelled once. What differs between the two is where the picture
 * comes from; what a picture and its credit do to a row does not.
 */

import { pool } from '../../db/index.js';
import { isCommonsPictureUrl } from '../../types/urlSafety.js';
import type { ImageCredit } from './imageCredit.js';

/**
 * What became of one picture a repair tried to put on a row.
 *
 * Three answers rather than a boolean, because the two "not written" cases mean
 * different things to the report: `kept` is a row whose picture a curator owns,
 * and `refused` is a file the product may not show — which a repair has to
 * treat exactly as it treats a site Wikidata states no picture for, or the row
 * is re-selected on every run, re-written and counted fixed again, for good.
 */
export type PictureWrite = 'written' | 'kept' | 'refused';

/**
 * Write one row's picture and its credit, unless a curator owns the picture.
 *
 * Held to the same line as every other writer of the column first: the host is
 * safe by construction — Wikidata's P18 is a Commons file — but the file type
 * is not, since the "image file" rule on that property is a constraint report
 * rather than an enforcement, and an item can carry a PDF or a video under the
 * same `Special:FilePath` shape.
 *
 * Guarded the way the `is_iconic` write is, and for the same reason: a curator
 * can clear a wrong photograph (`imageUrl: ''` is an accepted edit), which
 * claims `image_url` and leaves a row a repair's own WHERE selects — so without
 * the clause, the next click puts the source's picture back over that decision.
 * `COALESCE` because `curated_fields` is nullable and `NULL ? 'x'` is NULL,
 * which would skip every unclaimed row rather than write it.
 *
 * The credit goes in the same statement, so no moment exists in which the card
 * shows a photograph nobody is named for — and the credit that was there goes
 * first, whatever is written after it. A repair puts a *different* picture on
 * the row than the one the stored credit described, and merging the new credit
 * over the old would leave the old one standing wherever Commons could not
 * answer: one person's name under another person's photograph, which is the one
 * thing this feature promises never to do. Where there is no answer the key is
 * therefore absent rather than null. Not because the differ would notice —
 * `jsonEquals` reads null and absent as one absence — but because the presence
 * tests tell them apart: `'{"a":null}'::jsonb ? 'a'` is true, so a stored null
 * would make the key present to the upsert's claim guard
 * (`experiences.metadata ? claimed.k`, `syncUtils.ts`), which would then
 * re-apply a curator's claim over a credit that is not there.
 */
export async function writeFoundPicture(
  experienceId: number,
  imageUrl: string,
  credit: ImageCredit | undefined,
): Promise<PictureWrite> {
  if (!isCommonsPictureUrl(imageUrl)) return 'refused';
  const written = await pool.query(
    `UPDATE experiences
        SET image_url = $1,
            metadata = (COALESCE(metadata, '{}'::jsonb) - 'imageCredit') || $2::jsonb,
            updated_at = NOW()
      WHERE id = $3
        AND NOT COALESCE(curated_fields ? 'image_url', false)`,
    [imageUrl, JSON.stringify(credit ? { imageCredit: credit } : {}), experienceId],
  );
  return (written.rowCount ?? 0) > 0 ? 'written' : 'kept';
}

/**
 * Take away a picture the product may not show, and the credit under it.
 *
 * The other half of the same repair, and the one #557 needs: a row whose
 * `image_url` points at a host whose terms do not let this product draw it is
 * not fixed by leaving it there when no replacement is found. What the card
 * shows then is nothing, which is honest, and the link to the source's own page
 * stays where it was.
 *
 * The credit goes with it, always: a line naming a photographer beside a frame
 * with no picture is a claim about a real person made where the thing that would
 * justify it is not. `- 'imageCredit'` rather than a null, for the reason above.
 */
export async function clearUnshowablePicture(experienceId: number): Promise<boolean> {
  const cleared = await pool.query(
    `UPDATE experiences
        SET image_url = NULL,
            metadata = COALESCE(metadata, '{}'::jsonb) - 'imageCredit',
            updated_at = NOW()
      WHERE id = $1
        AND NOT COALESCE(curated_fields ? 'image_url', false)`,
    [experienceId],
  );
  return (cleared.rowCount ?? 0) > 0;
}
