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
 * SQL predicate: did this run's changeset reach the table?
 *
 * `prev` must name an `experience_sync_logs` row. Both markers are matched by
 * JSONB containment rather than by status, for the reason in the note above.
 */
export const CHANGESET_LANDED_SQL = `
  prev.completed_at IS NOT NULL
  AND NOT COALESCE(prev.error_details @> '[${JSON.stringify(CHANGESET_LOST_MARKER)}]', FALSE)
  AND NOT COALESCE(prev.error_details @> '[${JSON.stringify(ORPHANED_RUN_MARKER)}]', FALSE)`;
