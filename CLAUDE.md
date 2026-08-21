# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run check              # Comprehensive gate: lint + typecheck (Node + Python) + fast security + knip + lint:extra. Same script CI runs. (~90s, run before committing)
TEST_REPORT_LOCAL=1 npm test  # Unit tests without Docker (run before committing)
npm run test:e2e:smoke     # Playwright smoke against the isolated test stack (before pushing)
npm run dev                # Start all services via Docker Compose (rebuilds images, so container deps track package.json)
npm run db:shell           # Open psql shell to active database
npm run help               # Full command reference (all other scripts: package.json)
```

Backend runs on port 3001, frontend on port 5173, Martin tile server on port 3000, cv-python on port 8000.

### Mandatory Pre-Commit Checks

**Before every commit**, run all three:

1. `npm run check` — comprehensive gate: lint + typecheck (Node + Python) + fast security (Bandit, pip-audit, npm audit) + knip + lint:extra (madge, shellcheck, hadolint). ~90s. Same script CI runs in its `check` job, so a clean local check means a clean CI check. Secret detection is split and does not fully compose: GitHub native scanning + push protection read every file type but match known provider patterns only, while Semgrep `p/secrets` (CI) covers source but skips the types `.semgrepignore` drops (`*.yaml`, `*.yml`, `*.json`, `*.sql`, `*.md` — note `*.yml`, which is what `docker-compose.yml` and `.github/workflows/*` are). A generic credential in a config file is seen by neither — see `docs/security/SECURITY.md` § Known Gaps.
2. `TEST_REPORT_LOCAL=1 npm test` + `npm run test:py` — unit tests for both stacks
3. `/security-check` — Claude Code security review of changed files

The exception is a deliberately layered sequence — a schema committed before its consumer, a test before its implementation. Those intermediate commits are expected not to build, so commit them with the gate red and get it green before the branch leaves your machine. The gate binds the branch, not every commit in it. See `docs/tech/development-guide.md` § "Granular Commits".

**Before pushing**, also run `npm run security:all` — it adds the slow scans (full Semgrep on both stacks, Trivy image CVE scan) on top of `check` — and `npm run test:e2e:smoke`, which stands up the isolated test stack and seeds its fixture automatically before running the Playwright smoke specs. Both tiers assume Docker and minutes of runtime, which is why they sit here and not in the per-commit tier above. CI runs the slow Semgrep + Trivy in their own jobs, plus an `E2E Smoke` job on every pull request. CodeQL (JS+Python) runs via GitHub's default-setup code scanning, configured in repo settings rather than as a workflow file.

**Before opening a PR**, the branch history must be clean: **no commit may exist solely to fix, amend, or "address review" on an earlier commit of the same branch.** Fold such fixes into the commits they belong to (run `/pr-changes-amend`) so every commit is self-contained and independently reviewable. The `/pr-create` command enforces this as a gate. See `docs/tech/development-guide.md` § "Granular Commits".

Python dev tooling lives in `cv-python/requirements-dev.txt` (ruff, mypy, pytest, pytest-cov, bandit, pip-audit). One-time setup: `npm run setup:py:dev` creates `cv-python/.venv` and installs both requirements files. The `*:py` npm scripts call `.venv/bin/<tool>` directly so they work without venv activation. CI covers both shapes across two jobs: the checks job builds the same venv with `npm run setup:py:dev`, and the Python test job installs into the runner's own interpreter with `actions/setup-python` + `pip install`. The venv is required locally — `scripts/require-py-tools.sh` guards each `*:py` gate and fails outright when a tool is missing, rather than letting `sh: .venv/bin/ruff: No such file or directory` read as environment noise while the rest of the chain silently does not run. `setup:py:dev` needs `python3.12` by name, since CI pins 3.12 and cv-python ships on `python:3.12-slim`; where that binary is absent *and* no venv exists, the guard prints a container command that runs the same gates against the pinned interpreter. An existing venv keeps working — the pin binds building one, not using one.

## Architecture

### Stack
Express backend + React/MUI frontend + PostgreSQL/PostGIS + Martin vector tile server. TypeScript everywhere. Drizzle ORM for queries, raw `pool` for PostGIS geometry operations.

### Database
- **Name**: `track_regions` (NOT `track_your_regions`)
- **Container**: `tyr-ng-db` — access via `docker exec -i tyr-ng-db psql -U postgres -d track_regions`
- **Schema**: `db/init/01-schema.sql` — the only init file: tables, triggers, auth, Martin tile functions and the SRID 3857 columns. One-shot changes for databases that already hold data live in `db/migrations/` (see its README)
- **Extensions**: PostGIS, pg_trgm, unaccent

### Domain Model
- **administrative_divisions** — GADM official boundaries (tree via `parent_id`), pre-simplified at 4 LOD levels
- **world_views** — Custom regional hierarchies. Default world view (id=1) is GADM itself
- **regions** — User-defined groups within a world view, hierarchical via `parent_region_id`. Has computed geometry, `focus_bbox`, `anchor_point`, `is_leaf`
- **region_members** — Links regions to divisions, supports `custom_geom` for partial coverage
- **experiences** — UNESCO sites, museums, public art. Multi-location via `experience_locations` table
- **experience_categories** — UNESCO (id=1), Top Art Museums (id=2), Public Art & Monuments (id=3). `display_priority` controls ordering (lower = first)
- **treasures** — Independently trackable items inside venues (artworks, artifacts). Globally unique by `external_id`. Linked to experiences via `experience_treasures` junction table (many-to-many)
- **is_iconic** — Boolean flag on both `experiences` and `treasures` for highlighting must-see items

### Structure notes (non-obvious contracts; layout itself — see `ls backend/src`, `ls frontend/src`)
- Startup cleanup in backend `index.ts` marks orphaned `running` sync logs as `failed`
- All frontend API calls go through `authFetchJson()` (`frontend/src/api/fetchUtils.ts`) with in-memory JWT; refresh token lives in an httpOnly cookie
- Map: MapLibre GL via react-map-gl; `RegionMapVT.tsx` renders Martin vector tiles; `ExperienceMarkers.tsx` uses declarative `<Source>`/`<Layer>` over one unclustered GeoJSON source — a density heatmap below `HEATMAP_MAX_ZOOM`, individual markers above it. Discover Mode still clusters, on its own map instance

### Martin Vector Tiles
- Config: `martin/config.yaml` (auto-discovers PostGIS functions; table auto-publish is off)
- Tile endpoints: `tile_gadm_root_divisions`, `tile_world_view_root_regions`, `tile_region_subregions`
- Frontend: `MARTIN_URL` from `VITE_MARTIN_URL` env var, source layers: `regions`, `divisions`, `islands`

## Key Patterns

### Sync Services
Follow pattern: `syncX()`, `getXSyncStatus()`, `cancelXSync()`. In-memory progress via `runningSyncs` Map. `finally` blocks use captured `thisProgress` reference to avoid timer race conditions.

### Geometry & Triggers
Two triggers fire on region geometry changes: `update_region_metadata()` (area, archipelago flag) and `update_region_focus_data()` (anchor_point, focus_bbox). Hull services in `backend/src/services/hull/` handle dateline-crossing geometries.

### Antimeridian Handling
`focus_bbox` = [west, south, east, north]; `west > east` means antimeridian crossing. MapLibre's `cameraForBounds()` does NOT handle this — use pre-computed `anchorPoint` as center. Zoom computed via shifted bbox (`east + 360`).

### Experience Images
**Every image is a remote URL today** — measured on the live database: 0 of 1272 UNESCO rows and 0 of 332 Wikidata-sourced rows are stored locally, despite `/data/images` machinery existing for it. UNESCO images are served from `whc.unesco.org/document/<id>`; museums, landmarks and artworks from Wikimedia Commons. Thumbnails via `Special:FilePath/X.jpg?width=N` (CDN-cached sizes: 120, 250, 330, 500, 960, 1280px). Wikimedia requires proper User-Agent, 429+Retry-After handling, 1.5s delay between downloads.

**A hosted picture carries a credit.** Most Commons files are CC BY / CC BY-SA, whose one condition is naming the author wherever the work is shown; UNESCO's syndication terms ask for the same. Credits are captured at sync time into `metadata.imageCredit` (`imageCredit.ts`) and rendered by `ImageCreditLine`. Anything new that displays an experience picture shows the credit with it.

### Shared Components
Reusable UI components live in `frontend/src/components/shared/`, shared utilities in `frontend/src/utils/`. Always check these before writing inline equivalents. See `docs/tech/shared-frontend-patterns.md` for the full inventory with usage guidance.

### Curation System
- **Shared dialogs**: `CurationDialog` (edit, reject/unreject, and take a lifecycle verdict back) and `AddExperienceDialog` (search+assign / create new) in `frontend/src/components/shared/`
- Used from both Map mode (`ExperienceList.tsx`) and Discover mode (`DiscoverExperienceView.tsx`, `DiscoverPage.tsx`)
- Rejection filtering: `getExperiencesByRegion` excludes rejected items (descendant-aware for `includeChildren`), `getExperienceRegionCounts` excludes from tree counts
- `requireCurator` middleware checks role; admins have implicit curator powers

### Refactoring Hygiene
When modifying code, always clean up leftovers from the change:
- **Remove unused imports** after deleting or moving code that used them
- **Remove unused variables** after replacing logic (e.g., old variable superseded by a new one)
- **Update downstream checks** after adding guards — if a null guard throws/returns early, remove now-redundant null checks below it
- **Remove redundant conditionals** in JSX after adding early returns that guarantee truthiness

## Security Standards

This project follows OWASP ASVS 5.0 Level 2.
Security profile: `docs/security/SECURITY.md`
Current audit status: `docs/security/asvs-checklist.yaml`

### Security Rules (Always Apply)

1. **Never** concatenate user input into SQL/NoSQL queries — use parameterized queries or Drizzle ORM
2. **Never** render user-generated content without escaping (experience names, user names, external data)
3. **Always** verify resource ownership before returning data (IDOR prevention)
4. **Always** validate and sanitize file paths and content-types for server-side downloads
5. **Never** expose secrets in code, configs, logs, or error messages
6. **Always** enforce authorization server-side, never trust client-side checks
7. **Always** use HTTPS and secure cookie flags in production
8. **Never** log sensitive data (passwords, tokens, precise user coordinates)

### Security Slash Commands

- `/security-audit` — Full OWASP ASVS 5.0 audit with report generation
- `/security-check` — Quick pre-commit check on changed files
- `/security-review [file]` — Deep review of a specific file or module

## Documentation

Docs live in `docs/` with this structure:

```
docs/
├── decisions/        ← Architecture Decision Records (immutable)
├── inbox/            ← unsorted docs awaiting categorization
├── security/         ← OWASP ASVS security profile, checklist, audit reports
├── tech/             ← technical details of implemented features
│   └── planning/     ← plans for features to build next
└── vision/           ← non-technical vision, user stories, concepts
    └── vision.md     ← root vision document
```

See `docs/README.md` for the full index.

### Documentation Workflow

When working on this codebase, keep docs in sync:

- **Planning a feature** → create or update a doc in `docs/tech/planning/`. **Plans are never committed** — they stay untracked local working documents (the directory is gitignored). Do not stage one, and never open a PR for one
- **Implementing a feature** → update relevant `docs/tech/` doc (or create one). This is the committed artefact: docs describe **what exists**, never what is planned. A committed plan starts drifting from reality the moment it lands and becomes a second, wrong source of truth
- **Any user-facing change** → **always** update `docs/vision/vision.md`. This applies to any change that affects what visitors, users, curators, or admins can see or do — new UI, changed workflows, new input methods, etc. Vision docs describe the product from the user's perspective
- **Security-relevant change** → update `docs/security/SECURITY.md` (profile, known gaps) and/or `docs/security/asvs-checklist.yaml` (requirement status). This applies to new auth flows, new API endpoints, new input surfaces, file handling changes, new roles/permissions, or changes to token/session handling
- **Completing a plan** → trim the planning doc to only unimplemented ideas/improvements. Remove fully implemented sections
- **Pure idea or concept** → add to `docs/vision/`
- **Architectural decision** → create an ADR in `docs/decisions/` (see below)
- **Unsorted** → drop in `docs/inbox/`, categorize later

### Architecture Decision Records (ADRs)

ADRs live in `docs/decisions/`. They are **immutable** — only `Status` can change. Never delete an ADR; mark it `Superseded by ADR-XXXX` and create a new one. When the new ADR narrows only part of an older one and the rest stands, mark it `Accepted — decision N narrowed by ADR-XXXX` instead: superseding a multi-decision ADR to revise one of them retires the decisions that still hold.

**When to create an ADR** — before implementing any change that involves:
- Choosing a library, framework, or external service
- Changing database schema design patterns or API conventions
- Choosing between fundamentally different technical approaches
- Any decision that would be surprising or hard to reverse later

Do **not** create an ADR for: bug fixes, routine feature additions, styling changes, or anything that follows already-established patterns.

**When to read ADRs** — before proposing any architectural change, check `docs/decisions/` for existing decisions. Either follow them or explicitly propose superseding with a new ADR.

**Linking in code** — add a short comment at the relevant entry point:
```typescript
// ADR-0004: Drizzle ORM over raw SQL
const result = await db.select().from(regions).where(eq(regions.id, id));
```

See `docs/decisions/README.md` for the full process, template, and index.

## Required Reading by Area

Before working in a specific area, read the relevant docs. Start from the area guide, drill into detail docs as needed.

| Area | Start here | Details |
|------|-----------|---------|
| **Code conventions** (any area) | `docs/tech/development-guide.md` | Splitting patterns, commit hygiene, refactoring rules |
| **Map rendering, tile layers, map interactions** | `docs/tech/development-guide.md` § MapLibre Gotchas | `docs/tech/maplibre-patterns.md` — overlapping layers, MVT gaps, feature IDs, paint priority, fonts |
| **Map UI behavior** (markers, hover, selection) | `docs/tech/experience-map-ui.md` | Marker model, hover cards, context layers, exploration outlines |
| **Shared frontend components/utils** | `docs/tech/shared-frontend-patterns.md` | Full inventory with "use this, not that" table |
| **Experience system** | `docs/tech/experiences.md` | Sources, sync, region assignment, API |
| **Security** | `docs/security/SECURITY.md` | `docs/security/asvs-checklist.yaml` — per-requirement status |
| **Auth flows** | `docs/tech/authentication.md` | JWT, OAuth, tokens, email verification |
| **Architecture decisions** | `docs/decisions/README.md` | ADR index, when/how to create, template |
| **Product vision** (user-facing changes) | `docs/vision/vision.md` | Role-specific capabilities, design principles |

## Skill Integration Rules

When executing **any** skill workflow (brainstorming, writing-plans, debugging, TDD, code review, etc.), the following project rules always apply **in addition to** the skill's own instructions:

1. **Read area docs first** — consult the "Required Reading by Area" table above before exploring code or proposing changes
2. **Reuse before creating** — search `frontend/src/components/shared/`, `frontend/src/utils/`, and existing services before writing new code
3. **Docs alongside code** — update `docs/tech/` for implementation details and `docs/vision/vision.md` for any user-facing change, in the same step as the code change (never as a follow-up)
4. **ADRs for architecture** — check `docs/decisions/` before proposing architectural choices; create a new ADR if one is needed
5. **Security standards** — follow OWASP ASVS 5.0 Level 2 rules (see Security Standards section above)
6. **Pre-commit checks** — before every commit, run `npm run check` (comprehensive gate; includes knip + lint:extra), `TEST_REPORT_LOCAL=1 npm test` + `npm run test:py`, and `/security-check`. The gate binds the branch, not every commit in it: an intermediate commit in a deliberately layered sequence may be red, provided the branch is green before it leaves your machine. Before pushing, run `npm run security:all` (adds the slow Semgrep + Trivy scans on top of `check`) and `npm run test:e2e:smoke` (stands up the isolated test stack and seeds its fixture automatically) — both assume Docker and minutes of runtime, so they stay out of the per-commit tier.
7. **Design docs path** — save design documents and plans to `docs/tech/planning/` (not `docs/plans/`), and leave them **uncommitted**: plans are local working documents. What gets committed when the work lands is documentation of what exists, in `docs/tech/`. Guideline edits a plan calls for (this file, `.claude/commands/*`) ship with the implementation, never ahead of it
8. **Development guide** — follow all conventions in `docs/tech/development-guide.md` (file size limits, commit format, refactoring hygiene)
9. **Refactoring cleanup** — after any code change, remove unused imports, dead variables, and now-redundant checks
