/**
 * What the pictures a review card shows are (#2192): a photograph, a map, a
 * drawing or engraving, or a diagram, as Commons states it.
 *
 * GET /api/experiences/:id/picture-classes
 *
 * A curator choosing between two pictures saw a map or an engraving drawn
 * exactly like a photograph: Banqiao Dam's picture is a map, and a run proposed
 * an 1865 engraving for the Saqqara Tablet. The request names the place and
 * nothing else: the pictures are the ones the catalogue holds for it — the
 * place's own, each source's reported one, the pictures its open proposals
 * bring (the held proposal a membership's pending pointer holds, and the change
 * set the conflict card reads, for the place and for its works), its points'
 * and its works' — so no caller-named address reaches a request, and only
 * Commons is asked. Scoped as the place's curation is.
 */

import type { z } from 'zod/v4';
import type { PictureClasses } from '../../api/responses/curation.js';
import { pool } from '../../db/index.js';
import { MEMBERSHIPS } from '../../db/membership.js';
import { offeredLinkSql } from '../../db/readerPredicates.js';
import { createError, notFound } from '../../middleware/errorHandler.js';
import { classifyPictures, type PictureToClass } from '../../services/pictureClass/pictureClasses.js';
import type { idParamSchema } from '../../types/index.js';
import { resolveExperienceScope } from './experienceScope.js';
import { conflictChangeOpenSql } from './reviewQueuePredicates.js';

/**
 * One Commons request's worth (`batchTitles`' ceiling), and more than a card
 * shows at once: the place's own pictures and every proposal's come first, so
 * a museum of many works loses the mark on its last works' thumbnails, never
 * on the two sides of a picture question.
 */
const MAX_PICTURES = 50;

/**
 * The pictures a card about place `$1` shows, distinct, the place's own first,
 * each with what it is of: the place, or a work with its type, which decides
 * whether a Commons category speaks about the picture or about the work's own
 * medium (`classifyPicture`).
 */
export const PICTURES_SQL = `
  WITH held AS (
    SELECT ch.changed_fields, ch.contents
      FROM experience_sync_changes ch
      JOIN ${MEMBERSHIPS} m ON m.experience_id = ch.experience_id AND m.pending_change_sync_log_id = ch.sync_log_id
     WHERE ch.experience_id = $1
    UNION ALL
    (SELECT ch.changed_fields, ch.contents FROM experience_sync_changes ch
       JOIN experiences e ON e.id = ch.experience_id
       JOIN experience_sync_logs l ON l.id = ch.sync_log_id
      WHERE ch.experience_id = $1 AND ${conflictChangeOpenSql('e', 'ch', 'l')}
      ORDER BY ch.id DESC LIMIT 1)
  ), urls AS (
    SELECT 0 AS rank, e.image_url AS url, NULL::text AS work_type FROM experiences e WHERE e.id = $1
    UNION ALL
    SELECT 1, m.reported_image_url, NULL FROM ${MEMBERSHIPS} m WHERE m.experience_id = $1
    UNION ALL
    SELECT 2, f->>'new', NULL FROM held, jsonb_array_elements(held.changed_fields) f
     WHERE f->>'field' = 'imageUrl' AND jsonb_typeof(f->'new') = 'string'
    UNION ALL
    SELECT 3, el.image_url, NULL FROM experience_locations el
     WHERE el.experience_id = $1 AND el.merged_into_id IS NULL AND el.missing_since IS NULL
    UNION ALL
    -- A work's proposed picture, before the works' own: the work the change
    -- names, by its reference, for its type. The "after" side of a work's
    -- picture question is what the cap must never cut.
    -- Explicit joins throughout: a comma binds more loosely than JOIN, so the
    -- change c would be out of the LEFT JOIN's sight after one.
    SELECT 4, changed.proposed #>> '{}', COALESCE(t.treasure_type, '')
      FROM held
      CROSS JOIN LATERAL jsonb_array_elements(held.contents #> '{treasures,changed}') c
      CROSS JOIN LATERAL (SELECT jsonb_path_query_first(c, '$.fields[*] ? (@.field == "imageUrl").new') AS proposed) changed
      LEFT JOIN treasures t ON t.external_id = c #>> '{item,ref}'
     WHERE jsonb_typeof(changed.proposed) = 'string'
    UNION ALL
    SELECT 5, t.image_url, COALESCE(t.treasure_type, '') FROM experience_treasures et JOIN treasures t ON t.id = et.treasure_id
     WHERE et.experience_id = $1 AND ${offeredLinkSql('et')}
  )
  -- One picture held by the place and by one of its works is the place's: the
  -- subject of its first rank, which min() would skip as null.
  SELECT url, (array_agg(work_type ORDER BY rank))[1] AS work_type FROM urls WHERE NULLIF(url, '') IS NOT NULL
   GROUP BY url ORDER BY min(rank), url LIMIT ${MAX_PICTURES}`;

/** The pictures a card about place `id` shows, as the catalogue holds them, each with what it is of. */
export async function picturesOfPlace(id: number): Promise<PictureToClass[]> {
  const rows = await pool.query<{ url: string; work_type: string | null }>(PICTURES_SQL, [id]);
  return rows.rows.map(row => ({
    url: row.url,
    subject: row.work_type === null ? { kind: 'place' } : { kind: 'work', type: row.work_type || null },
  }));
}

export async function getPictureClasses(
  { params: { id }, caller }: { params: z.output<typeof idParamSchema>; caller: Express.User },
): Promise<PictureClasses> {
  const exists = await pool.query('SELECT 1 FROM experiences WHERE id = $1', [id]);
  if (exists.rowCount === 0) throw notFound('Experience not found');
  const { permitted } = await resolveExperienceScope(caller.id, caller.role, id, 'place');
  if (!permitted) throw createError('You do not have curator permissions for this experience', 403);

  return { classes: await classifyPictures(await picturesOfPlace(id)) };
}
