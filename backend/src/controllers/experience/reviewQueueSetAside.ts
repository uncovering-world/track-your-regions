/**
 * A curator's "not now" on a whole run's batch of open questions (ADR-0051
 * decision 4): `curator_queue_set_aside(user_id, sync_log_id)`, one row per
 * curator per run. The read side already honours it — `reviewQueueKeys.ts`
 * excludes a set-aside run's rows unless `showAside`, and reports the batch
 * back in `facets.run[].setAside` and the `facets.setAside` count, which is
 * what a chip needs to name the batch and bring it back. This is the write
 * half of that.
 *
 * **No object-scope check, unlike every other curator write in this
 * directory.** `setExperienceState`, `setExperienceAdmission` and the rest
 * resolve the caller's scope against the row they act on
 * (`resolveExperienceScope`), because that row is shared: a region-scoped
 * curator must not publish, refuse, or correct an object outside the regions
 * they cover. This table holds nothing shared — every row is keyed on the
 * caller's own `user_id`, and it is *this curator's own view* of the queue
 * that a run id hides or restores. The read that lists a run as a chip
 * (`reviewQueueKeys.ts`'s `facet_run`) already scopes which runs this curator
 * can see open rows for; setting aside a run id outside that scope, or one
 * with no open rows left in it, hides nothing anybody could otherwise see —
 * it is a row in a table nobody else reads, under a key nobody else can write.
 *
 * **A dry run is refused, as a 404.** `is_dry_run = TRUE` runs write no
 * changeset, no membership, nothing the review queue reads — a dry run raises
 * no question, so there is nothing here to set aside. The insert's own
 * `WHERE l.id = $2 AND l.is_dry_run = FALSE` makes that answer indistinguishable
 * from "no such run", rather than a second error shape for a run that exists
 * but was never a batch of questions.
 */

import { Response } from 'express';
import { pool } from '../../db/index.js';
import type { AuthenticatedRequest } from '../../middleware/auth.js';

/**
 * Put a run's batch of open questions aside.
 * PUT /api/experiences/review/set-aside/:syncLogId
 *
 * `ON CONFLICT DO NOTHING` makes a second click the same 200 as the first —
 * the row is already there, holding its earlier `created_at`, and the
 * response states the state the caller asked for rather than whether the
 * statement actually moved a row. That is also why `RETURNING` alone cannot
 * answer 404: it comes back empty both when the run does not exist (or is a
 * dry run) and when this curator had already set it aside, and only the first
 * of those is a question worth refusing.
 */
export async function setRunAside(req: AuthenticatedRequest, res: Response): Promise<void> {
  const userId = req.user!.id;
  const syncLogId = parseInt(String(req.params.syncLogId));

  const inserted = await pool.query(
    `INSERT INTO curator_queue_set_aside (user_id, sync_log_id)
     SELECT $1, l.id FROM experience_sync_logs l
      WHERE l.id = $2 AND l.is_dry_run = FALSE
     ON CONFLICT DO NOTHING
     RETURNING sync_log_id`,
    [userId, syncLogId],
  );
  if (inserted.rows.length === 0) {
    const already = await pool.query(
      `SELECT 1 FROM curator_queue_set_aside WHERE user_id = $1 AND sync_log_id = $2`,
      [userId, syncLogId],
    );
    if (already.rows.length === 0) {
      res.status(404).json({ error: 'Sync run not found' });
      return;
    }
  }
  res.json({ syncLogId, setAside: true });
}

/**
 * Bring a run's batch back into view.
 * DELETE /api/experiences/review/set-aside/:syncLogId
 *
 * Idempotent by design, not merely by `DELETE`'s own shrug at deleting
 * nothing: the caller is asking for a state ("not set aside"), and a run this
 * curator never set aside — or already brought back — answers the same 200
 * a first click gets, rather than a 404 that would make the chip a one-shot.
 */
export async function bringRunBack(req: AuthenticatedRequest, res: Response): Promise<void> {
  const userId = req.user!.id;
  const syncLogId = parseInt(String(req.params.syncLogId));

  await pool.query(
    `DELETE FROM curator_queue_set_aside WHERE user_id = $1 AND sync_log_id = $2`,
    [userId, syncLogId],
  );
  res.json({ syncLogId, setAside: false });
}
