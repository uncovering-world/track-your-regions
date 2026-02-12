# Development Guide

Conventions and patterns for writing code in this project. Follow these to keep the codebase consistent and avoid large refactoring sessions.

## Core Principles

### 1. Reuse Before You Create

Before implementing anything new, **search the codebase for similar patterns**:

- **Backend utilities:** Check `backend/src/services/sync/syncUtils.ts` (upsert, sync log, cleanup), `wikidataUtils.ts` (SPARQL, QID parsing), and service-level shared code before writing new helpers.
- **Frontend utilities:** Check `frontend/src/utils/` (categoryColors, dateFormat, imageUrl, coordinateParser, mapUtils) before creating inline helpers.
- **Frontend hooks:** Check `frontend/src/hooks/` for app-level hooks and component directories for co-located hooks.
- **Frontend components:** Check `frontend/src/components/shared/` (CurationDialog, AddExperienceDialog, LocationPicker) before building new dialogs or UI patterns.

If similar functionality exists:
- **Extend it** — add a parameter or variant to the existing code.
- **Extract to shared** — if code is duplicated in 2+ places, move it to a shared utility or component.
- **Don't fork** — never copy-paste a function and tweak it. Refactor the original to handle both cases.

### 2. Keep Files Small

**Keep files under ~500 lines.** When a file approaches this, split proactively. Files at 800+ lines are overdue for splitting.

Exceptions: files with dense, non-decomposable JSX (like `ExperienceList.tsx` at ~1,300 lines with clear internal sub-components) can exceed the limit if splitting would only add prop-drilling overhead without clarity gain. Use judgment — if a file has distinct responsibilities, it should be split.

### 3. Keep Docs in Sync

**Every code change must update relevant documentation.** This is non-negotiable — do it in the same work session, not as a follow-up.

| What changed | What to update |
|---|---|
| Any code | `docs/tech/` — create or update the relevant technical doc |
| User-facing behavior (UI, workflows, inputs) | `docs/vision/vision.md` — describe what users/curators/admins see or do |
| New/changed API endpoints, auth flows, input surfaces | `docs/security/SECURITY.md` and/or `docs/security/asvs-checklist.yaml` |
| Completed a plan | Trim `docs/tech/planning/*.md` — remove implemented sections, keep only remaining ideas |
| New tech doc | Add it to `docs/README.md` index table |

## Backend

### Controllers

Controllers live in `backend/src/controllers/`, organized by domain into subdirectories with barrel `index.ts` files.

```
controllers/
├── experience/
│   ├── index.ts                      ← barrel: exports everything
│   ├── experienceQueryController.ts  ← list, get, search, counts
│   ├── experienceVisitController.ts  ← mark/unmark visited
│   ├── experienceLocationController.ts
│   ├── experienceTreasureController.ts
│   └── curationController.ts
├── worldView/
│   ├── index.ts                      ← barrel: named re-exports
│   ├── regionCrud.ts
│   ├── regionMemberQueries.ts
│   ├── regionMemberMutations.ts
│   ├── regionMemberOperations.ts
│   ├── geometryRead.ts
│   ├── geometryCompute.ts
│   └── ...
├── division/
└── sync/
```

**Rules:**

1. **One file per concern.** Group related handler functions that operate on the same entity/action. A "queries" file handles reads; a "mutations" file handles writes.
2. **Barrel re-exports.** Every domain directory has an `index.ts` that re-exports all public functions. Routes import from the barrel — never from individual files.
3. **Two barrel styles:**
   - `export *` (experience): simpler, use when there are no naming conflicts
   - Named re-exports (worldView): explicit, use when you want to document the API surface
4. **Target: 100–600 lines per file.** If a controller file exceeds ~600 lines, split by sub-concern.

### Adding a new controller function

1. Find the right file by concern (queries vs mutations vs a new sub-concern).
2. Add the function, export it.
3. If the barrel uses named re-exports, add the new function to `index.ts`.
4. Wire it in the route file (`backend/src/routes/`).

### Routes

Routes are thin — they wire HTTP methods to controller functions and apply middleware. No business logic in route files.

```
routes/
├── index.ts              ← mounts all routers
├── experienceRoutes.ts
├── worldViewRoutes.ts
├── adminRoutes.ts
└── ...
```

Each route file applies appropriate middleware (`requireAuth`, `requireAdmin`, `requireCurator`, `validate()`, rate limiters). Every endpoint must have:
- **Auth middleware** — `requireAuth`, `requireAdmin`, `requireCurator`, or `optionalAuth`
- **Zod validation** via `validate()` — validate body, query, and path params
- **Rate limiting** — see `backend/src/middleware/rateLimiter.ts` and `docs/tech/rate-limiting.md`

### Services

Services live in `backend/src/services/`, organized by feature:

```
services/
├── sync/
│   ├── index.ts               ← barrel with orchestrator + status
│   ├── syncOrchestrator.ts    ← generic orchestration framework
│   ├── syncUtils.ts           ← shared: upsert, sync log, cleanup
│   ├── wikidataUtils.ts       ← shared: SPARQL queries, QID parsing
│   ├── unescoSyncService.ts   ← category-specific sync
│   ├── museumSyncService.ts
│   ├── landmarkSyncService.ts
│   ├── imageService.ts
│   ├── regionAssignmentService.ts
│   └── types.ts
├── hull/
├── ai/
├── authService.ts
└── emailService.ts
```

**Rules:**

1. **Shared utilities go in shared files.** `syncUtils.ts` and `wikidataUtils.ts` are reused across all sync services. Don't duplicate their logic.
2. **New sync category?** Create a new `*SyncService.ts` file that implements `SyncServiceConfig<T>` from `syncOrchestrator.ts`. Reuse shared utilities.
3. **Co-locate tests.** Test files sit next to source: `syncOrchestrator.test.ts` alongside `syncOrchestrator.ts`.

### Database Queries

- Use Drizzle ORM for standard queries.
- Use raw `pool.query()` with parameterized SQL for PostGIS geometry operations.
- **Never** concatenate user input into SQL strings.
- When you need `SET`/`RESET` to apply to the same connection as your query, use `const client = await pool.connect()` + `client.query()` + `client.release()`. `pool.query()` grabs a random connection each time.

### Backend Gotchas

- **SSE endpoints need `token` in Zod query schema.** `EventSource` can't send headers, so JWT is passed as `?token=...`. The `validate()` middleware strips undeclared fields, so Zod schemas must include `token: z.string().optional()`.
- **`booleanStringSchema` stays as string.** Zod validates `'true'`/`'false'` but does NOT transform to boolean. Controllers use `=== 'true'` string comparison. Don't add `.transform()`.
- **`getExperiencesByRegion`** API must include `country_names`, `external_id`, and `category_priority` in SELECT — frontends depend on these.

## Frontend

### Component Organization

Components live in `frontend/src/components/`, organized by feature:

```
components/
├── MainDisplay.tsx           ← shell: map + navigation
├── RegionMapVT.tsx           ← map rendering (uses extracted hooks)
├── ExperienceList.tsx        ← experience cards with inline sub-components
├── regionMap/                ← extracted hooks for RegionMapVT
│   ├── layerStyles.ts
│   ├── useRegionMetadata.ts
│   ├── useTileUrls.ts
│   ├── useMapFeatureState.ts
│   └── useMapInteractions.ts
├── shared/                   ← reusable across features
│   ├── AddExperienceDialog.tsx
│   ├── CurationDialog.tsx
│   └── LocationPicker.tsx
├── discover/                 ← Discover mode UI
├── WorldViewEditor/          ← admin world-view editing
│   └── components/
│       └── dialogs/
│           └── CustomSubdivisionDialog/
│               ├── AIAssistTab.tsx
│               ├── aiAssistTypes.ts
│               ├── useAIModelManager.ts
│               ├── useAIUsageTracking.ts
│               └── AIUsagePopover.tsx
└── admin/
```

**Rules:**

1. **Co-locate extracted hooks and types.** When you extract hooks or types from a component, keep them in the same directory (or a sibling directory named after the feature). Don't scatter them across the tree.
2. **Feature directories for complex components.** If a component needs >2 extracted files, create a subdirectory (e.g., `regionMap/` for RegionMapVT's hooks, `CustomSubdivisionDialog/` for AIAssistTab's extractions).
3. **Shared components go in `shared/`.** If a component is used from 2+ unrelated features, it belongs in `frontend/src/components/shared/`.

### Extracting Hooks from Large Components

This is the primary technique for keeping React components manageable. The pattern:

1. **Identify a cohesive group of state + logic** (e.g., all hover/selection state, all tile URL computation, all API model management).
2. **Create a `use*.ts` hook** in the same directory or a feature subdirectory.
3. **Pass shared refs as parameters** — the parent keeps `mapRef`, `mapLoaded`, etc. and passes them to hooks.
4. **Each hook returns only its own state/callbacks** — no god-object returns.

Example from `RegionMapVT.tsx` → `regionMap/`:

```tsx
// RegionMapVT.tsx — parent keeps shared state
const mapRef = useRef<MapRef>(null);
const [mapLoaded, setMapLoaded] = useState(false);

// Each hook receives what it needs
const tileUrls = useTileUrls(worldViewId, regionId, tileVersion);
const metadata = useRegionMetadata(worldViewId, regionId);
const featureState = useMapFeatureState(mapRef, mapLoaded, ...);
const interactions = useMapInteractions(mapRef, mapLoaded, ...);
```

### Extracting Types

When interfaces are shared between a component and its extracted hooks/sub-components:

1. Create a `*Types.ts` file (e.g., `aiAssistTypes.ts`).
2. Import types from that file in all consumers.
3. **Re-export types** from the original component if external consumers import them:
   ```tsx
   export type { UsageStats, LastOperation } from './aiAssistTypes';
   ```

### App-Level Hooks

Hooks in `frontend/src/hooks/` are app-wide concerns shared across many components:

| Hook | Purpose |
|------|---------|
| `useNavigation` | World views, divisions, breadcrumbs, tile version |
| `useAuth` | Authentication state, login/logout |
| `useExperienceContext` | Experiences, hover sync, selection |
| `useVisitedRegions` | Region visit tracking |
| `useVisitedExperiences` | Experience visit tracking, mutations |
| `useDiscoverExperiences` | Discover mode queries |
| `useRegionLocations` | Batch location fetching |

**Don't put component-specific hooks here.** A hook that only serves one component (like `useMapFeatureState`) stays co-located with that component.

### Utility Modules

Shared utilities live in `frontend/src/utils/`, one module per concern:

| Module | Contents |
|--------|----------|
| `categoryColors.ts` | Category color mapping |
| `dateFormat.ts` | `formatRelativeTime` and date formatters |
| `imageUrl.ts` | `toThumbnailUrl`, `extractImageUrl` |
| `coordinateParser.ts` | Coordinate string parsing |
| `mapUtils.ts` | Map helper functions |

**Rules:**

1. **One concern per file.** Don't create a `helpers.ts` grab bag.
2. **Extract when used in 2+ files.** If you're about to copy-paste a utility function, extract it here first.
3. **Co-locate tests.** `coordinateParser.test.ts` sits next to `coordinateParser.ts`.

### API Layer

All API calls live in `frontend/src/api/`. Use `authFetchJson()` from `fetchUtils.ts` for authenticated requests.

When adding a new endpoint:
1. Add the function in the appropriate `api/*.ts` file.
2. Add/update the TypeScript types in the same file.
3. Use the API function in a hook or component — never call `fetch` directly from components.

### MapLibre Gotchas

- Symbol layers with broken glyph URLs silently stall the entire GeoJSON source rendering pipeline.
- Glyph server: `fonts.openmaptiles.org` — supports `Open Sans Regular/Bold/Semibold` only (NOT Noto Sans).
- `DiscoverExperienceView.tsx` has its own inline map style with glyphs URL (separate from shared `MAP_STYLE`) — update both when changing fonts.

## Splitting Patterns — When and How

### When to split

| Signal | Action |
|--------|--------|
| File > 500 lines | Look for split opportunities |
| File > 800 lines | Split now |
| File has 2+ distinct responsibilities | Split by responsibility |
| You're about to add a new responsibility to an already-large file | Extract the new code into its own file from the start |
| Hook has 3+ `useState` + related logic that could stand alone | Extract to `use*.ts` |

### How to split (backend controllers)

1. Create new files in the same directory, named by concern.
2. Move functions — don't copy. Each function lives in exactly one file.
3. Update the barrel `index.ts` to re-export from the new file.
4. Delete the old file (or trim it).
5. Run `npm run check` — if routes import from the barrel, zero consumer changes needed.

### How to split (frontend components)

1. **Hooks first.** Look for state + logic that can become a custom hook.
2. **Sub-components second.** JSX blocks that take clear props can become their own components.
3. **Types third.** Shared interfaces go to a `*Types.ts` file.
4. Keep files in the same directory or create a feature subdirectory.
5. The parent component should read like an outline — hook calls at the top, clean JSX below.

### How NOT to split

- Don't create a file for a single 10-line function.
- Don't split just to hit a line count — split along responsibility boundaries.
- Don't create deep directory nesting. Two levels max (`components/feature/file.ts`).
- Don't scatter extracted files across unrelated directories.

## Commits and Branches

### Commit Messages

Every commit must have a **title and body**:

```
Add batch location fetching for experience markers

Replace N+1 individual location fetches with a single batch
endpoint that returns all locations for a region's experiences.
Reduces network requests from ~50 to 1 when opening a region
with many experiences.

Closes #234

Signed-off-by: ...
Co-Authored-By: ...
```

**Title rules:**
- Imperative mood: "Add X", "Fix Y", "Update Z" (not "Added" or "Fixes")
- Max 72 characters
- Specific: "Fix hover state not clearing on region change" not "Fix bug"

**Body rules:**
- Explain **what** changed and **why** — not just how
- Wrap at 72 characters
- Reference related issues: `Closes #N` or `Relates to #N`
- Always sign off (`-s`) and include `Co-Authored-By` trailer

### Granular Commits

**Split large changes into multiple well-scoped commits.** Each commit should be independently reviewable and tell a coherent story.

Good commit sequence for a feature:
```
1. Add batch locations API endpoint          ← backend: schema + controller
2. Add useRegionLocations hook               ← frontend: data layer
3. Replace N+1 fetches with batch hook       ← frontend: wire it up
4. Document batch location fetching          ← docs
```

Bad: one giant commit "Add batch location fetching" with all of the above mixed together.

**Guidelines:**
- Each commit compiles and passes lint on its own
- Backend and frontend changes can be separate commits when the feature has distinct layers
- Documentation updates get their own dedicated commit
- Refactoring and feature work never share a commit
- If a commit diff is hard to review in one sitting, it's too big — split it

### Branch Discipline

- **One purpose per branch/PR.** A branch delivers ONE feature, fix, or improvement.
- Don't sneak in unrelated changes — no "while I'm here" fixes, no inbox notes, no drive-by refactors.
- Branch naming: `feature/NNN-short-slug`, `fix/NNN-short-slug`, or descriptive kebab-case (`add-development-guide`).

## Security

This project follows **OWASP ASVS 5.0 Level 2**. Key rules:

- **Never** concatenate user input into SQL — use parameterized queries or Drizzle ORM
- **Always** validate inputs with Zod schemas via `validate()` middleware
- **Always** verify resource ownership (IDOR prevention)
- **Always** apply auth middleware to new endpoints
- **Never** expose secrets in code, configs, logs, or error messages
- **Never** log sensitive data (passwords, tokens, coordinates)

See `docs/security/SECURITY.md` for the full security profile and `CLAUDE.md` for the complete rules.

## Verification Workflow

Run before every commit:

```bash
npm run check          # lint + typecheck for both packages
```

For security-sensitive changes, also run:

```bash
npm run security:all   # Semgrep SAST + npm audit
```

## Slash Commands

The project has slash commands (in `.claude/commands/`) that automate common workflows. Use them — they encode the conventions in this guide:

| Command | When to use |
|---------|-------------|
| `/feature <issue#>` | Start work on a feature — creates branch, enters plan mode, checks for reusable code, updates docs |
| `/fix <issue#>` | Fix a bug — minimal change, explains root cause before fixing |
| `/commit` | Commit changes — organizes into atomic commits, enforces title+body format, filters junk |
| `/pr-create` | Create a PR — rebases on main, fills PR template from actual changes |
| `/review-pr` | Review PR comments — analyzes, categorizes, creates action plan |
| `/pr-comments-analyze` | Deep analysis of PR review comments with draft replies |
| `/pr-comments-reply` | Post replies to addressed PR comments |
| `/pr-changes-amend` | Fold review fixes into original commits for clean history |
| `/security-check` | Quick pre-commit security scan of changed files |
| `/security-review [file]` | Deep security review of a specific file or module |
| `/security-audit` | Full OWASP ASVS 5.0 audit with report generation |
| `/security-alerts` | Triage GitHub code scanning alerts (CodeQL, etc.) |
| `/quality-alerts` | Triage code quality alerts |
| `/issues` | Browse and work with GitHub issues |
| `/issue-create` | Create a new GitHub issue |
| `/issue-upload` | Batch-create issues from a markdown file |
| `/review-dependabot` | Review Dependabot PRs and security alerts |

### Typical workflow

```
/feature 267          # start feature from issue
  ... implement ...
npm run check         # verify
/security-check       # security scan
/commit               # atomic commits + push
/pr-create            # create PR
  ... reviewer comments ...
/review-pr            # analyze comments
  ... fix issues ...
/pr-changes-amend     # fold fixes into original commits
/pr-comments-reply    # reply to reviewers
```
