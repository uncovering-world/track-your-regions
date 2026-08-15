-- 025: a contents-only change gets its own word
--
-- One widened CHECK. `experience_sync_changes.change_type` had four words for a row
-- whose own fields did not move — `conflict`, `held`, `returned`, and the accident
-- below — and ADR-0026 added a fourth reason to store one: the object's contents
-- moved while every field of it came through unchanged.
--
-- Without this value that row was written as `conflict`. Not harmlessly: `conflict`
-- means a curator had claimed a field and the source's proposal lost, so the admin
-- run report's `?type=conflict` filter handed back a serial site that had gained a
-- component as a disagreement with a person that never happened. Found in review of
-- the PR that added the column (#541), before any run had written such a row.
--
-- Nothing to backfill, and nothing that could be: no row on disk carries the fourth
-- exception, because the column it depends on landed in migration 023 and no sync has
-- run since. A row that *did* predate this could not be recovered either — `conflict`
-- and this case are indistinguishable once written, which is the whole reason the
-- value exists.
--
-- The list is restated whole, as every migration that widens it does. Migration 021,
-- which added `held`, keeps the list it added: it is correct history, and the guard in
-- `schemaMigrationParity.test.ts` finds the newest file restating this constraint
-- rather than naming one — the same lesson the curation-log action list learned when
-- 022 superseded 019.
--
-- Order: this file may run before or after the next re-application of
-- `01-schema.sql`, in either order and any number of times. The drop/add idiom is
-- idempotent and `01-schema.sql` carries the same pair for the same reason.
--
-- Applying this file changes nothing anyone sees: it widens what the column accepts.
--
-- Apply with:
--   npm run db:run-sql -- -v ON_ERROR_STOP=1 < db/migrations/025-contents-change-type.sql

\set ON_ERROR_STOP on

BEGIN;

ALTER TABLE experience_sync_changes DROP CONSTRAINT IF EXISTS experience_sync_changes_change_type_check;
ALTER TABLE experience_sync_changes ADD CONSTRAINT experience_sync_changes_change_type_check
    CHECK (change_type IN ('created', 'updated', 'conflict', 'held', 'contents', 'missing', 'returned', 'failed', 'filtered'));

COMMIT;
