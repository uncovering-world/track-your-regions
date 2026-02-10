# Amend PR Review Fixes into Original Commits

Rework the branch history so that fixes made in response to PR review comments are folded into the original commits that introduced the code, rather than appearing as separate "address review" commits.

## Arguments

$ARGUMENTS — optional: base branch (default: `main`).

## Prerequisites

- All review fixes should already be committed (as one or more recent commits)
- Working tree must be clean (`git status` shows no uncommitted changes)
- The branch should NOT have been force-pushed yet after the review fixes

## Instructions

### 1. Assess the situation

```bash
# Verify clean working tree
git status

# List all commits on this branch (since diverging from base)
git log --oneline {base}..HEAD

# Show which files each commit touched
git log --stat --oneline {base}..HEAD
```

Identify:
- **Original commits** — the commits that were part of the PR before the review
- **Fix commits** — the recent commits that address review comments
- If there's only one original commit, this simplifies to a single amend

### 2. Map fixes to original commits

For each fix commit, determine which original commit it should be folded into:

- **By file overlap** — if a fix modifies `regionAssignmentService.ts` and only one original commit touched that file, it belongs there
- **By logical grouping** — if a fix spans multiple files (e.g., updating a comment + related code), find the original commit that introduced that code
- **Ambiguous cases** — if a fix could belong to multiple commits, prefer the commit that introduced the specific lines being modified. Use `git log -p {base}..HEAD -- {file}` to check

Present the mapping to the user:

```
### Fix → Original Commit Mapping

| Fix commit | Fix description | → Target commit | Reason |
|-----------|----------------|-----------------|--------|
| abc1234 | Add && spatial pre-filter | def5678 (Add experience system) | Modifies regionAssignmentService.ts introduced in that commit |
| abc1235 | Fix NOWAIT comment | def5679 (Add World View Editor) | Modifies helpers.ts introduced in that commit |
...
```

**Ask the user to confirm the mapping before proceeding.**

### 3. Create fixup commits

For each fix commit, create a `fixup!` commit that targets the original:

```bash
# Get the subject line of the target original commit
TARGET_SUBJECT=$(git log --format=%s -1 {target_sha})

# Create a fixup commit
# Method: soft-reset the fix commit and recommit as fixup
git commit --fixup={target_sha}
```

If the fix commits are already committed, the approach is:
1. Note the target SHAs for each fix
2. Use interactive rebase with `--autosquash` to fold them in

**Concrete steps:**

```bash
# For each fix commit that should be folded into an original commit:
# Mark it as a fixup by renaming it
git rebase -i {base}
# In the todo list, move each fix commit right after its target and change 'pick' to 'fixup'
```

Since interactive rebase requires manual editing, instead use `--autosquash`:

```bash
# First, for each fix commit, create a new fixup commit pointing to the target
# Then run:
git rebase --autosquash {base}
```

### 4. Execute the rebase

The safest approach:

1. **Create a backup branch** before rewriting:
   ```bash
   git branch backup/{branch-name} HEAD
   ```

2. **Reorder and squash** using `--autosquash`:
   ```bash
   git rebase --autosquash {base}
   ```

3. **If conflicts arise**, resolve them and continue:
   ```bash
   git rebase --continue
   ```

4. **Verify the result**:
   ```bash
   # Check the final diff matches what we had before rebase
   git diff backup/{branch-name}..HEAD  # Should be empty

   # Review the cleaned-up history
   git log --oneline {base}..HEAD
   ```

### 5. Handle edge cases

- **Single original commit**: Just `git reset --soft HEAD~{n}` where n = number of fix commits, then `git commit --amend --no-edit`
- **Fix applies to multiple original commits**: Split the fix and create separate fixup commits for each target
- **CI/config changes** (e.g., `.github/workflows/ci.yml`): If no original commit clearly owns this file, ask the user which commit to fold it into, or keep it as a separate commit
- **New files created by fixes**: Fold into the commit that would logically have included them

### 6. Clean up

After successful rebase:
- Delete the backup branch: `git branch -d backup/{branch-name}`
- Show the final commit history: `git log --oneline {base}..HEAD`
- Remind the user they need to **force-push**: `git push --force-with-lease`
- **Do NOT force-push automatically** — always let the user do it

### 7. Abort safety

If anything goes wrong during rebase:
```bash
git rebase --abort
git checkout {branch-name}
# The backup branch is still intact
```

Tell the user the backup branch exists and how to restore from it.
