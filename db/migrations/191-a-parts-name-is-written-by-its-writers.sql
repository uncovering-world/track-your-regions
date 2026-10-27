-- 191: a part's name is written by the writers of its point, not copied by a trigger (ADR-0156, #1426)
--
-- A serial site's part was renamed, moved and renumbered by triggers whenever
-- its point, its article or its site's name changed (part_follows_point() and
-- the three triggers that applied it). A fact about the part is the part's own
-- (ADR-0156), so the writers that change what a part is named or placed for
-- write the part themselves (followTheirPoints, backend/src/db/partFieldsWriter.ts):
-- the site's run, a curator's correction of the point, an accepted source
-- coordinate, a published held name, a new article and the undo of a merge. A
-- curator's name for a part is a claim on the part's row, never on its point.
--
-- On the development catalogue on 2026-10-27 no part's point carried a claim
-- on its name and every part was already named as the rule names it, so no row
-- changes here.
--
-- Re-runnable.

\set ON_ERROR_STOP on

BEGIN;

DROP TRIGGER IF EXISTS trg_follow_component_point ON experience_locations;
DROP TRIGGER IF EXISTS trg_follow_part_article ON experiences;
DROP TRIGGER IF EXISTS trg_follow_component_site ON experiences;
DROP FUNCTION IF EXISTS follow_component_point();
DROP FUNCTION IF EXISTS follow_part_article();
DROP FUNCTION IF EXISTS follow_component_site();
DROP FUNCTION IF EXISTS part_follows_point(INTEGER);

COMMIT;
