-- 142-a-run-filters-a-record-with-nothing-to-place.sql
--
-- A run's filtered count also holds a record the source lists with nothing
-- the run can place (#1814): the World Heritage dataset sends 1567 and the
-- Routes of Santiago de Compostela in France (868) with no point and no
-- component, and the run files each as filtered rather than as an error, so
-- missing detection still runs. The column's comment says so.
--
-- 01-schema.sql declares the same comment for a fresh database.
-- Re-runnable: a comment is replaced whole.

\set ON_ERROR_STOP on

BEGIN;

COMMENT ON COLUMN experience_sync_logs.total_filtered IS 'Entities the run read and could not hold: one the source offered that is not of the kind this source fills (a Wikidata collection with no physical address answering a museum query), or a record the source lists with nothing the run can place (a World Heritage site sent with no point and no component, #1814). Not errors: nothing failed, and the run stays successful.';

COMMIT;
