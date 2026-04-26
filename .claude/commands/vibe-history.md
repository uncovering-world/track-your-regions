# Create Proper Commit History

Analyze a large diff and transform it into clean git history with proper feature branches, atomic commits, and PRs.

**Precondition:** Code should already be cleaned up and compliant. This command does NOT fix code — it only organizes it into git history. Run `/vibe-cleanup` and `/vibe-compliance` first (or use `/vibe-ship` for the full pipeline).

**Critical rule:** The planning phase (steps 1-4) is entirely READ-ONLY. Do NOT create branches, stash changes, switch branches, or modify the working tree in any way until the user has approved the plan. The current code may be running in production.

## Prerequisites

Read the project's commit conventions:
- `docs/tech/development-guide.md` — commit format, branch naming, granularity rules
- `CLAUDE.md` — commit and PR conventions

## Instructions

### 1. Analyze the full diff (read-only)

Compare current state against the base branch (usually `main`) using only read-only git commands:

```bash
git fetch origin main
git diff origin/main --stat
git diff origin/main --name-status
git log origin/main..HEAD --oneline
```

Read every changed file's diff to understand WHAT each change does. For each file, note:
- What feature/fix/refactor it belongs to
- Whether it's backend, frontend, database, docs, or config
- Dependencies on other changes (does it use a function added in another file?)

**Do NOT run any commands that modify the working tree, index, or branches.**

### 2. Identify logical units

Group changes into coherent branches. Each branch must be:
- **Self-contained**: Compiles and tests pass with just those changes applied to main
- **Single-purpose**: One feature, one fix, or one refactor
- **Dependency-ordered**: If branch B uses code from branch A, A must be created first

Common groupings:
- Backend API endpoint + its route + validation schemas
- Frontend component + its hook + its API integration
- Database schema change + backend migration code
- Refactoring of shared utilities (often a prerequisite branch)
- Documentation updates (can be a separate branch or included per-feature)

**Handle cross-cutting files carefully:** When multiple features modify the same file:
1. Create a "shared infrastructure" branch that goes first, containing the shared file changes
2. Or assign the file to the primary feature and have other branches build on top

### 3. Propose the plan

Present to the user:

**Branch list** (in dependency/merge order):

For each branch:
- Branch name (e.g., `feature/add-hull-editor`, `refactor/shared-image-utils`)
- One-line description
- Files included (list each file)
- Commits it will contain (e.g., "1. Add backend endpoint, 2. Add frontend hook, 3. Wire up UI, 4. Update docs")
- Dependencies (which branches must exist/merge first)
- Any cross-cutting concerns or tricky splits

**Merge order:** Which branch merges to main first, second, etc.

**Flagged items:** Changes that don't fit cleanly anywhere — ask the user where they belong.

**Wait for user approval and adjustments before proceeding.** Nothing has been modified yet — the user can safely cancel at this point.

### 4. Safety checkpoint

**Only after the user approves the plan**, create safety nets before any git modifications:

```bash
# Backup branch capturing current state
git branch backup/vibe-history-$(date +%Y%m%d-%H%M)

# Stash any uncommitted changes
git stash push -m "vibe-history backup $(date +%Y%m%d-%H%M)"

# Patch file as last resort
git diff origin/main > /tmp/vibe-history-backup-$(date +%Y%m%d-%H%M).patch
```

Print all backup references so the user knows exactly how to restore:
- Backup branch name
- Stash reference (if changes were stashed)
- Patch file path

Confirm: **"Safety backups created. Starting branch creation now."**

### 5. Execute branch-by-branch

For each branch in dependency order:

**a. Create the branch:**
```bash
git checkout main  # or the dependency branch
git checkout -b <branch-name>
```

**b. Apply relevant changes:**
Cherry-pick the specific files/hunks that belong to this branch. Use `git checkout <source> -- <file>` for whole files or manual editing for partial file changes.

**c. Structure into atomic commits:**
Follow the project's commit conventions:
- Imperative mood title, max 72 characters
- Body explains "what" and "why"
- Granular by layer: backend, frontend, docs as separate commits
- Documentation in dedicated commits
- Sign all commits (`-s` flag)
- Add `Co-Authored-By: Claude <noreply@anthropic.com>` trailer (substitute the actual model name at runtime, e.g. `Claude Sonnet 4.6`)

**d. Verify the branch:**
```bash
npm run check
```
Must pass — the branch must compile on its own. If it fails because the branch depends on another branch's changes, that signals the grouping or dependency order is wrong. Fix it.

**e. Push and create PR:**
```bash
git push -u origin <branch-name>
```

Create a PR with:
- Short title (under 70 characters)
- Summary section with 1-3 bullet points
- Test plan
- Reference to related PRs in the chain (if applicable)

### 6. Final verification — nothing lost

After all branches are created, verify the combined changes equal the original diff:

```bash
git diff backup/vibe-history-YYYYMMDD-HHMM
```

The diff should be empty (or only contain expected ordering differences). If changes were lost, identify what's missing and fix it.

### 7. Summary

Report:
- List of branches and PRs created (with URLs)
- Merge order
- Any items that couldn't be cleanly split
- Backup branch name (can be deleted once all PRs are merged)
- Suggested next steps: "Review each PR, merge in the suggested order"
