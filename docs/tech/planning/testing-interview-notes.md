# Testing Interview Notes

> **Purpose:** Capture product-owner decisions needed to finalize the test feature matrix and scenario catalog.
>
> Current baseline: `testing-feature-matrix-v1.md`

## Round 1 Questions (Scope and Priorities)

| ID | Question | Why It Matters | Your Answer |
|---|---|---|---|
| `Q1` | Which 5 workflows are absolutely release-blocking if broken? | Defines `E2E-SMOKE` must-have set | User exploration in Map/Discover + visibility of visited regions and experienced items |
| `Q2` | Should admin-only world-view editing flows be PR-gated or nightly-only? | Strong impact on PR runtime | Nightly-only |
| `Q3` | Should curator workflows (reject/unreject/edit/create/assign) be PR-gated? | Critical for content quality regressions | Nightly-only |
| `Q4` | Is Apple OAuth in scope for automation now, or explicitly deferred? | Avoids unstable/untestable pipeline scope | Pending |
| `Q5` | Should sync-provider behavior be tested with real external APIs or mocked in CI? | Determines determinism and flakiness risk | Real external APIs |
| `Q6` | For map UX, what is acceptable visual regression policy (strict screenshot diff vs behavioral assertions)? | Defines E2E implementation style | Pending |
| `Q7` | Is “fresh DB + full GADM” required for every full run, or can we restore a versioned post-GADM baseline dump? | Biggest runtime/cost tradeoff | Fresh DB + full GADM required |
| `Q8` | What maximum PR pipeline duration is acceptable? | Hard constraint for smoke lane size | 1 hour |
| `Q9` | What maximum nightly duration is acceptable? | Hard constraint for full lane scope | 5 hours |
| `Q10` | Do you want planned (not yet implemented) vision features represented now, or only implemented capabilities? | Prevents matrix scope drift | Pending |

## Round 1 Questions (Definition of Coverage)

| ID | Question | Why It Matters | Your Answer |
|---|---|---|---|
| `Q11` | For a capability to be “covered,” do we require at least one `HAPPY + PERM + FAIL` scenario? | Sets completion criteria | Direction accepted from assistant: yes for `P0` capabilities |
| `Q12` | Do you want per-capability ownership (who maintains test scenarios) documented? | Prevents stale tests | Pending |
| `Q13` | Should every production bug fix require a regression test before close? | Creates long-term quality ratchet | Pending |
| `Q14` | Should DB migration/schema changes require dedicated integration tests by policy? | Reduces data regression risk | Pending |
| `Q15` | Should map-marker behavior parity between Map Mode and Discover Mode be mandatory in smoke tests? | Prevents known class of regressions | Yes |

## Round 1 Questions (Data and Environment)

| ID | Question | Why It Matters | Your Answer |
|---|---|---|---|
| `Q16` | Which seed users are required in test runs (user/curator/admin)? | Needed for role-based journey coverage | Split by lane: PR smoke=`user`; nightly full=`user+curator+admin` |
| `Q17` | Should test runs create these users via UI/API, or allow setup SQL helper? | Tradeoff between realism and speed | API + minimal role setup helper |
| `Q18` | Should failures preserve DB dump automatically for debugging? | Improves triage of flaky/full failures | Pending |
| `Q19` | Any workflows that must never be mocked (strict end-to-end realism)? | Defines non-negotiable realism boundaries | Real external sync indicates strong realism preference |
| `Q20` | Any workflows that should always be mocked (for speed/stability)? | Defines acceptable abstraction boundaries | Pending |

## Decision Log

| Date | Decision | Impacted Docs |
|---|---|---|
| 2026-02-08 | PR smoke should prioritize user exploration/visited behavior; admin and curator flows move to nightly | `testing-feature-matrix-v1.md` |
| 2026-02-08 | Fresh DB + full GADM required for full E2E runs | `e2e-fresh-db-strategy.md`, `testing-feature-matrix-v1.md` |
| 2026-02-08 | External sync behavior should use real providers | `testing-feature-matrix-v1.md` |
| 2026-02-08 | PR max runtime budget set to 1 hour; nightly to 5 hours | `testing-strategy.md`, `testing-feature-matrix-v1.md` |
| 2026-02-08 | Marker behavior parity between Map and Discover is mandatory in smoke lane | `testing-feature-matrix-v1.md` |
| 2026-02-08 | Seed-account policy: PR smoke uses user only; nightly full uses user+curator+admin | `testing-feature-matrix-v1.md`, `e2e-fresh-db-strategy.md` |
| 2026-02-08 | Test account creation policy: API-driven setup with minimal role helper | `e2e-fresh-db-strategy.md`, `testing-strategy.md` |
| 2026-02-08 | Testing must be local-first for fast development, not only PR-gated | `testing-strategy.md`, `testing-feature-matrix-v1.md` |
