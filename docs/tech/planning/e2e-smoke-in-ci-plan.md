# E2E Smoke in CI — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> Design: [e2e-smoke-in-ci.md](e2e-smoke-in-ci.md) (local, uncommitted).

**Goal:** Make the four existing Playwright smoke specs pass against a seeded
synthetic fixture, and run them on every pull request.

**Architecture:** A typechecked TypeScript seed writes a pinned custom world
view, one root region and three experiences into the isolated test database.
Scalar columns go through Drizzle; geometry goes through `sql` templates in the
same transaction, so the existing triggers compute every derived column. `scripts/test-stack.sh`
runs the seed after the stack is healthy and before Playwright. A new
non-required CI job runs the smoke project on every PR with no path filters.

**Tech Stack:** TypeScript, Drizzle ORM, node-postgres, PostGIS, Playwright,
Docker Compose, GitHub Actions.

## Global Constraints

- Plans stay local; this file and the design doc are never committed.
- Commit titles use `<Type>: <Topic>.` — `front`, `back`, `deploy`, or blank.
  Never Conventional-Commit prefixes. Max 72 chars, imperative, trailing period.
- Commit bodies wrap at 72 characters. Always `git commit -s`.
- `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>` only on
  AI-assisted commits.
- Never write literal control characters into source. Use `\uXXXX` escapes and
  verify with a byte scan — raw control bytes are invisible and break `grep`
  and `diff`.
- Fixture ids are pinned: world view `9001`, region `9001`, experiences
  `9001..9003`. Serial sequences are advanced with `setval` after explicit-id
  inserts so later application writes do not collide.
- The fixture's world view **must** have `is_default = false`. `useNavigation`
  gates the root-region query on `isCustomWorldView`
  (`!selectedWorldView.isDefault`); under the default GADM world view the UI
  renders administrative divisions and never requests regions.

---

## File Structure

| File | Responsibility |
|---|---|
| `backend/src/db/seed/e2eFixture.ts` (create) | The fixture data and the seed/reset functions. Single export surface, no CLI concerns. |
| `backend/src/db/seed/runE2eFixture.ts` (create) | Thin CLI entry point: opens the pool, calls the seed, exits with a status code. |
| `package.json` (modify) | `db:seed:e2e` script. |
| `docker-compose.yml` (modify, lines 57 and 113) | Parameterise the `./data` host path. |
| `scripts/test-stack.sh` (modify) | Set `DATA_DIR`, run the seed inside `ensure_up`. |
| `.gitignore` (modify) | Ignore `.test-data/`. |
| `frontend/tests/e2e/smoke/*.smoke.spec.ts` (modify) | Navigate with `?wv=9001`, drop the positional fallback. |
| `.github/workflows/ci.yml` (modify) | `E2E Smoke` job. |
| `CLAUDE.md`, `.claude/commands/commit.md`, `.claude/commands/pr-create.md`, `docs/tech/planning/e2e-fresh-db-strategy.md` (modify) | Gate placement and strategy correction. |

---

### Task 1: The fixture seed

**Files:**
- Create: `backend/src/db/seed/e2eFixture.ts`
- Create: `backend/src/db/seed/runE2eFixture.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: `backend/src/db/schema.ts` (`worldViews`, `regions`, `experiences`,
  `experienceRegions`, `experienceLocations`, `experienceCategories`) and
  `backend/src/db/index.ts`, which exports both `db` (Drizzle) and `pool`.
- Produces: `seedE2eFixture(): Promise<void>` and the exported constants
  `E2E_WORLD_VIEW_ID = 9001`, `E2E_REGION_ID = 9001`,
  `E2E_REGION_NAME = 'Testland'`. Task 3 restates the id and name in the specs.

**Why Drizzle and not raw SQL for the scalar columns:** the entire reason this
seed is TypeScript rather than a `.sql` file is that a renamed or dropped
column then fails `npm run typecheck` instead of surfacing as a red E2E run
days later. Raw SQL strings throw that property away. Scalars therefore go
through Drizzle; only geometry — which the Drizzle model deliberately omits —
goes through `sql` templates, inside the same transaction.

- [ ] **Step 1: Write the fixture module**

Create `backend/src/db/seed/e2eFixture.ts`:

```typescript
/**
 * Deterministic fixture for the Playwright smoke lane.
 *
 * Ids are pinned so the specs can navigate to ?wv=9001 without discovering
 * them at runtime. Derived columns (anchor_point, focus_bbox, geom_area_km2,
 * the 3857 mirror) are deliberately absent: the triggers on `regions` own
 * them, and duplicating that here would create a second, wrong source of truth.
 */

import { eq, inArray, sql } from 'drizzle-orm';
import { db } from '../index.js';
import {
  experienceCategories,
  experienceLocations,
  experienceRegions,
  experiences,
  regions,
  worldViews,
} from '../schema.js';

export const E2E_WORLD_VIEW_ID = 9001;
export const E2E_REGION_ID = 9001;
export const E2E_REGION_NAME = 'Testland';

/** UNESCO World Heritage Sites — seeded by db/init/01-schema.sql. */
const UNESCO_CATEGORY_NAME = 'UNESCO World Heritage Sites';

const EXPERIENCES = [
  { id: 9001, name: 'Testland Old Town', lon: 10.1, lat: 50.1 },
  { id: 9002, name: 'Testland Cathedral', lon: 10.2, lat: 50.2 },
  { id: 9003, name: 'Testland Aqueduct', lon: 10.3, lat: 50.3 },
];

/** A square around (10,50) — valid, small, and far from the antimeridian. */
const REGION_WKT =
  'MULTIPOLYGON(((10 50, 10.5 50, 10.5 50.5, 10 50.5, 10 50)))';

export async function seedE2eFixture(): Promise<void> {
  await db.transaction(async (tx) => {
    // Idempotent: drop our own rows first. Cascades clear the links.
    await tx.delete(experiences).where(
      inArray(experiences.id, EXPERIENCES.map((e) => e.id)),
    );
    await tx.delete(worldViews).where(eq(worldViews.id, E2E_WORLD_VIEW_ID));

    const [category] = await tx
      .select({ id: experienceCategories.id })
      .from(experienceCategories)
      .where(eq(experienceCategories.name, UNESCO_CATEGORY_NAME));
    if (!category) {
      throw new Error(
        `Category "${UNESCO_CATEGORY_NAME}" missing - is db/init applied?`,
      );
    }

    await tx.insert(worldViews).values({
      id: E2E_WORLD_VIEW_ID,
      name: 'E2E Fixture',
      description: 'Synthetic data for the smoke lane',
      isDefault: false,
      isActive: true,
    });

    await tx.insert(regions).values({
      id: E2E_REGION_ID,
      worldViewId: E2E_WORLD_VIEW_ID,
      name: E2E_REGION_NAME,
    });

    // geom is deliberately absent from the Drizzle model, so it goes through
    // a sql template - still inside this transaction. The BEFORE UPDATE OF
    // geom trigger fires here and fills anchor_point, focus_bbox and
    // geom_area_km2. Never compute those here.
    await tx.execute(
      sql`UPDATE regions SET geom = ST_GeomFromText(${REGION_WKT}, 4326)
          WHERE id = ${E2E_REGION_ID}`,
    );

    for (const exp of EXPERIENCES) {
      await tx.insert(experiences).values({
        id: exp.id,
        categoryId: category.id,
        externalId: `e2e-${exp.id}`,
        name: exp.name,
      });
      await tx.execute(
        sql`UPDATE experiences
            SET location = ST_SetSRID(ST_MakePoint(${exp.lon}, ${exp.lat}), 4326)
            WHERE id = ${exp.id}`,
      );

      await tx.insert(experienceLocations).values({
        experienceId: exp.id,
        name: exp.name,
        ordinal: 0,
      });
      await tx.execute(
        sql`UPDATE experience_locations
            SET location = ST_SetSRID(ST_MakePoint(${exp.lon}, ${exp.lat}), 4326)
            WHERE experience_id = ${exp.id} AND ordinal = 0`,
      );

      await tx.insert(experienceRegions).values({
        experienceId: exp.id,
        regionId: E2E_REGION_ID,
      });
    }

    // Explicit ids do not advance the sequences; application writes would
    // otherwise collide with the fixture.
    await tx.execute(
      sql`SELECT setval(pg_get_serial_sequence('world_views', 'id'),
                        GREATEST((SELECT MAX(id) FROM world_views), 1))`,
    );
    await tx.execute(
      sql`SELECT setval(pg_get_serial_sequence('regions', 'id'),
                        GREATEST((SELECT MAX(id) FROM regions), 1))`,
    );
    await tx.execute(
      sql`SELECT setval(pg_get_serial_sequence('experiences', 'id'),
                        GREATEST((SELECT MAX(id) FROM experiences), 1))`,
    );
  });
}
```

`db.transaction` gives every statement above one connection and one rollback
boundary, so a half-seeded database is not a reachable state.

- [ ] **Step 2: Write the CLI entry point**

Create `backend/src/db/seed/runE2eFixture.ts`:

```typescript
import { pool } from '../index.js';
import { seedE2eFixture } from './e2eFixture.js';

seedE2eFixture()
  .then(() => {
    console.log('E2E fixture seeded');
    return pool.end();
  })
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error('E2E fixture seeding failed:', error);
    process.exit(1);
  });
```

Both `db` and `pool` are exported from `backend/src/db/index.ts`; the seed uses
`db`, and this entry point uses `pool` only to close the connection.

- [ ] **Step 3: Add the npm script**

In `package.json`, next to the other `db:*` entries:

```json
"db:seed:e2e": "npm --prefix backend exec tsx src/db/seed/runE2eFixture.ts",
```

Verify `tsx` is available in `backend`: `grep -n '"tsx"' backend/package.json`.
If it is not, use the runner the backend `dev` script already uses.

- [ ] **Step 4: Verify it typechecks**

Run: `npm run typecheck`
Expected: clean. If a column name is wrong, this is where it fails — that is
the whole point of writing the seed in TypeScript.

- [ ] **Step 5: Run it against the test stack**

```bash
./scripts/test-stack.sh up
TEST_DB_PORT=55432 PGPASSWORD=postgres \
  psql -h 127.0.0.1 -p 55432 -U postgres -d track_regions_test \
  -c "select count(*) from regions"
```

Expected before seeding: `0`.

Then run the seed pointed at the test database. Confirm how the backend reads
its connection settings first (`grep -n "DATABASE_URL\|PGHOST" backend/src/db/index.ts`)
and set them accordingly.

- [ ] **Step 6: Assert the seeded state, including the trigger output**

```bash
psql -h 127.0.0.1 -p 55432 -U postgres -d track_regions_test -c "
  select r.name, r.anchor_point is not null as has_anchor,
         r.focus_bbox is not null as has_bbox,
         r.geom_area_km2 is not null as has_area,
         count(er.id) as experiences
  from regions r
  left join experience_regions er on er.region_id = r.id
  group by r.id, r.name, r.anchor_point, r.focus_bbox, r.geom_area_km2"
```

Expected: one row, `Testland`, all three flags `t`, `experiences` = 3.

The three `t` flags are the real assertion: they prove the triggers ran and the
fixture did not have to compute derived state itself.

- [ ] **Step 7: Prove idempotency**

Run the seed a second time, then re-run the query from Step 7.
Expected: identical output — one region, three experiences, no duplicate-key
error.

- [ ] **Step 8: Commit**

```bash
git add backend/src/db/seed package.json
git commit -s -m "$(cat <<'EOF'
back: Add the synthetic fixture for the E2E smoke lane.

The smoke specs need content and the test stack seeds none, so two of
the four have never passed. This adds a pinned fixture: a custom world
view, one region with simple geometry, and three UNESCO experiences
linked to it.

The world view is deliberately not the default one. useNavigation gates
its root-region query on isCustomWorldView, so under the GADM default
the UI renders administrative divisions and never asks for regions — a
fixture hung off world view 1 would sit in the database invisible.

Derived columns are left to the triggers on `regions` rather than
written here, so the fixture cannot drift into a second, wrong source
of truth. Scalar rows would go through Drizzle and geometry through raw
pool.query, per the repo's existing split.

Ids are pinned so the specs can navigate to ?wv=9001 without runtime
discovery; sequences are advanced afterwards so application writes do
not collide.
EOF
)"
```

---

### Task 2: Wire the seed in and close the `./data` leak

**Files:**
- Modify: `docker-compose.yml` (the `backend` and `cv-python` volume entries)
- Modify: `scripts/test-stack.sh`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: `npm run db:seed:e2e` from Task 1.
- Produces: `./scripts/test-stack.sh up` leaves a seeded database and writes
  nothing into the dev stack's `./data`.

- [ ] **Step 1: Show the leak before fixing it**

```bash
docker inspect tyr-ng-backend tyr-test-backend \
  --format '{{.Name}}: {{range .Mounts}}{{if eq .Destination "/app/data"}}{{.Source}} (rw={{.RW}}){{end}}{{end}}'
```

Expected: both print the same host path with `rw=true`. That is the leak.

- [ ] **Step 2: Parameterise the host path**

In `docker-compose.yml`, both occurrences of `- ./data:/app/data:z` become:

```yaml
      - ${DATA_DIR:-./data}:/app/data:z
```

- [ ] **Step 3: Point the test stack at its own directory**

In `scripts/test-stack.sh`, beside the other `TEST_*` defaults:

```bash
DATA_DIR="${TEST_DATA_DIR:-./.test-data}"
```

and add `DATA_DIR="$DATA_DIR"` to the environment block of the `compose()`
function, alongside `DB_NAME` and the port variables.

- [ ] **Step 4: Ignore the new directory**

In `.gitignore`, beside the other generated-output entries:

```
# Isolated test stack's runtime data (see scripts/test-stack.sh)
.test-data/
```

- [ ] **Step 5: Run the seed as part of bringing the stack up**

In `scripts/test-stack.sh`, inside `ensure_up`, after the stack reports
healthy and before it returns, invoke the seed against the test database.
Read `ensure_up` first and follow its existing style for waiting and error
handling rather than inventing a new pattern.

- [ ] **Step 6: Verify the leak is closed**

```bash
./scripts/test-stack.sh down
./scripts/test-stack.sh up
docker inspect tyr-test-backend \
  --format '{{range .Mounts}}{{if eq .Destination "/app/data"}}{{.Source}}{{end}}{{end}}'
```

Expected: a path ending in `.test-data`, not the repo's `./data`.

- [ ] **Step 7: Verify the stack comes up seeded**

Re-run the assertion query from Task 1 Step 6 immediately after
`./scripts/test-stack.sh up`, with no manual seeding.
Expected: `Testland`, three flags `t`, three experiences.

- [ ] **Step 8: Verify the dev stack is untouched**

```bash
docker ps --format '{{.Names}}' | sort
```

Expected: both `tyr-ng-*` and `tyr-test-*` present, dev stack still healthy.

- [ ] **Step 8: Commit**

```bash
git add docker-compose.yml scripts/test-stack.sh .gitignore
git commit -s -m "$(cat <<'EOF'
Seed the test stack and stop it writing into the dev stack's data.

test-stack.sh brought up an empty schema and called it a test
environment, which is why two smoke specs have never passed. It now
seeds the fixture once the stack is healthy.

While here: both stacks bind-mounted the same host ./data read-write,
so a test run could overwrite dev caches, downloaded images and debug
dumps. The runner guards carefully against the dev stack and the golden
database, then shared this directory silently. The host path is now
parameterised and the test stack gets its own .test-data.
EOF
)"
```

---

### Task 3: Make the specs deterministic

**Files:**
- Modify: `frontend/tests/e2e/smoke/explore-workflows.smoke.spec.ts`
- Modify: `frontend/tests/e2e/smoke/shell-navigation.smoke.spec.ts`

**Interfaces:**
- Consumes: `E2E_WORLD_VIEW_ID = 9001` and `E2E_REGION_NAME = 'Testland'` from
  Task 1. The specs cannot import from `backend/`, so restate both as local
  constants and reference the fixture module in a comment.

- [ ] **Step 1: Replace the positional fallback**

In `explore-workflows.smoke.spec.ts`, replace `selectRootRegion` entirely:

```typescript
// Mirrors backend/src/db/seed/e2eFixture.ts — keep in sync.
const FIXTURE_WORLD_VIEW = 9001;
const FIXTURE_REGION = 'Testland';

async function selectRootRegion(page: Page) {
  await page.getByRole('button', { name: FIXTURE_REGION }).click();
}
```

The old body clicked the first `[role="button"]` when it could not find a named
region. That fallback is why an empty database produced a 1.1-minute timeout
instead of a clear failure — remove it, do not soften it.

- [ ] **Step 2: Navigate to the fixture world view**

Every `page.goto('/')` in `explore-workflows.smoke.spec.ts` becomes
`page.goto('/?wv=' + FIXTURE_WORLD_VIEW)`, and `page.goto('/discover')`
becomes `page.goto('/discover?wv=' + FIXTURE_WORLD_VIEW)`.

Leave `shell-navigation.smoke.spec.ts` on `/` — it asserts shell chrome only
and must keep passing with no fixture at all, since it is the guard against
"the app does not come up".

- [ ] **Step 3: Run the smoke suite**

Run: `cd frontend && npx playwright test --project=smoke --reporter=list`
Expected: 4 passed.

If `explore-workflows` still fails, read the failure before changing anything:
a wrong region name fails instantly with a clear locator error, whereas a
missing world view shows the app rendering but empty.

- [ ] **Step 4: Prove the tests still detect an empty database**

```bash
psql -h 127.0.0.1 -p 55432 -U postgres -d track_regions_test \
  -c "delete from world_views where id = 9001"
cd frontend && npx playwright test --project=smoke --reporter=list
```

Expected: the two `explore-workflows` tests fail quickly with a clear locator
error; the two `shell-navigation` tests still pass. Then re-seed.

This step is the point of the task. A green suite proves nothing until you have
watched it go red for the right reason.

- [ ] **Step 5: Commit**

```bash
git add frontend/tests/e2e/smoke
git commit -s -m "$(cat <<'EOF'
front: Point the smoke specs at the fixture world view.

The specs looked for a region named Africa and fell back to clicking
the first [role=button] when they could not find one. Against an empty
database that fallback turned a missing fixture into a 1.1-minute
timeout instead of a locator error naming what was absent.

They now select the fixture world view explicitly via ?wv= and assert
the fixture region by name. shell-navigation stays on / with no world
view, since its job is to prove the shell renders at all.
EOF
)"
```

---

### Task 4: Run it in CI

**Files:**
- Modify: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: `npm run test:e2e:smoke`, which Task 2 made self-seeding.

- [ ] **Step 1: Read the existing job style**

Run: `sed -n '1,60p' .github/workflows/ci.yml`

Match the checkout, Node setup and dependency-install steps of the existing
jobs rather than writing a new idiom.

- [ ] **Step 2: Add the job**

Append a job that checks out, sets up Node 22, installs backend and frontend
dependencies, installs Playwright's chromium (`npx playwright install --with-deps chromium`),
runs `npm run test:e2e:smoke`, and uploads `frontend/playwright-report` and
`frontend/test-results` with `if: failure()`.

Name it `E2E Smoke`. Add **no** `paths:` filter — dependency-only changes are
exactly the class that breaks the app while touching no source file, and a
required check skipped by a path filter reports pending forever and blocks the
merge.

- [ ] **Step 3: Push and watch it**

```bash
git add .github/workflows/ci.yml
git commit -s -m "$(cat <<'EOF'
Run the E2E smoke suite on every pull request.

The Playwright smoke project existed and was wired to nothing: no CI job
referenced it and the pre-commit gate did not run it. The one suite that
renders the real application against the real stack never ran.

No path filter. Dependency-only changes break the app at runtime while
touching no source file, and a required check skipped by a filter blocks
the merge forever.
EOF
)"
git push
```

- [ ] **Step 4: Confirm the job actually ran and passed**

```bash
gh pr checks <number> | grep -i "e2e"
```

Expected: `E2E Smoke  pass`. If it fails, read the uploaded report before
touching the workflow — a CI-only failure usually means a timing assumption
that held locally.

- [ ] **Step 5: Leave it non-required**

Do not add `E2E Smoke` to branch protection yet. Revisit after two weeks of
observed runs, so the first flake does not block every merge.

---

### Task 5: Update the guidelines and the stale strategy doc

**Files:**
- Modify: `CLAUDE.md`
- Modify: `.claude/commands/commit.md`
- Modify: `.claude/commands/pr-create.md`
- Modify: `docs/tech/planning/e2e-fresh-db-strategy.md` — **this one is
  already tracked in git, so it is committed like any other doc.**

- [ ] **Step 1: Add the command**

In `CLAUDE.md`'s commands block:

```
npm run test:e2e:smoke     # Playwright smoke against the isolated test stack (before pushing)
```

- [ ] **Step 2: Place the gate**

In `CLAUDE.md` § Mandatory Pre-Commit Checks, extend the **Before pushing**
paragraph with `npm run test:e2e:smoke`, noting it stands up the isolated stack
and seeds the fixture. Do not add it to the per-commit tier: that tier must
stay fast or it gets bypassed.

Mirror the same sentence in Skill Integration Rules #6, so skill workflows
inherit it.

- [ ] **Step 3: Add it to the command docs**

`.claude/commands/commit.md` § 8 Push and `.claude/commands/pr-create.md` § 2.5
each gain a line pointing at the same command.

- [ ] **Step 4: Correct the strategy doc**

In `docs/tech/planning/e2e-fresh-db-strategy.md`, update the Status line and the
Test data policy section: the smoke lane runs on a synthetic in-repo fixture
seeded by `scripts/test-stack.sh`; fresh GADM governs the full lane, which is
not built.

Leaving this stale would repeat exactly the failure this work exists to fix — a
document promising seeded data while the runner seeded none.

- [ ] **Step 5: Verify the gate description matches reality**

Run: `npm run test:e2e:smoke`
Expected: passes from a cold start, with no manual seeding. If it does not, the
documentation is wrong and Task 2 is incomplete.

- [ ] **Step 6: Commit**

```bash
git add CLAUDE.md .claude/commands docs/tech/planning/e2e-fresh-db-strategy.md
git commit -s -m "$(cat <<'EOF'
Document the E2E smoke gate and correct the strategy doc.

Adds the smoke run to the before-pushing tier, where security:all
already assumes Docker and minutes of runtime, rather than the
per-commit tier which has to stay fast.

e2e-fresh-db-strategy.md described a fresh database with GADM loaded
while the runner seeded nothing at all. It now records what is true:
the smoke lane runs on a synthetic fixture, and fresh GADM governs the
full lane, which is not built.
EOF
)"
```

---

## Self-Review

**Spec coverage.** Design §1 scope → Tasks 3 and 4. §2 fixture → Task 1. §3
seed form → Task 1. §4′ `./data` leak → Task 2. §5 CI → Task 4. §6 keeping it
honest → Task 1 Step 6, Task 3 Steps 1 and 4. §7 gates and docs → Task 5.

**Types.** `E2E_WORLD_VIEW_ID`, `E2E_REGION_ID`, `E2E_REGION_NAME` and
`seedE2eFixture` are used consistently. The specs restate the values as local
constants because Playwright cannot import from `backend/`; Task 3 Step 1 says
so explicitly and comments the duplication in the code.

**Known soft spots, called out rather than hidden.** Two steps say "read the
existing style first" instead of giving code — the `ensure_up` internals in Task 2, and the CI job idiom in Task 4. That is
deliberate: each depends on surrounding code this plan should not guess at, and
each carries the exact command to discover the answer.
