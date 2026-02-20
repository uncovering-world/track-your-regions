# Work on a Feature

Work on a feature or enhancement from a GitHub issue. Features require proper planning before implementation — this command reads the issue, explores the codebase, and produces a plan for approval.

## Arguments

$ARGUMENTS — required: GitHub issue number.

## Prerequisites

Before starting, read `docs/tech/development-guide.md` — it defines the project's code organization conventions, file size rules, reuse-first principle, commit format, and documentation requirements. All work must follow these rules.

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

- **Read `docs/tech/development-guide.md`** to understand where new code should live and how to organize it
- **Read area-specific docs** based on what the feature touches:

  | Area | Read |
  |------|------|
  | Map rendering, tile layers, map interactions | `docs/tech/maplibre-patterns.md` |
  | Map UI (markers, hover, selection, context layers) | `docs/tech/experience-map-ui.md` |
  | Geometry, triggers, simplification, hull | `docs/tech/geometry-columns.md` |
  | Shared frontend components/utils | `docs/tech/shared-frontend-patterns.md` |
  | Experience system (sync, sources, assignment) | `docs/tech/experiences.md` |
  | Auth flows (JWT, OAuth, tokens, email) | `docs/tech/authentication.md` |
  | Security (new endpoints, input surfaces) | `docs/security/SECURITY.md` |

  Read **all** docs that apply — most features touch 2-3 areas. Skip only areas that are clearly irrelevant.

- **Check `docs/decisions/`** for existing ADRs that apply to this feature — mention them in the plan ("This follows ADR-0004")
- Explore the relevant parts of the codebase
- Understand existing patterns and architecture
- **Search for existing code to reuse** — check shared utilities, hooks, and components before planning new ones (see "Reuse Before You Create" in the development guide)
- Check `docs/tech/planning/` for any existing plans related to this feature
- Check `docs/vision/vision.md` for relevant user stories
- Check `frontend/src/components/shared/` for reusable components
- Design the implementation approach
- Identify files to create/modify — **flag any file that would exceed ~500 lines** and plan how to split it
- Consider edge cases and security implications
- **If the feature involves an architectural choice** (new library, schema pattern, API convention, or hard-to-reverse decision) — include a new ADR in the plan (see `CLAUDE.md` § Architecture Decision Records)

Present the plan to the user for approval before writing any code.

### 5. After plan approval — implement

Once the user approves the plan:

- Implement the feature following the approved plan
- Follow the code organization conventions in `docs/tech/development-guide.md`:
  - **Reuse first** — use existing utilities, hooks, and shared components
  - **Keep files small** — extract hooks/sub-components proactively if a file approaches ~500 lines
  - **Barrel exports** — if adding to a controller directory, update `index.ts`
  - **Co-locate** — keep extracted hooks/types near the component they serve
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
- **`docs/decisions/`** — if the plan included a new ADR, create the file and update the index

### 8. Commit and summarize

Commit the changes following the conventions in `docs/tech/development-guide.md`:
- **Granular commits** — split into multiple well-scoped commits (backend, frontend, docs separately)
- **Title + body** — every commit needs an imperative title and a body explaining what and why
- **Docs in dedicated commits** — documentation updates are separate from code commits

Then summarize what was built and suggest:
- **To create a PR**: use `gh pr create` — the PR description should reference the issue with `Closes #$ARGUMENTS` or `Part of #$ARGUMENTS` (if partial)
- **To continue work**: list any remaining items from the issue that weren't addressed
