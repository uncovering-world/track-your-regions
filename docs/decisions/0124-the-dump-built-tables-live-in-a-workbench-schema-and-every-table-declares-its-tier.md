# ADR-0124: The dump-built tables live in a workbench schema, and every table declares its tier

**Date:** 2026-10-19
**Status:** Accepted
**Extends:** [ADR-0101](0101-bulk-reads-come-from-public-dumps-and-wikidata-is-kept-as-a-wide-subset.md) (the dump-built tables and their ledger get a schema of their own)

---

## Context

The database holds two kinds of table, and until now nothing told them apart:

- **Serving tables**, which readers and curators read and write: places, regions, users, the curation gate.
- **Workbench tables**, built from public dumps or kept as intermediate work, which no reader or curator route reads. They are read by the source runs, the dump builds and the admin panel.

On the development database on 2026-10-18 the dump-built tables held about 103 GB of its 112 GB:

| Tables | Size |
|---|---|
| the Wikidata subset (`wikidata_entities`, `_claims`, `_labels`, `_sitelinks`, `_class_closure`) | 72.5 GB |
| `readership_months` | 18.8 GB |
| English Wikipedia's structure and the redirects | 11.4 GB |

The deployment plan (#585, #1319, #1322) ships the serving part first, at a price a hobby project can carry, and sized the database at 18.3 GB on 2026-10-09. Deploying the serving tables alone means leaving the dump-built ones behind.

That is one `pg_dump --exclude-schema` only if they sit in a schema of their own and no serving code has come to depend on them. Every new table asks the question again: a dump-built table added to `public` makes the split harder by one more table. The maintainer asked for the line to be drawn now, ahead of the deployment design (#1693).

## Decision

**1. The tables built from public dumps live in the `workbench` schema.**
- The tables:
  - the Wikidata subset and `wikidata_subset_builds`;
  - readership (`readership_month_files`, `readership_months`, `readership_staging`);
  - English Wikipedia's structure (`enwiki_*`, `enwiki_structure_builds`);
  - the redirects (`wikipedia_redirects`, `wikipedia_redirect_builds`);
  - the builds' ledger, `dump_builds`.
- `db/init/01-schema.sql` creates them there. Migration 131 moves them in a database that already holds them, including the `_next` copies and the resume record a cut build left, so it still resumes (ADR-0107).

**2. They are reached through the database's search path, not by a qualified name in every statement.**
- The database's `search_path` is `public, workbench`, set with `ALTER DATABASE` by the init file and by the migration, as `jit = off` is (#994). Every client finds the tables by their bare names: the backend, the worker, the scripts, psql. No reader's SQL changes.
- What creates a table there names the schema (`inWorkbench`, `backend/src/db/workbench.ts`), since a bare `CREATE TABLE` lands in `public`, the first schema on the path. So does what asks the catalog about one:
  - the dump builds' `_next` copies, resume record and staging tables;
  - `indexesOf`, which reads `pg_index` for the workbench schema;
  - the index-definition rewrite, which matches `ON workbench.<table>`.
  `ALTER TABLE … RENAME` keeps a table in its schema, so the swap renames in place.
- On a serving-only database the schema is absent. A stray bare read of a workbench table fails there loudly instead of reading something else.

**3. Every relation declares its tier, `serving` or `workbench`, in one registry: `TABLE_TIERS` in `backend/src/db/tableTiers.ts`.**
- It is typed against `RELATION_SCHEMAS`, which `schema.generated.ts` now carries for every relation (`db:types` reads both schemas). A table without a tier, or a tier for a table that is gone, fails the typecheck.
- `tableTiers.test.ts` holds each tier to its schema:
  - a serving table sits in `public`;
  - a workbench table sits in `workbench`, unless `WORKBENCH_IN_PUBLIC` names it with what holds it there.
- `WORKBENCH_IN_PUBLIC` only shrinks. It holds the workbench tables this slice leaves in place:
  - the world-view import's runs and map candidates, and its AI extraction (they reference `regions` and `world_views`);
  - the live Wikidata caches (`wikidata_query_cache` and `wikidata_cache_policy` reference `experience_sources`; `wikidata_geoshapes`);
  - the catalogue-coverage survey.
- A table a reader or curator route reads is serving, whatever made it. Three tables made by the import or the worker are serving for that reason:
  - the region tree reads an imported region's source (`region_import_state`);
  - the editor reads the import's open suggestions (`region_match_suggestions`);
  - a world view's page reads its geometry computation's state (`geometry_computations`).

**4. No reader or curator route names a workbench table.** The backend lint refuses it in `controllers/**` and `routes/**`, the admin controllers and route files left out.
- The tables are those `TABLE_TIERS` gives the workbench tier, read from the registry, so it is the one place a table's tier is said. The rule therefore covers the workbench tables still in `public` as well as the schema's, and a table a reader reads cannot be called workbench without the lint saying so.
- The rule matches SQL text, as the writer rules do (ADR-0069). An import rule would not do: every route reaches `services/sync/subset/kit.ts` through `config/validateEnv.ts`.
- It is the core `no-restricted-syntax` under a name of its own (`tiers/no-workbench-tables`), because that rule's options are replaced block by block for the writer modules.
- The admin checks that read the subset (`borderPlacementAssertions`, the landmark run's `countryByPoint`) are admin and source-run code, which the rule does not cover. A reader that needs dump-built data gets a precomputed result written into a serving table.

## Consequences

- **A new table names its tier when it is made.** The typecheck asks for it. A dump-built or intermediate table is created in `workbench`, by name in `01-schema.sql` and in its migration.
- **The serving part can be dumped without the workbench**: `pg_dump --exclude-schema=workbench`, with the tables `WORKBENCH_IN_PUBLIC` still names excluded too. No reader or curator route reads any of them, which the lint holds.
- **One foreign key crosses the line:** `dump_builds.started_by → users(id)`. It holds while the two tiers share a database. The split replaces it with a plain id, as the deployment design decides (#1693).
- **Applying migration 131 is a scheduled step.** It moves tables a running build writes, so no build may be in flight. A session reads `search_path` when it connects, so the backend and the dump worker restart straight after it.
- **Where a source run computes once a host exists** (#1693) does not change which tier a table belongs to, so this decision does not wait for it.
