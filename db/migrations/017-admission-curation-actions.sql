-- 017: a curator can answer a refusal, and the log has to be able to say so
--
-- Migration 016 gave a category somewhere to record that it turned a row down
-- (ADR-0024). The answer to that is a curator's, and it is neither of the two
-- verdicts `experience_curation_log` already knows: `marked_former` and
-- `marked_lost` are statements about the world, and this is a statement about
-- which of our lists the row belongs on.
--
-- Two actions, because a refusal has two honest answers:
--
--   admission_confirmed  — the rule was right. The row stays refused and leaves
--                          the queue. It is not deleted: the British Museum is
--                          the archaeology category's strongest candidate, and
--                          the refused set is the list that category will be
--                          built from.
--   admission_overridden — the rule was wrong. The row is admitted again and
--                          'admission' is pinned in curated_fields, so the next
--                          run does not refuse it a second time.
--
-- Order: apply this before the next re-application of 01-schema.sql, which now
-- carries the same constraint.
--
-- Apply with:
--   npm run db:run-sql -- -v ON_ERROR_STOP=1 < db/migrations/017-admission-curation-actions.sql

\set ON_ERROR_STOP on

BEGIN;

ALTER TABLE experience_curation_log
    DROP CONSTRAINT IF EXISTS experience_curation_log_action_check;

ALTER TABLE experience_curation_log
    ADD CONSTRAINT experience_curation_log_action_check
    CHECK (action IN (
        'created', 'rejected', 'unrejected', 'edited',
        'added_to_region', 'removed_from_region',
        'marked_former', 'marked_lost', 'state_restored',
        'accepted_source', 'missing_dismissed',
        'admission_confirmed', 'admission_overridden'
    ));

COMMIT;
