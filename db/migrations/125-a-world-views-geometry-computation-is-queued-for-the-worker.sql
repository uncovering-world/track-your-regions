-- 125-a-world-views-geometry-computation-is-queued-for-the-worker.sql
--
-- A world view's geometry computation runs in the dump worker, queued from
-- the admin panel through a ledger of its own (#1658, ADR-0122), as a dump
-- build is (ADR-0106): the row is what was asked for, the running
-- computation's progress and heartbeat, an admin's cancel, and the outcome.
-- An edit or a restart of the backend no longer stops a computation part-way.
-- Nothing is backfilled: a computation the backend ran before this kept no row.
--
-- Order-independent with 01-schema.sql, which declares the same table.
-- Re-runnable: the table, its indexes and comments are created if absent.

\set ON_ERROR_STOP on

BEGIN;

CREATE TABLE IF NOT EXISTS geometry_computations (
    id SERIAL PRIMARY KEY,
    world_view_id INTEGER NOT NULL REFERENCES world_views(id) ON DELETE CASCADE,
    status VARCHAR(20) NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'success', 'failed', 'cancelled')),
    force BOOLEAN NOT NULL DEFAULT FALSE,
    skip_snapping BOOLEAN NOT NULL DEFAULT FALSE,
    regions INTEGER NOT NULL DEFAULT 0,
    started_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    queued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    started_at TIMESTAMPTZ,
    finished_at TIMESTAMPTZ,
    heartbeat_at TIMESTAMPTZ,
    runner TEXT,
    progress JSONB,
    cancel_requested_at TIMESTAMPTZ,
    outcome TEXT,
    error TEXT
);
CREATE INDEX IF NOT EXISTS idx_geometry_computations_world_view ON geometry_computations(world_view_id, queued_at DESC);
-- At most one computation of a world view is queued or running, in any process.
CREATE UNIQUE INDEX IF NOT EXISTS idx_geometry_computations_one_active ON geometry_computations(world_view_id) WHERE status IN ('queued', 'running');
COMMENT ON TABLE geometry_computations IS 'A world view''s geometry computation (#1658, ADR-0122): queued by an admin from the panel, taken and run by the dump worker, closed with its outcome. The row is the only channel between the backend and the worker, as a dump build''s is (ADR-0106).';
COMMENT ON COLUMN geometry_computations.force IS 'Every region is computed again, not only those with no geometry and their ancestors.';
COMMENT ON COLUMN geometry_computations.regions IS 'How many regions the computation was queued to compute, counted when it was queued.';
COMMENT ON COLUMN geometry_computations.heartbeat_at IS 'When the running computation last said it is alive, every few seconds. A running row that has not beaten for five minutes is a computation that stopped.';
COMMENT ON COLUMN geometry_computations.runner IS 'What runs the computation: the dump worker on this host (worker:<hostname>). A worker that starts closes the running rows of its own runner, which its previous run left.';
COMMENT ON COLUMN geometry_computations.progress IS 'The running computation''s progress as the panel shows it: regions done, computed, skipped and failed, the region in hand, and the step; written by the worker with its heartbeat.';
COMMENT ON COLUMN geometry_computations.cancel_requested_at IS 'When an admin asked the computation to stop; the worker reads it with its heartbeat and stops after the region in hand.';
COMMENT ON COLUMN geometry_computations.outcome IS 'What a computation that ended well did, in words: regions computed, skipped and failed. Null while it runs and for one that failed or was cancelled, whose reason is in error.';

COMMIT;
