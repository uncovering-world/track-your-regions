-- 065-treasures-found-at-index.sql
--
-- The finds of a site are the treasures whose discovery place names the
-- site's item (ADR-0058 decision 3). A region's list now counts them on every
-- site row (#907), and a site's own list reads them by the same key; without
-- an index each site row scans the whole table. Measured on the development
-- database on 2026-09-29: Europe's list, 346 site rows, 0.36 ms of scan each
-- (about 125 ms a read) against 0.002 ms through the index.
-- Re-runnable: IF NOT EXISTS.

\set ON_ERROR_STOP on

BEGIN;
CREATE INDEX IF NOT EXISTS idx_treasures_found_at ON treasures ((metadata->'foundAt'->>'qid'));
COMMIT;
