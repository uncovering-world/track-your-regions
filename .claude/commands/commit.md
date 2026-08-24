# Commit Changes

Review uncommitted changes, organize them into atomic commits on an appropriate branch, run the project's mandatory pre-commit gates, and push.

## Arguments

`$ARGUMENTS` — optional. Accepts any combination of:

- A branch name or short description of the change (e.g. `fix-auth-token-refresh`). If absent, infer from the diff.
- `--skip-tests` — skip the test runs for trivial doc-only / comment-only / `.gitignore`-only changes. The lint+typecheck gate (`npm run check`) and the security pass still run.

Examples: `/commit`, `/commit fix-token-refresh`, `/commit docs-cleanup --skip-tests`.

## Prerequisites

Follow the commit conventions defined in `docs/tech/development-guide.md` — specifically the "Commits and Branches" section (granular commits, title+body format, branch discipline, docs in dedicated commits).

## Why these conventions matter

The conventions exist because each one has burned this repo before:

- **DCO sign-off (`-s`) is a CI gate, not a style preference.** PRs without a `Signed-off-by:` trailer fail the DCO check and cannot merge. This is the most common cause of red CI on dependency PRs.
- **72-char body wrap** keeps `git log`, `gh pr view`, and review tools readable. Longer lines wrap mid-word and obscure the history.
- **Pre-commit gates** (`npm run check`, tests, security pass) catch issues locally that would otherwise show up as red CI 5 minutes later. Running them now saves a force-push cycle.
- **One purpose per branch** keeps PRs reviewable and reversible.

## Instructions

### 1. Assess current state

Run in parallel:

```bash
git status
git diff
git diff --cached
git log --oneline -10
git branch --show-current
```

Also check if the current branch has unmerged commits (i.e., is not `main`):

```bash
git log main..HEAD --oneline
```

### 2. Determine the branch

- **If already on a non-main branch with unmerged commits**: check if the uncommitted changes are related to the branch's purpose. If yes, use this branch. If the changes are unrelated (different feature/fix), stash them, switch to main, and create a new branch.
- **If on main or on a clean feature branch with no relation to the changes**: create a new branch. Use a descriptive kebab-case name (e.g., `fix-auth-token-refresh`, `add-region-export`). If `$ARGUMENTS` provides a name or hint, use that.

### 3. Filter out junk

Review every changed file. **Do NOT stage** any of the following:

- `.env`, `.env.*` files or anything with secrets/credentials
- Files with hardcoded local paths, hostnames, ports specific to your machine
- IDE/editor config (`.idea/`, `.vscode/settings.json`, etc.) unless already tracked
- OS files (`.DS_Store`, `Thumbs.db`)
- Build artifacts, `node_modules/`, `dist/`, `.cache/`
- Log files, temporary files, debug output
- Local-only tweaks
- Any file that contains private data (API keys, tokens, personal info)

If you find suspicious files, **skip them** and mention it in the summary.

### 4. Run the mandatory pre-commit gates

Run these **before** creating any commit, so a failure aborts the workflow before history is touched.

**a. Lint + typecheck + fast security (always):**

```bash
npm run check
```

If this fails, stop. Report the specific failure to the user with the relevant output (the failing lint rule, type error, audit advisory, etc.). Don't try to commit "anyway" — the same failure will appear in CI and block the PR. Either fix the underlying issue or ask the user how to proceed (e.g. if the failure is unrelated infra noise, the user may want to aggregate a separate fix into this PR — that's what we did for PR #396).

**b. Tests (unless `--skip-tests` was passed):**

```bash
TEST_REPORT_LOCAL=1 npm test
npm run test:py
```

`--skip-tests` is only appropriate for changes that touch zero executable code: `*.md` doc edits, comment-only edits, `.gitignore` / `.editorconfig` tweaks. Any `.ts`, `.tsx`, `.js`, `.py`, `.sql`, `.yaml` (config) change — run the tests.

**c. Security pass on changed files:**

Invoke the `security-check` skill via the Skill tool to scan the diff for secrets, missing auth, IDOR, injection patterns, and the language-specific gotchas listed in `.claude/commands/security-check.md`. If the skill flags anything CRITICAL or HIGH, stop and surface it — fix before committing.

### 5. Group changes into atomic commits

Analyze the staged-worthy changes and group them by purpose. Each commit should contain **only** changes that belong together:

- A bug fix is one commit — don't mix in unrelated refactoring
- A new feature should be split into multiple granular commits when it has distinct layers (e.g., backend endpoint, frontend hook, frontend wiring — each gets its own commit)
- **Documentation updates always get their own dedicated commit** — never mix docs with code changes
- Config changes get their own commit unless directly tied to a feature
- Each commit must compile and pass lint on its own
- If a commit diff is hard to review in one sitting, it's too big — split it

**Do NOT create a commit that mixes unrelated changes.** If changes span multiple unrelated topics, they need separate commits (and potentially separate branches — see step 2).

**Each branch/PR must be single-purpose.** A branch exists to deliver ONE feature, fix, or improvement. Don't sneak in unrelated changes — no matter how small — into a branch that serves a different purpose. Inbox notes, unrelated doc edits, minor refactors, or "while I'm here" fixes must go on their own branch or be left uncommitted. A PR reviewer should never see a diff that makes them ask "why is this here?"

### 6. Create commits

For each atomic group, stage the specific files and commit. Always pass `-s` and always use a HEREDOC so the body keeps its line breaks:

```bash
git add <file1> <file2> ...
git commit -s -m "$(cat <<'EOF'
<Type>: <Topic>.

<body: explain what changed and why, wrap every line at 72 chars>

<Closes|Fixes|Part of|Relates to> #<N>

Co-Authored-By: <model name> <noreply@anthropic.com>
EOF
)"
```

The heredoc delimiter is quoted (`<<'EOF'`), so **everything between the
markers is literal** — no expansion, and no shell comments. Never annotate
a line inline; the annotation lands in the commit message verbatim. The
last two lines above are conditional: pick the issue-reference keyword
per the rule below (`Closes`/`Fixes` close, `Part of` keeps the issue
open) and drop the line entirely when no issue applies, and drop the `Co-Authored-By` trailer entirely for commits a
human wrote (see **Trailers** below).

**Title:**

- Imperative mood: "Add X", "Fix Y", "Update Z" (not "Added"/"Fixes")
- Max 72 characters (including the type)
- Specific: "Fix hover state not clearing on region change" not "Fix bug"
- Format `<Type>: <Topic>.` where `<Type>` is one of `front` (frontend), `back` (backend), `deploy` (deployment), or **left blank** if the change isn't specific to one of those. Do NOT use Conventional-Commit prefixes (`feat(scope):`, `fix(scope):`, …). Check `git log --oneline -20` for examples.

**Body:**

- Explain *what* changed and *why* — not just *how*. The diff already shows *how*.
- Wrap every line at 72 characters. If you're unsure, after writing the message run:
  ```bash
  git log -1 --format=%B | awk '{ if (length > 72) print NR": "length" chars: "$0 }'
  ```
  Empty output = all lines ≤ 72. Anything printed = re-wrap and amend.
- Reference issues with `Closes #N` (for fixes that close the issue) or `Part of #N` (for partial progress; `Relates to #N` only for a loose association). Place these before the trailers. Run `gh issue list --search "<keyword>"` if unsure whether a relevant issue exists.

**Trailers:**

- `-s` produces the `Signed-off-by:` line — this is the DCO trailer (a CI gate). Never skip it.
- `Co-Authored-By: <model name> <noreply@anthropic.com>` — **only for commits written with AI assistance**, never by default. Use the human-readable model name from your current environment's system prompt (e.g. "Claude Opus 4.8"); don't hardcode an older version. Omit this trailer entirely for commits a human wrote.

### 7. Verify the commit landed correctly

Immediately after each commit:

```bash
git log -1 --format=%B
```

Check by eye:

- Title is imperative and ≤72 chars
- Every body line is ≤72 chars (run the `awk` check above if uncertain)
- `Signed-off-by: <real name> <email>` trailer is present
- `Co-Authored-By: ...` trailer is present **only if** the commit was AI-assisted

If anything's off and the commit hasn't been pushed yet, undo with `git reset --soft HEAD~1`, fix, and recommit fresh — don't `--amend` silently (per repo policy, prefer new commits to amends). If the commit was already pushed, ask the user before rewriting — except inside `/pr-create` § "Babysit the PR until it is mergeable", where rewriting the loop's own pushed commits is its normal operation (see the carve-out there).

### 8. Push

Before pushing, run `npm run test:e2e:smoke` — it stands up the isolated
test stack and seeds its fixture automatically, then runs the Playwright
smoke specs. This is the before-pushing tier from `CLAUDE.md`'s Mandatory
Pre-Commit Checks, alongside `npm run security:all` and — when the change
touches what the browser loads or draws (a dependency, a route, a layout, a
hot endpoint) — `npm run perf:local`, which measures the production build
on the dev stack's own data; all three assume Docker and minutes of
runtime, which is why they aren't part of step 4's per-commit gates.

After all commits are created and verified:

```bash
git push -u origin <branch-name>
```

If the branch is new, this sets up tracking. If pushing to an existing branch, a regular `git push` suffices. If the branch was rebased, use `git push --force-with-lease` (never bare `--force`; and nothing that refreshes `origin/<branch>` beforehand — a refspec-less `git fetch origin` or a bare `git pull` blinds the lease, see `/pr-create` § 8) and confirm with the user first if the branch already has a PR with reviewers — except inside `/pr-create` § Babysit, whose loop pushes its own amends as part of answering that PR's review (see the carve-out there).

### 9. Summary

Report to the user:

- Branch name
- Number of commits created (with short titles)
- Pre-commit gate results (which gates ran, anything noteworthy)
- Any files that were **skipped** (junk, secrets, host-specific) and why
- Any uncommitted changes that remain (files you chose not to commit)
- Remind the user if leftover changes suggest a separate branch
