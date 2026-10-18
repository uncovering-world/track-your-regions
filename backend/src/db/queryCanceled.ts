/**
 * Whether a failed statement was cancelled in the database: PostgreSQL's
 * `query_canceled` (57014), which a `statement_timeout` raises, and so does
 * `pg_cancel_backend`. A caller that cancels its own statements knows which
 * it was; for the others, a 57014 is a timeout or someone's cancel.
 */
export const isQueryCanceled = (error: unknown): boolean =>
  (error as { code?: string } | null)?.code === '57014';
