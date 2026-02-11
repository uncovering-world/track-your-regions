# Work on a Feature

Work on a feature or enhancement from a GitHub issue. Features require proper planning before implementation — this command reads the issue, explores the codebase, and produces a plan for approval.

## Arguments

$ARGUMENTS — required: GitHub issue number.

## Instructions

### 1. Load the issue

```bash
gh issue view $ARGUMENTS --json number,title,body,labels,comments
```

If the issue doesn't exist or isn't open, tell the user and stop.

### 2. Understand the requirements

- Read the issue title, description, and all comments carefully
- Extract specific requirements and acceptance criteria
- Note any subtasks or checkboxes in the issue body
- Identify which parts of the system are affected (frontend, backend, database, etc.)

### 3. Create a branch

```bash
git checkout main
git pull
git checkout -b feature/$ARGUMENTS-<short-slug>
```

Use a short slug derived from the issue title (e.g., `feature/200-dark-mode`).

### 4. Enter plan mode

This is a feature — it requires proper planning. Enter plan mode to:

- Explore the relevant parts of the codebase
- Understand existing patterns and architecture
- Check `docs/tech/planning/` for any existing plans related to this feature
- Check `docs/vision/vision.md` for relevant user stories
- Check `frontend/src/components/shared/` for reusable components
- Design the implementation approach
- Identify files to create/modify
- Consider edge cases and security implications

Present the plan to the user for approval before writing any code.

### 5. After plan approval — implement

Once the user approves the plan:

- Implement the feature following the approved plan
- Follow existing code patterns (check similar features for reference)
- Reuse existing utilities and shared components
- Add proper input validation (Zod schemas for new endpoints)
- Add auth middleware where needed

### 6. Verify

Run the project checks:

```bash
npm run check
```

Fix any lint or type errors.

### 7. Update documentation

Features always require doc updates:

- **`docs/tech/`** — create or update technical documentation for the feature
- **`docs/vision/vision.md`** — update if the feature is user-facing
- **`docs/tech/planning/`** — if there was an existing plan, trim it to only remaining ideas
- **`docs/security/`** — update if the feature touches auth, new endpoints, or input surfaces

### 8. Commit and summarize

Commit the changes (follow the git commit protocol from system instructions).

Then summarize what was built and suggest:
- **To create a PR**: use `gh pr create` — the PR description should reference the issue with `Closes #$ARGUMENTS` or `Part of #$ARGUMENTS` (if partial)
- **To continue work**: list any remaining items from the issue that weren't addressed
