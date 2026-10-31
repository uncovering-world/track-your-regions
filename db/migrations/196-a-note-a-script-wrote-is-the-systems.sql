-- 196-a-note-a-script-wrote-is-the-systems.sql
--
-- A curation log row's `details.note` is the curator's own words, and every
-- screen quotes it as such: the pin card, the pins list and the place's
-- history. The one-time script that released the unread batch answer's pins
-- (ADR-0096, `backend/src/scripts/releaseBatchPins.ts`) wrote its own
-- sentence there, with an issue number, so a card read "You kept it out on
-- 26 Oct 2026 - 'Pinned by the unread batch answer of 2026-09-14; kept once
-- read (#1365)'" as if the curator had typed it (#2195). What a script
-- records about how an answer came about is `details.systemNote`, shown as
-- the system's and never quoted; the script writes it there from now on, and
-- this moves the rows it wrote: 8 kept, 111 released on the development
-- database.
--
-- Re-runnable: a moved row carries no `note` to match.

\set ON_ERROR_STOP on

BEGIN;

UPDATE experience_curation_log
   SET details = (details - 'note')
                 || jsonb_build_object('systemNote', 'kept when the batch answer of 14 September 2026 was read')
 WHERE details->>'note' = 'Pinned by the unread batch answer of 2026-09-14; kept once read (#1365)';

UPDATE experience_curation_log
   SET details = (details - 'note')
                 || jsonb_build_object('systemNote', 'released when the batch answer of 14 September 2026 was read')
 WHERE details->>'note' = 'Pinned by the unread batch answer of 2026-09-14; released once read (#1365)';

COMMIT;
