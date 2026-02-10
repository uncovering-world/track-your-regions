# Overall Testing Strategy

> **Status:** In progress. Initial tooling baseline is implemented; feature-level coverage expansion is ongoing.

Companion artifacts:
- `testing-feature-matrix-v1.md`
- `testing-interview-notes.md`
- `e2e-fresh-db-strategy.md`

## Goals

- Ship changes fast without breaking existing behavior.
- Detect regressions as close to commit time as possible.
- Keep map-heavy and data-heavy user flows verifiable end-to-end.

## Implemented Baseline

Current implemented test tooling:

- Frontend unit/integration: `Vitest` (`npm --prefix frontend run test`)
- Backend unit/integration: `Vitest` (`npm --prefix backend run test`)
- Frontend E2E: `Playwright Test` with `smoke` and `full` projects
- Monorepo scripts:
  - `npm run test`
  - `npm run test:fast`
  - `npm run test:e2e:smoke`
  - `npm run test:e2e:full`
- Test commands run in an isolated test environment by default.

## Testing Model (Layered)

### 1) Fast feedback lane (always-on)

- **Static checks:** lint + typecheck
- **Unit tests:** pure functions, reducers/state logic, utility modules
- **Integration tests:** API handlers, data mapping, component behavior with mocked dependencies

Target: run locally in minutes and on every PR.

### 2) Journey safety lane (E2E)

- Browser E2E for real user workflows across frontend + backend + DB + Martin.
- Use a small smoke suite on PRs and a broad full suite on nightly/manual runs.
- Fresh DB strategy is defined in `e2e-fresh-db-strategy.md`.

## Local-First Development Policy

Tests are not only PR gates. They are part of the local coding loop.

### Local loop A (during coding)

- Run fast checks frequently on touched areas.
- Typical scope: lint/typecheck + targeted unit/integration tests.

### Local loop B (before commit)

- Run full fast-feedback lane locally.
- Run impacted smoke E2E journeys for changed capabilities (especially `P0`).

### Local loop C (before opening PR)

- Re-run the same checks expected by PR gate to reduce CI churn.
- Goal: PR failures should be uncommon and actionable, not first discovery.

## Coverage Philosophy

Coverage is measured by **feature behavior**, not only line percentage.

For each user-facing capability, require:

1. At least one happy-path check.
2. At least one negative/edge check.
3. Contract-level assertions for key API responses and permission boundaries.

Interview calibration:
- For `P0` capabilities, require at least `HAPPY + PERM + FAIL` scenario coverage.

Line/branch coverage thresholds are useful guardrails, but not the primary success metric.

## Execution Tiers (Local + CI)

### Local pre-PR baseline (recommended)

- lint + typecheck
- unit/integration suites
- impacted smoke E2E journeys
- Target budget: <= 1 hour

### PR gate (must pass)

- lint + typecheck
- unit/integration suites
- E2E smoke journeys
- Target budget: <= 1 hour

### Nightly/manual (broad confidence)

- full E2E suite on fresh DB + GADM
- extended scenario coverage and slower paths
- Target budget: <= 5 hours

## Test Data and Environment Rules

- Never run test automation against `.golden-db`.
- Prefer UI-driven setup for behaviors users perform in UI.
- Use minimal API/SQL helpers only for non-product setup concerns (for example: creating admin/curator seed users).
- Preserve artifacts on failure (trace/video/screenshots/logs, DB name/dump when needed).
- Role-seed policy by lane:
  - PR smoke: `user`
  - Nightly/full: `user + curator + admin`

## Rollout Plan

1. Stabilize tooling and scripts (test runners, reporting, CI wiring).
2. Add smoke E2E for highest-risk journeys.
3. Add feature matrix and expand scenario coverage by capability.
4. Raise quality gates incrementally (coverage thresholds, stricter invariants).

## Out of Scope for This Doc

- Full feature inventory/matrix
- Detailed test case catalog
- Per-suite ownership mapping

Those are the next planning artifacts after this strategy baseline is accepted.
