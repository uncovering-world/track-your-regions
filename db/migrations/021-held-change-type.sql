-- 021: a run may record that the gate held a proposal (#519, ADR-0025)
--
-- One widened CHECK and one comment. Nothing to backfill, and nothing an existing
-- row could violate: `held` is a *new* value the writer may now use, and no run
-- has ever produced one — `requires_curation` is false on all three categories,
-- so no row has ever been held and every changeset row on disk is `created`,
-- `updated`, `conflict`, `missing`, `returned`, `failed` or `filtered`.
--
-- Why the word exists at all: under a gated source the upsert keeps a visible
-- row's stored content and refuses the incoming value. Until now the changeset
-- filed that refused value under `changed_fields` with no reason attached and the
-- row as `updated`, so the run reported a change it had not made and the curator's
-- screen rendered the held value as the one now live — the exact opposite of the
-- truth. `conflict` could not absorb it: that word means a curator had claimed the
-- field, so the stored value won on purpose and nothing is waiting, while a held
-- row is waiting on a verdict nobody has given.
--
-- The per-field `held` flag inside `changed_fields` needs no DDL — the column is
-- jsonb. Rows written before this file carry no such key, which reads as false,
-- and that is the truth about them: nothing was ever held.
--
-- Order: this file may run before or after the next re-application of
-- `01-schema.sql`, in either order and any number of times. The drop/add idiom is
-- the same one `01-schema.sql` uses for this constraint, for the same reason —
-- `CREATE TABLE IF NOT EXISTS` cannot widen a CHECK on a table that already
-- exists. Applying this file changes what nobody sees.
--
-- Apply with:
--   npm run db:run-sql -- -v ON_ERROR_STOP=1 < db/migrations/021-held-change-type.sql

\set ON_ERROR_STOP on

BEGIN;

ALTER TABLE experience_sync_changes DROP CONSTRAINT IF EXISTS experience_sync_changes_change_type_check;
ALTER TABLE experience_sync_changes ADD CONSTRAINT experience_sync_changes_change_type_check
    CHECK (change_type IN ('created', 'updated', 'conflict', 'held', 'missing', 'returned', 'failed', 'filtered'));

-- Re-stated here because `01-schema.sql` states it too, and a database that gets
-- only this file must not keep the old wording — which named one of the two
-- reasons a value in this column was never written.
COMMENT ON COLUMN experience_sync_changes.changed_fields IS 'Array of {field, old, new, significance, curatedConflict, held}. Each entry holds the value the source proposed for that field even when the run refused to write it, so a curator can answer it later; the two flags say why it was refused - curatedConflict = a curator had claimed the field (answered by accept-source), held = the category gate kept it out of a row a reader can already see (answered by publishing). Both false on a field the run applied.';

COMMIT;
