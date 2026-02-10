# E2E Strategy with Fresh Database

> **Status:** In progress. Isolated-stack execution is implemented; full fresh-GADM automation and full scenario matrix are still pending.

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

Manual fresh-DB flow remains valid for explicit DB-control runs:

- `npm run db:up`
- `npm run db:create e2e_<timestamp>`
- `npm run db:load-gadm`
- start app stack (`npm run dev`) and point Playwright to it via `E2E_BASE_URL`

Important:
- Never mark this DB as golden.
- Store DB name in test artifacts for debugging.

### 2) Test data policy

- Prefer creating state via UI for user-facing flows (custom hierarchy, curation actions, visited/seen interactions).
- Allow minimal API/SQL helpers only for setup that is not a product behavior target (for example: creating admin/curator accounts quickly).
- Use deterministic naming with a run id suffix to avoid collisions.

Interview-calibrated account policy:
- PR smoke lane: seed `user` account only.
- Nightly/full lane: seed `user + curator + admin` accounts.
- Preferred creation path: API-driven account creation + minimal role helper for curator/admin setup.

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
