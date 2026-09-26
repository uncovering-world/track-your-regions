/**
 * What a run's status columns may say — a sync log, an import run and a
 * region's match in an import — and the moves a run's status may make (#794).
 *
 * Declared here in the order the schema's CHECKs list them, and pinned to those
 * CHECKs by a type: `backend/src/db/curationLogActions.test.ts` asks TypeScript
 * whether each union and the generated `CheckValue<…>` are the same set, so a
 * status added to the schema and not here — or here and not there — fails the
 * typecheck rather than reaching a row.
 */

/**
 * How a sync run ended — what closes its log row, and what
 * `experience_sources.last_sync_status` records for the source.
 */
export const CLOSED_SYNC_STATUSES = ['success', 'partial', 'failed', 'cancelled'] as const;
export type ClosedSyncStatus = (typeof CLOSED_SYNC_STATUSES)[number];

/** `experience_sync_logs.status`: a run in flight, then how it ended. */
export const SYNC_LOG_STATUSES = ['running', ...CLOSED_SYNC_STATUSES] as const;
export type SyncLogStatus = (typeof SYNC_LOG_STATUSES)[number];

/**
 * `import_runs.status`: fetching the source, matching its regions, waiting on
 * an admin's review — or failed, as the startup sweep marks a run a restart
 * interrupted.
 */
export const IMPORT_RUN_STATUSES = ['running', 'matching', 'reviewing', 'failed'] as const;
export type ImportRunStatus = (typeof IMPORT_RUN_STATUSES)[number];

/**
 * `region_import_state.match_status`: how an imported region stands against
 * the divisions it may be made of.
 */
export const MATCH_STATUSES = [
  'no_candidates',
  'needs_review',
  'auto_matched',
  'manual_matched',
  'children_matched',
  'suggested',
] as const;
export type MatchStatus = (typeof MATCH_STATUSES)[number];

/** A move of a run's status from one value to another; staying put is no move. */
export type RunStatusMove<S extends string> = readonly [from: S, to: S];

/**
 * The moves a run's `status` may make, table by table. The database refuses
 * every other move (`guard_run_status_move()`, `db/init/01-schema.sql`), and a
 * database-lane spec walks every pair against this list.
 *
 * - A sync log is opened `running` and closed with how the run ended. A closed
 *   verdict may still be corrected — placement downgrades `success` to
 *   `partial` after the log is written, and a failure between the log and the
 *   source's mirror of it closes the run `failed` over the verdict already
 *   written — but a closed run never becomes `running` again: the startup
 *   sweep would take it for a run a restart interrupted.
 * - An import run is `running` while the source is fetched, `matching` once
 *   its regions are written, and `reviewing` when matching is done; the startup
 *   sweep closes one in either of the first two `failed`. Nothing moves a run
 *   out of `reviewing` or `failed`.
 *
 * `region_import_state.match_status` has no list: every one of its thirty
 * moves is made by some writer — an admin's accept, reject, reset, flatten or
 * undo, and the copy of one region's match onto another — so a list would
 * refuse nothing. What that column must hold is a claim about the region
 * itself (a match names members, a suggestion sits on a region that has
 * children), which a move between two values cannot see.
 */
export const RUN_STATUS_MOVES = {
  experience_sync_logs: SYNC_LOG_STATUSES.flatMap(from =>
    SYNC_LOG_STATUSES
      .filter(to => to !== from && to !== 'running')
      .map((to): RunStatusMove<SyncLogStatus> => [from, to])),
  import_runs: [
    ['running', 'matching'],
    ['matching', 'reviewing'],
    ['running', 'failed'],
    ['matching', 'failed'],
  ] as const satisfies readonly RunStatusMove<ImportRunStatus>[],
};
export type RunTable = keyof typeof RUN_STATUS_MOVES;
