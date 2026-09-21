# ADR-0064: Row types are generated from the schema, and queries stay SQL

**Date:** 2026-09-21
**Status:** Accepted

---

## Context

ADR-0004 chose two query patterns for the backend: Drizzle ORM for type-safe
CRUD, and raw `pool.query()` with parameterized SQL for PostGIS. It named its
own risk in its last line — the Drizzle model in `backend/src/db/schema.ts`
"must stay in sync with SQL schema (`db/init/01-schema.sql`)" — and nothing
was ever built to hold it there.

Measured at HEAD on 2026-09-21, the two halves had long since stopped being
halves. `db/init/01-schema.sql` declares 43 tables and 2 views. The Drizzle
model, 598 lines, covered 21 of those tables and lacked 17 of the 31
columns `experiences` has — `admission`, `curation_state` and
`missing_since` among them. No test compared it to the SQL, and `drizzle-kit`,
the tool that would have, was never installed. Drizzle was used at 7 query
sites in 6 files plus the e2e seed: `services/ai/aiSettingsService.ts`,
`services/ai/learnedRulesService.ts`, `controllers/division/divisionCrud.ts`,
`controllers/division/focusColumns.ts`, `services/sync/syncUtils.ts` and
`db/seed/e2eFixture.ts`. Everything else is SQL: 1097 `pool.query` and
`client.query` calls in 129 files, 71 of them using PostGIS (`ST_*`), 32 with
`ON CONFLICT`, 22 with CTEs, and hand-built dynamic `WHERE` clauses in 3. The
row types those statements return were written by hand, at 45 `.rows as`
casts and 29 `pool.query<...>` sites, each a claim about the schema that no
gate checked.

The schema was restated twice more, each restatement with a guard of its own.
The vocabularies its `CHECK` constraints declare were a TypeScript union in
`services/sync/changeRecorder.ts` and a `z.enum` in `types/index.ts`, kept
equal to the DDL by `db/schemaMigrationParity.test.ts` (1016 lines) reading
those two files as text. The `VARCHAR` widths were Zod `.max()` bounds, kept
equal by `types/columnBounds.test.ts` (455 lines) reading the DDL with a
regular expression. Each guard is a third copy of the fact it protects, and a
parser of TypeScript source written for one file's layout.

The umbrella #788 had already declined a full Drizzle adoption; #792 was filed
for the drift itself; the milestone *Reduce Change Cost* names the outcome.
ADR-0041 fixes what the schema of record is — the hand-written SQL in
`db/init/01-schema.sql`, re-applied by hand as it grows, with `db/migrations/`
carrying what a database already holding data cannot get from re-applying it.
Whatever holds the types to the schema has to read that file, and nothing
else.

## Decision

**1. One generated file, read back from a fresh database that `db/init`
built, checked in, and diffed by a `check`-tier gate.**
`backend/src/db/generateSchemaTypes.ts` reads `pg_attribute` through
`format_type` — not `information_schema.columns`, which reports a NULL width
for an array column such as `country_codes VARCHAR(10)[]` — with `pg_enum` and
`pg_constraint`, leaving out every relation `pg_depend` records as owned by an
extension, so PostGIS's own tables never appear.
`backend/src/db/schemaTypesRender.ts` is the pure half: the type map, the
parsing of `pg_get_constraintdef` into a value list, the rendering, with a
unit test of its own. The output, `backend/src/db/schema.generated.ts`, holds
one `<PascalCase>Row` interface per relation in the *select shape* `pg`
returns — `int8` and `numeric` as strings, timestamps as `Date`, `jsonb` as
`unknown`, a geometry as hex EWKB, a view's columns nullable — the two
Postgres enums (`UserRole`, `AuthProvider`) as unions,
`COLUMN_WIDTHS` (per element for an array), `CHECK_VALUES` (every `CHECK`
that is one value list over one column, in declared order; a range or a
multi-column rule is passed over) and `CheckValue<table, column>`. A column of
a type the map does not know fails the generator by name rather than becoming
`unknown`. `scripts/db-types.sh` stands the compose file's `db` service up
under a project of its own, on a fresh volume so `db/init` is applied, waits
over TCP (initdb's temporary server answers the socket before the restart),
runs the generator and tears the container down, volume and all;
`npm run db:types` regenerates and `npm run db:types:check` diffs. The
generator refuses any database not named like a test one
(`TEST_DB_NAME_PATTERN` in `backend/src/db/testDbName.ts`, the guard the e2e
seed and the database lane already apply), because the developer's catalogue
holds whatever branches were applied to it — 56 relations on 2026-09-21
against the schema's 45. `db:types` is a `check`-tier gate in
`scripts/gates.mjs` with an input class of its own, `schema`: the schema file,
the generated file, the generator, the renderer and the runner. The
migrations are not an input, since a fresh database never reads one. It is a
`node` setup, because the generator runs from `backend/node_modules`; the
database is Docker, which every runner already has.

**2. Queries are raw parameterized SQL on the pool, typed by the generated
rows; there is no query builder.** A statement is
`pool.query<Row>(sql, params)`, with `Pick<ExperiencesRow, ...>` for a partial
select and a small type of its own for a computed column. The seven Drizzle
sites become that shape, their transactions on one client as
`docs/tech/development-guide.md` § Database Queries requires, and
`backend/src/db/schema.ts` and `drizzle-orm` are removed. ADR-0004 is
superseded.

**3. A vocabulary a column constrains is read from `CHECK_VALUES` and
`CheckValue`, a bound from `COLUMN_WIDTHS`, and the guards that kept the
copies equal are deleted.** `changeRecorder.ts`'s union and the `z.enum`s in
`types/index.ts` read `CHECK_VALUES`; every Zod bound on a `VARCHAR`-backed
field reads `COLUMN_WIDTHS`. `types/columnBounds.test.ts` goes, and so does
the vocabulary half of `db/schemaMigrationParity.test.ts`; its
schema-to-migration half stays, since that compares two SQL files and the
generator reads only one of them. Two bounds are deliberately tighter than
their column and keep a literal with its reason beside it: the email at 254,
per RFC 5321, and a label at the column's width minus the 51 characters its
wrapper adds.

## Alternatives Considered

| Option | Why rejected |
|--------|-------------|
| Kysely with `kysely-codegen` — a typed SQL builder whose `DB` interface a generator produces from the live database | The codegen emits column types only: no `VARCHAR` widths, no `CHECK` lists. Neither guard could be deleted without a second, in-house pass over the catalog, and the builder itself would serve 7 sites and 3 files of dynamic `WHERE` while 1097 statements stay SQL — ADR-0004's own negative was "two query patterns to learn" |
| An in-house generator plus Kysely for the CRUD sites | The generator is this decision; adding a builder beside it for seven sites is the same second pattern with a smaller footprint. The door is left open: the same catalog rows can render a Kysely-shaped `DB` interface if a later slice needs one, and nothing here forecloses it |
| pgtyped — per-query parameter and result types, generated from `.sql` files or from `sql`-tagged template literals in TypeScript against a live database | Every one of 1097 statements is rewritten into its tagged form and its types regenerated on each change, with a database running for the generation; a plain `pool.query` string is invisible to it. The gain is per-statement; the cost is the whole backend, and a typed result per query is what a `pool.query<Row>` with a generated row type already gives where the select is a column list |
| Zapatos, or Drizzle's own introspection | The same shape as `kysely-codegen`: column types without widths or value lists, so the third copies and their guards stay |
| The raw pool with hand-written types — the status quo | 45 casts and 29 type parameters that no gate reads are the drift #792 was filed for |
| Finishing the Drizzle model | A 598-line hand-written copy of a 43-table schema, 22 tables and 17 columns of `experiences` behind, is the same drift in a second language; #788 had already declined the full adoption, and `drizzle-kit`'s introspection would still leave the widths and the lists unread |

## Consequences

**Positive:**

- **The schema is stated once, and every restatement is derived.** A row type,
  a vocabulary and a bound all read `schema.generated.ts`, which reads
  `01-schema.sql` through the database that built it; ADR-0041's schema of
  record is the one file a type can be wrong about.
- **Two guards over TypeScript source as text are gone** — 455 lines of
  regular expressions over the DDL and the vocabulary half of a 1016-line
  parity test — and nothing replaces them: the copies they compared no longer
  exist.
- **Drift is a red gate, not a missing column found at runtime.** A schema
  edit without `npm run db:types` fails `db:types:check`, locally and in CI's
  check job, on the change that made it.
- **One query pattern.** A reader of the backend meets `pool.query<Row>` and
  parameterized SQL everywhere; the question ADR-0004 left open, which of two
  patterns to reach for, no longer has to be asked.
- **The generated file is committed**, so a review sees the schema change and
  its typed consequence in one diff, and a checkout typechecks without Docker.
- **An array column's width is right.** `information_schema` reports none for
  `country_codes VARCHAR(10)[]`; `format_type` reports 10, and the generated
  bound is per element.

**Negative / Trade-offs:**

- **Typed inserts and updates are lost at the seven former Drizzle sites.**
  That was already true at the 1097 others; the generated rows type what a
  statement returns, not what it writes. The writer-module slice #791 is where
  a write shape gets an owner.
- **The select shape is a claim about the driver, not the catalog.** The
  catalog says a column is `int8`; that it arrives as a string is `pg`'s type
  parser, and the generator's map of one to the other is written by hand.
  `backend/src/db/schemaTypes.db.test.ts` selects one value of every mapped
  type on the live driver and compares, in the database lane — the lane that
  runs when `backend/package-lock.json` moves — so a `pg` release that changed
  a parser is caught there rather than by `db:types:check`, which reads the
  catalog alone.
- **A `jsonb` column is `unknown`**, and a reader narrows it. The catalog
  knows nothing of the value's shape, and a type that pretended to would be a
  hand-written claim again.
- **A schema edit now needs Docker on the developer's machine**, about half a
  minute for the gate; CI's check job pays it only when the `schema` class
  moved.
- **The types describe `01-schema.sql`, never a migration.** A column a
  migration adds is typed only once the schema file carries it too, which
  ADR-0041 already requires and the parity test's remaining half still checks.
- **A view's columns are all nullable** in the generated type, since the
  catalog records no `NOT NULL` for them; a reader of `region_render_geom`
  handles a null the view cannot in fact produce.
- **The e2e seed loses `sql.identifier(...)`'s rename safety.** It is replaced
  by the row types on its reads and by the smoke lane, which runs the seed on
  every pull request whose inputs ask for it.

## References

- Related ADRs: ADR-0004 (superseded by this one), ADR-0041 (a database says
  which migrations it has seen — the hand-written SQL remains the schema of
  record, and this generator reads nothing else), ADR-0062 (a gate runs when,
  and only when, the inputs it checks have changed — `db:types` is one more
  entry in that map, with an input class of its own), ADR-0063 (the same
  test-database guard, `TEST_DB_NAME_PATTERN`, now with three callers; and its
  decision 1's criterion for the database lane — the row set — extended in
  the guide it names as that criterion's home by a second reason, a claim
  about what the live driver hands back, which `schemaTypes.db.test.ts` is)
- Related docs: `docs/tech/development-guide.md` § Database Queries and
  § Database Migrations, `docs/tech/gates.md`
- PR / issue: #792; parent umbrella #788; the milestone *Reduce Change Cost*
