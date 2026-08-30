/**
 * Which run's proposal a visible row is holding, said once.
 *
 * `experiences.pending_change_sync_log_id` is what the curator's held card
 * resolves to find the proposal it shows, and three writers now set it: the
 * object upsert, for a field of the object's own the gate refused to write;
 * the location writer, for a visible point's name (ADR-0037); and the treasure
 * writer, for a visible work's fields. One statement rather than three, so the
 * predicate cannot drift between them — a row a reader can see, under a gated
 * source, and nothing else.
 *
 * The three cooperate rather than compete, and the order is what makes that
 * true. The object upsert runs first in every service and, where the object's
 * own fields propose nothing, **clears** the pointer (`syncUtils.ts`); the
 * content writers then set it again where they held something. So the column
 * names the newest run that held anything about the object, at either level,
 * and is clear when nothing is held — a proposal a later run withdraws leaves no
 * pointer behind, whichever writer had set it.
 *
 * A run with no log id writes nothing rather than NULL. The id is what a
 * curator's screen resolves to see the proposal, so a run that cannot name
 * itself has nothing to offer the column — and NULL is not "unknown run", it
 * is "nothing is held", which would be a lie about a row whose content this run
 * just held. The same rule the object upsert has always followed.
 */

import type { QueryRunner } from './curationDecay.js';

/**
 * Point `experienceId` at `syncLogId` as the run whose proposal it is holding.
 *
 * A no-op for a `pending` row — an arrival is refreshed in place rather than
 * held, and its card needs no pointer — and for a trusted source, which holds
 * nothing. Takes whatever runs the statement: the client inside the location
 * writer's transaction, or the pool.
 */
export async function pointHeldProposalAt(
  runner: QueryRunner,
  experienceId: number,
  syncLogId: number | null,
): Promise<void> {
  if (syncLogId == null) return;
  await runner.query(
    `UPDATE experiences e SET pending_change_sync_log_id = $2
      WHERE e.id = $1 AND e.curation_state <> 'pending'
        AND EXISTS (
          SELECT 1 FROM experience_categories c
           WHERE c.id = e.category_id AND c.requires_curation
        )`,
    [experienceId, syncLogId],
  );
}
