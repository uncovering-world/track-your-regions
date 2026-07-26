# E2E Strategy with Fresh Database

> **Status:** In progress. The PR smoke lane is implemented (`npm run
> test:e2e:smoke`, wired into CI as the `E2E Smoke` job) and runs against a
> small synthetic fixture committed to the repo — not the fresh GADM database
> this document originally specified. Fresh-GADM automation and the full
> scenario matrix below remain the plan for a full/nightly lane that is not
> built yet.

For the broader testing model (unit/integration + E2E tiers + coverage philosophy), see `testing-strategy.md`.
For capability inventory and scenario mapping, see `testing-feature-matrix-v1.md`.

## Goal

Validate real user behavior end-to-end with production-like data flow:

1. Fresh non-golden DB
2. GADM loaded
3. App used through the real UI
4. Full user lifecycle validated (setup, explore, create, visit/seen, curate)

Interview constraints accepted:
- Full runs use fresh DB + full GADM load (no baseline restore shortcut).
- External sync-provider scenarios should run against real providers.

## Constraints

- GADM import is heavy (can take tens of minutes), so per-test DB reset is too slow.
- Map behavior depends on DB + Martin + backend + frontend being aligned.
- `.golden-db` protection must never be used for test runs.

## Approach Options

### Option A: New DB per individual test case
- Best isolation.
- Too slow for this project once GADM is required.

### Option B (Recommended): New DB per test run
- Create one fresh DB for the run.
- Load GADM once.
- Execute all E2E scenarios against this DB.
- Strong realism with practical runtime.

### Option C: Restore from prepared baseline dump
- Fastest repeatability.
- Useful later for CI acceleration after baseline is stable.

## Recommended Runtime Model

### 1) Environment bootstrap

Preferred flow (non-conflicting with local dev):

- `npm run test:e2e:smoke` (or `npm run test:e2e:full`)

These commands run against the isolated test environment by default.

The isolated stack's frontend is not usable from a host browser: Playwright
itself runs inside the `e2e` container, so `docker-compose.yml` points that
stack's `VITE_API_URL`/`VITE_MARTIN_URL` at in-network hostnames
(`http://backend:3001`, `http://martin:3000`) rather than `localhost`.
Opening `http://localhost:5174` on the host loads the page, but its API
calls do not resolve — a deliberate trade-off, not a bug. `scripts/test-stack.sh`
sets these through `FRONTEND_API_URL_OVERRIDE`/`FRONTEND_MARTIN_URL_OVERRIDE`,
named to avoid colliding with the `VITE_API_URL`/`VITE_MARTIN_URL` keys
`.env.example` shipped until this change — `scripts/setup.sh` copied those
into every developer's `.env`, where they remain and would otherwise silently
shadow the port-derived defaults `docker-compose.yml` falls back to.

Manual fresh-DB flow remains valid for explicit DB-control runs:

- `npm run db:up`
- `npm run db:create e2e_<timestamp>`
- `npm run db:load-gadm`
- start app stack (`npm run dev`) and point Playwright to it via `E2E_BASE_URL`

Important:
- Never mark this DB as golden.
- Store DB name in test artifacts for debugging.

### 2) Test data policy

**PR smoke lane (implemented):** no accounts, no UI-driven state. The lane
runs against a small synthetic fixture committed to the repo — one custom
world view, one region, three experiences with locations — defined in
`backend/src/db/seed/e2eFixture.ts` and applied automatically by
`scripts/test-stack.sh` on every `up`, so `npm run test:e2e:smoke` needs no
manual seeding step. Three of the four smoke tests depend on this fixture
being present, including `shell-navigation.smoke.spec.ts`'s first test: the
fixture is the only custom world view in the test database, and
`useNavigation` filters the default GADM world view out for non-admin
users, so with no fixture the world-view list is empty and `MainDisplay`
renders `SetupInstructions` instead of the `Select a region` shell that
test asserts. (Its second test only exercises the sign-in dialog in
`Header`, which `App.tsx` renders outside `MainDisplay`, so that one passes
either way.)

**Full/nightly lane (not built):** the policy below remains the plan for
when fresh-GADM automation exists.

- Prefer creating state via UI for user-facing flows (custom hierarchy, curation actions, visited/seen interactions).
- Allow minimal API/SQL helpers only for setup that is not a product behavior target (for example: creating admin/curator accounts quickly).
- Use deterministic naming with a run id suffix to avoid collisions.
- Seed `user + curator + admin` accounts via API-driven account creation plus a minimal role helper for curator/admin setup.

### 3) Execution tiers

- **Smoke E2E (PR gate):** short high-signal journeys.
- **Full E2E (nightly/manual):** broad user journey coverage on fresh DB + GADM.
- Unit/integration tests remain mandatory for fast feedback and edge-condition checks.

### 4) Teardown and failure handling

- On success: drop test DB.
- On failure: preserve DB dump + Playwright trace/screenshots/videos + service logs.
- Keep teardown idempotent so reruns do not fail on partial cleanup.

## CI and Local Workflow Guidance

- PRs should run fast checks plus smoke E2E only.
- Nightly/manual pipeline should run full fresh-DB E2E.
- Long-term optimization: maintain a versioned post-GADM baseline dump and restore it for CI runs.

## What Comes Next (Separate Work)

The next step is to define the feature coverage map and detailed test case matrix:

- user capability map
- scenario inventory
- expected outcomes and invariants
- ownership and run frequency
