# Database Migrations

`db/init/01-schema.sql` is the canonical schema — tables, indexes, triggers,
tile functions and the auth system. It is the only file in `db/init/`, and
Postgres applies it automatically when a database is created empty
(`docker-entrypoint-initdb.d`, see `docker-compose.yml`).

The numbered files in this directory carry what a database holding data cannot
get from that file: one-shot cleanups, backfills, and DDL that fails while the
old rows are still there. Apply them by hand, in filename order:

```bash
npm run db:run-sql -- -v ON_ERROR_STOP=1 < db/migrations/006-single-default-world-view.sql
```

The flag is not optional. `db:run-sql` is plain `psql`, and psql exits 0 when a
statement in a piped script fails, so without it a migration that aborts on
purpose — 006 refuses to run when a row it would delete still has dependents —
reports success to the shell. `006` also sets `\set ON_ERROR_STOP on` in the
file itself so it cannot be defeated by the way it is invoked; `001`-`005`
predate that habit.

Nothing records which of these files a given database has already seen — that
state is tribal knowledge today. Issue #435 tracks adding a `schema_migrations`
ledger and a runner.

Re-applying `01-schema.sql` to an existing database is the other half of the
workflow: it is how new tables and columns arrive between migrations. That is
why the file has to stay idempotent — DDL uses `IF NOT EXISTS` / `OR REPLACE`,
and every seed `INSERT` names an explicit `ON CONFLICT` arbiter backed by a real
unique index. A bare `ON CONFLICT DO NOTHING` is not a guard: on a table whose
only unique constraint is a serial primary key it never fires, and the seed row
is inserted again on every run. That is exactly how a second default world view
appeared (#434). `backend/src/db/schemaSeeds.test.ts` guards the rule.

A migration that adds a constraint the existing rows violate has to run *before*
the next re-application of `01-schema.sql`, since the schema file will otherwise
fail on the same constraint. Each such migration says so in its header.
