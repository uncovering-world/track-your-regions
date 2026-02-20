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
│   ├── geometryCompute.ts            ← CRUD: update, reset, regenerate
│   ├── geometryComputeSingle.ts      ← computation: core algorithm + HTTP handler
│   ├── geometryComputeSSE.ts         ← SSE streaming for single region compute
│   ├── computationProgress.ts        ← batch computation with progress tracking
│   ├── hullOperations.ts
│   ├── helpers.ts                    ← invalidate/recompute region geometry
│   └── types.ts
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
├── shared/                   ← reusable across features (see shared-frontend-patterns.md)
├── discover/                 ← Discover mode UI
├── WorldViewEditor/          ← admin world-view editing
│   └── components/
│       └── dialogs/
│           └── CustomSubdivisionDialog/
│               ├── MapViewTab.tsx             ← map-based subdivision UI (hooks below)
│               ├── useGeometryLoading.ts      ← geometry fetch, fit-bounds, feature building
│               ├── useDivisionOperations.ts   ← split/cut/assign/moveToParent tools
│               ├── useImageColorPicker.ts     ← eyedropper color sampling from reference image
│               ├── AIAssistTab.tsx
│               ├── aiAssistTypes.ts
│               ├── useAIModelManager.ts
│               ├── useAIUsageTracking.ts
│               └── AIUsagePopover.tsx
└── admin/
    ├── WorldViewImportTree.tsx    ← main tree component + mutations
    ├── TreeNodeRow.tsx            ← row orchestrator (expand, name, delegates to below)
    ├── TreeNodeActions.tsx        ← match-status chips + action buttons
    ├── TreeNodeContent.tsx        ← division lists, suggestions, shadow rows
    ├── importTreeUtils.ts         ← pure tree-walking helpers (no React deps)
    └── treeNodeShared.tsx         ← shared Tooltip wrapper + ShadowInsertion type
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

| Module | Purpose |
|--------|---------|
| `categoryColors.ts` | Category color mapping, shared color constants |
| `dateFormat.ts` | Date/time formatting helpers |
| `imageUrl.ts` | Thumbnail URL generation |
| `queryInvalidation.ts` | TanStack Query cache invalidation helpers |
| `scrollUtils.ts` | Programmatic scroll-to-element |
| `coordinateParser.ts` | Coordinate string parsing |
| `mapUtils.ts` | Map helper functions |

For detailed exports and usage guidance, see [shared-frontend-patterns.md](shared-frontend-patterns.md).

**Rules:**

1. **One concern per file.** Don't create a `helpers.ts` grab bag.
2. **Extract when used in 2+ files.** If you're about to copy-paste a utility function, extract it here first.
3. **Co-locate tests.** `coordinateParser.test.ts` sits next to `coordinateParser.ts`.

### Shared UI Patterns

Before writing any inline UI pattern, check `frontend/src/components/shared/` and `frontend/src/utils/`. If a shared solution exists, use it. If you're writing something that 2+ components will need, extract it to shared before duplicating.

For example: use `<LoadingSpinner />` instead of writing another centered `CircularProgress`, or `VISITED_GREEN` from `categoryColors` instead of hardcoding a hex color.

The full inventory of shared components and utilities — including a "use this, not that" reference table — is in [shared-frontend-patterns.md](shared-frontend-patterns.md). Keep that doc updated when extracting new shared code.

### API Layer

All API calls live in `frontend/src/api/`. Use `authFetchJson()` from `fetchUtils.ts` for authenticated requests.

When adding a new endpoint:
1. Add the function in the appropriate `api/*.ts` file.
2. Add/update the TypeScript types in the same file.
3. Use the API function in a hook or component — never call `fetch` directly from components.

### MapLibre Gotchas

**Fonts and symbols:**
- Symbol layers with broken glyph URLs silently stall the entire GeoJSON source rendering pipeline.
- Glyph server: `fonts.openmaptiles.org` — supports `Open Sans Regular/Bold/Semibold` only (NOT Noto Sans).
- `DiscoverExperienceView.tsx` has its own inline map style with glyphs URL (separate from shared `MAP_STYLE`) — update both when changing fonts.

**Overlapping interactive layers — prefer main tiles:**
- When multiple interactive layers overlap at the same point (e.g., ancestor context layers behind main children tiles), `event.features` returns features from ALL layers — and the first element is NOT guaranteed to be from the topmost visible layer.
- **Apply the same fix to ALL event handlers.** If a click handler needs to prefer main tile features over context features, the hover handler needs the same logic. These share the same `event.features` source — fixing only one leaves the other broken.
- Pattern: `const preferred = features.find(f => !f.layer?.id?.startsWith('context-')) ?? features[0]`

**MVT tiles expose a subset of DB columns:**
- Martin tile functions select specific columns — NOT everything from the table. In particular, `focus_bbox` and `anchor_point` are NOT in MVT properties (they're large and rarely needed for rendering).
- When building state objects from tile click data, expect missing fields. Don't fly-to using imprecise tile geometry when the API can provide accurate `focusBbox` shortly after.
- Pattern: skip immediate action for data you know is missing, let an API response enrich the state, then react to the enriched state.

**Feature ID expressions:**
- Use `['id']` (MVT feature ID), NOT `['get', 'id']` (property lookup). PostGIS `ST_AsMVT(..., 'id')` strips the `id` column from properties when used as `feature_id_name`.

For the full reference with examples, see [maplibre-patterns.md](maplibre-patterns.md).

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

## Refactoring Hygiene

When modifying existing code, always clean up leftovers from the change. These are the most common sources of CodeQL quality findings:

| Leftover | How it happens | Fix |
|----------|---------------|-----|
| **Unused imports** | You delete or move code that used a module | Remove the import |
| **Unused variables** | You replace logic with a new approach but leave the old variable | Delete both the declaration and all assignments |
| **Redundant null checks** | You add an early-return guard (`if (!x) return`) but leave `x !== null` checks below it | Remove the now-always-true checks |
| **Redundant JSX conditionals** | You add an early return that guarantees a value is truthy, but leave `{value && ...}` in JSX | Simplify to just the inner expression |
| **Always-true/false conditions** | You narrow a type upstream but a downstream comparison still tests the old broader type | Remove or simplify the condition |

**Rule of thumb:** after every edit, scan the surrounding code for anything that's now dead or redundant because of your change.

## Post-Refactoring Prevention Check

After completing any refactoring, verify that docs have rules **preventing the same duplication from recurring**. The goal: new code should use the shared abstraction from the start, not rediscover it years later.

Ask yourself: "If someone writes new code tomorrow that needs this pattern, will the docs guide them to the shared solution?" If not, update:
- **[shared-frontend-patterns.md](shared-frontend-patterns.md)** — add the new component/utility and a "use this, not that" row
- **CLAUDE.md** — if the extraction changes the architectural narrative

Use `/refactor-check` to automate this verification.

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
- **Never commit `docs/inbox/`** — inbox is a local scratch space, not tracked in git.
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
npm run knip           # detect unused files + dependencies
```

For periodic cleanup (includes exports/types, ~30-40% false positive rate on exports):

```bash
npm run knip:full      # full knip scan including exports/types
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
| `/refactor-check` | Post-refactoring prevention check — verify dev guide has rules preventing the old pattern from recurring |
| `/issues` | Browse and work with GitHub issues |
| `/issue-create` | Create a new GitHub issue |
| `/issue-upload` | Batch-create issues from a markdown file |
| `/review-dependabot` | Review Dependabot PRs and security alerts |

### Typical workflows

**Feature development:**
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

**Refactoring:**
```
  ... refactor (extract shared components, consolidate utils, etc.) ...
npm run check         # verify
/security-check       # security scan
/refactor-check       # verify dev guide prevents the old pattern from recurring
/commit               # atomic commits + push
/pr-create            # create PR
```
