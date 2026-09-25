/**
 * What a run's status columns may say — a sync log, an import run and a
 * region's match in an import (#794).
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
