/**
 * Whether the official websites a review card shows still answer (#2165).
 *
 * GET /api/experiences/:id/website-checks
 *
 * The card's curator decides whether a proposed website goes onto the place, and
 * 18 of the 106 websites held proposals brought on 2026-10-30 no longer answered:
 * Villa d'Este's domain does not resolve, Caral-Supe's page is a 404. Asked only
 * for a card on screen, never for the queue or the catalogue in bulk.
 *
 * The request names the place and nothing else: the addresses are the ones the
 * catalogue holds for it, read here, so no caller-named host reaches the fetch.
 * They are the place's own website and the websites its open proposals bring —
 * the proposal a membership's pending pointer holds, and the change set the
 * conflict card reads (`conflictChangeOpenSql`: the newest of a run that was no
 * dry run, holds a field a curator's claim refused, and no later landed run of
 * its source replaced). Scoped as the place's curation is.
 */

import type { z } from 'zod/v4';
import type { WebsiteChecks } from '../../api/responses/curation.js';
import { pool } from '../../db/index.js';
import { MEMBERSHIPS } from '../../db/membership.js';
import { createError, notFound } from '../../middleware/errorHandler.js';
import { checkWebsite } from '../../services/websiteCheck/checkWebsite.js';
import type { idParamSchema } from '../../types/index.js';
import { resolveExperienceScope } from './experienceScope.js';
import { conflictChangeOpenSql } from './reviewQueuePredicates.js';

/** More than a card shows (the place's site and a proposal's), fewer than a fan-out would take. */
const MAX_WEBSITES = 6;

/** The websites a card about place `$1` shows, distinct, the place's own first. */
const WEBSITES_SQL = `
  WITH held AS (
    SELECT ch.changed_fields
      FROM experience_sync_changes ch
      JOIN ${MEMBERSHIPS} m ON m.experience_id = ch.experience_id AND m.pending_change_sync_log_id = ch.sync_log_id
     WHERE ch.experience_id = $1
    UNION ALL
    (SELECT ch.changed_fields FROM experience_sync_changes ch
       JOIN experiences e ON e.id = ch.experience_id
       JOIN experience_sync_logs l ON l.id = ch.sync_log_id
      WHERE ch.experience_id = $1 AND ${conflictChangeOpenSql('e', 'ch', 'l')}
      ORDER BY ch.id DESC LIMIT 1)
  ), urls AS (
    SELECT 0 AS rank, e.metadata->>'website' AS url FROM experiences e WHERE e.id = $1
    UNION ALL
    SELECT 1, f->>'new' FROM held, jsonb_array_elements(held.changed_fields) f
     WHERE f->>'field' = 'metadata.website' AND jsonb_typeof(f->'new') = 'string'
  )
  SELECT url FROM urls WHERE NULLIF(url, '') IS NOT NULL
   GROUP BY url ORDER BY min(rank), url LIMIT ${MAX_WEBSITES}`;

/** The websites a card about place `id` shows, as the catalogue holds them. */
export async function websitesOfPlace(id: number): Promise<string[]> {
  return (await pool.query<{ url: string }>(WEBSITES_SQL, [id])).rows.map(row => row.url);
}

export async function getWebsiteChecks(
  { params: { id }, caller }: { params: z.output<typeof idParamSchema>; caller: Express.User },
): Promise<WebsiteChecks> {
  const exists = await pool.query('SELECT 1 FROM experiences WHERE id = $1', [id]);
  if (exists.rowCount === 0) throw notFound('Experience not found');
  const { permitted } = await resolveExperienceScope(caller.id, caller.role, id, 'place');
  if (!permitted) throw createError('You do not have curator permissions for this experience', 403);

  const urls = await websitesOfPlace(id);
  const checks = await Promise.all(urls.map(async url => ({ url, ...(await checkWebsite(url)) })));
  return { checks };
}
