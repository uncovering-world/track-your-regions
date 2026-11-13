/**
 * The review queue's open questions as points on a map (#2477).
 * GET /api/experiences/review/queue/map?q=&source=&kind=&region=&run=&aside=
 *
 * The list pages the open questions and draws a card for each; the map draws
 * every one at once, so a curator sees where they are before opening any. Both
 * read the same questions: the union of their keys, the curator's scope and the
 * chips are `scopedQuestionsSql` and `selectedSql` (`reviewQueueKeys.ts`), and
 * the request's chips are parsed by `queueSelection` (`reviewQueueController.ts`).
 * What this read leaves out is the list's own: the order, the page, the facets.
 *
 * **One entry per place.** Every key's id is a place — the object the question is
 * about, a museum for its works' questions, a serial site for its parts' — so the
 * questions are grouped by it and the place is one marker. A question's key is
 * `kind:placeId`, the list's own name for a row, so the map opens the same card.
 *
 * **No page.** Measured on the development catalogue (2026-11-13): 15,709 open
 * questions on about 15,300 places, read in 1.0 s. The point is the place's
 * `experiences.location`, which the schema requires, so `unplaced` counts a key
 * whose place row is gone by the time the statement reads it, and is 0 there.
 */

import type { z } from 'zod/v4';
import type { QueueMapPlace, ReviewQueueMap } from '../../api/responses/reviewQueue.js';
import { pool } from '../../db/index.js';
import type { reviewQueueMapQuerySchema } from '../../types/index.js';
import { queueSelection } from './reviewQueueController.js';
import { scopedQuestionsSql, selectedSql, type QueueSelection } from './reviewQueueKeys.js';

/**
 * Every place with an open question this curator may be asked under the
 * selection, with its point and its questions, and how many questions have no
 * point to draw.
 */
export async function queryQueueMap(
  { userId, isAdmin, selection }: { userId: number; isAdmin: boolean; selection: QueueSelection },
): Promise<ReviewQueueMap> {
  const params: unknown[] = [userId];
  const bind = (value: unknown): string => {
    params.push(value);
    return `$${params.length}`;
  };
  const scoped = scopedQuestionsSql(isAdmin, selection, bind);

  // Rounded in the statement, since the answer is about fifteen thousand points
  // and the sixth decimal is a tenth of a metre no marker can show.
  const sql = `${scoped.sql}
, selected AS (
    SELECT k.kind, k.rank, k.id, k.subs FROM scoped k
    WHERE ${selectedSql(scoped.selected)}
  )
, placed AS (
    SELECT e.id, round(ST_X(e.location)::numeric, 5) AS lon, round(ST_Y(e.location)::numeric, 5) AS lat,
           json_agg(json_build_object('kind', s.kind, 'subs', s.subs) ORDER BY s.rank) AS questions
    FROM selected s
    JOIN experiences e ON e.id = s.id
    WHERE e.location IS NOT NULL
    GROUP BY e.id
  )
SELECT COALESCE((SELECT json_agg(json_build_object('placeId', p.id, 'lon', p.lon, 'lat', p.lat,
                                                   'questions', p.questions) ORDER BY p.id)
                   FROM placed p), '[]'::json) AS places,
       (SELECT count(*)::int FROM selected s
         WHERE NOT EXISTS (SELECT 1 FROM placed p WHERE p.id = s.id)) AS unplaced`;

  const { rows } = await pool.query<{ places: QueueMapPlace[] | null; unplaced: number | null }>(sql, params);
  const row = rows[0];
  return { places: row?.places ?? [], unplaced: Number(row?.unplaced ?? 0) };
}

export async function getReviewQueueMap(
  { query, caller }: { query: z.output<typeof reviewQueueMapQuerySchema>; caller: Express.User },
): Promise<ReviewQueueMap> {
  return queryQueueMap({ userId: caller.id, isAdmin: caller.role === 'admin', selection: queueSelection(query) });
}
