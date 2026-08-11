/**
 * What makes an experience "new" to the person looking at it.
 *
 * Not "recently created" — that is what the client-side heuristic this
 * replaces measured, and it answers a different question. Both measure a first
 * appearance, but of different things: `created_at` is when the row entered
 * this database, which for a category loaded in bulk is the same instant for
 * thousands of rows that entered the *source* years apart. The chip is about
 * arriving in a run, so it keys off the run:
 *
 *     is_new = a run was observed creating the row, AND that run is the latest
 *              completed non-dry run of its category, AND ( it is still inside
 *              the category's window OR this reader first saw the chip less
 *              than a week ago )
 *
 * The two clauses are a maximum, not a choice: the category window is the
 * floor — everyone gets at least that long — and a reader who happens to arrive
 * near the end of it keeps the chip a week from *their* first sighting rather
 * than losing it the next day. Anonymous readers get the first clause only,
 * since there is nobody to remember.
 *
 * "Observed" is load-bearing, and is why the first clause is not just the
 * column: migration 009 backfilled `first_seen_sync_log_id` to the newest run
 * of each category for every pre-existing row, so the column alone credits
 * 1547 of 1547 rows to a run that never inserted them. A changeset row of type
 * `created` is the difference between a sighting and a guess — do not
 * "simplify" it away.
 *
 * Scoped by that, the column does mean first: it is written on INSERT and
 * never on update, so a row that went missing and came back keeps the run it
 * originally arrived in and does not wear the chip again — which is right, it
 * is not new to anyone who was here before, and `returned` is where that event
 * is recorded.
 *
 * The bound on the whole thing is the next completed non-dry run: once the
 * category runs again for real,
 * `first_seen_sync_log_id` no longer names the latest run and the chip goes,
 * whatever either window says. That is the property that keeps a batch from
 * accumulating chips forever.
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
 * Correlated rather than joined: a join against the latest-run subquery would
 * multiply rows on a read that already joins categories and regions, and the
 * planner treats this as a scalar per row either way.
 */
export function isNewSql(alias = 'e', userIdParam: NewBadgeReaderParam = 'NULL'): string {
  return `(
    ${alias}.first_seen_sync_log_id IS NOT NULL
    -- Observed arriving, not merely attributed to a run. Migration 009
    -- backfilled first_seen_sync_log_id to the newest run of each category
    -- for every pre-existing row — a reasonable guess about where they came
    -- from, but not a sighting. Without this clause the whole catalogue wears
    -- the chip on the day this ships, and keeps it until each category next
    -- runs: 1547 of 1547 rows, measured. Nothing re-inserts a whole category
    -- any more — force sync, which did, is gone — so this clause only ever
    -- sees rows a run genuinely brought in for the first time.
    AND EXISTS (
      SELECT 1 FROM experience_sync_changes ch
      WHERE ch.experience_id = ${alias}.id
        AND ch.sync_log_id = ${alias}.first_seen_sync_log_id
        AND ch.change_type = 'created'
    )
    AND ${alias}.first_seen_sync_log_id = (
      SELECT l.id FROM experience_sync_logs l
      WHERE l.category_id = ${alias}.category_id
        AND l.is_dry_run = FALSE
        AND l.completed_at IS NOT NULL
      -- By completion, not by id. A run that started earlier can finish later,
      -- and id order is creation order — so ordering by id can name a run that
      -- finished months ago as the latest and quietly switch every chip off.
      ORDER BY l.completed_at DESC, l.id DESC
      LIMIT 1
    )
    AND (
      EXISTS (
        SELECT 1 FROM experience_sync_logs l
        JOIN experience_categories c ON c.id = ${alias}.category_id
        WHERE l.id = ${alias}.first_seen_sync_log_id
          AND l.completed_at > NOW() - (c.new_badge_days || ' days')::interval
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
