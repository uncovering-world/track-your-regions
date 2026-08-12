/**
 * What makes an experience "new" to the person looking at it.
 *
 * Not "recently created" — that is what the client-side heuristic this replaced
 * measured, and it answers a different question. `created_at` is when the row
 * entered this database, which for a category loaded in bulk is one instant for
 * thousands of objects that entered the *source* years apart.
 *
 * It keys off **becoming visible**:
 *
 *     is_new = the row has been published, AND ( that publication is still inside
 *              the category's window OR this reader first saw the chip less than
 *              a week ago )
 *
 * The two clauses are a maximum, not a choice: the category window is the floor —
 * everyone gets at least that long — and a reader who arrives near the end of it
 * keeps the chip a week from *their* first sighting rather than losing it the next
 * day. Anonymous readers get the first clause only, since there is nobody to
 * remember.
 *
 * **Why becoming visible and not arriving in a run (#529).** Under a gated source
 * the two are not the same moment. An arrival is invisible until a curator passes
 * it, so a chip anchored to the run that found it fails in the ordinary case
 * rather than an exotic one: a museum arrives on Monday, the category runs again
 * on Wednesday, the curator answers on Thursday — and by then the run that found
 * it is no longer the latest, so the chip never appears for anyone. Even with no
 * intervening run, the window was being spent while nobody could see the row.
 * `published_at` is when a reader could first see it, which is the only moment the
 * word "new" can honestly mean.
 *
 * **Two clauses were removed, and both removals are deliberate — do not re-add:**
 *
 * - the `EXISTS … change_type = 'created'` proof of a sighting existed only
 *   because migration 009 backfilled `first_seen_sync_log_id` to the newest run
 *   of each category, so the column alone credited 1547 of 1547 rows to a run
 *   that never inserted them. `published_at` is never backfilled — migration 018
 *   left 1603 of 1604 rows NULL on purpose — so a publication needs no proof.
 * - the latest-completed-run bound existed to stop chips accumulating. The
 *   category window already bounds them, and under piecemeal approval "the newest
 *   batch" has stopped being a unit: a curator answers eighteen arrivals over a
 *   week, and no run divides them.
 *
 * **Two consequences, stated rather than discovered later.** Chips no longer clear
 * when a category next runs — they last their full window per row, so a weekly
 * source shows roughly four windows' worth at once instead of one batch. And
 * everything published before the gate existed wears no chip at all, because
 * `published_at` is NULL for it; the column starts meaning something from the
 * first publication forward.
 *
 * Nothing re-inserts a whole category any more — force sync is gone (66960d8d) —
 * so no single act can chip a whole source, which is the property the removed
 * bound was protecting.
 */

import { Response } from 'express';
import { pool } from '../../db/index.js';
import type { AuthenticatedRequest } from '../../middleware/auth.js';
import { experienceOfferedToReaderSql } from './experienceLifecycle.js';

/**
 * Where the reader's id comes from: a bind placeholder, or `NULL` for an
 * anonymous one. A union rather than a string, so the one caller cannot pass an
 * expression — the fragment is interpolated into SQL, and "it is only ever
 * called with a placeholder" is the kind of assumption that stops being true.
 */
export type NewBadgeReaderParam = 'NULL' | `$${number}`;

/** A reader's own window, once they have actually been shown the chip. */
export const NEW_BADGE_PERSONAL_DAYS = 7;

/**
 * SQL expression yielding `is_new` for the `experiences` row aliased `alias`.
 *
 * `userId` is the bind placeholder holding the reader's id, or `NULL` for an
 * anonymous one — written as a placeholder rather than a value so the caller
 * keeps control of parameter numbering, which is the part that has bitten this
 * file's neighbours twice.
 *
 * Two correlated subqueries rather than joins, and after #529 that is a choice
 * about readability rather than about row counts: neither could multiply anything —
 * `experience_categories` is reached by primary key and `user_new_badge_views` is
 * unique on `(user_id, experience_id)`. The paragraph that used to be here
 * justified the shape by the latest-run subquery this predicate no longer has,
 * which would have sent the next reader looking for a join risk that is gone.
 * `EXISTS` also keeps each clause readable as the question it asks, which matters
 * more than the shape when the two are alternatives rather than filters.
 */
export function isNewSql(alias = 'e', userIdParam: NewBadgeReaderParam = 'NULL'): string {
  return `(
    ${alias}.published_at IS NOT NULL
    AND (
      EXISTS (
        SELECT 1 FROM experience_categories c
        WHERE c.id = ${alias}.category_id
          AND ${alias}.published_at > NOW() - (c.new_badge_days || ' days')::interval
      )
      OR EXISTS (
        SELECT 1 FROM user_new_badge_views v
        WHERE v.user_id = ${userIdParam}
          AND v.experience_id = ${alias}.id
          AND v.first_shown_at > NOW() - INTERVAL '${NEW_BADGE_PERSONAL_DAYS} days'
      )
    )
  )`;
}

/**
 * Record that this reader has now seen these chips.
 * POST /api/experiences/new-badges/seen
 * Body: { experienceIds: number[] }
 *
 * Its own call rather than a side effect of the read that produced the chips:
 * a GET that writes is a GET that lies about being repeatable, and a timestamp
 * set by a prefetch, a crawler or a warmed cache is not an impression. The
 * client sends it once the chips are actually on screen.
 *
 * Only the first impression is kept — `DO NOTHING`, not `DO UPDATE`. Restarting
 * the week on every later view would let the chip follow a returning reader
 * around indefinitely, which is the opposite of what it is for.
 */
export async function markNewBadgesSeen(req: AuthenticatedRequest, res: Response): Promise<void> {
  const userId = req.user!.id;
  const { experienceIds } = req.body as { experienceIds: number[] };

  const result = await pool.query(
    `INSERT INTO user_new_badge_views (user_id, experience_id)
     SELECT $1, id FROM experiences
      WHERE id = ANY($2::int[])
        AND ${experienceOfferedToReaderSql('experiences')}
     ON CONFLICT (user_id, experience_id) DO NOTHING
     RETURNING experience_id`,
    [userId, experienceIds],
  );

  // Selected through `experiences` rather than inserted from the ids directly:
  // the foreign key would reject the whole statement for one stale id, and a
  // client whose list is a moment out of date is the normal case here.
  //
  // Filtered for the reason every writer in this family is: this records a claim
  // about a row ("this reader has seen its chip"), and `recorded` answers with
  // the ids it accepted — so an unfiltered version confirms the existence of a
  // row the caller was never shown, and writes a sighting of a chip that was
  // never on screen. A chip cannot legitimately be seen on an unread row: the
  // only read that renders one carries the gate. `existence` stays out, matching
  // the by-id reads — a chip seen on something since lost was still seen.
  res.json({ recorded: result.rows.map(r => r.experience_id) });
}
