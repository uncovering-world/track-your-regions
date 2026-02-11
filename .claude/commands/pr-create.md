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
git fetch origin  # update ALL remote tracking refs (needed for --force-with-lease)
git fetch origin main:main  # fast-forward local main
```

If the working tree is dirty, stash before switching branches:
```bash
git stash --include-untracked  # if needed
```

For each branch:
```bash
git checkout <branch>
git rebase main
git push --force-with-lease
```

After rebase, check if the branch still has commits ahead of main:
```bash
git log main..<branch> --oneline
```

If empty (all commits were already in main), **skip this branch** — report it as "already merged" and do not attempt to create a PR.

If rebase has conflicts, stop and report them to the user — do not force through.

After all rebases, restore the stash if one was created and return to the original branch.

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
- If commit messages reference issues, include them with `Closes #N` or `Relates to #N`
- Also search open issues for matches: `gh issue list --state open --json number,title` — look for issues related to the branch's changes by title/keyword
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

### 6. Report results

For each PR created, show:
- PR number and URL
- Title
- Brief note on what was included

If multiple PRs were created, show a summary table at the end.
