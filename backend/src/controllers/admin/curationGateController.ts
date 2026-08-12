/**
 * The switch that decides whether a source's content waits for a person.
 *
 * Its own file rather than more of `syncController.ts`, which is about starting,
 * watching and cancelling runs. This is about what a run is *allowed to show*, which
 * is a different question with different consequences — the same reason the panel's
 * gate controls are their own component rather than more of `SyncPanel.tsx`.
 */

import { Response } from 'express';
import { pool } from '../../db/index.js';
import type { AuthenticatedRequest } from '../../middleware/auth.js';

/**
 * Hold a source's new and changed content for review, or stop holding it.
 * PUT /api/admin/sync/categories/:categoryId/curation-gate
 *
 * The only writer of `requires_curation` in the application (ADR-0025). Until
 * this existed the column could be read by four services and set by nobody, so
 * gating a source meant hand-written SQL against production.
 *
 * **Switching it on is not retroactive, and this statement is why:** it touches
 * `experience_categories` and nothing else. Rows the source already published
 * stay `auto` and stay visible — a setting that removed 1272 objects from the
 * product on one click would be a different feature. One category can therefore
 * hold `auto` rows from before the switch beside `pending` ones from after it,
 * which is intended and which the panel's copy says out loud.
 *
 * **Switching it off publishes nothing** — the statement itself moves no row. What
 * happens to a backlog afterwards differs by kind, and the difference is worth
 * knowing before flipping it. Arrivals and unread contents stay put: only the insert
 * arm ever writes `pending`, and only a person moves a row out of it, through
 * `publish-waiting` or a card. A change a run is *holding* is the exception — it sits
 * on a visible row as `pending_change_sync_log_id`, and the hold is
 * `requires_curation AND curation_state <> 'pending'` (`syncUtils`), so with the gate
 * off the next run writes the proposed values and clears the pointer with no person
 * involved. A switch that published forty unreviewed objects silently is the thing
 * the gate exists to prevent; a switch that quietly leaves a run free to apply what
 * it was holding is a different promise, and this one only makes the first.
 *
 * Admin-only, and mounted beside the other category writes rather than on the
 * experiences router: this is a property of the source, not of any object.
 */
export async function setCurationGate(req: AuthenticatedRequest, res: Response): Promise<void> {
  const categoryId = parseInt(String(req.params.categoryId));
  const { requiresCuration } = req.body as { requiresCuration: boolean };

  // `is_active` in the guard, not only the id: the panel lists active sources,
  // so a request naming an inactive one is either stale or hand-made, and
  // silently gating a source nobody can run is worse than a 404.
  const result = await pool.query(
    `UPDATE experience_categories
        SET requires_curation = $1
      WHERE id = $2 AND is_active = true
      RETURNING id, name, requires_curation`,
    [requiresCuration, categoryId],
  );

  if (result.rows.length === 0) {
    res.status(404).json({ error: 'Category not found' });
    return;
  }

  const category = result.rows[0];
  // There is no per-category audit table and inventing one is out of scope, but a
  // gate flip that leaves no trace anywhere is not acceptable either: this is the
  // switch that decides whether a whole source reaches readers unreviewed.
  console.log(
    `[curation-gate] ${category.name} (${category.id}) -> ${category.requires_curation ? 'held for review' : 'published on arrival'} by user ${req.user?.id}`,
  );

  res.json({
    categoryId: category.id,
    name: category.name,
    requiresCuration: category.requires_curation,
  });
}
