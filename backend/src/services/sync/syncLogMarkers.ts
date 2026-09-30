/**
 * The entries a run leaves in `experience_sync_logs.error_details` that other
 * code reads as facts rather than as prose.
 *
 * They live here because they are written in one place and interpreted in
 * another: the review queue decides whether a closed run's changeset actually
 * landed, and gets that wrong if either string drifts. `status` cannot answer
 * it — a run that throws after `processItemsLoop` records its batch and *then*
 * marks itself `failed`, so the status is `failed` on a run whose changes are
 * all on record.
 */

/** The changeset insert threw; the run closed anyway rather than sticking at `running`. */
export const CHANGESET_LOST_MARKER = { externalId: 'changeset' } as const;

/**
 * The process died mid-run and the startup sweep closed the log. Its changes
 * never left memory, so nothing this run stamped can be read as evidence.
 */
export const ORPHANED_RUN_ERROR = 'Server restarted while sync was running';
export const ORPHANED_RUN_MARKER = { externalId: 'system', error: ORPHANED_RUN_ERROR } as const;

/**
 * Placing the experiences whose points moved failed after the run had closed.
 *
 * A separate marker rather than a plain error string, for the same reason as
 * the two above: what an operator has to do about it is specific. The catalogue
 * is correct and the changeset landed — what is stale is `experience_regions`
 * for the objects this run moved. The row goes on naming them
 * (`unplaced_experience_ids`, #1152), so the source's next real run places
 * them again; a full re-assignment of the world view places them now.
 */
export const PLACEMENT_FAILED_MARKER = { externalId: 'region-assignment' } as const;

/**
 * The server was restarted while the run, already closed, was placing what it
 * moved (#1152). The startup sweep leaves it, with the objects still named on
 * the row, and downgrades a successful run to `partial`: the run did its own
 * job, and what is stale is `experience_regions` for those objects, which the
 * source's next real run places. Carries the placement marker's `externalId`,
 * so the sweep, which skips a run carrying that, never marks a run twice nor
 * one whose placement failed on its own.
 */
export const PLACEMENT_STOPPED_ERROR = 'Server restarted while the run was placing what it moved';
export const PLACEMENT_STOPPED_MARKER = {
  ...PLACEMENT_FAILED_MARKER,
  error: PLACEMENT_STOPPED_ERROR,
} as const;

/**
 * SQL predicate: did this run's changeset reach the table?
 *
 * `prev` must name an `experience_sync_logs` row. Both markers are matched by
 * JSONB containment rather than by status, for the reason in the note above.
 */
export const CHANGESET_LANDED_SQL = `
  prev.completed_at IS NOT NULL
  AND NOT COALESCE(prev.error_details @> '[${JSON.stringify(CHANGESET_LOST_MARKER)}]', FALSE)
  AND NOT COALESCE(prev.error_details @> '[${JSON.stringify(ORPHANED_RUN_MARKER)}]', FALSE)`;

/**
 * SQL: did the startup sweep close this run, because the server was
 * restarted under it (#1131)?
 *
 * `alias` must name an `experience_sync_logs` row. Matched by containment,
 * like the predicate above, since the sweep closes the row `failed` and a
 * status alone cannot tell it from a run that failed on its own.
 */
export function stoppedByRestartSql(alias: string): string {
  return `COALESCE(${alias}.error_details @> '[${JSON.stringify(ORPHANED_RUN_MARKER)}]', FALSE)`;
}

/**
 * SQL: did the startup sweep find this closed run still placing what it
 * moved, because the server was restarted under its placement (#1152)?
 *
 * `alias` must name an `experience_sync_logs` row. By containment, like the
 * one above: the run keeps the status it closed with, downgraded from
 * `success` to `partial`, and a status cannot tell this from a placement that
 * failed on its own.
 */
export function placementStoppedByRestartSql(alias: string): string {
  return `COALESCE(${alias}.error_details @> '[${JSON.stringify(PLACEMENT_STOPPED_MARKER)}]', FALSE)`;
}
