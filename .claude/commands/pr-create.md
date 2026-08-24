# Create Pull Request

Create a pull request for a branch, filling in the PR template based on the actual changes.

## Arguments

$ARGUMENTS — optional: branch name. If not provided, list branches with unmerged commits and ask which to create PRs for.

## Instructions

### 1. Determine which branches to process

If $ARGUMENTS provides a branch name, use that branch.

If no argument, analyze all local branches that don't have an open PR:

```bash
# List local branches with unmerged commits (excluding main)
git branch --no-merged main --format='%(refname:short)'

# List branches that already have open PRs
gh pr list --state open --json headRefName --jq '.[].headRefName'
```

Filter to only local branches without an open PR. For each, gather a quick summary (commits, files changed) and present a table with your recommendation:

```
| # | Branch | Commits | Summary | Recommendation |
|---|--------|---------|---------|----------------|
| 1 | add-feature-x | 3 | New feature X | Create PR |
| 2 | backup/old-stuff | 47 | Old backup branch | Skip (backup) |
```

Recommendations:
- **Create PR** — focused branch with clear purpose
- **Skip (backup)** — branch name suggests it's a backup (`backup/`, `-backup`, `old-`)
- **Skip (stale)** — very old commits with no recent activity
- **Review first** — large diff or unclear purpose, user should decide

Ask the user to confirm which branches to create PRs for.

### 2. Rebase branches on top of main

Before creating PRs, ensure each branch is rebased with fast-forward on top of the latest main:

```bash
git fetch origin main:main  # fast-forward local main — and nothing else: a refspec-less
                            # `git fetch origin` would refresh origin/<branch> too, making
                            # the per-branch lease below vacuous
```

If the working tree is dirty, stash before switching branches:
```bash
git stash --include-untracked  # if needed
```

For each branch:
```bash
git checkout <branch>
git rebase main
git push --force-with-lease    # first push of a new branch: git push -u origin <branch>
```

Rewriting your own branch's history and force-pushing it is this repo's normal flow — `--force-with-lease` is all the protection needed here, *because* the fetch above touched only `main`: the lease compares against your remote-tracking ref, which still holds the last state of the branch you actually saw. A refused push means someone else pushed to the branch — fetch it, read what arrived, fold it in, push again.

After rebase, check if the branch still has commits ahead of main:
```bash
git log main..<branch> --oneline
```

If empty (all commits were already in main), **skip this branch** — report it as "already merged" and do not attempt to create a PR.

If rebase has conflicts, stop and report them to the user — do not force through.

After all rebases, restore the stash if one was created and return to the original branch.

### 2.5 Verify clean branch history (mandatory gate)

The branch history must be clean before a PR: **no commit may exist solely to fix, amend, or "address review" on an earlier commit of the same branch.** Each commit must be self-contained and independently reviewable (see `docs/tech/development-guide.md` § "Granular Commits").

Inspect the subjects and the diffs:

```bash
git log --oneline {base}..HEAD
```

If any commit just patches a previous one on this branch (e.g. "fix typo from <earlier>", "address review", "harden X added two commits ago"), **STOP and fold it into the original** before proceeding — run `/pr-changes-amend`. Only continue to the PR once every commit stands on its own.

Also confirm the before-pushing tier ran on this branch: `npm run test:e2e:smoke` (stands up the isolated test stack and seeds its fixture automatically) alongside `npm run security:all`, and `npm run perf:local` when the change touches what the browser loads or draws, per `CLAUDE.md`'s Mandatory Pre-Commit Checks.

### 3. For each branch, analyze the changes

Switch context to the branch (without checking it out) and gather info:

```bash
# Commits on this branch since diverging from main
git log main..<branch> --oneline
git log main..<branch> --format='%s%n%n%b---'

# Full diff against main
git diff main...<branch> --stat
git diff main...<branch>
```

From this, determine:
- **What changed**: summarize the purpose of the branch's commits
- **Related issues**: look for issue references in commit messages (`#123`, `Closes #123`, etc.)
- **Files changed**: list of modified/added/deleted files
- **Type of change**: feature, bug fix, refactoring, docs, etc.

### 4. Fill in the PR template

Use the project's PR template (`.github/PULL_REQUEST_TEMPLATE.md`) and fill each section:

#### Description
Write a clear summary of what the branch does and why. Derive this from the commit messages and the actual diff — don't just repeat commit titles. Group related changes if there are multiple commits.

#### Related Issues
- If commit messages reference issues, include them with `Closes #N` / `Fixes #N` (the merge closes the issue) or `Part of #N` (partial progress — the issue stays open). Use `Relates to #N` only for a loose association that should not drive the issue's board status.
- Also search open issues for matches: `gh issue list --state open --limit 500 --json number,title` (the default `--limit` is 30, far below this repo's open count) — look for issues related to the branch's changes by title/keyword
- If no issues are referenced and none found, write "None"

#### How Was This Tested?
- If the branch includes test files, mention the tests added/modified
- If it's a config/docs/tooling change that doesn't need tests, say "N/A — configuration/documentation change"
- If it's code without tests, note "Manual testing" or flag that tests are needed

#### Checklist
Fill in the checklist based on actual state:
- Check commit messages: are they well-formatted with title + body?
- Check signatures: `git log main..<branch> --format='%G?'` or look for `Signed-off-by`
- Check for related issues (already gathered above)
- Lint status: run `npm run check` if code files changed, skip for docs-only changes

#### Additional Comments
Add any notable context: migration notes, deployment considerations, or things the reviewer should pay attention to. Leave empty if nothing special.

### 5. Create the PR

```bash
gh pr create --base main --head <branch> --title "<title>" --body "$(cat <<'EOF'
<filled template>
EOF
)"
```

PR title rules:
- Under 70 characters
- Imperative mood ("Add X", "Fix Y", not "Added X" or "Fixes Y")
- Derived from the branch's overall purpose, not just the last commit

### 6. Update the board

For every issue the PR references (`Closes #N` / `Fixes #N` / `Part of #N`), move it to review on the org board:

```bash
scripts/board.sh status <N> "In review"
```

The board update is best-effort: if it fails because the token lacks the `project` scope, run `gh auth refresh -s project` (or note the miss and continue) — it must not block the work itself.

An issue referenced with `Closes`/`Fixes` goes ✅ Done automatically when the merge closes it. A `Part of #N` issue stays open — after the merge, move it back to 📋 Backlog (or 🏗 In progress if its work continues) by hand.

### 7. Report results

For each PR created, show:
- PR number and URL
- Title
- Brief note on what was included

If multiple PRs were created, show a summary table at the end.

### 8. Babysit the PR until it is mergeable

Creating the PR is not the end of the job — an open PR is unfinished work. Stay on it until it is mergeable: checks green, every review thread answered, no conflicts with main. Poll periodically rather than waiting to be asked, and do not move on to other branches while checks are red or reviewers are unanswered. One carve-out: a stacked chain built by `/vibe-history` opens all its PRs first (that command owns the ordering and the nothing-lost verification) and then this loop covers the whole chain together.

**Checks.** `gh pr checks <number>` (add `--watch` to block on them). On a failure, read the actual failing log (`gh run view <run-id> --log-failed`), reproduce locally, and fix. A fix is folded into the commit that owns the broken code — run `/pr-changes-amend` (for a dependent member of a stacked chain, pass its dependency branch as the base: `/pr-changes-amend <dependency-branch>` — the default `main` base would let the mapping reach the root's commits and rewrite them inside the dependent; and when the amended commit belongs to a chain member that itself **has** dependents, create the `fixup!` on the chain's top branch and fold from there with `git rebase --autosquash --update-refs origin/main`, so the rewrite carries into every dependent and all refs move together — then force-push each branch of the chain) — never appended as an "address review" commit; then `git push --force-with-lease` (see "Conflicts and staleness" below for the one rule that keeps that safe). Pushing its own amends unattended is this loop's normal operation (the carve-out is stated in `/pr-changes-amend` and `/commit` too): the branch is under this loop's stewardship, `--force-with-lease` refuses to clobber anything it has not seen, every amend answers a review thread that gets a reply naming the fix, and parking each wave for a manual push would defeat "stay on it until it is mergeable".

**Reviews and comments.** Fetch new review threads as they arrive — `/pr-comments-analyze` collects and classifies them, `/pr-comments-reply` answers them; inside this loop their ask-the-user approval gates are carved out (stated in both files), since an unattended loop cannot wait on them and every reply is anchored to a verified fix or a stated reason. Ground rules, learned the hard way:

- Answer every thread; **do not resolve threads yourself** unless explicitly told to — the commenter resolves. `main` requires conversation resolution, so an ignored thread blocks the merge as surely as a red check. One carve-out: when a bot commenter reports it could not resolve its own thread ("please resolve it manually"), that *is* being told — resolve it yourself and say so in the reply.
- Read a bot reviewer's *verdict*, not just its finding list — and verify each claim against the code (grep for the claim, not the cited line number; lines drift) before agreeing or pushing back.
- When a finding is real, look for its symmetric twin — the same bug in the mirrored code path — and fix both; then expect second-order breakage from the fix and re-run the affected tests.
- A declined finding gets a reply with the concrete reason, never silence.

**Conflicts and staleness.** If main moves ahead, rebase — the repo is rebase-only, no merge commits:

```bash
git fetch origin main && git rebase origin/main
git push --force-with-lease
```

One rule keeps the bare lease sound: **never refresh `origin/<branch>` inside the loop** — that means no refspec-less `git fetch origin` and no bare `git pull` (it runs exactly that fetch); fetch `main` (or another specific ref) by name. The lease compares against your remote-tracking ref, i.e. the last state of the branch you actually saw; a full fetch would silently mark a reviewer's or the maintainer's fresh push as "seen" and let the next force-push clobber it. With the fetch scoped, a third-party push simply makes the push refuse — fetch the branch, read what arrived, fold it in, push again.

A **stacked chain** (dependents' PR bases are their dependency branches, per `/vibe-history` step 5e) does not use the recipe above branch-by-branch: rebasing a dependent onto `origin/main` would balloon its PR with main's and the root's commits, and hand-running `--onto` needs pre-rebase tips that the root's rebase destroys. Rebase the whole stack in one move from its top instead: `git checkout <top-branch> && git rebase --update-refs origin/main` — `--update-refs` moves every intermediate branch ref with it, no remembered shas — then force-push each branch of the chain (`--force-with-lease`, same scoped-fetch rule). Re-run whatever gates the rebase could have invalidated.

**Done.** The loop ends when the PR reports mergeable and all reviews are addressed. Auto-merge is disabled on this repo — the maintainer presses the button; report the final state rather than merging.
