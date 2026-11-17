/**
 * An arrival's answered neighbours in its kind (#2185): what a curator who
 * has never seen the kind's line reads it from. The Dormition Cathedral in
 * Kharkiv arrives in Towers as a bell tower; its card shows a bell tower the
 * catalogue kept and one a curator turned away.
 *
 * GET /api/experiences/review/kind-neighbours/:membershipId
 *
 * Answered only for a membership whose place the caller may be shown, a 404
 * otherwise, as the guide articles' read does. The neighbours share the
 * membership's kind and type; a kind that files no types matches on the kind
 * alone, since its memberships carry none.
 *
 * - **Kept**: a membership a curator verified that is admitted, of a place
 *   readers are offered, the most recently published. A curator's publish is
 *   what makes a membership verified, so this holds every keep, older ones
 *   included.
 * - **Refused**: a membership the curator log names as turned away from its
 *   kind (`arrival_refused`, or `admission_confirmed`: the rule's refusal
 *   upheld), still refused, the most recent answer first, and only one whose
 *   place the caller may be shown, so an unread place outside the scope is
 *   never named. It carries its recorded reason, since an upheld rule's
 *   refusal may be about the place's fame or state rather than its kind:
 *   Torre Scappi kept out for its few editions is no example of "not a tower".
 */

import type { z } from 'zod/v4';
import type { KindNeighbours } from '../../api/responses/kindNeighbours.js';
import type { ImageCredit } from '../../api/responses/experiences.js';
import { pool } from '../../db/index.js';
import { MEMBERSHIPS, membershipAdmittedSql, placeOfferedSql } from '../../db/membership.js';
import { notFound } from '../../middleware/errorHandler.js';
import type { guideArticlesParamSchema } from '../../types/guideArticlesSchema.js';
import { shownToCallerSql, type CallerParams } from './partRecordRead.js';

interface NeighbourRow {
  place_id: number;
  name: string;
  image_url: string | null;
  image_credit: z.infer<typeof ImageCredit> | null;
  reason?: string | null;
}

const neighbourOf = (row: NeighbourRow | undefined): KindNeighbours['kept'] => (row ? {
  placeId: row.place_id, name: row.name, imageUrl: row.image_url, imageCredit: row.image_credit ?? null,
} : null);

const NEIGHBOUR_COLUMNS = `e.id AS place_id, e.name, e.image_url, e.metadata->'imageCredit' AS image_credit`;

export async function getKindNeighbours(
  { params: { membershipId }, caller }: { params: z.output<typeof guideArticlesParamSchema>; caller: Express.User },
): Promise<KindNeighbours> {
  const asked: CallerParams = { user: '$1', admin: '$3::boolean' };
  // $1 the caller, $2 the membership, $3 whether an admin asks.
  const params = [caller.id, membershipId, caller.role === 'admin'];
  const found = await pool.query<{ kind_id: number; type: string | null }>(
    `SELECT m.kind_id, m.type
       FROM ${MEMBERSHIPS} m JOIN experiences e ON e.id = m.experience_id
      WHERE m.id = $2 AND m.kind_id IS NOT NULL AND ${shownToCallerSql('e', asked)}`,
    params,
  );
  if (found.rowCount === 0) throw notFound('Membership not found');
  // The neighbours of the membership `membership` names: its kind and type, never itself.
  const same = (membership: string) => `n.kind_id = asked.kind_id AND n.type IS NOT DISTINCT FROM asked.type
    AND n.id <> ${membership} AND e.merged_into_id IS NULL`;
  const askedCte = (membership: string) => `WITH asked AS (SELECT kind_id, type FROM ${MEMBERSHIPS} WHERE id = ${membership})`;
  const [kept, refused] = await Promise.all([
    // $1 the membership.
    pool.query<NeighbourRow>(
      `${askedCte('$1')}
       SELECT ${NEIGHBOUR_COLUMNS}
         FROM asked JOIN ${MEMBERSHIPS} n ON true JOIN experiences e ON e.id = n.experience_id
        WHERE ${same('$1')} AND n.curation_state = 'verified' AND ${membershipAdmittedSql('n')} AND ${placeOfferedSql('e')}
        ORDER BY n.published_at DESC NULLS LAST, n.id DESC
        LIMIT 1`,
      [membershipId],
    ),
    pool.query<NeighbourRow>(
      `${askedCte('$2')}
       SELECT ${NEIGHBOUR_COLUMNS}, n.admission_reason AS reason
         FROM asked
         JOIN experience_curation_log l ON l.action IN ('arrival_refused', 'admission_confirmed')
         JOIN ${MEMBERSHIPS} n ON n.id = (l.details->>'membershipId')::int
         JOIN experiences e ON e.id = n.experience_id
        WHERE ${same('$2')} AND NOT ${membershipAdmittedSql('n')} AND ${shownToCallerSql('e', asked)}
        ORDER BY l.id DESC
        LIMIT 1`,
      params,
    ),
  ]);
  const refusedRow = refused.rows[0];
  return {
    kept: neighbourOf(kept.rows[0]),
    refused: refusedRow ? { ...neighbourOf(refusedRow)!, reason: refusedRow.reason ?? null } : null,
  };
}
