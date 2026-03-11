# Vibe-Coding Cleanup Skills — Design

**Status**: Implemented. All four commands live in `.claude/commands/` (not `~/.claude/skills/` as originally planned — Claude Code discovers project commands but not user skill directories).

## Context

After a week of vibe-coding, the working tree has a mix of messy commits and uncommitted changes spanning what should be multiple feature branches. These skills clean up the mess and produce a proper commit history with branches and PRs.

## Architecture

Three personal skills in `~/.claude/skills/` (generic, reusable) + one project orchestrator `/vibe-ship` in `.claude/commands/`.

| Skill | Location | Purpose |
|-------|----------|---------|
| `/vibe-cleanup` | `.claude/commands/vibe-cleanup.md` | Remove debug artifacts, dead code, structural issues |
| `/vibe-compliance` | `.claude/commands/vibe-compliance.md` | Verify code follows project guidelines and conventions |
| `/vibe-history` | `.claude/commands/vibe-history.md` | Create proper branches, commits, and PRs from a clean diff |
| `/vibe-ship` | `.claude/commands/vibe-ship.md` | Project orchestrator chaining all three with approval gates |

## Skill 1: vibe-cleanup

**Purpose**: Scan a dirty working tree and systematically clean up vibe-coding leftovers.

**Triggering condition**: Use when you have a messy working tree from rapid prototyping and need to clean up before proper commits.

**Process**:

1. **Snapshot** — Run `git diff --stat` and `git status` to catalog all changed/new files
2. **Scan categories** (parallel subagents per category):
   - **Debug artifacts**: `console.log`, `console.debug`, `debugger`, hardcoded test values, `// TODO HACK`, commented-out code blocks
   - **Dead code**: Unused imports, unreferenced functions/components, orphaned files (files that nothing imports)
   - **Structural issues**: Oversized files (>500 lines), duplicated logic across files, inline code that should be in shared utils, missing barrel exports
3. **Report** — Present findings grouped by category with file:line references and severity (auto-fixable vs needs-judgment)
4. **Fix with approval** — For each category, propose fixes and get user approval before applying. Auto-fixable items (unused imports, console.logs) can be batch-applied. Judgment items (extract to shared util, split file) presented individually.
5. **Verify** — Run linter + typecheck after cleanup to confirm nothing broke

**Key constraint**: This skill only *cleans* — it does NOT restructure commits, create branches, update docs, or check security. It leaves the working tree cleaner but still uncommitted.

**Scope boundary**: Security issues (hardcoded secrets, SQL injection, missing validation) are NOT checked here — that belongs to vibe-compliance.

## Skill 2: vibe-compliance

**Purpose**: Systematically verify that all changed code follows project guidelines and conventions by reading the actual docs and checking against them.

**Triggering condition**: Use when you have working code that needs to be verified against project standards before committing.

**Process**:

1. **Identify scope** — `git diff --stat` to get all changed/new files. Classify each file by area (backend controller, frontend component, route, service, hook, etc.)
2. **Load relevant docs** — For each area touched, read the corresponding docs from CLAUDE.md's "Required Reading by Area" table. Also always read:
   - `docs/tech/development-guide.md` (universal conventions)
   - `docs/security/SECURITY.md` (security rules)
   - `CLAUDE.md` itself (Skill Integration Rules, Security Standards)
3. **Check per-file compliance** (parallel subagents per area):
   - **Code conventions**: File size limits, barrel exports, co-location rules, naming patterns
   - **Security**: Parameterized queries, input validation (Zod schemas), auth middleware, no exposed secrets, XSS prevention
   - **Patterns**: Correct use of shared components/utils (checking against `shared-frontend-patterns.md`), proper hook extraction, error handling
   - **Reuse**: Flag any code that duplicates existing shared utilities or components
   - **Architecture**: Check against existing ADRs in `docs/decisions/`
4. **Documentation gap analysis** — For each changed area, check if the corresponding docs need updating:
   - New/changed user-facing behavior → needs `vision.md` update?
   - New endpoint or API change → needs tech doc update?
   - Security-relevant change → needs security doc update?
   - Architectural choice → needs an ADR?
5. **Report** — Compliance report with:
   - **Violations**: What breaks a rule, with the specific doc reference and file:line
   - **Doc gaps**: Missing documentation updates
   - **Reuse opportunities**: Where shared code should be used instead of inline
   - Severity: blocking (must fix) vs advisory (should fix)
6. **Fix with approval** — Walk through violations, fix each with user approval. For doc gaps, draft the doc updates.
7. **Verify** — Run full pre-commit suite: lint + typecheck, knip, security scan, tests

**Key constraint**: This skill checks and fixes compliance but does NOT touch commit history or branching. It works on the current working tree state.

## Skill 3: vibe-history

**Purpose**: Analyze a large, messy diff and transform it into a clean git history with proper feature branches, atomic commits, and PRs.

**Triggering condition**: Use when you have a clean working tree (code reviewed, tests passing) that needs to be structured into proper branches and commits.

**Precondition**: Code should already be cleaned up and compliant (skills 1 and 2 done). This skill does NOT fix code — it only organizes it into git history.

**Process**:

1. **Safety checkpoint** — Before any destructive git operations:
   - Create backup branch: `backup/vibe-ship-pre-history-YYYY-MM-DD-HHMM`
   - Create git stash of uncommitted changes: `git stash push -m "vibe-ship pre-history backup"`
   - Create patch file: `git diff main > /tmp/vibe-ship-backup.patch`
   - Print all backup refs so the user knows how to restore
2. **Analyze the full diff** — Compare current state against the base branch (usually `main`). Catalog every change: new files, modified files, deleted files. Read each diff hunk to understand what it does.
3. **Identify logical units** — Group changes into coherent features/fixes/refactors. Each unit should be:
   - **Self-contained**: The branch compiles and tests pass with just those changes
   - **Single-purpose**: One feature, one fix, or one refactor per branch
   - **Dependency-ordered**: If feature B depends on feature A's code, A goes first
   - Examples: "Add new API endpoint for X", "Refactor shared utils to support Y", "Fix Z bug in map rendering", "Update docs for W"
4. **Propose the plan** — Present to user:
   - List of branches with names (e.g., `feature/add-hull-editor`, `refactor/shared-image-utils`)
   - For each branch: which files/hunks go in it, what commits it will contain, dependency order
   - Suggested merge order (which branch merges to main first)
   - Flag any changes that don't fit cleanly (cross-cutting concerns, shared modifications)
5. **User approval** — User reviews and adjusts groupings before any git operations
6. **Execute branch-by-branch** (sequential, not parallel):
   - For each branch in dependency order:
     a. Create branch from `main` (or from previous branch if dependent)
     b. Apply only the relevant changes (cherry-pick hunks, not whole files when needed)
     c. Structure into atomic commits following project conventions (imperative title + body, granular by layer, docs in separate commits)
     d. Run verification: `npm run check` at minimum
     e. Push and create PR (title, summary, test plan)
   - After all branches created, verify nothing was lost
7. **Final verification** — Diff between combined branch state and original backup should be empty. All PRs created, all code accounted for, no orphaned changes.

**Key challenges**:
- **Shared file modifications**: When multiple features touch the same file, split hunks not whole files. May need a "shared/infrastructure" branch that goes first.
- **Dependency chains**: Feature B uses a util from feature A → detect and order correctly.
- **Nothing-lost guarantee**: Combined diff of all branches must equal original diff. This is the exit criterion.

## Orchestrator: /vibe-ship

**Purpose**: Chain the three skills with approval gates, safety backups, and project-specific hooks.

**Flow**:

```
Phase 0: Safety & Orientation
├── Show current state (git status, diff stats, commit log)
├── Create safety backup branch: backup/vibe-ship-start-YYYY-MM-DD-HHMM
├── Create git stash as secondary backup
└── GATE: User confirms ready to proceed

Phase 1: Cleanup (invoke vibe-cleanup)
├── Run vibe-cleanup skill
├── Present report
├── User approves fixes
├── Apply fixes
└── GATE: User confirms cleanup is complete

Phase 2: Compliance (invoke vibe-compliance)
├── Run vibe-compliance skill
├── Present compliance report + doc gaps
├── Fix violations + draft doc updates
├── Run full pre-commit suite:
│   - npm run check
│   - npm run knip
│   - npm run security:all
│   - TEST_REPORT_LOCAL=1 npm test
│   - /security-check
└── GATE: User confirms compliance is satisfactory

Phase 3: History (invoke vibe-history)
├── Create second backup: backup/vibe-ship-pre-history-YYYY-MM-DD-HHMM
├── Analyze diff, propose branches + commits
├── GATE: User approves branch plan
├── Execute branch creation + PRs
├── Final "nothing lost" verification
└── Report: list of PRs created, merge order
```

**Dual-backup model**:
- **Phase 0 backup**: Captures the raw vibe-coded state before any changes. Restoring abandons the whole process.
- **Phase 3 backup**: Captures the cleaned + compliant state before history rewriting. Restoring lets you retry just the branch splitting.

**Project-specific hooks** (what makes this a project command):
- Phase 2 runs the project's mandatory pre-commit checks
- Phase 3 uses the project's `/commit` patterns for commit formatting
- Phase 3 uses `/pr-create` patterns for PR creation
- Doc updates reference the project's specific doc structure (`docs/tech/`, `docs/vision/vision.md`, etc.)
