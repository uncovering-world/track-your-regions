-- 170-a-places-outline-belongs-to-the-source-that-drew-it.sql
--
-- A place is one row whatever kinds offer it (ADR-0084), and only the
-- Archaeology run sends an outline. Every other run that wrote a place the
-- Archaeology run outlined read its omitted outline as "none" and cleared it,
-- and the next Archaeology run drew it again: Angkor Wat after each Places of
-- worship run, the Pont du Gard after each Bridges run (#1968). The outline now
-- records the source that drew it (ADR-0146): a run that reads no extents
-- leaves it, and only the source that drew it replaces or clears it.
--
-- Every outline stored today was drawn by the Archaeology run (source 5): no
-- other run sends one and no curator screen writes one. On the development
-- catalogue on 2026-10-24, 753 places held one, 590 of them with an
-- Archaeology membership and the other 163 folded into another place.
--
-- Re-runnable: the column is added if absent, and the backfill names only
-- outlines no source holds yet.

\set ON_ERROR_STOP on

BEGIN;

-- Which source drew the place's outline (#1968): a place is one row whatever
-- kinds offer it (ADR-0084), and its one outline belongs to the run that drew
-- it (ADR-0146). A run whose source reads no extents never touches the outline;
-- a source that reads them replaces or clears only an outline it drew, or one
-- no source holds, and another source's outline stands until that source clears
-- it. NULL where there is no outline, or none a run drew.
ALTER TABLE experiences ADD COLUMN IF NOT EXISTS boundary_source_id INTEGER REFERENCES experience_sources(id) ON DELETE SET NULL;
COMMENT ON COLUMN experiences.boundary_source_id IS 'The source whose run drew the outline (boundary, area_km2): only that source replaces or clears it, and a run that reads no extents leaves it (ADR-0146, #1968). NULL where there is no outline, or one no run drew.';

UPDATE experiences SET boundary_source_id = 5
 WHERE boundary IS NOT NULL AND boundary_source_id IS NULL
   AND EXISTS (SELECT 1 FROM experience_sources WHERE id = 5);

COMMIT;
