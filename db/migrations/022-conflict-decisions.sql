-- 022: a curator may settle a disagreement, not only postpone it
--
-- One new table and one widened CHECK. Nothing to backfill: every disagreement on
-- disk today is unanswered by definition, because until this file there was no way
-- to answer one. Standing by your own edit was the absence of an action — the card
-- came back after every run, and the screen said so in as many words ("the source
-- will propose again").
--
-- What the table stores is the refused **value**, and the queue suppresses a
-- proposal only while it is jsonb-equal to it. A field-level rule would be simpler
-- and wrong: it would hide the one case the curator must see, a source that has
-- changed its mind. Measured on the dev database before building it — of seven
-- conflict rows across three objects, every one repeated a proposal the source had
-- made before, Aksum's three times in two days.
--
-- One row per (experience, field), replaced on conflict rather than appended: this
-- is the standing answer. The history of who answered what and when is
-- experience_curation_log's job, which is why 'declined_source' joins its CHECK
-- here — the list is closed, the audit insert shares the decision's transaction,
-- and a rejected action would roll the decision back with it.
--
-- Order: this file may run before or after the next re-application of
-- `01-schema.sql`, in either order and any number of times. `CREATE TABLE IF NOT
-- EXISTS` is a no-op where the table exists, and the drop/add idiom on the CHECK
-- is the same one `01-schema.sql` uses for the same reason. Applying this file
-- changes nothing a reader sees: it adds a place to record an answer, and the
-- answers it records only ever silence a question about a value that had already
-- lost.
--
-- Apply with:
--   npm run db:run-sql -- -v ON_ERROR_STOP=1 < db/migrations/022-conflict-decisions.sql
--
-- ...and set here as well, so the file stops on the first error however it is
-- invoked. Without it a failed CREATE TABLE would be followed by a widened CHECK
-- naming an action no table can hold, and psql would exit 0 either way.

\set ON_ERROR_STOP on

CREATE TABLE IF NOT EXISTS experience_conflict_decisions (
    id BIGSERIAL PRIMARY KEY,
    experience_id INTEGER NOT NULL REFERENCES experiences(id) ON DELETE CASCADE,
    field VARCHAR(100) NOT NULL,
    declined JSONB NOT NULL,
    decided_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    decided_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (experience_id, field)
);

-- No index beyond the unique constraint: its btree leads on experience_id, so it already
-- serves both readers of this table, and a second index would only be one more thing to
-- maintain on every upsert.

COMMENT ON TABLE experience_conflict_decisions IS 'Source proposals a curator refused; suppresses the queue card while the proposal is unchanged';

ALTER TABLE experience_curation_log DROP CONSTRAINT IF EXISTS experience_curation_log_action_check;
ALTER TABLE experience_curation_log ADD CONSTRAINT experience_curation_log_action_check
    CHECK (action IN ('created', 'rejected', 'unrejected', 'edited', 'added_to_region', 'removed_from_region', 'marked_former', 'marked_lost', 'state_restored', 'accepted_source', 'declined_source', 'missing_dismissed', 'admission_confirmed', 'admission_overridden', 'published'));
