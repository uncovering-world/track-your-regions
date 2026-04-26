# Check Guidelines Compliance

Verify that all changed code follows project guidelines and conventions by reading the actual docs and checking against them. Fix violations and fill documentation gaps.

This command checks compliance but does NOT touch commit history or branching.

## Prerequisites

Read `CLAUDE.md` to understand the project's documentation structure, required reading areas, and security standards.

## Instructions

### 1. Identify scope

Run `git fetch origin main && git diff origin/main --stat` to get all changed and new files. Classify each file by area:
- Backend controller, service, route, middleware
- Frontend component, hook, utility, API layer
- Database schema, migration
- Configuration, documentation

### 2. Load relevant documentation

For each area touched, read the corresponding docs. Use the "Required Reading by Area" table in `CLAUDE.md` to determine which docs apply. **Always** read:
- `docs/tech/development-guide.md` (universal code conventions)
- `docs/security/SECURITY.md` (security rules)
- `CLAUDE.md` (Skill Integration Rules, Security Standards)

Read **all** area-specific docs that apply — most changes touch 2-3 areas.

### 3. Check per-file compliance

Dispatch parallel subagents, one per area. Each subagent reads the area docs and checks every changed file in that area against them. Check for:

**Code conventions:**
- File size limits (controllers 100-600 lines, components similar)
- Barrel exports for controller directories (`index.ts`)
- Co-location of hooks and types near their components
- Naming patterns (kebab-case files, PascalCase components, camelCase functions)
- Hook extraction (3+ useState in a component should be extracted to a hook)

**Security:**
- Parameterized queries (never string concatenation in SQL)
- Input validation (Zod schemas for all new endpoints)
- Auth middleware on protected routes (`requireAuth`, `requireAdmin`, `requireCurator`)
- No hardcoded secrets, API keys, or credentials
- No rendering of unsanitized user-generated content
- CSRF protection on state-changing endpoints

**Patterns:**
- Correct use of shared components and utilities (check against `docs/tech/shared-frontend-patterns.md`)
- Proper error handling patterns
- Consistent API response formats
- Correct hook usage (TanStack Query patterns, context usage)

**Reuse:**
- Flag code that duplicates existing shared utilities or components
- Flag inline implementations of patterns that have shared abstractions

**Architecture:**
- Check against existing ADRs in `docs/decisions/`
- Flag any architectural choices that should have an ADR but don't

### 4. Documentation gap analysis

For each changed area, check if docs need updating:
- New or changed user-facing behavior → needs `docs/vision/vision.md` update?
- New endpoint or API change → needs `docs/tech/` update?
- Security-relevant change (new auth flow, input surface, token handling) → needs `docs/security/` update?
- Architectural choice (new library, schema pattern, API convention) → needs an ADR in `docs/decisions/`?
- New shared component or utility → needs `docs/tech/shared-frontend-patterns.md` update?

### 5. Present the compliance report

Group findings into:
- **Violations** (blocking — must fix): What breaks a documented rule, with the specific doc reference and file:line
- **Doc gaps** (blocking — must address): Missing documentation updates
- **Reuse opportunities** (advisory — should fix): Where shared code should replace inline
- **ADR candidates** (advisory): Architectural decisions that should be recorded

### 6. Fix violations

Walk through each finding:
- For code violations: show current code, the rule it breaks (with doc reference), and proposed fix. Apply with user approval.
- For doc gaps: draft the documentation update and show it for approval.
- For reuse opportunities: show the existing shared code and how to use it instead of the inline version.

### 7. Run full verification suite

Run ALL project checks to verify everything is clean:

```bash
npm run check          # lint + typecheck
npm run knip           # unused files + dependencies
npm run security:all   # Semgrep SAST + npm audit
TEST_REPORT_LOCAL=1 npm test  # unit tests
```

Also run `/security-check` for Claude Code security review of changed files.

If any check fails, fix and re-run until all pass.

### 8. Summary

Report:
- Violations found and fixed (count per category)
- Doc updates made
- Reuse improvements applied
- Any advisory items the user chose to skip
- Verification results (all checks passing?)

Remind the user: "Code is compliant and verified. Next steps: run `/vibe-history` to create proper branches and commits, or `/vibe-ship` for the full pipeline."
