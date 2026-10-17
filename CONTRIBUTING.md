# Contributing to Track Your Regions

Thank you for your interest in contributing! This document covers how
to get the project running locally and the conventions we follow.

## Directory Structure

- `frontend/` — React/TypeScript UI
- `backend/` — Express/TypeScript API
- `cv-python/` — FastAPI computer-vision microservice
- `db/` — schema SQL and GADM importer
- `docs/` — architecture docs, ADRs, vision, security

## Local Setup

**Prerequisites:** Docker + Docker Compose, Node.js 22+, and — for the Python tooling below — Python **3.12** specifically, not a floor like Node's

```shell
npm run setup   # interactive: writes .env, generates JWT secret,
                # creates your admin account (run once)
npm run dev     # start all services via Docker Compose
```

Open http://localhost:5173 and log in with the admin you just created.
World-boundary data is empty until you run:

```shell
npm run db:load-gadm   # ~30 min; offers to download the file
```

For a quick look at a real-shaped map, one continent loads in a fraction of that:
`npm run db:load-gadm -- --continent Oceania` (`docs/tech/hacking.md` has the
sizes). `db:status` says the database holds a sample.

The repo-wide lint tooling lives in the root `package.json`. Install it
once, in the repository root:

```shell
npm install
```

`npm run check` runs `madge` (circular imports) and `markdownlint-cli2`
(the docs pass) from the root `node_modules` instead of fetching them
per run, so the versions that run here are the ones the tracked root
`package-lock.json` names — the same tree CI installs with `npm ci`.
Without it the gate stops and names the check that did not run, rather
than dying on `madge: command not found`.

The third package, `packages/shared` — the rules both apps apply,
declared once (ADR-0065) — has its own lint, typecheck and knip, so it
takes an install of its own too:

```shell
npm ci --prefix packages/shared
```

The two apps link it by path and need nothing installed there; the
directory only has to exist.

For Python tooling (cv-python tests, type checking), set up the venv
once:

```shell
npm run setup:py:dev
```

This needs a `python3.12` binary by that name. The pin is deliberate: CI pins 3.12 and
cv-python ships on `python:3.12-slim`, so a venv built on another minor version would make a
green local gate stop meaning a green CI job. Without it the setup stops and says so. An
existing `cv-python/.venv` keeps working — the pin binds *building* a new one, not using one
you already have — and if you have no venv either, each `*:py` gate prints a container
command that runs it against 3.12 instead.

### Coding Style

- TypeScript (frontend + backend): ESLint with the project config.
  Run `npm run lint` to check, `npm run lint:fix` to auto-fix.
- Python (cv-python): Ruff for lint + format. Run `npm run check:py`.

### Testing

**A gate runs when, and only when, the inputs it checks have changed.**
`scripts/gates.mjs` is the map from each gate to its inputs; `npm run
gates` prints which gates the current change asks for and why the rest
are skipped; `docs/tech/gates.md` has the map and the reasoning. Before
every commit: `npm run check` (the fast gates the change asks for; `npm
run check:all` forces every one), `TEST_REPORT_LOCAL=1 npm run gates --
run test --affected` (the unit lanes it asks for, narrowed to the specs
the change reaches; without `--affected` they run whole), and
`/security-check`. A review wave runs the same two against the pull
request's pushed head (`--base <head>`), which CI has already answered
for. The slow lanes — the Semgrep and Trivy scans, the smoke, database
and API lanes, Lighthouse — are CI's: it runs every one the change asks
for on every pushed head, and a pull request is merged only when every
check that ran on its head is green, not only the required ones (one
exemption, the `review` check on a PR that changes `claude-review.yml`:
`docs/tech/gates.md` § Before merging). `npm
run gates -- run stack` marks what is still owed by hand, the
measurements CI cannot hold — `perf:local` (Lighthouse on the real
catalogue) on a change to what the browser loads, `perf:api` (the
latency probe) on a change to what answers the hot reads — run from the
checkout the dev stack serves; a lane CI reports red is reproduced
locally on its own (`/commit` § 8 holds the rule, #1379). A gate the map
skips was not run and did not need to be; a gate the host cannot run
(the Python tooling guard) is a failure to report, not a skip. CI reads
the same map per job, so a skipped job is a job whose inputs the pull
request does not touch. A gate that already passed on the same inputs —
after a fold, a clean rebase or a Markdown-only wave — is not run again
and is printed as reused, never as a fresh pass; `--no-cache` runs it
anyway, and CI never reuses one (ADR-0091).

```shell
npm run gates                  # every gate, run or skipped, with its reason
npm run check                  # the fast gates this change asks for
npm run gates -- run test --affected
                               # the unit lanes it asks for, narrowed to
                               # the specs it reaches (the Python one
                               # needs setup:py:dev)
npm run gates -- run stack     # where each slow lane is owed: here, or CI
```

`/security-check` is a Claude Code slash command, so it is not
available in every setup. Where it is not, do the same by hand before
committing: read the diff for secrets, for an endpoint added without
auth or ownership checks, and for user input concatenated into SQL or
rendered unescaped.

### Pre-commit Checks

Before every commit run the three things the rule names above: the fast
gates, the unit lanes, and the security pass over the diff. `CLAUDE.md`
§ Mandatory Pre-Commit Checks states the same rule for contributors
working with Claude Code, and `docs/tech/gates.md` is the map both of
them read.

### Commit Message Template
Follow this format for all commit messages:
```
<Type>: <Topic>.

<Description>

<Closes|Fixes|Part of|Relates to> #<GitHub Issue Number>

Signed-off-by: <Your Name> <Your Email>
```

- Type can be one of the following:
  - `front`: Frontend
  - `back`: Backend
  - `deploy`: Deployment
  Or leave it blank if the commit is not specific to any of the above.
- Keep the `<Topic>` line concise and imperative.
- In the `<Description>` body, explain *what* changed and *why* (not how), and
  wrap every body line at 72 characters.
- Reference related issues in the body: `Closes #N` / `Fixes #N` when the commit closes the issue, `Part of #N` for partial progress, `Relates to #N` for a loose association. Omit the line entirely when no issue applies.
- Sign your commits to verify your identity (use `git commit -s`).
- Only if the commit was written with AI assistance, add a
  `Co-Authored-By: <Model Name> <noreply@anthropic.com>` trailer — never by default.

### Pull Requests (PRs)

#### General PR Workflow

1. Fork the repo, create your feature branch from `main`. Branch name should be in the form `feature/<Feature Name>` for new features and `fix/<Issue Number>` for bug fixes.
2. Ensure code passes linting, has adequate test coverage, and adheres to our structure and style guide.
3. Create a PR to merge your feature branch into `main` of the original repo.
4. In the PR description, provide a clear explanation of your changes and the motivation behind them.
5. In the PR description, reference the issues the PR addresses: `Closes #<N>` / `Fixes #<N>` when the PR completes the issue, `Part of #<N>` for partial progress (the issue stays open), `Relates to #<N>` for a loose association.
   This will trigger bots to check that the PR's changes address all the requirements of the issue.
6. PRs are reviewed with the help of AI bots @coderabbitai and @CodiumAI-Agent. Pay attention to their comments. If you disagree, provide a clear explanation in the comments.
7. See every discussion thread through to resolution — answer each one, and let the commenter resolve it once addressed (do not resolve other people's threads yourself; the one exception is a bot reviewer that reports it could not resolve its own thread and asks for manual resolution — honour that ask and say so in a reply) — and ensure mandatory checks pass before merging.

#### Handling Stalled PRs
- If a PR is inactive for more than 7 days, a 'stale' label will be added to it and a reminder will be posted in the PR.
- If a PR is inactive for more than 14 days, it will be closed.

### Tips
- We are not against using AI tools like GitHub Copilot or ChatGPT to generate commit messages or PR descriptions. Just make sure that the generated text is correct and relevant.
