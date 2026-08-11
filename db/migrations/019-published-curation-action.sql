-- 019: a curator may say a reader can see this (ADR-0025 § 4.4)
--
-- One widened CHECK, and nothing else. `experience_curation_log.action` is a
-- closed list, so `POST /api/experiences/:id/publish` cannot record what it did
-- until 'published' is in it — and because the audit insert sits inside the
-- publish transaction, a rejected action does not merely lose the audit row, it
-- rolls the publication back with it. Applying this file changes nothing a
-- reader or a curator can see; it makes the endpoint's own write legal.
--
-- Order: this file may run before or after the next re-application of
-- `01-schema.sql`, in either order and any number of times. `DROP CONSTRAINT IF
-- EXISTS` followed by `ADD CONSTRAINT` is the same pair `01-schema.sql` carries
-- for this constraint, with the same list, so whichever file reaches a database
-- first leaves it in the state the other would have, and a second application
-- of either is a no-op in effect. The CHECK is a widening — every value already
-- stored still satisfies it — so no existing row can make the ADD fail.
--
-- Apply with:
--   npm run db:run-sql -- -v ON_ERROR_STOP=1 < db/migrations/019-published-curation-action.sql

\set ON_ERROR_STOP on

BEGIN;

ALTER TABLE experience_curation_log DROP CONSTRAINT IF EXISTS experience_curation_log_action_check;
ALTER TABLE experience_curation_log ADD CONSTRAINT experience_curation_log_action_check
    CHECK (action IN ('created', 'rejected', 'unrejected', 'edited', 'added_to_region', 'removed_from_region', 'marked_former', 'marked_lost', 'state_restored', 'accepted_source', 'missing_dismissed', 'admission_confirmed', 'admission_overridden', 'published'));

COMMIT;
