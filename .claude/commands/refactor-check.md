# Post-Refactoring Prevention Check

Verify that the development guide has rules preventing the patterns just refactored from recurring.

## Arguments

$ARGUMENTS — optional: description of what was refactored. If not provided, infer from the current branch's changes.

## Instructions

### 1. Identify what was refactored

If $ARGUMENTS describes the refactoring, use that. Otherwise, analyze the current branch:

```bash
git diff main --name-only
git log main..HEAD --oneline
```

Categorize the refactoring: shared component extraction, utility consolidation, pattern unification, file splitting, etc.

### 2. Read the development guide

Read `docs/tech/development-guide.md` fully. Focus on:
- **Component Organization** → `shared/` directory listing (is the new component listed?)
- **Utility Modules** → table (is the new utility listed with accurate description?)
- **Shared UI Patterns** → table (is there a row showing when to use the new pattern and what NOT to do?)
- **Splitting Patterns** → if the refactoring was a file split, are the new files documented?

### 3. Check CLAUDE.md

Read `CLAUDE.md` sections:
- **Shared Components** — does it mention the new shared components/utilities?
- Other relevant sections — does the architectural narrative reflect the refactoring?

### 4. Identify gaps

For each extracted component, utility, or pattern, check:

| Check | Question |
|-------|----------|
| Listed? | Is the new file listed in the appropriate directory/table? |
| Described? | Is the description accurate and complete? |
| Prevention rule? | Is there a rule that says "use X instead of doing Y inline"? |
| Anti-pattern? | Is the old inline pattern documented as "don't do this"? |

### 5. Report findings

Output a table:

```
## Prevention Check Results

| Extracted | Listed in dev guide? | Has "use this" rule? | Has "don't do this" anti-pattern? | Action needed |
|-----------|---------------------|----------------------|-----------------------------------|---------------|
| LoadingSpinner | Yes (shared/) | Yes (Shared UI Patterns) | Yes | None |
| formatDuration | No | No | No | Add to utility table + Shared UI Patterns |
```

### 6. Fix gaps

For each gap found:
- Update the dev guide with the missing listing, rule, or anti-pattern
- Update CLAUDE.md if the shared components section needs updating
- Show the user each change made

### 7. Summary

Report:
- How many items checked
- How many gaps found and fixed
- Any items that need manual review (e.g., rules that are hard to express in a table)
