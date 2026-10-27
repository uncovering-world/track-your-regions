/**
 * Who a region's map image is credited to (#2087, ADR-0043).
 *
 * A map image is a Commons file, most often CC BY-SA and drawn by a Wikivoyage
 * mapmaker, and the admin's import and editor dialogs draw it, so it carries its
 * credit like every other picture the product shows. The credit is read from
 * Commons the first time a dialog draws the file and kept on its
 * `region_map_images` rows: the import itself does not ask, since it holds
 * thousands of candidates and only the drawn ones owe a line.
 */

import type { z } from 'zod/v4';
import type { ImageCredit } from '../../api/responses/experiences.js';
import type { MapImageCredits } from '../../api/responses/wvImportTreeOps.js';
import { userAgent } from '../../config/userAgent.js';
import { pool } from '../../db/index.js';
import { fetchCommonsCredits } from '../../services/sync/imageCredit.js';
import { WaitBudget } from '../../services/sync/sourceRetry.js';
import type { worldViewIdParamSchema, wvImportMapCreditsSchema } from '../../types/index.js';

/** A dialog is waiting on the answer, so Commons gets one short attempt, as for a curator's save. */
const CREDIT_TIMEOUT_MS = 5000;

/**
 * The credits of the map images a dialog is about to draw.
 * POST /api/admin/wv-import/matches/:worldViewId/map-credits
 *
 * A url no region of the world view holds is left out of the answer, so this
 * is never a way to ask Commons about an arbitrary file. A credit Commons did
 * not give in time is answered as null and not stored, so the next draw asks
 * again.
 */
export async function getMapImageCredits(
  { params: { worldViewId }, body }: { params: z.output<typeof worldViewIdParamSchema>; body: z.output<typeof wvImportMapCreditsSchema> },
): Promise<MapImageCredits> {
  const urls = [...new Set(body.urls)];
  // A file two regions share is one credit; a row that already holds it wins.
  const held = await pool.query<{ image_url: string; image_credit: ImageCredit | null }>(
    `SELECT DISTINCT ON (m.image_url) m.image_url, m.image_credit
       FROM region_map_images m
       JOIN regions r ON r.id = m.region_id
      WHERE r.world_view_id = $1 AND m.image_url = ANY($2::text[])
      ORDER BY m.image_url, m.image_credit IS NULL`,
    [worldViewId, urls],
  );
  const credits = new Map(held.rows.map((row) => [row.image_url, row.image_credit]));

  const unread = [...credits].filter(([, credit]) => credit === null).map(([url]) => url);
  if (unread.length > 0) {
    const fetched = await fetchCommonsCredits(unread, {
      userAgent: userAgent({ purpose: 'map image credit' }),
      budget: new WaitBudget(0),
      timeoutMs: CREDIT_TIMEOUT_MS,
    });
    if (fetched.size > 0) {
      // Every row of the file, in any world view: the credit is the file's.
      await pool.query(
        `UPDATE region_map_images m SET image_credit = v.credit
           FROM jsonb_each($1::jsonb) AS v(url, credit)
          WHERE m.image_url = v.url AND m.image_credit IS NULL`,
        [JSON.stringify(Object.fromEntries(fetched))],
      );
      for (const [url, credit] of fetched) credits.set(url, credit);
    }
  }

  return {
    credits: urls.filter((url) => credits.has(url)).map((url) => ({ url, credit: credits.get(url) ?? null })),
  };
}
