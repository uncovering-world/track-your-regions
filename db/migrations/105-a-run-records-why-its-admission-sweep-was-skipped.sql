-- 105-a-run-records-why-its-admission-sweep-was-skipped.sql
--
-- A run whose admission sweep was skipped (ADR-0024: cancelled, errors, nothing
-- admitted, or an admitted set below half the previous one) left the places
-- its own rule would have delisted admitted, and said so only in the backend's
-- console (#751). The sweep's reason now lands on the run's row beside the two
-- other guards' reasons, and the run card reads it there.
--
-- No backfill: no earlier run recorded the reason anywhere it could be read
-- back from. 01-schema.sql declares the same column and comment for a fresh
-- database. Re-runnable.

\set ON_ERROR_STOP on

BEGIN;

ALTER TABLE experience_sync_logs ADD COLUMN IF NOT EXISTS admission_sweep_skipped_reason TEXT;
COMMENT ON COLUMN experience_sync_logs.admission_sweep_skipped_reason IS 'Why this run''s admission sweep delisted nothing the run''s own rule would have (ADR-0024): cancelled, errors, nothing admitted, or an admitted set below half the previous one. NULL when the sweep ran, when the source does not recompute membership, or on runs from before the column (#751).';

COMMIT;
