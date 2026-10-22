-- 152-a-placement-records-the-reference-it-adopted-a-point-under.sql
--
-- A run that takes another source's point a reader sees, within ten metres
-- of its own (#1846, ADR-0137), records on its placement the reference it
-- offers the point under. The next run takes the point again by that
-- reference, and the fast path matches it. A point the run placed as its own
-- carries NULL here and is never taken under another reference, or a
-- component a source dropped would lend its point to one it added at the
-- same coordinate.
--
-- Order-independent with 01-schema.sql, which declares the same column.
-- Re-runnable: the column is added if absent.

\set ON_ERROR_STOP on

BEGIN;

ALTER TABLE experience_location_placements ADD COLUMN IF NOT EXISTS adopted_ref TEXT;
COMMENT ON COLUMN experience_location_placements.adopted_ref IS 'The reference the membership offers another source''s point under, where its run adopted that point within ten metres of its own (ADR-0137); NULL where the run placed the point as its own.';

COMMIT;
