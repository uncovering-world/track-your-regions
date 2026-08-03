-- 011: curator decisions on an experience's lifecycle (issue #480, slice 3)
--
-- Slice 1 gave experiences two lifecycle axes and left both for a curator to
-- set: `source_membership` (present/former) and `existence` (extant/lost). The
-- audit log's action list predates them, so recording those decisions needs the
-- CHECK widened. `missing_dismissed` is the fourth: a verdict that moves no axis
-- still clears missing_since, and calling that a restoration would record one
-- that restored nothing. Nothing else changes — the columns already exist.
--
-- Apply with:
--   npm run db:run-sql -- -v ON_ERROR_STOP=1 < db/migrations/011-curation-lifecycle-actions.sql

\set ON_ERROR_STOP on

BEGIN;

ALTER TABLE experience_curation_log DROP CONSTRAINT IF EXISTS experience_curation_log_action_check;
ALTER TABLE experience_curation_log ADD CONSTRAINT experience_curation_log_action_check
    CHECK (action IN (
        'created', 'rejected', 'unrejected', 'edited',
        'added_to_region', 'removed_from_region',
        'marked_former', 'marked_lost', 'state_restored', 'accepted_source', 'missing_dismissed'
    ));

COMMIT;
