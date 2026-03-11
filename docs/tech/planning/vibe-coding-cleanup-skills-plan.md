# Vibe-Coding Cleanup Skills Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Create four slash commands (`/vibe-cleanup`, `/vibe-compliance`, `/vibe-history`, `/vibe-ship`) that transform a messy vibe-coded working tree into proper branches, commits, and PRs.

**Architecture:** All four are project commands in `.claude/commands/`. The first three are written generically (no project-specific references) for easy reuse across projects. The orchestrator (`/vibe-ship`) adds project-specific hooks (pre-commit checks, doc structure). Design doc: `docs/tech/planning/vibe-coding-cleanup-skills.md`.

**Tech Stack:** Markdown command files, git operations, parallel subagents for scanning.

---

### Task 1: Create vibe-cleanup command

**Files:**
- Create: `.claude/commands/vibe-cleanup.md`

**Step 1: Write the command file**

Create `.claude/commands/vibe-cleanup.md` — a command that scans a dirty working tree for debug artifacts, dead code, and structural issues. The command has these sections:

1. **Snapshot** — `git diff --stat` and `git status` to catalog changed/new files
2. **Scan categories** — parallel subagents scanning for:
   - Debug artifacts: console.log/debug, debugger statements, hardcoded test values, TODO/HACK/FIXME/TEMP/XXX comments, commented-out code blocks (2+ consecutive lines)
   - Dead code: unused imports, unreferenced functions/variables/types, orphaned files, unused package.json dependencies
   - Structural issues: files over 500 lines, duplicated logic in 2+ places, inline code duplicating shared utils, missing barrel exports
3. **Report** — findings grouped by category with file:line refs, severity (auto-fix vs needs-judgment)
4. **Fix with approval** — user chooses batch auto-fix, review each, or category-by-category. Judgment items shown individually.
5. **Verify** — run `npm run check` until clean
6. **Summary** — counts per category, suggest `/vibe-compliance` or `/vibe-ship` as next step

Key constraint: only cleans code, does NOT create commits, branches, or update docs.

See the design doc for full details on each scan category.

**Step 2: Verify** — `ls -la .claude/commands/vibe-cleanup.md`

**Step 3: Commit** — `git add .claude/commands/vibe-cleanup.md` then commit with message "Add /vibe-cleanup command for post-vibe-coding cleanup"

---

### Task 2: Create vibe-compliance command

**Files:**
- Create: `.claude/commands/vibe-compliance.md`

**Step 1: Write the command file**

Create `.claude/commands/vibe-compliance.md` — a command that verifies changed code follows project guidelines by reading actual docs and checking against them. Sections:

1. **Identify scope** — `git diff --stat` against base branch, classify files by area (backend controller/service/route, frontend component/hook/utility, etc.)
2. **Load relevant docs** — use CLAUDE.md "Required Reading by Area" table. Always read: development-guide.md, SECURITY.md, CLAUDE.md
3. **Check per-file compliance** (parallel subagents per area):
   - Code conventions: file size limits, barrel exports, co-location, naming, hook extraction threshold
   - Security: parameterized queries, Zod schemas, auth middleware, no secrets, XSS prevention
   - Patterns: shared component/util usage, error handling, API response formats, hook patterns
   - Reuse: flag code duplicating existing shared abstractions
   - Architecture: check against ADRs in docs/decisions/
4. **Documentation gap analysis** — for each changed area check: vision.md needed? tech doc needed? security doc needed? ADR needed? shared-frontend-patterns.md needed?
5. **Report** — violations (blocking), doc gaps (blocking), reuse opportunities (advisory), ADR candidates (advisory)
6. **Fix with approval** — code violations with proposed fixes, doc gaps with drafted updates, reuse opportunities with the shared alternative
7. **Verify** — run full pre-commit suite: `npm run check`, `npm run knip`, `npm run security:all`, `TEST_REPORT_LOCAL=1 npm test`, plus `/security-check`
8. **Summary** — counts, suggest `/vibe-history` or `/vibe-ship` as next step

Key constraint: checks and fixes compliance but does NOT touch commit history or branching.

**Step 2: Verify** — `ls -la .claude/commands/vibe-compliance.md`

**Step 3: Commit** — `git add .claude/commands/vibe-compliance.md` then commit with message "Add /vibe-compliance command for guidelines verification"

---

### Task 3: Create vibe-history command

**Files:**
- Create: `.claude/commands/vibe-history.md`

**Step 1: Write the command file**

Create `.claude/commands/vibe-history.md` — a command that analyzes a large diff and transforms it into clean branches, commits, and PRs. Sections:

1. **Safety checkpoint** — create backup branch (`backup/vibe-history-YYYYMMDD-HHMM`), stash uncommitted changes, create patch file. Print all refs. Confirm with user before proceeding.
2. **Analyze the full diff** — `git diff main --stat`, `--name-status`, `git log main..HEAD`. Read every changed file's diff. Note what feature/fix/refactor each change belongs to, its layer (backend/frontend/db/docs), and dependencies on other changes.
3. **Identify logical units** — group into branches, each self-contained (compiles alone), single-purpose, dependency-ordered. Handle cross-cutting files via either a shared infrastructure branch or primary-feature assignment.
4. **Propose the plan** — for each branch: name, description, files included, commits planned, dependencies. Plus merge order and flagged items. Wait for user approval.
5. **Execute branch-by-branch** (sequential):
   a. Create branch from main or dependency branch
   b. Apply relevant changes (whole files or partial hunks)
   c. Structure into atomic commits (imperative title, body with what/why, granular by layer, docs separate, signed)
   d. Verify: `npm run check` must pass
   e. Push and create PR (short title, summary bullets, test plan, references to related PRs)
6. **Final verification** — diff between combined branch state and backup should be empty (nothing lost guarantee)
7. **Summary** — list of branches/PRs with URLs, merge order, backup branch name, next steps

Precondition: code should already be cleaned up and compliant. This command does NOT fix code.

**Step 2: Verify** — `ls -la .claude/commands/vibe-history.md`

**Step 3: Commit** — `git add .claude/commands/vibe-history.md` then commit with message "Add /vibe-history command for commit history restructuring"

---

### Task 4: Create vibe-ship orchestrator command

**Files:**
- Create: `.claude/commands/vibe-ship.md`

**Step 1: Write the command file**

Create `.claude/commands/vibe-ship.md` — the project-specific orchestrator that chains all three commands with safety backups and approval gates. Sections:

**Phase 0: Safety and Orientation**
- Show current state: `git status`, `git diff --stat`, `git log --oneline -20`
- Summary: files changed, uncommitted vs committed, areas affected
- Create initial backup: `backup/vibe-ship-start-YYYYMMDD-HHMM` branch + stash
- Print backup refs, confirm with user

**Phase 1: Cleanup**
- Invoke `/vibe-cleanup`
- GATE: "Phase 1 complete — code is cleaned up. Proceed to Phase 2?"

**Phase 2: Compliance**
- Invoke `/vibe-compliance`
- This runs the project's mandatory pre-commit checks: `npm run check`, `npm run knip`, `npm run security:all`, `TEST_REPORT_LOCAL=1 npm test`, `/security-check`
- GATE: "Phase 2 complete — code is compliant and all checks pass. Proceed to Phase 3?"

**Phase 3: History**
- Create second backup: `backup/vibe-ship-pre-history-YYYYMMDD-HHMM`
- Invoke `/vibe-history`
- Branch creation, PRs, nothing-lost verification

**Summary**: cleanup results, compliance results, history results (branches/PRs with URLs), merge order, both backup branch names with note to delete after PRs merged.

**Step 2: Verify** — `ls -la .claude/commands/vibe-ship.md`

**Step 3: Commit** — `git add .claude/commands/vibe-ship.md` then commit with message "Add /vibe-ship orchestrator for full cleanup pipeline"

---

### Task 5: Update planning doc status

**Files:**
- Modify: `docs/tech/planning/vibe-coding-cleanup-skills.md`

**Step 1:** Change the status at the top from "Design complete, ready for implementation planning" to "Implemented". Add a note about the location change: all four commands live in `.claude/commands/` since Claude Code discovers project commands but not user skill directories.

**Step 2: Commit** — `git add docs/tech/planning/vibe-coding-cleanup-skills.md` then commit with message "Update vibe-coding cleanup design doc status"

---

### Task 6: Test the pipeline with a dry run

**Step 1: Verify all commands are discoverable**

```bash
ls -la .claude/commands/vibe-*.md
```

Expected: four files.

**Step 2: Smoke test each command**

Invoke each command briefly to verify it loads and the instructions make sense. Don't run the full pipeline.

**Step 3: Fix any issues**

If instructions are ambiguous or missing steps, fix and amend into the corresponding commit from Tasks 1-4.
