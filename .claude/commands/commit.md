# Commit Changes

Review uncommitted changes, organize them into atomic commits on an appropriate branch, and push.

## Arguments

$ARGUMENTS — optional: branch name or short description of the change. If not provided, infer from the changes.

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
- **If on main or on a clean feature branch with no relation to the changes**: create a new branch. Use a descriptive kebab-case name (e.g., `fix-auth-token-refresh`, `add-region-export`). If $ARGUMENTS provides a name or hint, use that.

### 3. Filter out junk

Review every changed file. **Do NOT stage** any of the following:
- `.env`, `.env.*` files or anything with secrets/credentials
- Files with hardcoded local paths, hostnames, ports specific to your machine
- IDE/editor config (`.idea/`, `.vscode/settings.json`, etc.) unless they're already tracked
- OS files (`.DS_Store`, `Thumbs.db`)
- Build artifacts, `node_modules/`, `dist/`, `.cache/`
- Log files, temporary files, debug output
- Any file that contains private data (API keys, tokens, personal info)

If you find suspicious files, **skip them** and mention it in the summary.

### 4. Group changes into atomic commits

Analyze the staged-worthy changes and group them by purpose. Each commit should contain **only** changes that belong together:

- A bug fix is one commit — don't mix in unrelated refactoring
- A new feature is one commit (or a small series if it has distinct layers: schema, backend, frontend)
- Documentation updates related to a code change go in the **same commit** as the code
- Unrelated documentation fixes get their own commit
- Config changes get their own commit unless directly tied to a feature

**Do NOT create a commit that mixes unrelated changes.** If changes span multiple unrelated topics, they need separate commits (and potentially separate branches — see step 2).

### 5. Create commits

For each atomic group, stage the specific files and commit:

```bash
git add <file1> <file2> ...
git commit -s -m "$(cat <<'EOF'
<title: imperative, under 72 chars>

<body: explain what changed and why, wrap at 72 chars>

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

Rules for commit messages:
- **Title**: imperative mood ("Add X", "Fix Y", "Update Z"), max 72 characters
- **Body**: explain _what_ changed and _why_ (not just _how_). Provide enough context that someone reading `git log` understands the motivation
- **Related issues**: if the change addresses or relates to a GitHub issue, include `Closes #N` or `Relates to #N` in the commit body (before the trailers). Search open issues with `gh issue list` if unsure whether a relevant issue exists
- **Always** use `-s` (sign-off: Developer Certificate of Origin)
- **Always** include the `Co-Authored-By` trailer

### 6. Push

After all commits are created:
```bash
git push -u origin <branch-name>
```

If the branch is new, this sets up tracking. If pushing to an existing branch, a regular `git push` suffices.

### 7. Summary

Report:
- Branch name
- Number of commits created (with short titles)
- Any files that were **skipped** (junk, secrets, host-specific) and why
- Any uncommitted changes that remain (files you chose not to commit)
- Remind the user if there are leftover changes that might need a separate branch
