-- 168-edition-cast-visits.sql
--
-- Whether a place's points are casts of one work (ADR-0145 decision 5, #880).
-- A bronze cast for several cities is one place with a point at every cast,
-- and every cast is the whole work: a traveller who stood under Maman in
-- Bilbao has seen Maman. A serial site's component is not the site, so the
-- visited status reads the two shapes differently, and only the run that reads
-- editions (Public Art & Monuments) can say which a place is; nothing infers
-- it from the number of points. Every existing place starts as no edition, and
-- the next Public art run sets it on the editions it writes.
--
-- Re-runnable: the column is added if absent.

\set ON_ERROR_STOP on

BEGIN;

ALTER TABLE experiences ADD COLUMN IF NOT EXISTS cast_points BOOLEAN NOT NULL DEFAULT FALSE;
COMMENT ON COLUMN experiences.cast_points IS 'The points are casts of one work: a visit to any cast marks the work visited (ADR-0145 decision 5). Run-owned; other sources leave it unchanged.';

COMMIT;
