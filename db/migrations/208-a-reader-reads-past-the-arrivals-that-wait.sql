-- 208-a-reader-reads-past-the-arrivals-that-wait.sql
--
-- The hot reads slowed down with arrivals no reader sees (#2283). The first
-- places pass under ADR-0175 added 10 063 memberships waiting for a curator,
-- with their unread points, and a reader-facing read found the shown ones by
-- reading every membership and every point of the catalogue and filtering the
-- waiting ones out afterwards: the world points overview went from 35 to 68 ms.
--
-- Two partial indexes hold what a reader may be shown, on the predicates the
-- reader modules spell: a membership admitted and passed
-- (membershipAdmittedSql, membershipVisibleSql) and a point offered and passed
-- (offeredLocationSql, publishedContentSql). What a reader sees is unchanged.
--
-- Re-runnable: each index is created if missing.

\set ON_ERROR_STOP on

BEGIN;

CREATE INDEX IF NOT EXISTS idx_experience_kind_memberships_reader
    ON experience_kind_memberships(experience_id, kind_id) INCLUDE (id)
    WHERE admission <> 'refused' AND curation_state <> 'pending';

CREATE INDEX IF NOT EXISTS idx_experience_locations_reader
    ON experience_locations(experience_id) INCLUDE (id)
    WHERE missing_since IS NULL AND existence <> 'lost' AND merged_into_id IS NULL
      AND curation_state <> 'pending';

COMMIT;
