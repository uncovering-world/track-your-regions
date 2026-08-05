# E2E Smoke in CI — Design

> **Status:** Approved design, not yet implemented. Decided 2026-07-26.
>
> Narrows [e2e-fresh-db-strategy.md](e2e-fresh-db-strategy.md) for the smoke
> lane specifically. That document still governs the full lane, which this
> design deliberately does not build.

## Problem

The Playwright smoke project exists and is wired to nothing. No CI job
references it — `grep -rn e2e .github/workflows/` returns nothing — and the
pre-commit gate does not run it. The one suite that renders the real
application against the real stack never runs automatically.

Two of its four tests also fail locally, for a reason worth stating precisely:
`scripts/test-stack.sh` seeds no data at all. It stands up an isolated stack
against an empty schema. `e2e-fresh-db-strategy.md` describes a fresh database
with GADM loaded; the implemented runner does neither. Nobody noticed because
nothing ran the tests.

This gap has already cost us. A dependency upgrade left the frontend rendering
a blank page, and lint, typecheck and 364 unit tests all passed — the smoke
suite would have caught it in one assertion, had anything been running it.

## Decisions

### 1. Scope: run what exists, write nothing new

All four existing specs run on every PR. No new scenarios, no nightly lane, no
full lane. Broad coverage is deferred until there are enough scenarios to
justify the machinery.

Rationale: the immediate value is the guard against "the app does not come up".
Adding scenarios before the lane is reliable multiplies flakiness by breadth.

### 2. Fixture: synthetic, in-repo

The smoke lane runs against a small hand-authored dataset committed to the
repository, not against real GADM.

`db/init/01-schema.sql` already seeds all three experience categories, so the
fixture adds only a world view and content:

- **its own custom world view with a pinned id**, `is_default = false`. This is
  not a stylistic choice: `useNavigation` gates the root-region query on
  `isCustomWorldView`, which is `!selectedWorldView.isDefault`. Under the
  default GADM world view the navigation renders administrative divisions and
  never asks for regions at all, so a fixture hung off world view 1 would sit
  in the database invisible to the UI. World views are chosen by the `?wv=<id>`
  URL parameter, so the specs navigate to `/?wv=<fixture id>`; pinning the id
  keeps that stable against a serial column.
- at least one named root region under that world view, with simple valid
  `MultiPolygon` geometry
- experiences in the `UNESCO World Heritage Sites` category, linked to that
  region, with locations

The size is defined by what the specs assert, not by taste. The fixture is
sufficient exactly when all four specs pass, which requires:

| Spec assertion | What the fixture must provide |
|---|---|
| a root region is selectable by name | a named region under world view 1 |
| heading is not "Select a region" | that region resolves and renders |
| `World Heritage Sites (\d+)` | ≥1 experience in category 1 linked to it |
| `[aria-label*="UNESCO World Heritage Sites in"]` in Discover | the same link, surfaced as a source tag |
| `\d+ experiences` after opening the tag | a non-zero count for that category |

Anything beyond that is out of scope. Names are deterministic so specs assert
exact strings rather than falling back to positional selectors.

Derived columns are **not** written by the fixture. Three triggers own them —
`update_region_metadata`, `update_region_focus_data`, `update_regions_geom_3857`
— and compute `anchor_point`, `focus_bbox`, `geom_area_km2` and the SRID 3857
mirror on insert. Letting the database own them is what keeps a hand-authored
fixture from drifting into a second, wrong source of truth.

Real GADM stays the basis for the full lane, per `e2e-fresh-db-strategy.md`.

### 3. Seed form: TypeScript over Drizzle

`backend/src/db/seed/e2eFixture.ts`, exposed as `npm run db:seed:e2e`.

Rows go through Drizzle using the existing `backend/src/db/schema.ts`;
geometry goes through raw `pool.query`. That split is already the documented
repo convention.

Rationale: the seed lives inside a typechecked workspace, so a renamed or
dropped column fails `npm run check` rather than surfacing as a red E2E run
days later. A plain `.sql` file cannot offer that. Seeding through the
application's own API was rejected for the opposite reason — it makes failures
ambiguous, since a broken write path would fail every test at once with no
signal about which layer broke.

The seed must be idempotent: running it twice produces the same state.

### 4. Stack isolation: already sound, with one leak to close

Verified by running both stacks side by side, not assumed:

| | dev | test |
|---|---|---|
| compose project | `track-your-regions` | `tyr-test` |
| db | 5432 | 55432 |
| backend | 3001 | 5301 |
| frontend | 5173 | 5174 |
| martin | 3000 | 5300 |
| database | `track_regions` | `track_regions_test` |
| pg volume | `track-your-regions_postgres_data` | `tyr-test_postgres_data` |

Ports and database storage are fully disjoint, so a developer can run
`npm run dev` and the E2E lane at the same time. `cv-python` is already
excluded from the test stack — no change needed there.

One genuine leak: both stacks bind-mount the same host `./data` read-write at
`/app/data`. It holds caches, downloaded experience images and debug dumps, so
a test run can overwrite dev state. This contradicts the isolation the script
otherwise enforces with hard rails against the dev stack and the golden
database.

Fix: parameterise the host path — `${DATA_DIR:-./data}:/app/data` in
`docker-compose.yml`, `DATA_DIR=./.test-data` in `scripts/test-stack.sh`, and
the new directory gitignored.

### 5. CI wiring: no path filters

A new `E2E Smoke` job in `.github/workflows/ci.yml` runs
`npm run test:e2e:smoke` on every pull request, with Playwright's report and
traces uploaded as artifacts on failure.

**Deliberately no path filters.** They are unsound as a skip mechanism: they
encode an assumption about the dependency graph that is wrong at the edges.
Dependency-only changes are exactly the class that breaks the application at
runtime while touching no source file — PR #424 changes nothing but two
lockfiles, and a `frontend/src/**` filter would skip it. Path filters are
acceptable to *add* runs (escalate to a broader suite when `backend/` or `db/`
changes) and never to remove them.

They also interact badly with this repo's branch protection: a required check
that is skipped by a path filter reports pending forever and blocks the merge.

The job starts **not required**. Promote it to a required check after a couple
of weeks of observed stability, so the first flake does not block all merges.

### 6. Keeping it honest

- the seed is typechecked, so schema drift fails at `npm run check`
- derived columns belong to the database triggers
- specs assert fixture names exactly

`explore-workflows.smoke.spec.ts` currently falls back to clicking the first
`[role="button"]` when it cannot find a named region. That fallback is why an
empty database produced a 1.1-minute timeout instead of a clear failure. Remove
it once the fixture makes the region deterministic.

### 7. Gate placement: before pushing, not before every commit

The requirement goes into the **before pushing** tier, alongside
`npm run security:all`. That tier already assumes Docker and minutes of
runtime; the per-commit tier must stay fast or it gets bypassed — the
`--skip-tests` escape hatch in `commit.md` shows that cost already mattered.

Documents to update:

- `CLAUDE.md` — the commands block, § Mandatory Pre-Commit Checks, and Skill
  Integration Rules #6, so skill workflows inherit the requirement
- `.claude/commands/commit.md` § 8 Push
- `.claude/commands/pr-create.md` § 2.5, next to the clean-history gate
- `e2e-fresh-db-strategy.md` — record that the smoke lane runs on the synthetic
  fixture and that fresh GADM governs the full lane. Leaving this stale would
  repeat exactly the failure this design exists to fix: a document promising
  seeded data while the runner seeded none.

## Non-goals

- new E2E scenarios
- a nightly or full lane, and any scheduled workflow
- GADM automation for the smoke lane
- merge queue — the repository has a serial contribution flow, so batching buys
  nothing yet
- test impact analysis

## Risks

- **Synthetic geometry hides GADM-specific bugs.** Accepted: the full lane
  covers real geometry, and the smoke lane's job is liveness, not cartography.
- **Fixture rot.** Mitigated by the typechecked seed and trigger-owned derived
  columns, not eliminated.
- **CI wall-clock grows.** The stack is four services and the tests take ~19s;
  if this becomes a problem the answer is to attack stack bring-up, not to add
  scheduling cleverness.
