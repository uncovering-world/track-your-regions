-- 049-a-curator-sets-a-run-aside.sql
--
-- Somewhere for a curator to say "not now" to a whole run's batch of open
-- questions, rather than to one row at a time (#805, ADR-0051).
--
-- UNESCO run 98 of 5 September put 1 255 open questions into the review queue
-- at once, every one of them proposing the same field, metadata.criteria. A
-- curator does not decide those 1 255 times; they decide once, about the run,
-- and the other kinds work the same way -- a run's arrivals, a run's refusals
-- -- so the run is the unit of "not now" everywhere in the queue, not a
-- UNESCO-only shape.
--
-- The row is keyed on (user_id, sync_log_id) because the decision is the
-- curator's own: a region-scoped curator setting aside run 98's rows for
-- Italy must not hide it from the category curator working public art, and
-- what one curator has decided not to look at yet says nothing about what
-- another has.
--
-- Nothing expires the row, and nothing has to. It is read only to hide a
-- batch from the curator's default list, and the read already asks each
-- kind's own predicate for open rows; once a run's questions are all answered
-- or a later run has moved the pointer a held row answers to, that run offers
-- no open rows to hide and the set-aside row becomes inert on its own. A sweep
-- would be deleting a fact -- "I set this aside on 5 September" -- that the
-- curator never asked to have forgotten.
--
-- Order-independent with 01-schema.sql, which carries the same
-- CREATE TABLE IF NOT EXISTS and COMMENT; re-running this file finds the
-- table already there and does nothing.

\set ON_ERROR_STOP on

BEGIN;

CREATE TABLE IF NOT EXISTS curator_queue_set_aside (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    sync_log_id INTEGER NOT NULL REFERENCES experience_sync_logs(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, sync_log_id)
);
COMMENT ON TABLE curator_queue_set_aside IS 'Runs whose open questions this curator has set aside on the review page; the batch is hidden from their default list until its rows are answered';

COMMIT;
