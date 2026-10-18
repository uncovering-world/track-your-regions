-- 127-a-computations-cancel-reaches-the-statement-in-flight.sql
--
-- An admin's cancel of a running geometry computation, like the worker's stop,
-- now cancels the statement in flight in the database rather than waiting for
-- the region in hand, whose union can run up to the worker's thirty-minute
-- bound (#459, ADR-0123). The column's comment says so; nothing else changes.
--
-- Order-independent with 01-schema.sql, which carries the same comment.
-- Re-runnable: a comment is set, not added.

\set ON_ERROR_STOP on

BEGIN;

COMMENT ON COLUMN geometry_computations.cancel_requested_at IS 'When an admin asked the computation to stop; the worker reads it with its heartbeat and cancels the statement in flight in the database (ADR-0123).';

COMMIT;
