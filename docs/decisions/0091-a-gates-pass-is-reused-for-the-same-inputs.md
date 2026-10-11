# ADR-0091: A gate's pass is reused for the same inputs, keyed from the gate map

**Date:** 2026-10-11
**Status:** Accepted — decision 1 narrowed by ADR-0092

---

## Context

ADR-0062 decided when a gate runs: when, and only when, the inputs it checks have
changed against the base. It said nothing about a gate that has already run on
those exact inputs, so such a gate runs again from scratch. Three everyday paths
produce that case:

- `/pr-changes-amend` folds review fixes into the commits they belong to, which
  changes the history and usually leaves the final tree as it was;
- a review wave that touches only Markdown leaves every code input unchanged;
- `CLAUDE.md` § Mandatory Pre-Commit Checks asks for the slow tier again on the head
  the maintainer is asked to merge, which after a clean rebase is often a tree that
  has already passed.

The unit-lane runs recorded by `scripts/test-report.mjs` in `.test-results/` between
2026-09-20 and 2026-10-11 give the price of one rerun on the development machine: a
median of 278 s for `test:frontend` and 80 s for `test:backend`. Over those three
weeks the web lane ran about 480 times.

Every tool that solves this keys a task's result by a hash of what the task reads,
and reuses the result while the hash is unchanged: Turborepo, Nx, moon, Wireit,
Bazel. The question for this repository is whether to adopt one of them or to key
results from the map it already has (#1375, under Epic #1374).

That map is `scripts/gates.mjs`, and four things depend on it that a tool would
have to take over:

- `npm run gates` prints, for every gate in the map, whether it runs or why it is
  skipped. That printout is ADR-0062's answer to a skip that would otherwise look
  like a pass.
- CI's `Changes` job reads the map through `--github-output`, and every job's `if:`
  is shaped around the required-check asymmetry ADR-0062 records. A job skipped by
  its own `if:` reports Success; a workflow skipped by `paths:` leaves its checks
  Pending.
- `scripts/ci-failsafe.test.mjs` holds every job's condition against the map.
- `scripts/gates.test.mjs` asserts that every file a spec opens through `repoFile()`
  is an input of the lane that runs the spec.

## Decision

**1. A gate's pass is kept under a key made from the content it reads, and reused
while the key is unchanged.** The key hashes the following, as they sit on disk:

- every file in the gate's own input classes, and whether git tracks it, since
  `lint:shell`, `lint:docker` and `lint:pointers` read only what git tracks;
- the `tooling` class;
- the Node manifests and lockfiles (`node-deps`);
- the gate's command;
- the Node version, and the Python version for a Python gate;
- for a unit lane, whether it runs on the host or in the backend container. The
  container has no git and mounts only part of the tree, so the two can disagree.

The key comes from the map in `scripts/gates.mjs`, the same one that decides whether
the gate runs. `scripts/gate-cache.mjs` holds the key and the records.

**2. Only a pass is recorded, and only if the files did not move while the gate
ran.** A failure, a gate the host could not run, and a gate killed by a signal leave
nothing behind. The files are hashed again after the gate exits, and a pass whose
two hashes disagree is reported as not recorded.

**3. A gate whose answer reads something outside the tree is never reused.** Each
such gate says why in its `uncached` field in the map:

- the dependency audits (`security:deps`, `security:py:deps`) read advisory
  databases;
- the Semgrep scans fetch their rule packs from the registry on every run;
- the Trivy scan reads a vulnerability database and a base image;
- `api:breaking` compares with the base's document;
- `lint:links` resolves links to files of every type, while its input class holds
  the Markdown only.

The stack tier is listed and never run (ADR-0062), so nothing records its passes.

**4. A reuse is always printed as one.** The run prints a reused gate on its own
line, with when and at which commit it passed, and lists it under `Reused` in the
summary. It never appears under `Ran`.

**5. The records stay on the machine that made them.** They are kept under the
clone's common git directory, so the worktrees of one clone share them and nothing
is tracked. CI never reads or writes them: a run with `CI` set reuses nothing.
`--no-cache` and `--all` reuse nothing either.

**6. No task runner is adopted.** The map stays in `scripts/gates.mjs`, and the
narrowing of its classes (#1378) is done there.

## Alternatives Considered

| Option | Why rejected |
|--------|-------------|
| **moon** (moonrepo) | It is the closest fit: language-agnostic, task inputs declared as globs, results cached by input hash, and `--affected`. Adopting it would move the map into `moon.yml` files and rebuild everything listed in Context: the per-gate skip reasons, the `Changes` job and its `if:` keys, the fail-safe contract and the `repoFile()` assertion. Its Python toolchains are all marked `unstable_`, and six of the map's gates are Python. It is also a new binary that CI and every worktree would install. The one thing it would add is the cache, which is the smallest part of the work. |
| **Nx** | The same migration as moon, plus a project graph and a daemon designed around JavaScript workspaces. Its self-hosted remote cache is free, but it carries risks this repository does not need. Nx's own documentation warns that shared-directory and bucket caches are open to cache poisoning, and its HTTP remote cache extracted downloaded artifacts without constraining where they were written (CVE-2026-71476, versions 20.8.0 up to 22.7.7 and 23.0.2). A remote cache is not wanted here anyway: CI must answer for a pushed head from a fresh checkout. |
| **Turborepo** | It expects package-manager workspaces with one lockfile at the root, and uses that lockfile to understand the packages. This repository keeps one lockfile each in `backend/`, `frontend/` and `packages/shared/`, and its Docker builds and CI install them separately. Converting to workspaces is a change of its own, much larger than the cache. |
| **Wireit** | It adds caching to npm scripts, with inputs declared as `files` in each `package.json`. The map would be split across four manifests. Wireit has no notion of a change set or of a skip reason, so `scripts/gates.mjs` would remain and declare the same inputs a second time. |
| **Bazel / Pants** | They cache down to a single test, but only once every build and test is rewritten into their rules. That is out of proportion to a repository of this size. |
| **No cache** | Every fold, rebase and docs-only wave keeps costing the lanes' whole wall time, at about 480 web-lane runs in three weeks. |

## Consequences

**Positive:**

- A fold, a clean rebase or a Markdown-only wave reruns nothing whose inputs it left
  unchanged. Keying the cache costs about 70 ms of hashing per gate over this
  repository's 1,800 files.
- Worktrees of one clone share their passes, so a lane that passed in one does not
  run again in another on the same inputs.
- One file still decides both whether a gate runs and whether its pass can be
  reused. The input classes therefore also define the cache key, and narrowing
  them (#1378) also makes reuse finer.

**Negative / Trade-offs:**

- The key covers what the map says a gate reads, the tooling and the lockfiles. It
  does not cover an installed `node_modules` that has drifted from its lockfile, a
  Docker image re-pulled under the same tag, or an environment variable that changes
  a gate's behaviour, except the unit lanes' host-or-container switch, which is
  keyed. A pass recorded under such a difference is reused. `--no-cache`
  is the way out, and CI, which reuses nothing, is the backstop.
- Any edit to the `tooling` class, `docs/tech/gates.md` included, invalidates every
  record, because the key covers that class whole.
- A record is kept per gate and per key, and nothing prunes old ones. A record is
  about 200 bytes, so the directory grows slowly. Deleting it forgets every pass.

## References

- Related ADRs: ADR-0062 (a gate runs when, and only when, its inputs changed)
- Related docs: `docs/tech/gates.md` § Reusing a pass
- PR / issue: #1375, Epic #1374, #1378
