# Fix a Bug

Work on a bug fix from a GitHub issue. This is a streamlined workflow for bugs — read the issue, understand the problem, find the code, fix it, and verify.

## Arguments

$ARGUMENTS — required: GitHub issue number.

## Instructions

### 1. Load the issue

```bash
gh issue view $ARGUMENTS --json number,title,body,labels,comments
```

If the issue doesn't exist or isn't open, tell the user and stop.

### 2. Understand the problem

- Read the issue title, description, and any comments
- Extract the specific bug behavior described
- Identify reproduction steps if provided
- Note any files or areas of code mentioned

### 3. Create a branch

```bash
git checkout main
git pull
git checkout -b fix/$ARGUMENTS-<short-slug>
```

Use a short slug derived from the issue title (e.g., `fix/42-login-crash`).

### 4. Investigate

- Search the codebase for the relevant code based on the issue description
- Read the files involved to understand the current behavior
- Identify the root cause of the bug
- Check related tests if they exist

### 5. Explain your findings

Before making any changes, briefly explain:
- What the bug is
- Where in the code it occurs (file:line references)
- What the root cause is
- What the fix will be

Ask the user to confirm before proceeding with the fix.

### 6. Implement the fix

- Make the minimal change needed to fix the bug
- Follow existing code patterns and style
- Do NOT refactor surrounding code or add unrelated improvements
- Update any relevant tests

### 7. Verify

Run the project checks:

```bash
npm run check
```

Fix any lint or type errors introduced by the change.

### 8. Update docs if needed

If the fix changes user-facing behavior:
- Update `docs/vision/vision.md`
- Update relevant `docs/tech/` files

### 9. Commit and summarize

Commit the fix (follow the git commit protocol from system instructions).

Then summarize what was done and suggest:
- **To create a PR**: run `/commit` or use `gh pr create`
- **To close the issue**: the PR description should include `Fixes #$ARGUMENTS`
