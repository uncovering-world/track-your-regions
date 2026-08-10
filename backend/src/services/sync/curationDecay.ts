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
 * has been shown. The flag is read in SQL through the experience, because these
 * writers have an experience id and no category id, and a parameter would be a
 * second source of truth that could disagree with the column between the check
 * and the write.
 *
 * Newly written content only. A point the source stopped offering and now
 * offers again is not new — the curator saw it before it went missing, and its
 * row, id and assignments are the same ones.
 */

/** Whatever runs the statement: a pooled client inside a transaction, or the pool. */
export interface QueryRunner {
  query(sql: string, params: unknown[]): Promise<unknown>;
}

/**
 * Return `experienceId` from `verified` to `auto`, if a trusted source has just
 * given it content nobody has passed. A no-op for every other state, and for a
 * gated source.
 */
export async function retirePassAfterNewContent(
  runner: QueryRunner,
  experienceId: number,
): Promise<void> {
  await runner.query(
    `UPDATE experiences e SET curation_state = 'auto'
      WHERE e.id = $1 AND e.curation_state = 'verified'
        AND NOT EXISTS (
          SELECT 1 FROM experience_categories c
           WHERE c.id = e.category_id AND c.requires_curation
        )`,
    [experienceId],
  );
}
