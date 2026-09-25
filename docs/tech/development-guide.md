# Development Guide

Conventions and patterns for writing code in this project. Follow these to keep the codebase consistent and avoid large refactoring sessions.

## Core Principles

### 1. Reuse Before You Create

Before implementing anything new, **search the codebase for similar patterns**:

- **A rule both sides apply:** Check `packages/shared/src/` first — the picture hosts and file types, a held picture's credit pairing, when a moved coordinate is a move and when it matters, the label fold and store rule, the near-global threshold, the curation-log action vocabulary, the changeset equality, the whole-region ceiling, the user roles and the auth providers (`USER_ROLES`, `AUTH_PROVIDERS`) — imported as `@tyr/shared/<module>` by backend and frontend alike (ADR-0065; § A rule both sides apply, below). A rule you are about to write on one side that the other side already applies goes there, not beside its twin.
- **An endpoint's answer:** Check `backend/src/api/responses/` for a success body's schema before typing one on either side. The frontend imports its generated type from `@tyr/shared/api` through the client module that calls the endpoint (ADR-0066; § API Layer, below).
- **Backend utilities:** Check `backend/src/services/sync/experienceUpsert.ts` (the object upsert and its membership), `syncUtils.ts` (single-location write, sync log), `wikidataUtils.ts` (SPARQL, QID parsing), `backend/src/db/membership.ts` (the one spelling of "admitted" and "passed" over a place's memberships), and service-level shared code before writing new helpers.
- **Frontend utilities:** Check `frontend/src/utils/` (kindColors, dateFormat, imageUrl, coordinateParser, mapUtils) before creating inline helpers.
- **Frontend hooks:** Check `frontend/src/hooks/` for app-level hooks and component directories for co-located hooks.
- **Frontend components:** Check `frontend/src/components/shared/` (CurationDialog, AddExperienceDialog, LocationPicker) before building new dialogs or UI patterns.

If similar functionality exists:
- **Extend it** — add a parameter or variant to the existing code.
- **Extract to shared** — if code is duplicated in 2+ places, move it to a shared utility or component.
- **Don't fork** — never copy-paste a function and tweak it. Refactor the original to handle both cases.

### 2. Keep Files Small

**Keep files under ~500 lines of code, and never over 800.** Lines are counted the way the linter counts them: blank lines and comment lines are skipped, so a dense docblock costs nothing — the repo asks for those comments and a raw-line count would tax them. When a file approaches 500, split proactively. 800 is the ceiling `npm run check` enforces: the `max-lines` entry in `backend/eslint.config.mjs` and `frontend/eslint.config.mjs` states that number and names this section, so the guide and the linter are one rule in two places, and a change to either is a change to both (#530). To measure a file with the gate's own ruler rather than `wc -l`, ask the rule for its count:

```bash
cd backend   # or: cd frontend — the config and the eslint binary are the stack's own
npx eslint --rule '{"max-lines":["error",{"max":0,"skipBlankLines":true,"skipComments":true}]}' src/path/to/file.ts
# → "File has too many lines (975). Maximum allowed is 0."
```

The files that were over 800 on the day the ceiling was set (#530) were listed by name in a last block of the config that owned them, at the ceiling they were written under (1000), and that list only shrank: #933 split every one of them, the last — `backend/src/types/index.ts` — along the world-view import's seam, and both blocks are gone. No hand-written file is exempt now, and none is ever added back: a file that would need an exemption is a file to split first. The one relaxation left is `backend/src/db/schema.generated.ts`, whose length is the schema's and which nobody writes (ADR-0064).

Exceptions: files with dense, non-decomposable JSX can exceed the ~500 target if splitting would only add prop-drilling overhead without clarity gain. Use judgment — if a file has distinct responsibilities, it should be split. The 800 ceiling has no such exception for a hand-written file.

`ExperienceList.tsx` used to stand here as that exception, at ~1,300 lines. It is comfortably under 700 now, and what moved out was never JSX depth: the windowed rows (#552), then the kind header, the notice lines, the curator's rejected section and every movement of the list itself (#553). Each had a responsibility of its own, and the prop-drilling the exception warns about did not materialise — the pieces take what they render and the handlers they call. The exception stands; that file is no longer an example of it.

### 3. Keep Docs in Sync

**Every code change must update relevant documentation.** This is non-negotiable — do it in the same work session, not as a follow-up.

| What changed | What to update |
|---|---|
| Any code | `docs/tech/` — create or update the relevant technical doc |
| User-facing behavior (UI, workflows, inputs) | `docs/vision/vision.md` — describe what users/curators/admins see or do |
| New/changed API endpoints, auth flows, input surfaces | `docs/security/SECURITY.md` and/or `docs/security/asvs-checklist.yaml` |
| Completed a plan | Trim `docs/tech/planning/*.md` — remove implemented sections, keep only remaining ideas |
| New tech doc | Add it to `docs/README.md` index table |
| A line pointer, a count of places or a tally in living prose | Replace it with the symbol, the names or the class (§ What a living document may not say, below) |
| A comment narrating how the rule arrived | State the invariant and link the record (§ What a source comment says, below) |

### What a living document may not say

A living document — `docs/tech/*`, `docs/security/SECURITY.md`, `CLAUDE.md` (and `AGENTS.md`, which links to it), the command files under `.claude/commands/`, and a code comment — is read as current. A fact copied out of the code into it is a claim that expires without anything looking broken: the sentence stays readable and true-sounding while the thing it pins moves underneath it. Three shapes, one rule (#579, #797):

- **No line numbers.** Reference code as file + symbol, or as `§ Section`: "`RegionList`'s `useVirtualizer`", "`SECURITY.md` § Known Gaps". Every edit above a cited line breaks the pointer while the claim it supports stays true, and nothing checks a pointer between reviews — #578's review re-synced `docs/tech/experience-map-ui.md`'s pointer at the virtualiser twice in one afternoon. A name is searchable and survives edits for free. This one is a gate: `lint:pointers` (`scripts/lint-line-pointers.mjs`, in the `check` tier) refuses a file name followed by a line number wherever living prose lives — a Markdown page, a code comment, a workflow's `#` line — and exempts the records named in its `RECORDS` list, each with its reason. The two shapes below are not mechanised, because no pattern tells a catalogue total from a schema width or an API ceiling; they are the reviewer's, and the review bot reads them as Notes.
- **No count of places — name the places.** "Seven statements read `paired_rows`" is falsified by the eighth writer without a character of the sentence changing (PR #548), and the module inventory in `docs/tech/experiences.md` went stale on five consecutive pushes of PR #495. Name what is counted ("`markVisited`, `markLocationVisited` and `markTreasureViewed` all carry it"), or name the class ("every writer of `image_url`"), or put the enumeration in the same sentence as the count, so the sentence checks itself. A number that does not drift stays: an external contract (Commons answers 50 titles per request), a declared constant or a rule's threshold, a schema width, an id, a date, a named real example. A tally measured from the database — rows, works, sites — is the same defect one step over, with one boundary (#579): a measurement that carries its date or its run number ("dry run 109 of 2026-09-13 admitted…", "on 2026-09-22 the catalogue held 8 842 places") is a record and stays, since a reader can see what it was true of; the same figure stated as a bare present fact ("1382 of 1604 objects", "the catalogue's 8 830 places") is restated as the class it stands for, or re-measured and dated where the figure is the argument — a ceiling's headroom, a threshold's justification. A count of what the code or the prose itself holds never stays in either form.
- **One file, not twins.** A rule stated for more than one reader lives in one file the others link to or are generated from. `AGENTS.md` is a symlink to `CLAUDE.md` for that reason: the hand-kept paraphrase it used to be still said the JWT lived in `localStorage` after it had moved to memory. (On a checkout without symlinks — Windows with `core.symlinks` off — the file is one line naming `CLAUDE.md`, which is still the pointer.)

Where all of this stays legitimate: a point-in-time record — an ADR, an audit report, an issue or pull request, a commit message, a local plan under `docs/tech/planning/` (gitignored; the plans still tracked there are #514's to move out) — describes the code as of a date, and a line pointer or a count there is evidence rather than a standing claim. The same measurement copied from a pull request description into `docs/tech/` becomes one.

The review bot reads a stale count, tally or line pointer as a Note whose fix is to drop the volatile claim and name the class or the symbols — never to refresh the number, which the next change falsifies again. The sweep that does so is also where a claim that was never true gets caught: a sentence read as boilerplate for months is read as a claim once.

### What a source comment says

A source comment is a living document too, and the one read with the least context: whoever opens `locationWriter.ts` next has the code and the comment, not the pull request that produced them. It says what is true of the code **now** and why the implementation is not the obvious one — the constraint a reader would otherwise break, the ordering that is not free to change, the number a threshold still turns on, and a pointer to the durable decision (`ADR-0025`, `#706`) when there is one. What it does not hold is the chronology of how that rule arrived: what an older comment said, which pull request changed it, which review found the next exception, how many times a predicate was misspelled on a branch, how the wording evolved. Git history, the issue and the ADR already hold that, as point-in-time records; a comment that retells it is one more copy for the review bot's Ripple phase to keep aligned, and the source file ends up serving as code, ADR, issue log and postmortem at once (#925).

The tells, so a writer and a reviewer find them: *what this comment used to say*, *an earlier version of this paragraph*, *a review found*, *the Nth time on this branch*, *minutes before #N*, and a *used to* whose sentence states nothing about the present. `experienceRoutes.ts`'s `/new-badges/seen` block opened by correcting the sentence its predecessor had been wrong about; `db/readerPredicates.ts`'s `experienceOfferedToReaderSql` counted the times the predicate had been written as a subset of itself; `experienceNewBadge.ts`'s `isNewSql` explained a paragraph that was no longer there. Each now states the invariant those sentences were leading to — the reason the limiter is on this route, the hole a partial spelling of the predicate opens, that neither subquery can multiply rows — and the history stays in `git log`.

What a comment keeps:

- **A measurement that still governs.** The 483 ms zoom-3 tile behind `geom_simplified_coarse` and the 775 000 vertices behind a division's stored focus data (`db/init/01-schema.sql`) are why those columns exist; they justify a current threshold and stay. A number that only compares before with after ("seconds since #851, minutes before it") is chronology, and the pointer alone stays.
- **A pointer without a retelling.** "(ADR-0025)" is the link; three sentences on what ADR-0025 replaced are the copy. Where the *contrast* is the invariant — a suffix match on the picture hosts admits any `*.wikimedia.org` host, deleting a withdrawn point cascades the visit record away — it is stated as a present-tense constraint, not as what the code once did.

**This is not "shorter comments".** The repository's dense explanatory comments are an asset, and the rule leaves them whole where the explanation is the invariant: transaction and lock ordering (`locationWriter.ts`'s pairing CTE and its held-row term; `experienceUpsert.ts`'s follow-up statements on the same connection before the commit); a security guarantee (`db/readerPredicates.ts` — *adding a claim requires the row to have been showable; removing one never does* — and why a conjunction spelled in one place cannot be spelled partly); non-obvious Postgres and PostGIS semantics (`'{"a":null}'::jsonb ? 'a'` is presence, not truth; `OLD` is unavailable in an INSERT trigger's `WHEN`; the antimeridian rule in `geometry_focus`); a measured performance threshold. The target is duplicated chronology, not explanation.

A pull request cleans up the narration in the files it changes where the invariant can be stated more directly, and leaves the rest of the repository alone: the sweep of what exists is #579's, and a branch that rewrites comments in files it has no other reason to touch is adding review surface, not value. The point-in-time exemption above applies unchanged — a commit message, a pull request description or an ADR is where the history goes — and the review bot reads a history sentence in a comment as a Note whose fix is the invariant and the pointer, never a request to keep the superseded behaviour on record because it is informative.

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
4. **Target: 100–600 lines of code per file** (counted as § Keep Files Small counts). If a controller file exceeds ~600 lines, split by sub-concern.

### Adding a new controller function

1. Find the right file by concern (queries vs mutations vs a new sub-concern).
2. Add the function, export it.
3. Declare its success body as a `z.strictObject` in `backend/src/api/responses/<module>.ts`, the module named like the frontend client module that will call it, and send the body with `respond(res, Schema, body)` (§ API Layer).
4. If the barrel uses named re-exports, add the new function to `index.ts`.
5. Wire it in the route file (`backend/src/routes/`).

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

Services live in `backend/src/services/`, organized by feature, each file named in camelCase for what it does (`experienceUpsert.ts`, `syncUtils.ts`):

```
services/
├── sync/
│   ├── index.ts               ← barrel with orchestrator + status
│   ├── syncOrchestrator.ts    ← generic orchestration framework: the run's phases, in order
│   ├── syncContract.ts        ← what a sync service implements (SyncServiceConfig)
│   ├── experienceUpsert.ts    ← shared: the object upsert, lock-first, place + membership
│   ├── syncUtils.ts           ← shared: single-location write, sync log
│   ├── wikidataUtils.ts       ← shared: SPARQL queries, QID parsing
│   ├── unescoSyncService.ts   ← source-specific sync
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

1. **Shared utilities go in shared files.** `experienceUpsert.ts`, `syncUtils.ts` and `wikidataUtils.ts` are reused across all sync services. Don't duplicate their logic.
2. **New source?** Create a new `*SyncService.ts` file that implements `SyncServiceConfig<T>` from `syncContract.ts` and runs through `orchestrateSync` in `syncOrchestrator.ts`. Reuse shared utilities.
3. **Co-locate tests.** Test files sit next to source: `syncOrchestrator.test.ts` alongside `syncOrchestrator.ts`.

### Database Queries

- Every query is raw parameterized SQL on the pool: `pool.query<Row>('... $1 ...', [value])`. There is no ORM and no query builder (ADR-0064).
- The row type comes from `backend/src/db/schema.generated.ts`, one `<PascalCase>Row` interface per table and view in the select shape `pg` returns. A partial select is `Pick<ExperiencesRow, 'id' | 'name'>`; a computed column (a count, an `ST_AsGeoJSON`, a joined field) gets a small type of its own next to the statement. The file is never edited by hand.
- A vocabulary a `CHECK` constraint declares is read from `CHECK_VALUES` (the list) and `CheckValue<'table', 'column'>` (the union); a `VARCHAR` width is read from `COLUMN_WIDTHS`, per element for an array column. Never restate either as a literal — the two guards that used to keep such copies equal are gone, so a copy now drifts silently.
- After any change to `db/init/01-schema.sql`, run `npm run db:types` and commit the regenerated file. `npm run db:types:check` is the gate that fails otherwise (it needs Docker: a fresh database is built from `db/init` and read back, about half a minute).
- **Never** concatenate user input into SQL strings.
- When you need `SET`/`RESET` to apply to the same connection as your query, use `const client = await pool.connect()` + `client.query()` + `client.release()`. `pool.query()` grabs a random connection each time.
- **A transaction is pinned to one client, always.** `pool.query('BEGIN')` is not a transaction: pg.Pool checks out an arbitrary idle client, runs the BEGIN on it and releases it with the transaction still open. The statements that follow may land on other connections, and a *different request* that checks out the leaked client runs its own writes inside that stray transaction — to be rolled back with it. The shape, as in `curationController.ts`'s `editExperience`:

  ```ts
  const client = await pool.connect();
  let unusable: Error | undefined;
  try {
    await client.query('BEGIN');
    // ... every statement of the transaction on `client`
    await client.query('COMMIT');
  } catch (error) {
    // A client whose ROLLBACK also failed must be destroyed, not pooled.
    unusable = await rollbackQuietly(client);
    throw error;
  } finally {
    client.release(unusable);
  }
  ```

  Respond *after* the `finally`, not inside the `try` — a `res.json()` before the release leaves the connection out on any path that throws between the two. `rollbackQuietly` (`db/index.ts`) is what keeps a failing ROLLBACK from replacing the error the caller needs to see, and its return value is the argument `release()` needs to destroy a client that can no longer be trusted. The rule is enforced: `no-restricted-syntax` in `backend/eslint.config.mjs` fails the lint on `pool.query('BEGIN' | 'COMMIT' | 'ROLLBACK' | 'SAVEPOINT' | 'RELEASE' …)`, because the prose form of it lived in a comment for months while four call sites went on doing it (#532).

### Backend Gotchas

- **SSE endpoints need `token` in Zod query schema.** `EventSource` can't send headers, so JWT is passed as `?token=...`. The `validate()` middleware strips undeclared fields, so Zod schemas must include `token: z.string().optional()`.
- **`booleanStringSchema` stays as string.** Zod validates `'true'`/`'false'` but does NOT transform to boolean. Controllers use `=== 'true'` string comparison. Don't add `.transform()`.
- **`getExperiencesByRegion`** API must include `country_names`, `external_id`, and `kind_priority` in SELECT — frontends depend on these.

## Database Migrations

`db/init/01-schema.sql` is the canonical schema — a fresh database gets it
automatically, and it is re-applied by hand as it grows. The numbered files in
`db/migrations/` carry what a database already holding data cannot get from
re-applying it: one-shot cleanups, backfills, and DDL that fails while the old
rows are still there.

```bash
npm run db:migrate:status   # what this database has been through, and what is pending
npm run db:migrate          # apply every pending file, in filename order
npm run db:baseline         # record pending files as applied WITHOUT running them
```

The runner records each file in `schema_migrations`, so a database says what it
has seen instead of it being remembered (ADR-0041). A migration changes nothing
the row-type generator reads: the types follow `01-schema.sql`, which every
migration's DDL is also applied to, so it is the schema edit and not the
migration that asks for `npm run db:types` (ADR-0064). Two rules bind a new
migration:

- **Name it `NNN-slug.sql`.** Filename order is the order they are applied in;
  the runner refuses a name outside that shape or a number used twice, and
  `backend/src/db/migrationLedger.test.ts` catches it in the gate first.
- **Declare your own transaction.** Nothing is wrapped around a migration — most
  files open a `BEGIN`/`COMMIT`, and a wrapper around one that does would end at
  its `COMMIT` and leave the rest unwrapped. Write it to be re-runnable: a file
  the ledger did not record is applied again on the next run.

A rename or a drop carries its readers with it, and
`backend/src/db/statementNamesDeclaredColumns.test.ts` fails on the one it
missed: every SQL string literal in `backend/src` is held to the columns
`01-schema.sql` declares — a reference qualified by an alias the literal
declares, anywhere in it, and a bare name in a select list, a `SET` clause or an
`INSERT` column list where a single table owns it. What the extractor cannot
resolve it skips. That is the shape of `tileScopeGuards.test.ts` (and of
`columnBounds.test.ts`, until the generated widths retired it, ADR-0064), a
guard over the schema file's text, and the executable SQL lane (#522) retires
it: there a statement naming a dropped column is refused by the database
itself.

`db/migrations/README.md` has the rest, including what each existing migration
does and how to give an older database a ledger.

## Frontend

### Component Organization

Components live in `frontend/src/components/`, organized by feature:

```
components/
├── MainDisplay.tsx           ← shell: map + navigation
├── RegionMapVT.tsx           ← map rendering (uses extracted hooks)
├── ExperienceList.tsx        ← assembles the list: groups, filtering, curator actions
├── ExperienceList/           ← what came out of it: rows, headers, notices, scroll
│   ├── ExperienceListItem.tsx
│   ├── ExperienceListItem.styles.ts ← the row's chrome as classes made once
│   ├── ExperienceExpandedDetails.tsx
│   ├── ArtworksList.tsx
│   ├── CardLocationList.tsx  ← the open card's lists of places, and their caps
│   ├── GroupHeader.tsx
│   ├── LocationRow.tsx       ← one place inside an open card
│   ├── NoticeLink.tsx
│   ├── PlacesCountChip.tsx   ← the count, and the fold it offers
│   ├── RejectedSection.tsx
│   ├── VisitedStatusButton.tsx
│   ├── useInViewFilter.ts    ← which rows the map's view leaves
│   ├── useListScrollAnchor.ts ← every movement of the list
│   ├── inView.ts
│   └── utils.ts
├── ExperienceMarkers.tsx     ← a region's markers: sources, layers, list→map hover
├── WorldExperiencePoints.tsx ← the catalogue's own points, before a region is chosen
├── experienceMarkers/        ← what came out of ExperienceMarkers: the pins and the pointer
│   ├── buildMarkers.ts       ← one marker per place a reader may go to
│   ├── FoldPlacesControl.tsx ← the fold chip, floating for one object and inline for the world
│   ├── layers.ts
│   ├── useExtentLayer.ts     ← the outline of the place being looked at (ADR-0059)
│   ├── worldPointLayers.ts   ← the world layer's own: the region layer's paint over its read
│   ├── worldPointsView.ts    ← which tier and how much world the viewport asks for
│   ├── useWorldPointInteractions.ts ← a world pin's popup, ring and way in
│   └── useMarkerInteractions.ts ← the map's own listeners: popup, ring, click
├── regionMap/                ← what came out of RegionMapVT: its hooks, and what it draws over the map
│   ├── ArtworkPreviewOverlay.tsx ← the work under the pointer, at a size worth looking at
│   ├── HoverPreviewCard.tsx  ← names what the pointer is over, over the map
│   ├── HoveredRegionTooltip.tsx ← names the region under the pointer; its own store subscriber
│   ├── WorldLayerControls.tsx ← which kind the world map draws, and whether it is folded
│   ├── layerStyles.ts
│   ├── useRegionMetadata.ts
│   ├── useTileUrls.ts
│   ├── useWorldLayer.ts      ← whether the world layer draws, its kind, its fold
│   ├── useMapFeatureState.ts
│   └── useMapInteractions.ts
├── shared/                   ← reusable across features (see shared-frontend-patterns.md)
├── discover/                 ← Discover mode UI
├── WorldViewEditor/          ← admin world-view editing
│   └── components/
│       └── dialogs/
│           └── CustomSubdivisionDialog/
│               ├── MapViewTab.tsx             ← map-based subdivision UI (hooks below)
│               ├── SubdivisionMapLayers.tsx   ← what the map draws: image, context, divisions
│               ├── subdivisionMapColors.ts    ← each layer's GeoJSON, coloured by group (pure)
│               ├── useGeometryLoading.ts      ← geometry fetch, fit-bounds, feature building
│               ├── useDivisionOperations.ts   ← split/cut/assign/moveToParent tools
│               ├── useSubdivisionMapHover.ts  ← what the pointer is over, and the cursor for it
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
4. **Names say what a file is.** A component file is `PascalCase` (`RegionMapVT.tsx`), a hook `useCamelCase` (`useNavigation.tsx`), and everything else camelCase for what it does (`importTreeUtils.ts`). Indentation is two spaces throughout, and ESLint is the source of truth for the rest of the style: `npm run lint` and `npm run lint:fix`.

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
| `useAppAddress` | The app's address, read and written through one door — see [addresses.md](addresses.md). Nothing else touches `useSearchParams` or `navigate` for app state |
| `useAddressedRegion` | The selected region: the object, the read that restores it from the address, the degradation and the canonical slug |
| `useDocumentTitle` | The tab names the place the page is showing |
| `useNavigation` | World views, divisions, breadcrumbs, tile version |
| `useAuth` | Authentication state, login/logout |
| `useExperienceContext` | Experiences, selection (read from the address), what the map is showing |
| `useHoverContext` | What the pointer is over — a store, not state, and read where it is drawn. Map mode's provider is mounted by `ExperienceProvider`, Discover's by `DiscoverPage` |
| `useRegionHover` | Which region the pointer is over — the same store shape, mounted by `NavigationProvider`. As context state it re-rendered every `useNavigation` consumer per mouse move |
| `useSeenWindowIds` | Which rows a windowed list's viewport has held, accumulated and flushed on a timer — what New-badge impressions may honestly report |
| `useVisitedRegions` | Region visit tracking |
| `useVisitedExperiences` | Experience visit tracking, mutations, over the calls in `api/visited.ts` |
| `useDiscoverExperiences` | Discover mode queries |
| `useRegionLocations` | Batch location fetching; takes `includeLost` and `includeChildren` so the markers follow the list they belong to — both are part of the query key |
| `useNewBadgeImpressions` | Reports which "New" chips actually rendered, so the reader's personal window starts from a real impression |

**Don't put component-specific hooks here.** A hook that only serves one component (like `useMapFeatureState`) stays co-located with that component.

### Utility Modules

Shared utilities live in `frontend/src/utils/`, one module per concern:

| Module | Purpose |
|--------|---------|
| `appUrl.ts` | The URL grammar: parse, build, slugs, the legacy `?wv=` redirect. One module, with a round-trip test |
| `kindColors.ts` | The colour an object is drawn in (`experienceColors`: its kind's, refined by its type for World Heritage), source palette, shared colour constants |
| `experienceTypes.ts` | The closed vocabulary of types per kind (`typeOptionsFor`), and which vocabulary a value is from (`typeVocabularyOf`) |
| `dateFormat.ts` | Date/time formatting helpers |
| `imageUrl.ts` | Thumbnail URL generation |
| `queryInvalidation.ts` | TanStack Query cache invalidation helpers, over the key factory in `api/queryKeys.ts` — the one place a query key is built (#790) |
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

For example: use `<LoadingSpinner />` instead of writing another centered `CircularProgress`, or `VISITED_GREEN` from `kindColors` instead of hardcoding a hex color.

The full inventory of shared components and utilities — including a "use this, not that" reference table — is in [shared-frontend-patterns.md](shared-frontend-patterns.md). Keep that doc updated when extracting new shared code.

### API Layer

All API calls live in `frontend/src/api/`. Use `authFetchJson()` from `fetchUtils.ts` for authenticated requests. A read whose endpoint answers 204 for "there is none", as the geometry reads do for a region or division with no stored outline, uses `authFetchOptionalJson()` beside it, which reads the 204 as `null`. `authFetchJson` reads a 204 as an empty list, since that is what a list read means by it, and an empty array passes a caller's null test while carrying none of the answer's keys.

The one deliberate exception is `changePassword` (`api/auth.ts`): its endpoint answers a wrong *current password* with 401, and `authFetchJson` reads every 401 as an expired token — so the shared path would rotate the refresh family on each wrong attempt and eventually sign the user out under the sentence saying the session is fine. It builds its request by hand and takes its token from `requireFreshToken()`. The reasoning is in [authentication.md](authentication.md) § Password Security; do not "clean it up" back onto the shared path. Other hand-built authenticated calls (`getCurrentUser`, the `image-proxy` fetches in `useImageColorPicker` and `ImageOverlayDialog`) record no reason and are debt, not precedent.

**An endpoint's answer is declared once, on the backend** (ADR-0066). Its success body is a Zod 4 schema in `backend/src/api/responses/<module>.ts`, where `<module>` is named like the client module below whose function calls the endpoint. The web's types are generated from those schemas into `@tyr/shared/api`. The client function names the generated type, and its module re-exports it, so a component imports a call's answer from the call's module. A call's answer is never declared in `frontend/src/api/`.

The schema describes the wire, meaning what `JSON.parse` yields on the client:
- Every object is a `z.strictObject`. The generator refuses a plain `z.object`, whose parse would strip an undeclared key and pass while the key still went out.
- A timestamp is `z.iso.datetime({ offset: true })`, and the handler converts its `Date` with `toISOString()`.
- A vocabulary is read from where it is stated: `z.enum(CHECK_VALUES.…)` for a CHECK list, or the backend constant that holds it.
- A fixed-length array is a `z.tuple`, which the generator renders as `[number, number]`, and a tuple with a rest element is refused. `FocusBbox` and `AnchorPoint` in `responses/regions.ts` are the camera frame the map's reads carry.
- A field's meaning goes in `.describe()`, which reaches the generated type as JSDoc and later the OpenAPI document. Why the handler does what it does stays in comments.
- A rule across keys is a refinement (`superRefine`) on the schema. An example is a flag that comes only with a non-empty list, as with the placement pair in `responses/curation.ts`.
  - Zod's `toJSONSchema` does not carry a refinement, so the rule reaches neither the generated type nor the JSON Schema. Only `respond()`'s parse holds it, and only outside production.
  - A refinement that a second module needs lives beside `respond()` in `backend/src/api/`, because a response module exports schemas only.
- A schema module imports only `zod/v4`, the generated row types, vocabulary constants, the schemas of other response modules, and the pure helpers beside `respond()` in `backend/src/api/`. The generator imports every schema module, so nothing a schema imports may open a pool or read the environment.

The handler sends the body with `respond(res, Schema, body)`, from `backend/src/api/respond.ts`. A server-sent stream writes each event with `writeEvent(res, Schema, event)` beside it, and the stream's events are one schema, a union of their kinds (`ComputeProgressEvent` in `responses/geometry.ts`). Its headers are out before the first event, so a mismatch cannot become a 500: it throws into the handler, whose catch ends the stream with an error event. The body is typed from the schema, so an undeclared key in the literal, a `Date` where the wire says string, a value outside a vocabulary or a missing key fails `tsc`. Outside production, the body is also parsed strictly before it is sent, which covers both unit lanes, the dev stack, the smoke lane and `test:db`. A mismatch is a 500 that names the route and the issue paths. Call `respond()` outside any `try` whose `catch` answers with its own message, and after a transaction's `COMMIT` rather than inside it: otherwise that catch swallows the named 500, or answers a committed write with a `ROLLBACK` that has nothing left to undo.

TypeScript checks only the keys a literal writes itself, so build the body to write every key:
- An optional key is written as `key: cond ? value : undefined`, never as `...(cond ? { key } : {})`. JSON drops the `undefined`.
- A fragment spread into the body is typed as a `Pick` of the schema's type.
  - The placement pair is one such fragment. An answer whose call re-places the object spreads `placementReport(failures)` (`controllers/experience/placementReport.ts`), which is typed as `PublishResult`'s two keys, rather than mapping `placeAfterRelease`'s failures itself.
- Rows are typed from the generated row types (§ Database Queries) and mapped key by key, never passed through as `result.rows`. An untyped row is `any`, and `any` satisfies every type.
- A resource that several endpoints answer with is one schema and one mapper over one SELECT. Every region answer is `regionOf` over `REGION_SELECT_SQL` (`controllers/worldView/regionAnswerRows.ts`), and a write answers with that read rather than with its own `RETURNING`. A narrower copy for one endpoint drifts from what the client does with the answer, which is the same thing whichever endpoint it came from.

The runtime parse catches what the compiler cannot, on every path a lane exercises. Error bodies stay `{ error }`, and #793's route declarations are where they will be declared.

A success body sent around `respond()` fails `lint`: a `no-restricted-syntax` entry in `backend/eslint.config.mjs` (`RESPONSE_SHAPE_RULES`) reports a bare `res.json(…)`, or a `.json(…)` after a literal 2xx status, and the same with `send` when its argument is an object or array literal, which Express sends as JSON. It reads every source file but the specs and `respond.ts` itself. An error answer passes, including one whose status is a variable, and so does a `send` of a Buffer, a string or a name, whose type the rule cannot read. The rule exempts an endpoint only line by line, with an `eslint-disable-next-line` that names the issue deciding whether it stays: the endpoints the web does not call, #1006 and #1033.

An error body carries a sentence written for its reader, never the error's own text (#1021). A driver, an HTTP client or a model SDK writes table names, URLs and internals into `err.message`. A handler that catches its own failure logs the error with `console.error` and answers a fixed sentence. A cause the reader can act on is named by a code, the way the AI routes answer `quota_exceeded`. A failure the product names in its own words is thrown as a `ReaderFacingError` (`backend/src/api/readerFacingError.ts`), and `sentenceFor(err, fallback)` shows that sentence where any other error gets the fallback: the picture repair's "Wikidata did not answer, so nothing was changed — try again later" is the admin's only word that nothing changed. `ERROR_TEXT_RULES` in `backend/eslint.config.mjs` fails `lint` on an error's `.message`, the error passed to `String()`, turned into a string by its own `toString()` or interpolated whole into a template, inside a response body (`json`, `send`, `respond`), a redirect's address, a stream's event (`sendEvent`, `writeEvent`) or a progress status (`status`, `statusMessage`). The string cases read the error by its name (`e`, `err`, `error`, or a name ending in `Err` or `Error`), since `String(id)` or `${id}` in a body is an ordinary value. A value read into a variable first is beyond a selector, so review holds that case. `backend/src/middleware/errorTextLint.test.ts` pins both directions of the rule.

After changing a schema, run `npm --prefix backend run api:types` and commit `packages/shared/src/api.generated.ts`. `backend/src/api/apiTypes.test.ts` fails while the file is not what the schemas render to.

When adding a new endpoint:
1. Add the function in the appropriate `api/*.ts` file — the module of the caller it serves, which a URL's prefix does not decide. Everything under `/api/experiences` is three modules: `experiences.ts` for what a reader's screens ask of the catalogue, `reviewQueue.ts` for the review queue's calls (`/api/experiences/review/…`) and `curation.ts` for a curator's writes on one object (#933).
2. Declare the answer's schema in the backend module of the same name, regenerate, and name the generated type as the function's return type. Re-export it from the client module.
3. Use the API function in a hook or component — never call `fetch` directly from components.

### MapLibre Gotchas

**Fonts and symbols:**
- Symbol layers with broken glyph URLs silently stall the entire GeoJSON source rendering pipeline.
- Glyph server: `fonts.openmaptiles.org` — supports `Open Sans Regular/Bold/Semibold` only (NOT Noto Sans).
- Discover has its own inline map style with glyphs URL (separate from shared `MAP_STYLE`), in `discover/useDiscoverMap.ts` — update both when changing fonts.

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
| File > 500 lines of code | Look for split opportunities |
| File > 800 lines of code | The lint fails — split now |
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

### How to split (test files)

1. **By the surface under test.** The pieces are siblings in the same directory, named for what they ask about: `ReviewQueue.test.tsx` keeps the open questions, and `ReviewQueue.admission.test.tsx`, `.parts` and `.held` hold the review page's other cards.
2. **Keep the outer `describe`.** Every case then keeps its full name, so test history and a reviewer's search still find it.
3. **Each file installs its own `vi.mock`s.** A module mock belongs to the file that installs it, and so does the `vi.hoisted` value its factory reads.
4. **Share what the siblings need, once.** Fixtures, typed handles on the mocked calls and the answers each case starts from go to one co-located helper (`reviewQueueFixtures.tsx`, `reviewQueueCardMocks.ts`, `publishController.fixtures.ts`), never to a copy per file: the copies are what drift when the code under test makes one more call.

### A rule both sides apply

A rule the backend and the frontend both apply is declared **once**, in `packages/shared`, and imported by both as `@tyr/shared/<module>` (ADR-0065). Until #789 such a rule was written twice — once per side, because no import crossed the two packages — and held equal by a backend test reading the frontend's copy as text; six of those pins are gone with the copies.

**What goes in** is what both sides apply *and the browser must already know*: a list a card is drawn from and a run writes by (`pictures`), a fold a form and an endpoint compare names with (`labels`), a threshold the map and the database measure by (`geometry`), a vocabulary the schema constrains and a screen labels (`curationLog`, `auth`), an equality a run and a review card read by (`equality`), a ceiling a route enforces and a client asks for (`catalogue`), a distance and the thresholds a run and a review card decide a move by (`moves`). Everything in the bundle is something the frontend already shipped; nothing in the package authorises anything. One module is generated rather than written: `api.generated.ts`, the web's types for the backend's response schemas (ADR-0066, § API Layer). It holds types only, imports nothing, and is never edited by hand.

**What stays out** is anything that needs a runtime: a module that imports Express, React, `pg`, Zod or MapLibre, or reads `import.meta.env`, stays on its side — the package's `tsconfig.json` has `"types": []` and no DOM lib, so it would not compile there. A rule that is SQL text (`tidyLabelSql`) or a fetch address (`pictureFetchUrl`) stays on the backend beside the shared rule it spells.

**How it is built** — it is not. The package ships TypeScript source through subpath `exports`; each consumer's own `tsc`, `tsx`, Vite and vitest read it directly, so a type error in the package fails both sides' typecheck as well as `typecheck:shared`. Two rules follow: **one module, one concern, no relative import of a sibling** (Node's own type stripping runs the backend's emitted `dist/` against the source, and `./labels.js` does not exist on disk — a spec imports its module with `.js`, which only vitest resolves), and **no barrel** (a consumer bundles only the modules it imports). Its specs sit beside each module and run in the backend's unit lane, the way `scripts/*.test.mjs` do; its lint, typecheck and knip are its own gates, installed with `npm ci --prefix packages/shared`.

**Where the schema is a third statement** of the rule — a `CHECK` list, an enum — the package is held to it by a type: `backend/src/db/curationLogActions.test.ts` asks `expectTypeOf` whether the package's union and the generated `CheckValue<…>` (ADR-0064) are the same, and `tsc` fails before the spec runs. The frontend types what it derives from the vocabulary by the same union (`ACTION_LABELS: Record<CurationLogAction, …>`), so a label missing or invented is a type error there.

**In Docker** the package arrives as a named build context (`additional_contexts` in `docker-compose.yml`) copied to `/packages/shared`, where the `file:../packages/shared` link resolves from `/app` exactly as on a checkout; the dev stack mounts its `src/` over that copy on both containers. Only `src/` is mounted, so a new module, which adds a subpath to `exports`, reaches a running dev container only once its image is rebuilt (`npm run dev`, or `dev:backend:rebuild` and `dev:frontend:rebuild`); until then the backend stops at `ERR_PACKAGE_PATH_NOT_EXPORTED`. `packages/shared/README.md` has the same rules from the package's side.

### Tests that read a repository file

Some guards hold a claim in code against the file that actually states it: the schema in `db/init/01-schema.sql`, a numbered migration, Martin's `config.yaml`, a frontend module whose *shape* is the claim (that every `src=` goes through `toThumbnailUrl`, that no surface but `mapUtils.ts` calls `fitBounds`). They live in the backend suite because the things they compare have no test runner of their own, and the frontend's cannot read outside its root. What such a guard must **not** be any more is a pin between two copies of one rule: a rule both sides apply is imported from `packages/shared` (§ A rule both sides apply), and where the schema is a third statement of it the pin is a type, not a text read.

Such a spec locates the file through `backend/src/testSupport/repoFile.ts` — `repoFile(...segments)`, `repoRelative(path)` and `backendSrc` — never by counting `..` from its own module. That helper belongs to the backend package; the repository's own tooling specs — the `*.test.mjs` files under `scripts/`, which run in the same `test:backend` lane — use `scripts/repo-root.mjs` instead, whose `repoFile(...segments)` and `backendSrc` answer the same question by the same root walk. The split is the package boundary and nothing else: a `.mjs` sitting beside the scripts it tests cannot import from `backend/src`. `npm test` has two shapes: with `TEST_REPORT_LOCAL=1` it runs vitest on the host against the working tree, and without it inside the test stack's containers, where the backend mounts `backend/src` at `/app/src` and the repository directories it reads at the container root. A fixed walk up lands outside the checkout there, which is how 18 test files failed in the container lane while the host lane and CI stayed green (#948). The helper finds the root instead — the nearest ancestor holding `db/init/01-schema.sql` — and `scripts/test-stack.sh` refuses the run outright, naming the mounts, when a stale container does not have them.

A spec must also own any environment variable it asserts on. The container lane sets some of its own (`docker-compose.test.yml` raises the read ceilings for the smoke suite), so "the environment says nothing" has to be arranged by the spec, not assumed.

### Tests that need a database

The backend suite mocks the `pg` pool, so a test asserts the **text** of the SQL a function sends. That is the right tool for most of this codebase: it pins predicates, guard clauses and parameter binding cheaply, and its assertions catch real defects when each one is anchored to the clause it is about (a regex slice of the CTE) rather than to the whole statement. It cannot see *which row a statement selects*. A statement needs the database lane when **the assertion is about which rows the statement selects, not about what it says** — a CTE over a table holding rows the reader cannot see, a `row_number()` join, a partial unique index, a lock, a transaction boundary — or when **the assertion is about what the live server or driver hands back**, which the mocked pool is precisely what bypasses: `backend/src/db/schemaTypes.db.test.ts` selects one value of every Postgres type the generated row types map and compares what `pg` delivers with the claim (ADR-0064). Everything else stays in the mocked suite; the lane is for the row set and the driver's contract, not for coverage (ADR-0063).

The case that made the lane: the deferred-withdrawal pairing in `backend/src/services/sync/locationWriter.ts` had twelve text-level tests, all fifteen mutations of it were killed, and it still picked the wrong old row whenever two moves landed without a curator publishing in between — a one-point site showing the same place with two pins. Four statements on a real database saw it; no amount of text assertion could have (#522). `locationWriter.chain.db.test.ts` is that scenario as a test.

**Writing one.** The file is `*.db.test.ts`, beside the code it asks about; `backend/vitest.db.config.ts` runs those files and the unit config excludes them. It imports the real `pool` from `db/index.ts` — nothing is mocked — and ends it in `afterAll(() => pool.end())`. The fixture is the spec's own and destructive to its own rows only: ids pinned above the e2e fixture's 9001–9005 range, deleted before and after the run (the cascades take the dependants), seeded sources looked up by name rather than id, and never a `TRUNCATE` — the smoke fixture shares the database and has to be standing when the specs are done. Assertions are counts and ids read back from the table, and each step of a scenario carries one intermediate assertion, so a regression names the step that broke rather than the count at the end.

**Running it.** `npm run test:db` runs the lane inside the isolated test stack, against `track_regions_test` by default — `TEST_DB_NAME` names another database in that stack, and `scripts/test-stack.sh` refuses the golden one while the guard below refuses any name that does not say `test` — and only there: `TEST_REPORT_LOCAL=1` is refused for it, because on the host `db/index.ts` defaults to the dev catalogue. `TEST_REPORT_KEEP_ENV=1` keeps the stack up between runs while a spec is being written. The lane **fails rather than skips** without a database: `backend/src/testSupport/dbLane.globalSetup.ts` asks the server `SELECT current_database()` and throws unless the answer matches `TEST_DB_NAME_PATTERN` (`backend/src/db/testDbName.ts`, the same guard the e2e seed applies), and `dbLane.db.test.ts` is one permanent spec, so a green run always executed something. The unit lane never selects these files, which is how `npm test` stays a command a laptop without Docker can run. In CI the lane is a step of the E2E job, the one job with a database (`docs/tech/gates.md`).

### How NOT to split

- Don't create a file for a single 10-line function.
- Don't split just to hit a line count — split along responsibility boundaries.
- Don't create deep directory nesting. Two levels max (`components/feature/file.ts`).
- Don't scatter extracted files across unrelated directories.

## Linter Suppressions

Suppressions hide real issues over time. Treat each one as a deliberate exception that needs a written justification — like a `// HACK` in a code review.

### The rules

1. **No file-level or block-level disables.** Never write `/* eslint-disable rule */` at the top of a file or `/* eslint-disable rule */` … `/* eslint-enable rule */` around a block. They suppress the rule for everything that follows, including new code added later that the original author never reviewed.
2. **Always inline (one line, one suppression).** Use `// eslint-disable-next-line <rule>` or trailing `// eslint-disable-line <rule>`. Each disabled site is reviewed on its own.
3. **Always include a `-- reason`.** Every suppression must end with `-- <why>` explaining *what* makes the flagged code safe in this specific spot. The reason is what makes the suppression auditable.
4. **Name every rule explicitly.** Never use a bare `// eslint-disable-next-line` — that disables every rule on the next line and is far too broad. Always name each rule you intend to suppress. A single comment may list multiple rules (e.g. `// eslint-disable-next-line rule-a, rule-b -- reason`), but each rule must be named, and the `-- reason` must justify *all* of them.
5. **Same policy for every linter.** Every suppression syntax we use follows the same inline-with-reason rule:
   - **TypeScript** — `@ts-expect-error`, `@ts-ignore` (prefer `@ts-expect-error` — it errors when no longer needed)
   - **ESLint** — `// eslint-disable-next-line <rule>` / `// eslint-disable-line <rule>`
   - **Semgrep** — `// nosemgrep: <rule>` / `# nosemgrep: <rule>`
   - **Ruff** — `# noqa: <CODE>`
   - **mypy** — `# type: ignore[<CODE>]`
   - **Bandit** — `# nosec <CODE>`
   - **CodeQL** — `// lgtm[<rule>]` / `# lgtm[<rule>]`
   - **shellcheck** — `# shellcheck disable=<SCnnnn>` / `# shellcheck source=<path>`

   **shellcheck is the one exception to rules 3 and 4, and only to their
   syntax.** Its directives take no trailing `-- reason`; appending one is a
   parse error (SC1072), which fails the lint rather than documenting it. Put
   the reason on its own comment line immediately above instead — and make sure
   that line does not begin with the word `shellcheck`, because any comment
   starting that way is itself parsed as a directive (SC1073).

   Rule 4 also lands differently across its two forms. `disable=<SCnnnn>` names
   a code and is held to rule 4 as written. `source=<path>` names none — it
   tells the tool where a sourced file lives rather than switching a check off,
   and `source=/dev/null` is the accepted way to say "there is no fixed file to
   follow". So for that form the requirement is the stated reason, not a code:
   see `load_env` in `martin/run-martin.sh`, which uses exactly that shape —
   the reason from its opening word through to the sourced line. What never changes is one
   site at a time and a reason that says why.
6. **Config-level rule disables need a comment.** If you turn a rule `'off'` in `eslint.config.mjs` (or equivalent), add an inline comment naming why (see `security/detect-object-injection` in `backend/eslint.config.mjs` for the pattern). A rule relaxed for named files is the same pattern with a list, each entry carrying its reason — the way the `max-lines` block for `src/db/schema.generated.ts` in `backend/eslint.config.mjs` says why a generated file's length is not a file to split (§ Keep Files Small).

### Examples

```typescript
// ✅ GOOD — inline, single rule, with reason
// eslint-disable-next-line security/detect-non-literal-fs-filename -- filePath validated by safeCachePath: must match wikivoyage-cache*.json under CACHE_DIR
unlinkSync(filePath);

// ✅ GOOD — TypeScript suppression with reason, prefer @ts-expect-error
// @ts-expect-error -- passport-apple types are incomplete; module ships without callback typings
import AppleStrategy from 'passport-apple';

// ❌ BAD — file-level, hides everything that follows
/* eslint-disable security/detect-non-literal-fs-filename */

// ❌ BAD — no rule named, suppresses every rule on the next line
// eslint-disable-next-line
const x: any = doSomething();

// ❌ BAD — no reason, future readers can't tell if the suppression is still valid
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const cv: any = loadOpenCV();
```

```python
# ✅ GOOD — Ruff inline with reason
result = run_solver(  # noqa: E501 -- inline ASCII-art table is unreadable when reflowed
    matrix, tol=1e-9,
)

# ✅ GOOD — mypy inline with reason
warped = cv2.warpAffine(src, M, dsize)  # type: ignore[arg-type] -- cv2 stubs miss the (int,int) tuple overload; verified at runtime via tests/test_match.py

# ✅ GOOD — Bandit inline with reason
column = ALLOWED_COLUMNS[idx]
query = f"SELECT {column} FROM regions WHERE id = %s"  # nosec B608 -- column is from an allowlist; the value is parameterized below
cur.execute(query, (region_id,))

# ❌ BAD — file-level Ruff disable, hides everything that follows
# ruff: noqa

# ❌ BAD — bare suppression, no code or reason
result = some_call()  # noqa
```

### Writing a good reason

The reason should answer "why is this safe right now?" Not just restate the rule.

| Reason | Verdict |
|---|---|
| `-- false positive` | ❌ Useless — every suppression's author thinks it's a false positive |
| `-- ignore` | ❌ Useless |
| `-- needed for OpenCV.js` | ⚠️ Vague — *why* is OpenCV.js different? |
| `-- OpenCV.js (cv / cv.Mat) has no TypeScript types` | ✅ Specific and actionable |
| `-- filePath validated by safeCachePath: must match wikivoyage-cache*.json under CACHE_DIR` | ✅ Names the upstream guard that makes the call safe |
| `-- bounded character classes between literal anchors; no nested quantifiers, so no catastrophic backtracking` | ✅ Explains the regex-safety reasoning the rule missed |
| `# nosec B603 -- subprocess input is hard-coded path, not user input` | ✅ Names the upstream guarantee that defuses the rule |
| `# type: ignore[no-untyped-call] -- pyproj.Transformer.from_crs has no stubs in pyproj 3.7` | ✅ Specific lib + version, points to a fixable future state |

### When the rule is wrong everywhere

If a rule produces enough false positives that you'd suppress it in dozens of places, disable it in the config (`eslint.config.mjs`) with an inline comment naming why — don't sprinkle disables. The current `security/detect-object-injection: 'off'` is an example: it's globally noisy with TypeScript, so it's off at config level rather than suppressed inline 100+ times.

But: don't reach for config-level disable just because a rule is *occasionally* annoying. Inline-with-reason is the default; config-level is the escape hatch when a rule has no signal at all in this codebase.

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

## A migration deletes what its owner replaced

A change that gives a rule a new authoritative owner — a shared package, a route declaration, one writer module, a generated type, a trigger — is complete only when it names what that owner made unnecessary and removes it. Before the owner existed, the repository kept the rule's copies aligned by other means, and those means do not retire themselves: a migration that leaves them in place hands the repository both the new abstraction and the machinery built for the old duplication, which is more moving parts than it started with (#788, #926).

What such a change supersedes is one of five kinds:

| Kind | What it looked like | Retired by |
|------|---------------------|------------|
| **Parity test that reads source** | `backend/src/types/urlSafety.test.ts` read the frontend's `imageUrl.ts` as text to hold the picture hosts equal | the shared package (#789) — six such pins deleted in the same pull request |
| **Duplicated constant or type** | `frontend/src/utils/labelFold.ts`, the frontend's copy of the label fold | the shared package (#789) — file deleted |
| **Handwritten adapter or type** | `backend/src/db/schema.ts` (Drizzle's hand-kept table types) and `columnBounds.test.ts`, which held Zod bounds to the column widths | generated row types (#792) — both deleted |
| **Lint rule** | the two Cache-Control `no-restricted-syntax` rules in `backend/eslint.config.mjs` | the route declaration (#793), once no route bypasses it |
| **Reviewer cross-check** | a pair in the review bot's "places this repo states the same thing twice" list (`.github/workflows/claude-review.yml`, Phase 4) | the slice that gives the pair a home, which deletes the line when it lands, as #993 deleted the backend-response ⇄ frontend-consumer pair; a `[retired by #N]` mark names the owning slice while it is open, and the mark is not the retirement, the deletion is |

**The rule.** What the new owner makes deletable is deleted **in the same slice**, and the pull request's description lists the deletion as part of the result, beside what was added. A plan for such a change names the guard it deletes before any code is written; `/refactor-check` walks the five kinds on the branch and drafts that paragraph.

**Coexistence is a dated exception, not a state.** When a guard cannot go yet — a consumer still reads the old copy, a route still bypasses the registry — the pull request links the follow-up issue that owns the removal and names the dependency that blocks it now. "Remove later" with no issue, or an issue with no stated dependency, does not qualify.

**What is rejected.** An abstraction added beside independent representations that stay authoritative indefinitely is a new layer, not a home, and is not accepted as a migration: a shared module both sides *may* import while each keeps its own copy, a registry some routes join while the rest keep their hand-written middleware and the lint rule that polices them. A slice that deletes nothing has not moved the rule; it has added one more place that states it.

## Commits and Branches

### Commit Messages

Every commit must have a **title and body**:

```
back: Add batch location fetching for experience markers.

Replace N+1 individual location fetches with a single batch
endpoint that returns all locations for a region's experiences.
Reduces network requests from ~50 to 1 when opening a region
with many experiences.

Part of #234

Signed-off-by: ...
```

**Title rules:**
- Format `<Type>: <Topic>.` — `<Type>` is `front` (frontend), `back` (backend), `deploy` (deployment), or left blank if not specific to one. Do NOT use Conventional-Commit prefixes (`feat(scope):`, `fix(scope):`, …)
- Imperative mood: "Add X", "Fix Y", "Update Z" (not "Added" or "Fixes")
- Max 72 characters (including the type)
- Specific: "Fix hover state not clearing on region change" not "Fix bug"

**Body rules:**
- Explain **what** changed and **why** — not just how
- Wrap at 72 characters
- Reference related issues: `Closes #N` / `Fixes #N` (the change closes the issue), `Part of #N` (partial progress), or `Relates to #N` (loose association)
- Always sign off (`-s`). Add a `Co-Authored-By:` trailer **only** for AI-assisted commits, never by default

### Granular Commits

**Split large changes into multiple well-scoped commits.** Each commit should be independently reviewable and tell a coherent story.

Good commit sequence for a feature:
```
1. back: Add batch locations API endpoint     ← backend: schema + controller
2. front: Add useRegionLocations hook         ← frontend: data layer
3. front: Replace N+1 fetches with batch hook ← frontend: wire it up
4. Document batch location fetching           ← docs (blank type)
```

Bad: one giant commit "Add batch location fetching" with all of the above mixed together.

**Guidelines:**
- Each commit is one logical unit. An intermediate commit need **not** compile or pass lint on its own — introducing a schema before its consumer, or a test before its implementation, is often clearer than hiding both in one blob. What must pass every gate is the branch as a whole
- Backend and frontend changes can be separate commits when the feature has distinct layers
- Documentation updates get their own dedicated commit
- Refactoring and feature work never share a commit
- If a commit diff is hard to review in one sitting, it's too big — split it

### Branch Discipline

- **One purpose per branch/PR.** A branch delivers ONE feature, fix, or improvement.
- Don't sneak in unrelated changes — no "while I'm here" fixes, no inbox notes, no drive-by refactors.
- **Never commit `docs/inbox/`** — inbox is a local scratch space, not tracked in git.
- Branch naming: `feature/NNN-short-slug`, `fix/NNN-short-slug`, or descriptive kebab-case (`add-development-guide`).

### Review Surface

One purpose per branch is not the same as one sitting's worth of review. A branch
can be a single honest change and still be five times the work to review as the
median one — and the current workflow discovers that only after the review has
started, when the whole surface has been read and the threads are already open.
**A branch is split before its first review round, not after**, whenever the
split keeps each part to one purpose.

`npm run review:surface` measures how much review the branch asks for, in counted
lines, discounting what reviewers pass over: generated output, lines that only
moved between files, a single token swept across many files, and — at a
fraction — migrations and prose. The budget it reports against is the one in
`docs/tech/review-surface.md`, read off the recent history: the fifteen branches
over it drew a median of 28 review threads against five for the forty under. It
is a signal and not a gate — no CI job and no branch protection consults it.

```bash
npm run review:surface          # main...HEAD, with the seams a split could follow
```

Over budget, split along a seam the scorecard reports — an area, or a run of
commits — or record why the surface is inherently one change. `/pr-create` runs
this before it opens the pull request and writes a recorded reason into the body.
`docs/tech/review-surface.md` holds the baseline, the evidence for the budget and
the rule for moving it.

### Review Rounds

The review bot (`.github/workflows/claude-review.yml`) reads a pull request at
four moments, and a push is not one of them: when the PR is opened as a
non-draft; when a draft is marked ready; when someone with write access comments
`/review` — one round, drafts included, since an explicit ask is an ask; and on
every push, only while the PR carries the `review-on-push` label, which a
`/review always` comment applies and removing the label ends. A push by itself
brings no review, so the commands that push ask for the next round themselves:
`/pr-create` § 8 after every wave it pushes, `/commit` § 8 after a push to a
branch with an open PR. Those are the three modes Anthropic's managed Code
Review, Copilot and CodeRabbit ship between them; the measurement that set this
cadence is on #796. One pull request gets none of this: a PR that changes
`claude-review.yml` itself. The action refuses to run while the workflow file
differs from `main`'s copy, and the `review` check reports success anyway — so a
green check on such a PR is not a review, the maintainer reads that PR alone,
and what the change does is seen on the first PR after it merges.

What the bot posts arrives through two channels, and severity with provenance
decides which. An inline thread is opened only for a Critical or Major finding
that is the branch's own — introduced by it, or pre-existing and depended on by
the change — on a line the diff changed. A thread is a blocking ask:
`main` requires every conversation resolved, so each one costs the author a
round, and the bot opens one only for what must change before the merge.
Everything else — Minor, Note, and a `[pre-existing]` finding of any severity —
is a line in the bot's summary comment: information for the author, not an ask.

What an author owes any finding, thread or line, is a **disposition** (#924). A
verified finding — one the round checked against the code, not the reviewer's
claim as posted — ends in exactly one of three places. It is **fixed on the
branch** when the branch introduced it, or when it is pre-existing but the
changed path depends on it so the change is unsafe or incorrect while it stands;
the test is two questions, *would this problem exist if this branch were not
merged?* and, if it would, *is the changed path correct while it stands?*, and
a no to either makes it the branch's, folded into the owning commit in the same
wave. It is **filed** when it is a verified pre-existing defect the branch
neither introduced nor depends on and is worth durable backlog work: linked to
the open issue that already covers it, else created as a Bug through
`/issue-create`, and never a blocking thread or a fix wave on this branch. It is
**dropped** when verification found no defect — a false positive, a defensive
wish where a guarantee exists, a style preference — or a cleanup too small or
too speculative for the backlog, with its reason said once. Severity is the
reviewer's triage of urgency; the disposition is ownership: a Critical in a path
the branch never touched is urgent follow-up work, and a small defect the branch
introduced is the branch's. A branch never files a ticket for its own defect —
#753, #581 and #783 each ended with the branch's leftovers filed as tickets and
folded back in — and the record of a round is the `Review round <n> —
dispositions` comment the loop posts before `/review`, listing what was fixed,
filed with its number, and dropped; the bot's re-review summary verifies it in a
`Dispositions since <sha>` tally, so the maintainer sees where review scope ended
without reading every round. `/pr-create` § 8 states the rule for the loop and
`/pr-comments-analyze` sorts each item by it.

A re-review converges rather than restarts. Its notes cover only the lines
changed since the head SHA the previous summary names, an earlier note that
still stands is not repeated (the earlier summary holds it), and the bot
resolves its own threads it finds addressed at the new head, and opens no second
thread on a finding that already has one. The round on the author's side runs
in the order `/pr-create` § 8 "The next round" states — the one place it is
written, for a PR with the `review-on-push` label and for one without, so it is
not repeated here — and the re-review then reads the replies and the
dispositions, and a reasoned decline closes a thread the same way a fix does; a
wave with no push — every finding declined with a reason — is a round too. The
same section says when a round is asked for and what to wait on: the workflow run the comment started, since a
comment-triggered run's check attaches to `main`'s head and never shows under
the PR's checks.

A round ends on both bots, not on CI (#920). Claude's half is that workflow
run; CodeRabbit's is the commit status it sets on the head — context
`CodeRabbit`, `pending` while it reads, then `success` with "Review completed"
or, on about every other push under its hourly allowance, "Review rate
limited", which is as finished as a review for the round's purpose (a final
pass is asked for with `@coderabbitai review` once the window reopens, and the
loop never waits on it). The next wave starts once both have finished and
covers everything gathered by then, never on the first comment from either.
CI binds the branch rather than the round: a job already red when the round
ends joins the wave, one that fails later opens a wave of its own, and a
wave's push owes the per-commit tier locally while CI answers for the slow
lanes — the slow tier is run before the pull request opens and again on the
head the maintainer is asked to merge, then only when a wave touched its
inputs — keyed on the wave's own edits, which each round comment records on a
`Touched:` line, never on a diff between two heads (`/commit` § 8; `/pr-create`
§ 8 *Done* is the step that reads those lines and runs it, since the wave's own
push is exempt). `/pr-create` § 8 "The next round" is
the one statement of the signal, the command that reads it off the pull
request's head, and the two clocks that bound the wait — a head CodeRabbit
never picks up, and a status that never leaves `pending`.

The "same thing twice" list in the bot's Ripple phase is a guard for rules
without a single home; each pair is deleted by the #788 slice that gives its
rule one, in the same pull request, so the list only shrinks. A text finding is
fixed by its shape: a stale count, tally or line pointer the way § What a
living document may not say asks — drop the volatile claim and name the class
or the symbols, rather than refresh a number the next change will falsify
again — and a sentence of history in a comment the way § What a source comment
says asks — state the invariant it was leading to and point at the record,
never keep the superseded behaviour in the comment because it is informative.

## Security

This project follows **OWASP ASVS 5.0 Level 2**. Key rules:

- **Never** concatenate user input into SQL — use parameterized queries
- **Always** validate inputs with Zod schemas via `validate()` middleware
- **Always** verify resource ownership (IDOR prevention)
- **Always** apply auth middleware to new endpoints
- **Never** expose secrets in code, configs, logs, or error messages
- **Never** log sensitive data (passwords, tokens, coordinates)

See `docs/security/SECURITY.md` for the full security profile and `CLAUDE.md` for the complete rules.

## Verification Workflow

**A gate runs when, and only when, the inputs it checks have changed.**
`scripts/gates.mjs` is the map from each gate to its inputs; `npm run gates`
prints which gates the current change asks for and why the rest are skipped;
`docs/tech/gates.md` has the map and the reasoning. Before every commit:
`npm run check` (the fast gates the change asks for; `npm run check:all` forces
every one), `npm run gates -- run test` (the unit lanes it asks for;
`TEST_REPORT_LOCAL=1` keeps them on the host), and `/security-check`. Before
the pull request opens, and again on the head the maintainer is asked to merge
when a review wave since then touched their inputs: `npm run security:all` (the
fast gates plus the slow Semgrep and Trivy scans the change asks for) and, when
`npm run gates` lists them, `npm run test:e2e:smoke`, `npm run test:db` and
`npm run perf:local` — a review-wave push owes the per-commit tier alone, and CI
answers for the slow lanes on the pushed head (`/commit` § 8 holds the rule,
#920). A gate the map
skips was not run and did not need to be; a gate the host cannot run (the Python tooling
guard) is a failure to report, not a skip. CI reads the same map per job, so a
skipped job is a job whose inputs the pull request does not touch.

```bash
npm run gates                       # every gate, run or skipped, with its reason
npm run check                       # the fast gates this change asks for
npm run gates -- run test           # the unit lanes it asks for
npm run gates -- run stack          # the before-push lanes, listed with run/skip marks
```

ADR-0062 is the rule and `scripts/gates.mjs` holds the only copy of the map, so
a gate whose point is not obvious is a gate whose `inputs` line says what it
reads (#783).

It expects dependencies installed in `backend/`, `frontend/`, `packages/shared/`
and the repository root, with npm rather than pnpm — the pins live in each
`package-lock.json`, which pnpm does not read. The root holds the repo-wide
lint tooling (`madge` for `lint:circular`, `markdownlint-cli2` for `lint:md`),
whose versions come from the tracked root `package-lock.json` rather than from
the registry at run time.
A missing root install stops those gates with the name of the gate that did not
run; a missing `cv-python/.venv` does the same for the `*:py` gates, which only
a change under `cv-python/` — or, for the test lane, the GADM loader's own
Python files — asks for.

For periodic cleanup (includes exports/types, ~30-40% false positive rate on exports):

```bash
npm run knip:full      # full knip scan including exports/types
```

The before-push tier assumes Docker and minutes of runtime, which is why the map
lists those lanes rather than running them:

```bash
npm run security:all   # the fast gates, then the slow Semgrep and Trivy scans the change asks for
npm run test:e2e:smoke # isolated test stack, seeded fixture, Playwright smoke
npm run test:db        # the database-backed backend specs, inside the same stack (a real Postgres, not the mocked pool)
npm run perf:local     # the production build on the dev stack's own data: size, Lighthouse, the probe
```

### Reading a smoke result

The smoke lane gives a spec that fails a second attempt before calling it
failed — `retries: 1`, and the `e2e` service sets `CI=1`, so that holds on a
developer's machine exactly as on a runner. A spec that passes runs once.
What the wrapper then prints says which of three things happened, and only
one of them is about the branch:

- **PASS**, with a `Flaky:` line and the specs named under
  *Flaky (passed on retry)* — a spec failed its first attempt and passed the
  second. The run is green: a retry-pass is not a failed gate (#447). What
  the **failed** attempt did is what is kept — `trace: 'retain-on-first-failure'`
  records every first attempt and throws the recording away when it passed —
  so `frontend/test-results` and `frontend/playwright-report` hold that
  attempt's trace, screenshot and video, and CI keeps both directories as the
  `playwright-report` artifact on **every** run, green ones included. Open the
  trace with `npx playwright show-trace <trace.zip>`. One spec flaking under a
  parallel Docker build is the box; the same spec flaking on an idle machine
  is a defect — chase it there, not in the gate.
- **FAIL** — a spec never passed in two attempts, or none ran at all. A suite
  whose specs all skip is a failure too: Playwright exits 0 for it, so the
  verdict rests on specs that actually ran.
- **Failed to prepare test environment** — no spec ran, because the stack
  never got ready. Three things can end it there, and the message is the same
  for all three: the image build, a readiness probe that went unanswered for
  180 s, and the fixture seed. The build and the seed leave the failing
  command's own output immediately above the message; the readiness one is
  the case that prints `docker compose ps` and the last 200 lines of that
  service's own log, which is what says whether it was slow, crashed, or
  never bound the port. That is the state *at the moment of the timeout*, and
  on CI it is the only copy there will be — the runner is discarded. Locally
  the run exits before the cleanup step, so the stack is still up whichever
  of the three it was: `docker compose -p tyr-test logs <service>` gives the
  whole log rather than the printed 200 lines, and `npm run test:stack:down`
  puts it away afterwards. A database still finishing its first boot is not
  one of the three: the `db` healthcheck asks over TCP, which the temporary
  server that runs `db/init` does not listen on, and the backend waits for
  `SELECT 1` before its first statement (`waitForDatabase`), retrying a
  refusal or `57P03` for about thirty seconds (#775).

The per-spec budget is 120 s against 14–47 s measured on an idle machine
(`frontend/playwright.config.ts` carries the numbers). Nearly all of that is
the app load every spec pays, plus the tracing above; a spec that approaches
the budget is describing the load, not its own assertions.

Neither tier above touches the **rows**. Where a change writes catalogue data —
a sync service, the location writer, region placement — the question "did the
run write rows that should not exist" is asked of a database rather than of a
branch, and it is asked in the **admin panel → Catalogue Checks**, not from a
terminal. It cannot be a push gate: a push carries code, and the rows live in
whatever database that code is later run against. See
`docs/tech/data-assertions.md` for what is asserted and how accepted debt works.

## Performance

Performance is measured, budgeted and gated — not felt. Two tiers, both run
by CI on every pull request whose inputs ask for them — they are `app` gates,
so a prose pull request runs neither (`docs/tech/gates.md`) — and both
available locally under the same names, plus a local run on the developer's
own data:

```bash
npm run perf:size      # build the frontend, check the entry chunk and each named chunk against its gzip budget (size-limit)
npm run perf           # Lighthouse against the production build on the isolated test stack (the fixture)
npm run perf:api       # p50/p95 of the hot read endpoints against a running stack (a measurement, not a gate)
npm run perf:local     # all of the above on the dev stack and its real catalogue - the pre-push run
```

**A visitor downloads the shell, not the whole application** (#643). The
admin panel and the review queue are route-level chunks (`React.lazy` at their
`<Route>` in `App.tsx`), the world-view editor loads the first time it is
opened (`HierarchySwitcher`), and the curation dialogs the first time a curator
opens one (`components/shared/lazyCurationDialogs.tsx`). A new admin or curator
screen goes under `/admin/*` or `/review`, or is `lazy` where it mounts: a
static import of it from the shell puts it back in the entry chunk, and the
entry chunk's `size-limit` row fails on it. The lazy chunks have rows of their
own (`frontend/package.json`), keyed by the screen each one is named after.
Such a screen is loaded with `lazyChunk()` and mounted in a `ChunkBoundary`,
not with a bare `React.lazy` and `Suspense`: a chunk can fail to arrive — a
deployment replaced the file names an open tab still asks for — and without
the boundary that failure unmounts the whole application.

**Performance is measured on the production build, never on the dev server.**
The dev server serves unbundled modules with HMR and no compression: the map
view through it is 370 script requests, 19.7 MB and a 17 s LCP, where the
built page is a few compressed chunks, about 560 kB of script and a
second's LCP (`docs/tech/performance.md` § Baseline has the dated
measurement). Numbers taken from the dev server describe
the development tooling, not the product, and the Lighthouse runner refuses
to measure it. The dev stack's frontend has both shapes; switch and check with

```bash
npm run dev:frontend:preview   # production build on localhost:5173, compressed - measure this, or open it and look
npm run dev:frontend:dev       # back to the dev server
npm run dev:frontend:mode      # which one is answering right now
```

Telling them apart without a command: the dev server's tab is titled
"Track Your Regions (dev server)" and its document loads `/@vite/client`; the
built page has the plain title and one hashed `/assets/index-*.js`. The
world view a visitor sees has to be public for the real-data pages to load
(`is_public` on `world_views`; the mirror world view is public on the dev
database for this reason).

The budgets live next to what they measure — `frontend/package.json`
(`"size-limit"`), `frontend/perf/lighthouse-budgets.json` for the CI lane and
`frontend/perf/lighthouse-budgets.local.json` for `perf:local` (the two carry
different numbers: the local one is measured on the real catalogue) — and
the numbers they were set from, with the rule for moving them, in
`docs/tech/performance.md`. The short form of that rule: a budget sits just
above the last measured baseline, **lowering** one is a deliberate change,
**raising** one needs a stated reason in the pull request. The lane exists
to make an anti-pattern visible in the PR that introduces it — a dependency
that doubles the bundle, a layout that shifts, a screen that blocks the
main thread — while the UI is still cheap to change, not to certify the
current frontend as fast.

When the gate goes red, read the report before touching the budget:
`frontend/lighthouse-report/` holds every run's HTML, and CI uploads the
same directory as the `lighthouse-report` artifact. The summary the lane
prints names the page, the metric and the number; the HTML report names
the element and the request behind it.

## Slash Commands

The project has slash commands (in `.claude/commands/`) that automate common workflows. Use them — they encode the conventions in this guide:

| Command | When to use |
|---------|-------------|
| `/feature <issue#>` | Start work on a feature — reads the issue's type, fields and hierarchy (an Epic with a slice list whose every slice carries its ledger mark — `→ #N`, `→ merged into #N` or `→ dropped: …` — points at its sub-issues; one with no list yet or with unmarked slices is reconciled against the sub-issues it already has and then decomposed into the rest instead of coded — each marked on the Epic as it is created — blocked or not, the slices carrying its blockers; a blocked non-Epic is refused), creates branch (board → 🏗 In progress), enters plan mode, checks for reusable code, updates docs |
| `/fix <issue#>` | Fix a bug — the same state, blocker and Epic gates as `/feature` (neither command gates on type: a bug that needs a design may go through `/feature`), then minimal change (board → 🏗 In progress), explains root cause before fixing |
| `/commit` | Commit changes — organizes into atomic commits, enforces title+body format, filters junk |
| `/pr-create` | Create a PR — rebases on main, fills PR template, moves referenced issues to 👀 In review, then babysits the PR until it is mergeable |
| `/review-pr` | Review PR comments — analyzes, categorizes, creates action plan |
| `/pr-comments-analyze` | Deep analysis of PR review comments with draft replies |
| `/pr-comments-reply` | Post replies to addressed PR comments |
| `/pr-changes-amend` | Fold review fixes into original commits for clean history |
| `/security-check` | Quick pre-commit security scan of changed files |
| `/security-review [file]` | Deep security review of a specific file or module |
| `/security-audit` | Full OWASP ASVS 5.0 audit with report generation |
| `/security-alerts` | Triage GitHub code scanning alerts (CodeQL, etc.) |
| `/quality-alerts` | Triage code quality alerts |
| `/refactor-check` | Post-refactoring check — a change that gave a rule a new owner deletes the guard the owner made obsolete (or links the issue that owns it), and the dev guide has rules preventing the old pattern from recurring |
| `/issues` | Browse the task board — Backlog grouped by Priority with type, Size/Theme/AI fit, parent and blockers |
| `/issue-create` | Create a new GitHub issue — type (Bug / Feature / Task / Epic), the form's body shape in a neutral voice, area labels, Priority / Size / Theme / AI fit, parent / blockers / milestone, board placement; a slice of an Epic also gets its `→ #N` ledger mark written onto the Epic's own list, which the other commands gate on |
| `/issue-upload` | Batch-create issues from a markdown file — the same type, fields, hierarchy and Epic mark per item, with a file ledger that lets an interrupted run resume, plus a lookup of recently created issues shown for adoption before the batch is confirmed, which covers the one gap the ledger cannot (a create that succeeded while its file mark failed); a line is cleaned up only once its placement, its Epic mark and — for an adopted issue — its hierarchy, labels and type have all landed |
| `/review-dependabot` | Review Dependabot PRs and security alerts |

### Typical workflows

**Feature development:**
```
/feature 267          # start feature from issue
  ... implement ...
npm run check         # verify
/security-check       # security scan
/commit               # atomic commits + push
/pr-create            # create PR, then babysit it until mergeable:
                      #   watch checks, answer every review thread,
                      #   /pr-changes-amend fixes into owning commits,
                      #   force-with-lease push, comment /review,
                      #   repeat until green
```

**Refactoring:**
```
  ... refactor (extract shared components, consolidate utils, etc.) ...
npm run check         # verify
/security-check       # security scan
/refactor-check       # delete the guard the new owner replaced; verify dev guide prevents the old pattern
/commit               # atomic commits + push
/pr-create            # create PR + babysit until mergeable
```
