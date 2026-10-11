# ADR-0092: A gate reads its own side and its own settings, and only CI runs everything for the map

**Date:** 2026-10-11
**Status:** Accepted

---

## Context

ADR-0062 left two coarse answers in the map, both on purpose and both marked as
waiting for a measurement.

- **Decision 3 put the whole product in one input class, `app`.** That was
  `backend/`, `frontend/`, `db/`, `martin/`, `scripts/`, the compose files and
  `.env.example`; `packages/` joined it with ADR-0065. Separating the stacks was
  "a later decision, taken if it is measured to be worth it".
- **Decision 4 made `tooling` reach every gate.** That class held the workflow,
  the root manifest and lockfile, the map itself, the tool guards, three tools'
  settings files and `docs/tech/gates.md`. Reading what a change *reaches*
  instead was left open "until there is a measured need".

The measurement exists now (#1374). The unit-lane runs recorded in
`.test-results/` between 2026-09-20 and 2026-10-11 give these medians on the
development machine:

| Lane | Median | Runs in three weeks |
| --- | --- | --- |
| `test:frontend` | 278 s | about 480 |
| `test:backend` | 80 s | — |
| `test:e2e:smoke` | 155 s, plus the stack | — |

Two cases show what the coarse classes cost:

- A change confined to `backend/src/services/sync/` asked for the web's lint,
  typecheck, knip and unit lane, and for Lighthouse. None of those can see a file
  under `backend/`.
- Every pull request of #1374 edits the map or its document. Each therefore
  asked for every gate locally, the 20-minute slow tier included, for changes
  that touch no line of the product.

Practice elsewhere separates these concerns:

- **Nx** keeps its global inputs (`sharedGlobals`) minimal and makes a target's
  own settings its input alone. It reads a root `tsconfig` by path mapping, so
  that one mapping does not invalidate every task.
- **Turborepo** warns that anything in `globalDependencies` makes every task
  miss its cache.
- **Both** treat their own configuration as global. On a GitHub Actions
  workflow, a change to the workflow is what reruns its jobs.

## Decision

**1. The product is split into classes, and each gate names the ones it opens
(narrows ADR-0062 decision 3).**

| Class | Paths |
| --- | --- |
| `backend` | `backend/` |
| `web` | `frontend/` |
| `shared` | `packages/` |
| `database` | `db/` but the coverage lists |
| `tiles` | `martin/` |
| `scripts` | `scripts/` whole |
| `runners` | `scripts/` but the specs and the tools no lane executes |
| `compose` | the compose files and `.env.example` |

A README beside the code in `backend/`, `frontend/` and `packages/` is prose
only.

- **The two sides meet in one document.** The web reads the backend only
  through the OpenAPI document in `packages/shared` (ADR-0072, ADR-0073). So a
  backend change that leaves that document as it was asks for no web gate.
- **`test:backend` reads every class.** Its specs scan `frontend/src`, `db/`,
  `martin/` and `scripts/` as text.
- **The smoke and Lighthouse lanes read the whole product.** The pages
  Lighthouse weighs load the API's answers.

**2. `tooling` is gone (narrows ADR-0062 decision 4).** Each file a gate reads
outside its classes is in that gate's `config` and asks for that gate alone:

- a tool's settings;
- a guard its script calls;
- a document its specs open.

**3. The root `package.json` is read by script.** A changed npm script asks for
the gates that run it, directly or through `npm run`. A change outside the
scripts and the dependencies cannot be placed and asks for every gate. The root
lockfile asks for the gates that run a root tool.

**4. The map and the workflow are global in CI only.** In CI, a change to
`scripts/gates.mjs` or `.github/workflows/ci.yml` runs every gate. Without that,
an edit that narrows the map could skip the gate it broke, which is the risk
ADR-0062 decision 4 guarded against, and a job's definition is tested only by
running it. The same holds for a root npm script the workflow runs by name
(`npm run check`, `npm run perf`, `npm run setup:py:dev`), read from the
workflow itself: it is part of a job's definition, and no gate's own command
may name it. Locally the same change asks for its readers alone, and the
listing says that CI will run the rest.

**5. The map is held complete by specs, not by a class that runs everything.**
`scripts/gates.test.mjs` holds two things:

- every tracked path is in a class, in a gate's `config`, or in `UNREAD` with
  its reason;
- every script file and root settings file a gate's npm script names is that
  gate's input.

**6. The cache key keeps the machinery (narrows ADR-0091 decision 1).** A gate's
key covers its own classes and `config`. It also covers the gate machinery and
the root manifests (`scripts/gates.mjs`, `scripts/gate-cache.mjs`,
`package.json`, `package-lock.json`), so a pass recorded under older machinery
is never reused. Keying on those files no longer means asking every gate to
run.

## Alternatives Considered

| Option | Why rejected |
|--------|-------------|
| Keep `tooling` and skip the local slow tier for map-only branches | It answers one symptom and keeps the rule that a `.madgerc` edit runs Lighthouse. The local tiers would still disagree with what the change can affect. |
| Union of the base map's and the head map's decisions | It catches a narrowing edit without CI's help. But on the first branch that splits a class it inherits the old map's "everything", and the map must be importable from any past commit. CI running everything on a map change gives the same guarantee for one line. |
| Derive every gate's script inputs from the scripts' text alone | It finds `./scripts/require-py-tools.sh`, but not the settings a tool reads implicitly (`.madgerc`). Those are listed in `config`, and a spec checks that the text-named ones are there too. |
| A positive list of runner scripts | A new runner that is not listed would be skipped silently. The `runners` class is everything under `scripts/` but the named tools, so a new script counts as a runner until it is named a tool. |

## Consequences

**Positive:**

- A backend-only change no longer asks for the web's lint, typecheck, knip or
  unit lane. A web-only change no longer asks for the backend's lint,
  typecheck, knip, database or API lanes.
- A change to a tool's settings runs that tool. A change to the map or its
  document runs the map's specs and the docs gates locally, and CI runs
  everything.
- CI's unit job installs and runs each Node lane only when the map asks for it.

**Negative / Trade-offs:**

- Correctness now rests on the map being complete rather than on a class that
  runs everything. The two specs in decision 5 are what hold it. A tool that
  reads a file its script does not name can be missed until someone places that
  file by hand.
- A change to the map or the workflow costs CI a full run. That is the price of
  decision 4, paid by CI machines rather than by the person waiting.
- `lint:links` still resolves links to non-Markdown targets that its class does
  not cover. That gap is unchanged and recorded in `docs/tech/gates.md` § What
  the map does not reach.

## References

- Related ADRs: ADR-0062 (decisions 3 and 4 narrowed here), ADR-0091 (decision 1
  narrowed here), ADR-0065, ADR-0072, ADR-0073
- Related docs: `docs/tech/gates.md` § What a tool's settings ask for, § The map
- PR / issue: #1378, Epic #1374, #965
