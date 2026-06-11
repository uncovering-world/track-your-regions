# Database Migrations

Numbered, idempotent SQL migrations applied to existing `track_regions` databases.

## Workflow

Apply a migration with:

```bash
docker exec -i tyr-ng-db psql -U postgres -d track_regions < db/migrations/NNN-description.sql
```

Migrations are always **mirrored into `db/init/01-schema.sql`** so that a fresh database
created from the init scripts already includes every migration — no catch-up needed for
new installs.

## Naming and numbering

Files follow the pattern `NNN-description.sql` where `NNN` is a zero-padded sequential
integer (001, 002, …). Never skip or reuse numbers; always increment from the last file.

## Idempotency conventions

Every migration must be safe to re-run on an already-migrated database:

- DDL uses `IF NOT EXISTS` / `IF EXISTS` guards (`ADD COLUMN IF NOT EXISTS`,
  `CREATE TABLE IF NOT EXISTS`, `DROP COLUMN IF EXISTS`, etc.)
- Constraint additions that have no `IF NOT EXISTS` syntax are wrapped in a `DO $$`
  block that checks `pg_constraint` before executing the `ALTER TABLE`.
- DML-only migrations (e.g., one-shot `UPDATE` cleanup) are written so that a second
  run is a harmless no-op (e.g., updating rows to the value they already hold).

## Current migrations

| File | Description |
|------|-------------|
| `001-curator-system.sql` | Curator role, curation tables, experience editing support |
| `002-email-verification-tokens.sql` | `email_verification_tokens` table for email verification flow |
| `003-remove-curator-picks.sql` | Deactivate the "Curator Picks" experience source |
| `004-dedupe-subregions.sql` | Deduplicate sibling subregions; add unique index |
| `005-wv-import-geoshape-schema.sql` | `wikidata_geoshapes` table + three `region_import_state` columns for geoshape/hierarchy review |
| `006-wv-import-workflow-state.sql` | Work-unit/sign-off state: six `region_import_state` columns + `world_views.skeleton_confirmed` |
