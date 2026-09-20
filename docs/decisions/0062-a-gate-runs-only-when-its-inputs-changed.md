# ADR-0062: A gate runs when, and only when, the inputs it checks have changed

**Date:** 2026-09-20
**Status:** Accepted

---

## Context

Every gate ran on every change. PR #779 and PR #782 — an ADR and two doc
sections between them — each ran the whole matrix on every push: lint and
typecheck of both stacks, both unit lanes, the Python tests, the build, Semgrep
twice, the Trivy image scan, an E2E smoke run against a seeded stack, Lighthouse
and three CodeQL analyses. About 25 minutes of wall-clock per push, and not one
of those jobs can read a word of Markdown (#783).

The same waste sits inside the code. A backend-only change ran cv-python's
ruff, mypy, Bandit and pip-audit, none of which reads a TypeScript file; a
frontend-only change built the cv-python image so that Trivy could scan it.

Locally it was worse than slow. `CLAUDE.md` § Mandatory Pre-Commit Checks asked
for `npm run check`, both unit suites, `npm run security:all` and the smoke lane
whatever the diff touched, and `npm run check` ran the Python half of itself: on
a host with no `python3.12` a prose branch stopped at `scripts/require-py-tools.sh`
with a message about a virtualenv it had no reason to build. The guard is right
to fail loudly — a gate that is silently not run is the failure mode this
repository has been bitten by — and the defect is that it was asked at all.

Skipping is not free to arrange. Branch protection requires three contexts:
`Lint & Type Check`, `Security Scan`, `Unit Tests`. A workflow skipped by a
`paths:` filter never reports them at all, so they stay Pending for ever and the
merge button never lights up — the naive fix blocks the merge instead of
speeding it up. A job skipped by its own `if:` reports Success and satisfies the
same required check. That one asymmetry decides the mechanism below.

## Decision

**1. One map, `scripts/gates.mjs`, read by CI and by the local scripts.** Every
gate names the input classes it reads; a change is classified by the paths it
touches; nothing else anywhere declares what a gate reads. A change set the
runner cannot work out — no base, a shallow clone, a git that will not answer —
runs every gate and prints why, and a path that is an input to no gate is
reported rather than dropped. `docs/tech/gates.md` embeds the tables
`node scripts/gates.mjs --table` prints, and `scripts/gates.test.mjs` asserts
the document contains them verbatim, so the prose cannot drift from the map it
describes.

**2. CI skips by a job-level `if:` on a change-detection job, never by
`paths:`.** A first job, `Changes`, runs the map over the range the event
carries and publishes one output per job. Every other job reads it:

```yaml
if: ${{ !cancelled() && (needs.changes.result != 'success' || needs.changes.outputs.job_check == 'true') }}
```

`!cancelled()` removes the implicit `success()`, so a **failed** detection job
skips nothing — every job then runs, which is the map's own rule for a change
set it cannot work out, applied one level up. Without it, a broken decision
would skip the three required contexts, each would report Success, and the pull
request would be mergeable with nothing run on it at all. `Build`, `E2E Smoke`
and `Performance (Lighthouse)` additionally require
`needs.check.result == 'success'`: that is the ordering they had before, and it
has to be stated explicitly now, because `!cancelled()` is what removed it.

**3. The product is one input class, `app`** — `backend/`, `frontend/`, `db/`,
`martin/`, `scripts/`, the two compose files and `.env.example`. The frontend
imports nothing from the backend (#527) and its unit tests mock the API, so
neither its typecheck nor its unit lane can see a backend contract change; the
smoke lane is the only gate that sees the two sides agree, and it is an `app`
gate. In the other direction the backend suite reads the rest of the repository
directly — `db/init/01-schema.sql`, `db/migrations/`, `frontend/src`,
`martin/config.yaml`, `martin/README.md`, `scripts/db-migrate.sh` and whole-tree
scans of `frontend/src`, `db/` and `scripts/` — through `repoFile()` (#948), and
`scripts/gates.test.mjs` asserts that every literal `repoFile()` path in that
suite is an input to `test:backend` or to `tooling`, which runs everything
anyway. Separating the two stacks is a later
decision, taken if it is measured to be worth it; taken today it would skip a
gate that reads the file that changed.

**4. `tooling` reaches every gate, and "inputs" means paths.** A root config —
`.github/workflows/ci.yml`, the root `package.json` and lockfile,
`scripts/gates.mjs`, the three tool guards, `.semgrepignore`,
`.markdownlint-cli2.jsonc`, `docs/tech/gates.md` — decides what the gates are
rather than what they read, so a change to one runs all of them. The class also
holds `scripts/scan-image.sh`, for a different reason: it is one gate's own
runner, and that gate reads `python` while its script sits under `scripts/`, so
no class the gate reads would run an edit to the scan itself — the severity, the
pin — and a gate's runner that no input names is the one shape of drift the map
cannot see. It is the conservative answer, and the only one that cannot skip a
gate its own change just broke. Reading what a change *reaches* instead — the
import graph madge already builds, the Docker build context, the lock files —
is the open question
raised by #783, and it stays open: it is out of scope until there is a measured
need, because it buys precision inside a class that is already conservative.

**5. What sees every change keeps seeing every change.** GitHub's native secret
scanning and push protection, the DCO check, CodeQL's default-setup analyses and
the review bots are outside the map and are not skipped by it. Neither is prose:
`*.md` is an input class of its own, so a documentation change runs the Markdown
and link gates — the one class of file the old matrix spent twenty-five minutes
on and could not read.

**6. The docs pass is `markdownlint-cli2` with render-defect rules only, plus
lychee offline for links.** Measured on 2026-09-20 over the 155 tracked Markdown
files the repository held when the pass was added, in a clean checkout (a working
tree's untracked files are not counted): with every default rule on, 13 432
findings, 11 235 of them line length (MD013) and 1 305 table-pipe style
(MD060). Neither changes a rendered page by a pixel, and a gate that opens with
thirteen thousand findings is a gate nobody reads. So the config turns `default`
off and enables eleven rules, each one a defect a reader would see: a link that
is not a link, a heading that is not a heading, a table that renders as a row of
pipes. On the same 155 files that set finds 7, across three files — a list a
person fixes in one sitting, and one that was fixed in one before this branch
left the machine, so `lint:md` has found 0 since. Links go through lychee with
`--offline --include-fragments`, which resolves relative links and heading
anchors inside the repository and asks the network nothing, so the gate cannot
go red because a third-party site was down.

**MD018 is off, and what decided it is this repository's prose rather than
taste.** A hash opens an ATX heading in CommonMark only when a space follows it,
so a line beginning `#667's fix put …` or `#753 asked …` is an ordinary
paragraph on GitHub — and MD018 cannot tell such a line from a heading typed
without its space. On the same run it flagged 14 of them, across eleven files,
and not one mistyped heading. Every edit it asked for would have been to prose
that already rendered correctly — five of the eleven files are ADRs, three of
them Accepted, and an Accepted ADR may change only in its `Status`
(`docs/decisions/README.md`). MD020 keeps the closed
form (`##Heading##`), which carries none of that ambiguity: nothing here opens a
line with `##` and a digit.

## Alternatives Considered

| Option | Why rejected |
|--------|-------------|
| `paths:` / `paths-ignore:` on the workflow | The required contexts never report. A docs-only pull request would sit Pending for ever and could not be merged — the outcome #783 was filed to avoid, arrived at faster |
| A third-party filter action (`dorny/paths-filter` and the like) | A second vocabulary of globs, living in the workflow where no local script can read it. The map would be written twice and the documentation would be a third copy |
| Each job working out its own change set | The same diff computed in ten jobs, ten chances to disagree, and no single place that prints the verdict a reader can check |
| Splitting `app` into `backend` and `frontend` | Not safe today, and the reason is in the repository rather than in taste: backend specs read `frontend/src`, `martin/` and `scripts/` through `repoFile()`, and the only gate that sees the backend↔frontend contract is the smoke lane |
| Reading what a change reaches through the import graph | Precision inside a class that is already conservative, bought with a second mechanism to maintain. Deferred until something measured asks for it |
| Keeping a manual opt-out (`/commit --skip-tests`) | A flag says what a person believed about the diff; the map says what the diff is. The flag is removed by this decision |

## Consequences

**Positive:**

- **A prose change runs the prose gates and nothing else.** Measured on the
  docs-only commit 82b0345d: 2 of the 24 gates apply — `lint:md` and
  `lint:links` — and the other 22 print the input class they did not see moved.
- **The instruction and the behaviour are one sentence.** `CLAUDE.md`,
  `docs/tech/development-guide.md`, `CONTRIBUTING.md`, `/commit` and
  `/pr-create` state the rule identically and point at the same map, in place of
  four copies of "run everything before every commit and push".
- **A host without `python3.12` is no longer stopped on a branch that touched no
  Python** — unless it touches repository-wide tooling, which reaches every gate
  and is how this branch itself asks for `check:py`. The Python gates are
  otherwise asked for when `cv-python/` (or, for the test lane, the GADM
  loader's own Python files) changed, which is when this machine is expected to
  have the toolchain that runs them.
- **Every skip carries its reason**, in the local run and in the CI run summary
  alike, so "that gate did not run" is a sentence a reader can check rather than
  an absence they have to notice.

**Negative / Trade-offs:**

- **The map is a claim about what each gate reads, and it is maintained by
  hand.** A gate that quietly starts reading a new kind of file keeps passing on
  a change to it. Two things bound that: `tooling` runs everything, and the
  `repoFile()` assertion turns red the day a backend spec reads a path the map
  does not name.
- **The calendar is an input the map cannot name.** Trivy, `npm audit` and
  `pip-audit` answer from vulnerability databases, so their verdict changes when
  a CVE is published, not when a file moves; before this decision every push
  re-asked them, and under the map alone a base-image CVE disclosed after the
  last `cv-python/` change would be found by nothing — Dependabot alerts cover
  the manifests, the image's OS packages have no such backstop. So `ci.yml`
  carries a weekly `schedule:` trigger, which has no base and therefore runs
  every gate; the map states what a change reaches, the schedule states that
  time passes.
- **The `docs` class is `*.md`, while `lint:links` resolves links to any file.**
  Renaming a `.sh`, an `.sql` or an image leaves a dead link in prose that this
  map does not chase, because the change touched no Markdown. The next full run
  — any `tooling` change, or the next docs edit — finds it.
- **The other workflow files are in no input class.** `claude-review.yml`,
  `claude-qa.yml` and `claude-dependabot.yml` are linted by nothing, before this
  decision or after it; only `ci.yml` is named, and it is named as tooling rather
  than as something checked. A `lint:actions` gate over `.github/workflows/`
  (actionlint) is the candidate follow-up.
- **No gate covers the backend ↔ cv-python HTTP contract, before this decision
  or after it.** `backend/src/services/cv/pythonCvClient.ts` calls the FastAPI
  service over HTTP; no backend spec exercises it, and the smoke stack starts
  `db`, `backend`, `frontend` and `martin` only, so cv-python is not in the one
  lane that could see the two sides agree. What changes here is that the gap is
  written down: the map cannot skip a gate that does not exist.
- **A mistyped `#Heading` in the open form now renders as a paragraph and no
  gate says so.** That is the price of leaving MD018 off (decision 6), and it is
  paid knowingly: on the measured run the rule saw 14 lines and every one of
  them was a paragraph opening with an issue number, which is how this
  repository's prose refers to its own work. The closed form is still covered by
  MD020, and the day a heading here is genuinely typed without its space this is
  the rule to reconsider — with an ignore for the shape the false positives take
  rather than escapes written into prose that renders correctly. No ADR is
  edited by this branch except the one it adds; `docs/decisions/README.md` keeps
  its "only `Status` may change" intact.

## References

- Related ADRs: ADR-0032 (a rule stays absolute and the debt is recorded beside
  it — this rule is absolute and its inputs are what is named), ADR-0041 (a
  database says which migrations it has seen: the same preference for a record
  over a memory)
- Related docs: `docs/tech/gates.md` (the map, how to read a run of it, how CI
  applies it), `docs/tech/development-guide.md` § Verification Workflow,
  `docs/security/SECURITY.md` § Current Security Stack
- PR / issue: #783; the required-context behaviour it had to work around is why
  #778 saw red checks on documentation pull requests; `repoFile()` is #948
