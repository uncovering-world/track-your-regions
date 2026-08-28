-- 038-sync-log-total-held.sql
--
-- Give the sync log a count of the rows a gate held, and fill it for the runs
-- that predate the column (#523).
--
-- A run reports what it did in counters -- created, updated, unchanged,
-- missing, errors, and the claims it refused -- and since #519 a row whose
-- every proposed change the category gate kept out is correctly counted as
-- unchanged: nothing was written to it. That left the summary unable to tell
-- "the source said nothing new" from "the source proposed something a person
-- has to answer", and on this database the gate is on for all three sources,
-- so the report has already been lying: UNESCO run 68 (2026-08-22) held all
-- 1272 sites -- Bamiyan, Jam, Berat, Djémila, each holding its inscription
-- criteria for a curator -- and its row in the admin's list read "Created 0,
-- Updated 0, Errors 1". A run that touched nothing. Public Art run 67 held 199
-- of its 200, the museum run 64 held 15.
--
-- total_held is a subset of total_unchanged rather than a fifth bucket beside
-- it: a held row still moved nothing, and that counter's meaning is fixed by
-- its own comment. total_curated_conflicts is the precedent for counting a
-- refusal on top of the outcome buckets rather than instead of one, and no
-- more: it counts claimed fields, on updated rows as well, so it can exceed
-- total_unchanged, where this counts rows and only inside it.
-- The code decides it per row on the predicate that files the changeset row
-- as held -- outcome unchanged, with something in heldFields -- so the counter
-- always equals the number of held rows a run recorded. That is what makes the
-- fill below exact rather than a guess: for every run that recorded its
-- changeset, count(*) over its held rows is the number the code would have
-- written. Runs from before the gate have no held rows and keep 0, which is
-- true of them. A row the gate wrote pending is a created row, not a held one,
-- and is not counted here either.
--
-- What it cannot fill exactly it leaves alone and names. A run whose changeset
-- never landed, or landed only in part -- the insert goes in batches of 500
-- with no transaction around them, so a failure on the third batch of run 68's
-- 1272 rows leaves a thousand committed under the same lost-changeset marker --
-- is excluded from the fill and keeps 0, and the query at the end lists it with
-- the held rows that did land, so that zero is read as unknown rather than as
-- none. A count taken from a partial record would read as exact everywhere
-- afterwards, which is the one thing this column must not do. 009 filled
-- provenance the same way, from the run that had actually written the rows.
--
-- Order: adds the column itself, so it may run before or after the next
-- re-application of 01-schema.sql, and any number of times -- a second run
-- finds every counter already equal to its rows and writes nothing.
--
-- Apply with:
--   npm run db:run-sql -- -v ON_ERROR_STOP=1 < db/migrations/038-sync-log-total-held.sql

\set ON_ERROR_STOP on

BEGIN;

ALTER TABLE experience_sync_logs ADD COLUMN IF NOT EXISTS total_held INTEGER DEFAULT 0;

DO $fill$
DECLARE
  filled INT;
BEGIN
  WITH held AS (
    SELECT sync_log_id, count(*) AS n
      FROM experience_sync_changes
     WHERE change_type = 'held'
     GROUP BY sync_log_id
  ), fixed AS (
    UPDATE experience_sync_logs l
       SET total_held = held.n
      FROM held
     WHERE l.id = held.sync_log_id
       AND COALESCE(l.total_held, 0) <> held.n
       -- The two markers CHANGESET_LANDED_SQL reads (syncLogMarkers.ts). A run
       -- carrying either may have landed part of its changeset, and a count
       -- from part of the record is not the number the run would have written.
       AND NOT COALESCE(l.error_details @> '[{"externalId": "changeset"}]', FALSE)
       AND NOT COALESCE(l.error_details @> '[{"externalId": "system", "error": "Server restarted while sync was running"}]', FALSE)
    RETURNING l.id
  )
  SELECT count(*) INTO filled FROM fixed;

  RAISE NOTICE 'Filled total_held on % run(s) from the held rows they recorded', filled;
END;
$fill$;

-- Runs this file left alone: the changeset was lost or landed in part, or the
-- process died under the run and the startup sweep closed it -- the same two
-- markers as above. held_rows_landed is what the record does hold; the true
-- count is at least that, and nothing can now say how much more.
SELECT l.id,
       l.category_id,
       l.started_at::date AS day,
       l.status,
       l.total_unchanged,
       l.total_held,
       (SELECT count(*) FROM experience_sync_changes c
         WHERE c.sync_log_id = l.id AND c.change_type = 'held') AS held_rows_landed
  FROM experience_sync_logs l
 WHERE COALESCE(l.error_details @> '[{"externalId": "changeset"}]', FALSE)
    OR COALESCE(l.error_details @> '[{"externalId": "system", "error": "Server restarted while sync was running"}]', FALSE)
 ORDER BY l.id;

COMMIT;
