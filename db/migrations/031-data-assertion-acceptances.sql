-- The ledger of what this catalogue has been told to carry.
--
-- The admin panel's catalogue checks are absolute claims -- a place is not stored
-- twice, an object a reader is offered has somewhere to go -- and the catalogue
-- does not hold all of them today. Measured on the dev catalogue the day this was
-- written: 28 objects a reader is offered sat in no region at all, 173 offered
-- places carried no region row, and 2911 pictures named no author. The panel keeps
-- the rules at zero and records the debt separately, so that a number standing
-- still is reported and a number that grew is what raises attention.
--
-- A ledger rather than a setting (ADR-0032): one row per act of accepting, never
-- updated, so the newest row per assertion is the number in force and the rows
-- behind it are the history of what this catalogue was carrying and who said so.
--
-- This file is a copy of what 01-schema.sql already carries, for a database that
-- already holds data. Nothing to backfill: an assertion with no accepted number is
-- reported in full, which is the correct starting state for every rule on a
-- database nobody has answered for yet. Adding a table cannot fail on rows already
-- there, so it may run before or after the next re-application of the schema file,
-- in either order and any number of times.
--
-- Apply with:
--   npm run db:run-sql -- -v ON_ERROR_STOP=1 < db/migrations/031-data-assertion-acceptances.sql

\set ON_ERROR_STOP on

BEGIN;

CREATE TABLE IF NOT EXISTS data_assertion_acceptances (
    id SERIAL PRIMARY KEY,
    assertion_id VARCHAR(80) NOT NULL,
    accepted_count INTEGER NOT NULL CHECK (accepted_count >= 0),
    accepted_by INTEGER NOT NULL REFERENCES users(id),
    accepted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_data_assertion_acceptances_current
    ON data_assertion_acceptances(assertion_id, accepted_at DESC, id DESC);

COMMENT ON TABLE data_assertion_acceptances IS 'What a person accepted as the debt this catalogue carries, per assertion. A ledger: the newest row per assertion_id is the number in force, the rest is history.';
COMMENT ON COLUMN data_assertion_acceptances.accepted_count IS 'The number the assertion returned when it was accepted, measured on the server at that moment rather than sent by the client.';

COMMIT;
