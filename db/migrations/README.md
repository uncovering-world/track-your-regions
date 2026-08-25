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

`033-division-focus-data.sql` fills `administrative_divisions.focus_bbox` and `anchor_point` —
the focus data regions have always had, now stored for divisions too (#674) — from
`geometry_focus()`, the one rule, for every division with geometry. It writes the two columns
directly rather than re-firing the geometry trigger, which would drag the simplification and 3857
triggers through 392 112 rows, and it disables `trg_admin_div_geom_3857` around the write, since
that trigger fires on any UPDATE and compares geometries byte for byte to find it has nothing to
do. About five minutes on the dev database. Runs *after* the next re-application of
`01-schema.sql`, which defines the function and adds the column; its guard refuses otherwise. A
re-run fills only what is still empty and takes seconds. Its closing SELECT lists every division
whose box is global — the two Antarctica rows, and nothing else, on a database holding GADM 4.1.

`032-antimeridian-focus-data.sql` recomputes `focus_bbox` and `anchor_point` for the
regions the antimeridian fix in `update_region_focus_data()` reaches (#666; the measurement has since moved into `geometry_focus()`, which the guard accepts). The trigger
fires only on `geom` and `hull_geom`, so a database already holding rows keeps the wrong
boxes until something re-fires it: on the dev database the Far Eastern Federal District and
Fiji each claimed every longitude on Earth and anchored the camera in the wrong ocean. This
one runs *after* the next re-application of `01-schema.sql`, not before — it needs the fixed
function to be the one that answers, and its guard refuses to run otherwise rather than
writing the same wrong boxes back in place. Re-running it is a no-op.

`031-data-assertion-acceptances.sql` adds `data_assertion_acceptances`, the ledger
behind the admin panel's catalogue checks: one row per act of accepting what an
assertion currently finds, so the newest row per assertion is the debt this
catalogue is knowingly carrying and the rows behind it are the history of who
said so (ADR-0032). Nothing to backfill — an assertion with no accepted number is
reported in full, which is the correct starting state on a database nobody has
answered for yet. Adding a table cannot fail on rows already there, so it may run
before or after the next re-application of `01-schema.sql`.

`013-locations-mark-not-delete.sql` adds `experience_locations.missing_since` and drops
`ordinal`'s NOT NULL, so a point a source stops offering can be marked instead of deleted —
deleting it cascaded away the visit record and every region assignment on it. There is nothing
to backfill: until this file, anything missing was removed rather than recorded, so no existing
row has ever been observed missing. Adding a nullable column and dropping a NOT NULL cannot
fail on rows already there, so unlike the ordering rule above it may run before or after the
next re-application of `01-schema.sql`.

`012-new-badge-views.sql` adds `user_new_badge_views`, which records when a reader was
first shown the "New" chip. Nothing to backfill: an absent row means "not yet shown", which
is the correct starting state for every existing reader and experience. No retention job
either — the personal clause is bounded by the age of these rows themselves, so one that
ages past its seven days stops being read rather than needing to be swept.

Nothing to backfill *here*, but 009's backfill decided what the chip would show on day one,
and the answer would have been "everything": it credited every pre-existing row to the newest
run of its category, which was then the value the chip compared against. That is no longer
what the chip asks — #529 re-anchored it on `published_at`, which nothing backfills — so the
1547 rows credited without ever being observed wear no chip because they were never published,
not because of what a changeset says about them. The `created` clause that used to carry this
paragraph is gone with it.

`011-curation-lifecycle-actions.sql` widens the curation log's action check to
admit the five verdicts a curator can now record — `marked_former`,
`marked_lost`, `state_restored`, `missing_dismissed`, `accepted_source`. Widening a CHECK cannot fail
on rows already there, so unlike the ordering rule above it may run before or
after the next re-application of `01-schema.sql`; it exists because
`CREATE TABLE IF NOT EXISTS` leaves the old constraint alone on a database that
already holds the table.

`010-sync-filtered-entities.sql` separates filtering from failing: the museum
query answers with collections as well as museums, and dropping the ones with no
address is the filter working rather than the run breaking. It adds a counter and
widens the changeset's type check; there is nothing to backfill, because no run
before it distinguished the two.

`009-experience-change-provenance.sql` is the current example of the other kind:
its DDL is a copy of what `01-schema.sql` already carries and re-applying the
schema file achieves the same thing. What only exists in the migration is the
backfill — every source-derived row that predates change provenance is attributed
to the newest run of its category that wrote anything, which is how it got
there. Rows a curator created by hand are the exception: they were inserted
outside any run and keep NULL provenance permanently, since manual creation
writes none either. `COALESCE` guards each column, so running it twice is inert.
