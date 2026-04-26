# Ship Vibe-Coded Work

Full pipeline to transform a messy vibe-coded working tree into proper branches, commits, and PRs. Chains three phases — cleanup, compliance, history — with safety backups and approval gates between each.

Use this after a vibe-coding session when you have a mix of messy commits and uncommitted changes that need to become a proper commit history.

## Prerequisites

Read `docs/tech/development-guide.md` and `CLAUDE.md` — all conventions apply throughout this pipeline.

## Instructions

### Phase 0: Safety & Orientation

Show the current state:

```bash
git status
git diff --stat
git log --oneline -20
```

Present a summary: how many files changed, uncommitted vs committed changes, which areas affected (backend, frontend, database, docs).

Create the initial safety backup:

```bash
git branch backup/vibe-ship-start-$(date +%Y%m%d-%H%M)
```

If there are uncommitted changes, snapshot them onto the backup branch before
proceeding (the working tree must stay populated so the pipeline can analyze
it). Use a WIP commit on the backup branch rather than `git stash pop` —
`stash pop` removes the entry from `refs/stash` and recovery would require
forensic-level `git fsck --unreachable` work:
```bash
git stash push -m "vibe-ship initial backup $(date +%Y%m%d-%H%M)"
STASH_REF=$(git rev-parse stash@{0})
git checkout backup/vibe-ship-start-$(date +%Y%m%d-%H%M)
git stash apply --index "$STASH_REF"
git add -A && git commit -m "vibe-ship: WIP snapshot before cleanup"
git checkout -
git stash pop --quiet 2>/dev/null || true
```

Print all backup references (the branch name and the stash ref if uncommitted
changes existed) and confirm: **"Ready to start the cleanup pipeline? This
will modify your working tree in three phases, with approval gates between
each."**

---

### Phase 1: Cleanup

Invoke `/vibe-cleanup` to scan and fix:
- Debug artifacts (console.log, debugger, TODO hacks)
- Dead code (unused imports, orphaned files)
- Structural issues (oversized files, duplicated logic)

After cleanup completes, confirm with user: **"Phase 1 complete — code is cleaned up. Proceed to Phase 2 (compliance check)?"**

---

### Phase 2: Compliance

Invoke `/vibe-compliance` to verify and fix:
- Code convention compliance (file sizes, barrel exports, naming)
- Security standards (parameterized queries, input validation, auth middleware)
- Pattern compliance (shared components, hook extraction, error handling)
- Documentation gaps (vision.md, tech docs, security docs, ADRs)

This phase includes the full pre-commit verification suite:
```bash
npm run check
npm run knip
npm run security:all
TEST_REPORT_LOCAL=1 npm test
```

Plus `/security-check` for Claude Code security review.

After compliance completes and all checks pass, confirm with user: **"Phase 2 complete — code is compliant and all checks pass. Proceed to Phase 3 (commit history)?"**

---

### Phase 3: History

Invoke `/vibe-history` which will:
- Analyze the full diff (read-only — no git modifications yet)
- Propose branch plan for user approval
- **Only after approval**: create safety backup `backup/vibe-ship-pre-history-YYYYMMDD-HHMM`, then execute branch creation
- Create branches with atomic commits following project conventions
- Push and create PRs
- Verify nothing was lost

---

### Summary

After all phases complete, present the final report:

**Cleanup results:**
- Issues found and fixed per category

**Compliance results:**
- Violations found and fixed
- Documentation updates made
- Verification suite status

**History results:**
- Branches and PRs created (with URLs)
- Suggested merge order

**Backups:**
- Initial backup: `backup/vibe-ship-start-YYYYMMDD-HHMM`
- Pre-history backup: `backup/vibe-ship-pre-history-YYYYMMDD-HHMM`
- "Safe to delete these backup branches after all PRs are merged and verified."
