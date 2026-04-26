# Clean Up Vibe-Coded Working Tree

Scan a dirty working tree for debug artifacts, dead code, and structural issues left over from rapid prototyping. Fix them systematically with user approval.

This command only cleans code — it does NOT create commits, branches, or update docs.

## Instructions

### 1. Snapshot the current state

Run `git diff --stat` and `git status` to catalog all changed and new files. Present a summary: how many files changed, how many new, total lines added/removed.

### 2. Scan for issues

Dispatch parallel subagents to scan all changed/new files for these categories:

**Debug artifacts:**
- `console.log`, `console.debug`, `console.warn` (that aren't intentional logging)
- `debugger` statements
- Hardcoded test values, mock data left in production code
- `// TODO HACK`, `// FIXME`, `// TEMP`, `// XXX` comments
- Commented-out code blocks (more than 2 consecutive commented lines)

**Dead code:**
- Unused imports (imports not referenced anywhere in the file)
- Unreferenced functions, variables, types, interfaces
- Orphaned files (new files that nothing imports)
- Unused dependencies added to package.json

**Structural issues:**
- Files exceeding 500 lines — flag for potential splitting
- Duplicated logic across files (same pattern in 2+ places)
- Inline code that duplicates existing shared utilities or components
- Missing barrel exports for new modules

For each finding, record: category, file path, line number(s), description, and severity:
- **auto-fix**: Can be removed/fixed without judgment (unused imports, console.logs)
- **needs-judgment**: Requires user decision (split file, extract to shared util, remove commented code that might be intentional)

### 3. Present the report

Group findings by category. For each category show:
- Count of issues found
- Table with file:line, description, severity
- Proposed fix for each item

Ask the user how to proceed:
- **Batch auto-fix**: Apply all auto-fixable items at once
- **Review each**: Walk through every item
- **Category by category**: Batch auto-fix per category, review judgment items individually

### 4. Apply fixes with approval

Based on user's choice, apply fixes. For judgment items:
- Show the current code and proposed change
- Wait for user approval before each change
- If the user says skip, move on

### 5. Verify

Run the project's linter and type checker to confirm nothing broke:

```bash
npm run check
```

If there are errors, show them and fix. Repeat until clean.

### 6. Summary

Report what was done:
- How many issues found per category
- How many fixed, how many skipped
- Any remaining issues the user chose to skip

Remind the user: "Code is cleaned up but not committed. Next steps: run `/vibe-compliance` to check guidelines, or `/vibe-ship` for the full pipeline."
