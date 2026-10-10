-- 086-a-taken-back-candidate-is-marked.sql
--
-- A confirmed component candidate a curator took back (#1317) goes back to
-- the queue open (#1336), and carries the mark of it: taken_back_at. The two
-- batch confirmations - every exact match, every candidate Jev is sure of -
-- skip a marked candidate, so the hasty batch that confirmed it cannot
-- confirm it again; only a curator's own click on it can. The finder rewrites
-- a marked candidate it finds again with that pass's measures, mark kept, and
-- drops one it no longer finds, as it drops every open candidate it does not
-- find.
--
-- Order-independent with 01-schema.sql, which declares the same column.
-- Re-runnable: the column is added only where it is missing.

\set ON_ERROR_STOP on

BEGIN;

ALTER TABLE experience_component_item_proposals ADD COLUMN IF NOT EXISTS taken_back_at TIMESTAMPTZ;
COMMENT ON COLUMN experience_component_item_proposals.taken_back_at IS 'When a curator took this candidate back after confirming it (#1336): open again, and skipped by both batch confirmations until a curator confirms it by hand.';

COMMIT;
