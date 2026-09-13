/**
 * New content retires the pass that covered its container.
 *
 * A curator's `verified` pass covers an experience as it stood when they looked
 * — its points, and the works a museum was holding. A point or a work the run
 * has just added is content that pass never covered, so the container goes back
 * to `auto` and says so (ADR-0025).
 *
 * Only under a **trusted** source. A gated one writes its new content
 * `pending`, so nothing a reader sees has changed and the pass still describes
 * what is live; retiring it there would punish the row for an arrival nobody
 * has been shown. The flag is read in SQL through the membership's source,
 * because these writers have an experience id and no source id, and a
 * parameter would be a second source of truth that could disagree with the
 * column between the check and the write.
 *
 * The pass is the membership's since #822 (ADR-0045 decision 4): a curator
 * passed the place's arrival in a kind. Every trusted membership of the place
 * is retired — a point or a work is the place's, seen through each of them.
 *
 * Newly written content only. A point the source stopped offering and now
 * offers again is not new — the curator saw it before it went missing, and its
 * row, id and assignments are the same ones.
 *
 * Runs on the client of a transaction that already holds the place's lock,
 * taken in a statement of its own (`db/locks.ts`) — the location writer's,
 * the treasure writer's — and never on the pool: the statement chooses the
 * rows to retire by their state, and a statement's snapshot predates the lock
 * it waits for, so a lock folded into this UPDATE would wait for a publish in
 * flight and then skip the very membership that publish had just passed.
 * Measured on 2026-09-05: 0 rows updated that way, 1 with the lock in its own
 * statement first.
 */

import { MEMBERSHIPS } from '../../db/membership.js';

/** Whatever runs the statement: a pooled client inside a transaction, or the pool. */
export interface QueryRunner {
  query(sql: string, params: unknown[]): Promise<unknown>;
}

/**
 * Return `experienceId`'s memberships from `verified` to `auto`, if a trusted
 * source has just given it content nobody has passed. A no-op for every other
 * state, and for a gated source.
 */
export async function retirePassAfterNewContent(
  runner: QueryRunner,
  experienceId: number,
): Promise<void> {
  await runner.query(
    `UPDATE ${MEMBERSHIPS} m SET curation_state = 'auto', updated_at = NOW()
      WHERE m.experience_id = $1 AND m.curation_state = 'verified'
        AND NOT EXISTS (
          SELECT 1 FROM experience_sources c
           WHERE c.id = m.source_id AND c.requires_curation
        )`,
    [experienceId],
  );
}
