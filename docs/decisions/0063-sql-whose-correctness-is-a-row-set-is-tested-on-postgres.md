# ADR-0063: SQL whose correctness is a row set is tested on PostgreSQL

**Date:** 2026-09-21
**Status:** Accepted

---

## Context

Backend unit tests mock the `pg` pool by convention, so a test asserts the
**text** of the SQL a function sends. That is the right tool for most of this
codebase: it pins predicates, guard clauses and parameter binding cheaply, and
its assertions catch real defects when each is anchored to the clause it is
about rather than to the whole statement.

It cannot see *which row a statement selects*. The deferred-withdrawal writer
in `backend/src/services/sync/locationWriter.ts` pairs a withdrawn location
with the arrival that replaces it, over a CTE whose correctness is entirely
about row selection. Twelve tests asserted its SQL text, all fifteen mutations
of it were killed — and the statement still picked the wrong old row whenever
two moves landed without a curator publishing in between, leaving a one-point
site showing the same place with two pins, permanently, recoverable only by
hand-written SQL. Reproducing it took a real database and four statements; no
amount of text assertion would have (#522). The correctness argument for that
CTE lives in the database's own semantics — a CTE over a table containing rows
the reader cannot see, a `row_number()` join, a partial unique index — and
restating those semantics in a mock is writing a second, wrong Postgres.

The same shape recurs wherever this codebase reasons in SQL rather than in
TypeScript, which is deliberate and documented: the sync upsert's `CASE` arms,
`missingDetection`'s coverage ratio, the region-assignment insert and its
unfiltered clear, the queue's kinds. Each is a statement whose correctness is a
row set. Each was proved once by hand, against a throwaway database, and the
proof is a paragraph in a commit message that nothing re-runs.

The milestone *Reduce Change Cost* names the outcome: SQL whose correctness is
determined by database semantics has an executable PostgreSQL-backed test path.

What exists today, and why none of it is that path: `TEST_REPORT_LOCAL=1 npm test`
is vitest with a mocked pool and no database, and CI's `Unit Tests` job is a bare
runner with no `services:` block, so no database is reachable there;
`npm run test:e2e:smoke` has a real database, but its entry point is the
browser, so a single SQL statement is expensive and awkward to address. Two
findings rule out the cheapest fix — a reachability-guarded test in the
existing suite. In CI it would report green having executed nothing, and the
suite's own summary would count it as passing, which is worse than no test. On
a developer machine "reachable" means the golden database: `backend/src/db/index.ts`
defaults `DB_NAME` to `track_regions`, so a guard that fires on reachability
would run destructive fixture SQL against the working catalogue.

## Decision

**1. A statement's test belongs to the database lane when the assertion is
about which rows the statement selects, not about what it says.** A CTE over
rows the reader cannot see, a `row_number()` join, a partial unique index, a
lock, a transaction boundary. Everything else stays in the mocked suite, which
remains the default: the lane is for the row set, not for coverage, and a
mocked test anchored to its clause is still the cheapest way to pin a predicate.
The criterion is written in `docs/tech/development-guide.md` § Tests that need
a database, beside the section on tests that read a repository file.

**2. The lane runs only inside the isolated test stack, against a database
whose name says `test`, and it fails rather than skips without one.** The
specs are `backend/src/**/*.db.test.ts`, run by `backend/vitest.db.config.ts`
and excluded from the unit config, so the bare `vitest run` that the host lane
and CI's `Unit Tests` job use never selects them — that is how `npm test` keeps
working on a laptop without Docker: by never being asked, not by a guard that
reports green having run nothing. `npm run test:db` runs them inside the
backend container of the stack `scripts/test-stack.sh` stands up, and
`TEST_REPORT_LOCAL=1` is refused for that mode. Before any spec runs,
`backend/src/testSupport/dbLane.globalSetup.ts` asks the server
`SELECT current_database()` and throws unless the answer matches
`TEST_DB_NAME_PATTERN` in `backend/src/db/testDbName.ts` — the same guard the
e2e seed applies, now with one home and two callers — and throws again when no
server answers. A permanent probe spec, `dbLane.db.test.ts`, means a green run
always executed something.

**3. A fixture is the spec's own, scoped to its own rows, and never the shared
seed.** A spec inserts what its scenario needs under ids pinned above the e2e
fixture's range, deletes them before and after, looks seeded sources up by
name, and never truncates a table: the smoke fixture shares the database and
has to be standing when the specs are done. The chain scenario needs a gated
experience whose locations it controls exactly; a test that adapts to whatever
the shared fixture holds is a test whose failure mode is "the fixture changed".
Assertions are rows read back — counts and ids — with one intermediate
assertion per step, so a regression names the step rather than the total.

**4. The lane hangs off the E2E job, as a `stack`-tier gate with its own output
key.** `test:db` sits in the map (`scripts/gates.mjs`) with the smoke lane's
inputs, and CI runs it as a second step of the `E2E Smoke` job, which keeps the
stack up between the two. That is the one job in CI with a database, so the
lane costs no new infrastructure; `job_test_db` is its own key, in the shape the
two Semgrep steps have, and `scripts/gates.test.mjs` pins that the key can never
be true while `job_smoke` is false, since a step inside a skipped job reports
Success.

## Alternatives Considered

| Option | Why rejected |
|--------|-------------|
| A reachability-guarded test in the existing unit suite | Skips for ever in CI, where `Unit Tests` has no database, and reports green; on a developer machine "reachable" is the golden catalogue, so the guard that protects it leaves the test skipping in both places |
| A `services: postgres` block on the `Unit Tests` job | A second way to build a database, with the schema applied by a second mechanism; the compose stack already builds one from `db/init/01-schema.sql`, and the E2E job already pays for it |
| vitest `projects` in one config | A bare `vitest run` selects every project, and the two places that run it bare — the host lane and CI's `Unit Tests` job — are exactly the two with no database |
| Reusing the e2e seed (`db:seed:e2e`) as the fixture | The scenario needs a gated experience whose locations the spec controls exactly; adapting to the shared fixture makes "the fixture changed" the failure mode, and the seed must stay standing for the smoke lane anyway |
| Asserting on the database's behaviour through the browser (the smoke lane) | A single SQL statement is expensive and awkward to reach from Playwright; the lane exists to address one statement in four lines |

## Consequences

**Positive:**

- **A hand-verified paragraph in a commit message becomes something CI
  re-runs.** The pairing chain — two moves, no intervening publish, then a
  publish, exactly one pin — is `locationWriter.chain.db.test.ts`, executed on
  every pull request that touches the product.
- **The two lanes have a stated boundary.** A reviewer asks one question of a
  new test — is the assertion about the rows or about the text — and the answer
  says which file it belongs in.
- **The safety story is layered.** The stack's rails refuse the dev project and
  the golden database, the seed refuses a non-test name before any spec runs,
  the lane's own setup asks the server where it landed, and the unit config
  never selects a `*.db.test.ts` file.

**Negative / Trade-offs:**

- **The stack is shared, so a db spec must leave the fixture standing.** A spec
  that truncates a table breaks the smoke lane that runs beside it; the rule in
  decision 3 is a convention, enforced by review, not by a guard.
- **A config edit needs an image rebuild.** `backend/vitest.db.config.ts` is
  baked into the backend image while `src/` is mounted; `ensure_up` always
  rebuilds, and the runner probes for the file so a stale container says so,
  but a hand-run against a container built before the file existed fails on the
  probe rather than on the spec.
- **The lane is slow by construction** — it stands a stack up — so it belongs
  to the before-push tier and is typed by hand, never spawned by the per-commit
  tier. A row-selection defect is therefore found before the push, or by CI,
  not by `npm run gates -- run test`.
- **The step's key is redundant today.** `test:db` and `test:e2e:smoke` both
  read `app`, so `job_test_db` equals `job_smoke` on every change; the key
  exists for the day the smoke gate's inputs are narrowed, and the containment
  test is what makes that day safe.

## References

- Related ADRs: ADR-0062 (a gate runs when, and only when, the inputs it checks
  have changed — this lane is one more gate in that map), ADR-0025 decision 5
  (the deferred withdrawal whose pairing CTE is the motivating case), ADR-0041
  (a database says which migrations it has seen: the same preference for a
  record over a memory)
- Related docs: `docs/tech/development-guide.md` § Tests that need a database,
  `docs/tech/gates.md`
- PR / issue: #522; the milestone *Reduce Change Cost*; parent umbrella #788
