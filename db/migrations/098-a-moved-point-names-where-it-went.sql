-- 098-a-moved-point-names-where-it-went.sql
--
-- A point a curator's published move replaced names the point it moved to
-- (#1448): the Trevi Fountain's old spot names the point 24 m away. The
-- publish sets it with source_membership former, which answers the
-- departure; the answered withdrawals leave such a point out, since taking it
-- back would set a second pin beside the one it moved to. A run that lists
-- the old spot again, or a curator who answers it still listed, clears it.
--
-- 01-schema.sql declares the same column for a fresh database.
-- Re-runnable.

\set ON_ERROR_STOP on

BEGIN;

ALTER TABLE experience_locations ADD COLUMN IF NOT EXISTS moved_to_location_id INTEGER
    REFERENCES experience_locations(id) ON DELETE SET NULL;
COMMENT ON COLUMN experience_locations.moved_to_location_id IS 'The point a curator''s published move replaced this one with (#1448): the old spot of the Trevi Fountain names the point 24 m away. Set with source_membership former by the publish, which is its answer; the answered withdrawals leave it out, and a run that lists the old spot again, or a curator who answers it still listed, clears it.';

COMMIT;
