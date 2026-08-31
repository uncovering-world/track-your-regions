# ADR-0041: A database says which migrations it has seen

**Date:** 2026-08-31
**Status:** Accepted

---

## Context

`db/init/01-schema.sql` is the canonical schema. Postgres applies it to an empty
database automatically, and it is re-applied by hand as it grows new tables and
columns. Beside it, `db/migrations/NNN-*.sql` carry what a database already
holding data cannot get from re-applying that file: one-shot cleanups,
backfills, and DDL that fails while the old rows are still there. There are 40
of them.

Those files are applied by hand, and nothing records which of them a given
database has been through. The state of any database is therefore remembered
rather than known, and the memory is not reliable — a session working on this
repository in August 2026 could say that `034`, `035`, `036` and `038` had been
applied to the development database and that `037` was simply unrecorded.

The cost is not hypothetical. #434 is one instance: re-applying `01-schema.sql`
re-ran a seed that had no real arbiter, a second default world view appeared,
and no artefact in the database could say which changes that database had seen.
A migration re-applied because nobody was sure is the cheap failure; one skipped
because somebody was sure is the expensive one.

The obvious tool cannot be the answer here. `drizzle-kit` is in the repository,
but the Drizzle schema deliberately omits the PostGIS geometry columns
(ADR-0004), so the hand-written SQL stays authoritative and a generated
migration history would describe a subset of the database.

Two further facts constrain any runner:

- **A migration decides its own transaction, and a second one around it is a
  lie.** 34 of the 40 files open their own. Handing such a file to
  `psql --single-transaction` warns *there is already a transaction in
  progress*, and then the file's own `COMMIT` ends psql's outer transaction —
  everything after it runs unwrapped. Measured on the development server
  (PostgreSQL 17.10) with a file that commits and then fails: the statement
  after the `COMMIT` was still there afterwards, and psql exited 0. So the
  wrapper does not make a file atomic; it makes it *look* atomic, which is
  worse than not offering the guarantee at all.

  `001-curator-system.sql` says in its own header that its
  `ALTER TYPE user_role ADD VALUE` must be outside a transaction. That was true
  before PostgreSQL 12 and is no longer: on 17 the statement is accepted inside
  a transaction block, and only *using* the new value before the commit is
  refused, which `001` does not do. It stands as the clearest statement of the
  principle rather than as the blocking case — a runner that overrides what a
  migration says about its own transaction is deciding something it cannot know.
- **psql exits 0 when a statement in a piped script fails.** That is how `006`,
  which aborts on purpose when a row it would delete still has dependents, used
  to report success to the shell. A runner that recorded a file as applied on
  psql's word alone would write down the opposite of what happened.

## Decision

The numbered SQL migrations stay, and the database records which of them it has
been through:

1. A `schema_migrations` table in `db/init/01-schema.sql` — `filename`,
   `checksum`, `ran`, `applied_at` — so every database has a ledger from the
   moment it exists, and the table has one definition.
2. `scripts/db-migrate.sh` applies pending files in filename order and writes
   the ledger. It does not wrap a migration in a transaction, because the file
   decides that for itself. It records a file only by appending the `INSERT`
   to the migration and handing both to one psql invocation under
   `ON_ERROR_STOP=1`, so the row is reached only when every statement before it
   succeeded.
3. `ran = false` marks a file recorded without being executed against this
   database — a person's assertion, not an observation. It is how a database
   older than the ledger states what it already carries, and how a database
   created from the canonical schema states that these backfills have no rows
   to repair. `db:status` reports the two apart, and never merges them.

## Alternatives Considered

| Option | Why rejected |
|--------|-------------|
| Drop `db/migrations/` entirely; keep one canonical schema and make rebuilding a database the answer | A legitimate pre-production practice, and not available here. A rebuild costs about 30 minutes of GADM load plus the geometry precalculation, the Wikivoyage import and the experience syncs — and `037` alone took 2 h 24 m on the development database. Worse, it is lossy: the curator's held decisions, claims and assertion acceptances exist only in that database and no source reproduces them. Choosing this would have meant making a rebuild cheap first, which is a larger piece of work than the ledger. |
| A migration framework (`drizzle-kit`, `node-pg-migrate`, Flyway) | The schema of record is hand-written SQL with PostGIS types Drizzle does not model (ADR-0004), so a framework's history would describe part of the database and claim to describe all of it. The runner needed here is one loop, a checksum and an `INSERT`. |
| Wrap every migration in `psql --single-transaction` | Against the 34 files that open their own it does not hold: their `COMMIT` closes psql's outer transaction and the rest of the file runs unwrapped, so the option buys a guarantee it does not deliver. The file is the right place for that decision anyway — only it knows whether its work is one step or several. |
| Record the migration and its ledger row in two separate psql calls | A crash between the two leaves a migration applied and unrecorded. Appending the `INSERT` to the file costs nothing and removes the window that is not a process kill. |
| Have the runner create `schema_migrations` when it is missing | Two definitions of one table, drifting the moment either changes. The runner refuses and prints the command that re-applies the canonical schema. |

## Consequences

**Positive:**

- The state of a database is readable from the database: `npm run db:status`
  says what has been applied, what is pending, and which of the records are
  assertions rather than observations.
- A migration that fails is not recorded, so the next run picks it up again
  rather than stepping over it. The runner's own test drives exactly that case.
- The checksum makes a file edited after it was recorded visible, which is the
  other way a ledger can quietly stop being true.
- A database created by `npm run db:create` is baselined immediately, so it
  starts level instead of reporting 40 pending files it has no work for.

**Negative / Trade-offs:**

- The ledger is a record, not a lock. Nothing stops a migration being applied
  by hand with `db:run-sql`, and one applied that way is invisible to it. The
  runner is documented as the way, not enforced as the only way.
- A baselined row asserts what nobody checked. `037` is recorded on the
  development database because re-running it costs two and a half hours, not
  because anything confirmed it ran — and the ledger says as much by keeping
  `ran = false` rather than pretending otherwise.
- Every existing database needs the canonical schema re-applied once to get the
  table, and a baseline afterwards. There is no way to give an existing database
  a ledger without one deliberate act.

## References

- Related ADRs: [ADR-0004](0004-drizzle-orm-plus-raw-pool-for-postgis.md) — why the hand-written SQL is authoritative
- Related docs: `db/migrations/README.md`, `docs/tech/development-guide.md` § Database Migrations
- PR / issue: #435, #434
