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

**Prerequisites:** Docker + Docker Compose, Node.js 22+

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

For Python tooling (cv-python tests, type checking), set up the venv
once:

```shell
npm run setup:py:dev
```

### Coding Style

- TypeScript (frontend + backend): ESLint with the project config.
  Run `npm run lint` to check, `npm run lint:fix` to auto-fix.
- Python (cv-python): Ruff for lint + format. Run `npm run check:py`.

### Testing

Run all automated tests before opening a PR:

```shell
npm run check                  # lint + typecheck + fast security +
                               # knip + circular/shell/docker checks
TEST_REPORT_LOCAL=1 npm test   # Node unit + integration tests
npm run test:py                # cv-python pytest (needs setup:py:dev)
```

`npm run check` is the same gate CI runs — a clean local check means
a clean CI check.

### Pre-commit Checks

Before every commit run the three gates above. See `CLAUDE.md` for
the full mandatory pre-commit checklist (includes a security scan on
changed files).

### Commit Message Template
Follow this format for all commit messages:
```
<Type>: <Topic>.

<Description>

[Issue: #<GitHub Issue Number>]

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
- If the commit fixes an issue, add the issue number in the commit message.
- Sign your commits to verify your identity (use `git commit -s`).
- Only if the commit was written with AI assistance, add a
  `Co-Authored-By: <Model Name> <noreply@anthropic.com>` trailer — never by default.

### Pull Requests (PRs)

#### General PR Workflow

1. Fork the repo, create your feature branch from `main`. Branch name should be in the form `feature/<Feature Name>` for new features and `fix/<Issue Number>` for bug fixes.
2. Ensure code passes linting, has adequate test coverage, and adheres to our structure and style guide.
3. Create a PR to merge your feature branch into `main` of the original repo.
4. In the PR description, provide a clear explanation of your changes and the motivation behind them.
5. In the PR description, provide the Issue number that your PR fixes in a form `Fixes #<Issue Number>`.
   This will trigger bots to check that the PRs changes address all the requirements of the issue.
6. PRs are reviewed with the help of AI bots @coderabbitai and @CodiumAI-Agent. Pay attention to their comments. If you disagree, provide a clear explanation in the comments.
7. Resolve all discussion threads and ensure mandatory checks pass before merging.

#### Handling Stalled PRs
- If a PR is inactive for more than 7 days, a 'stale' label will be added to it and a reminder will be posted in the PR.
- If a PR is inactive for more than 14 days, it will be closed.

### Tips
- We are not against using AI tools like GitHub Copilot or ChatGPT to generate commit messages or PR descriptions. Just make sure that the generated text is correct and relevant.
