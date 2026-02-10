# Repository Guidelines

## Project Structure & Module Organization
This is a monorepo with three main areas:
- `frontend/`: Vite + React + TypeScript UI (`src/components`, `src/hooks`, `src/api`, `src/theme`).
- `backend/`: Express + TypeScript API (`src/routes`, `src/controllers`, `src/services`, `src/db`).
- `db/`: Postgres/PostGIS schema, migrations, and geometry scripts (`init/`, `scripts/`, `tests/`).

Supporting directories:
- `scripts/`: repo tooling (for example `scripts/db-cli.sh`).
- `docs/`: domain and architecture notes.
- `martin/`: vector tile server config and run scripts.

## Build, Test, and Development Commands
Run from repo root unless noted.
- `pnpm install`: install workspace dependencies.
- `npm run dev`: start all services with Docker Compose.
- `npm run dev:frontend`: run frontend locally.
- `npm run dev:backend`: run backend locally.
- `npm run build`: build backend and frontend.
- `npm run lint`: lint all TypeScript packages.
- `npm run typecheck`: run `tsc --noEmit` across packages.
- `npm run check`: lint + typecheck gate.
- `npm run db:up` / `npm run db:down`: start or stop Postgres.

## Coding Style & Naming Conventions
- Language: TypeScript (`.ts`/`.tsx`) with ES modules.
- Indentation: 2 spaces; keep functions/components small and typed.
- React naming: components in `PascalCase` (`RegionMapVT.tsx`), hooks in `useCamelCase` (`useNavigation.tsx`).
- API/service files use descriptive camelCase names (for example `divisionGeometry.ts`).
- Use ESLint as source of truth: `npm run lint` and `npm run lint:fix`.

## Testing Guidelines
- DB invariants live in `db/tests/` (SQL + Python checks).
- Frontend test notes live in `frontend/tests/README.md`; Playwright is available in frontend dev deps.
- Before opening a PR, run `npm run check` and relevant DB test scripts for changed SQL/geometry logic.
- Name tests by behavior/scope (example: `test_extent_boxes.py`, `geometry-invariants.sql`).

## Commit & Pull Request Guidelines
- Follow existing commit style: short, imperative summaries (example: `Refactor WorldViewEditor into modular panel components`).
- Keep commits focused by concern (UI, API, DB) to simplify review.
- PRs should include:
  - clear problem/solution summary,
  - linked issue (if applicable),
  - validation steps/commands run,
  - screenshots or short recordings for UI changes,
  - notes for schema/env changes (`.env`, migrations, data backfills).

## Security & Configuration Tips
- Copy `.env.example` to `.env`; never commit secrets.
- Use `npm run db:mark-golden` before risky DB experiments.
- Treat large geometry/data imports as operational tasks; document source files and commands in PR notes.

## Extended Runtime Commands

```bash
npm run check              # Lint + typecheck (run before committing)
npm run dev                # Start all services via Docker Compose
npm run dev:backend        # Start backend only (local, no Docker)
npm run dev:frontend       # Start frontend only (local, no Docker)
npm run db:shell           # Open psql shell to active database
npm run db:status          # Show current DB info and row counts
npm run help               # Full command reference
```

Backend runs on port 3001, frontend on port 5173, Martin tile server on port 3000.

## Architecture

### Stack

Express backend + React/MUI frontend + PostgreSQL/PostGIS + Martin vector tile server. TypeScript everywhere. Drizzle ORM for queries, raw `pool` for PostGIS geometry operations.

### Database

- **Name**: `track_regions` (not `track_your_regions`)
- **Container**: `tyr-ng-db` (access via `docker exec -i tyr-ng-db psql -U postgres -d track_regions`)
- **Schema**:
  - `db/init/01-schema.sql` (tables, triggers, auth)
  - `db/init/02-martin-functions.sql` (tile functions)
  - `db/init/03-geom-3857-columns.sql` (SRID 3857 for Martin)
- **Extensions**: PostGIS, pg_trgm, unaccent

### Domain Model

- `administrative_divisions`: GADM official boundaries (tree via `parent_id`), pre-simplified at 3 LOD levels
- `world_views`: custom regional hierarchies; default world view (`id=1`) is GADM itself
- `regions`: user-defined groups within a world view, hierarchical via `parent_region_id`; computed geometry, `focus_bbox`, `anchor_point`, `is_leaf`
- `region_members`: links regions to divisions, supports `custom_geom` for partial coverage
- `experiences`: UNESCO sites, museums, public art
- `experience_sources`: UNESCO (`id=1`), Top Museums (`id=2`), Public Art & Monuments (`id=3`); `display_priority` controls ordering (lower first)

### Backend Structure

- `backend/src/routes/`: authRoutes, divisionRoutes, worldViewRoutes, experienceRoutes, adminRoutes, userRoutes, aiRoutes, viewRoutes
- `backend/src/controllers/`: organized by domain (`division*`, `worldView/region*`, `experience*`, `sync*`, `ai*`)
- `backend/src/services/`: sync services, hull calculation, image downloading, region assignment, OpenAI integration
- Middleware in `backend/src/middleware/auth.ts`: `requireAuth`, `requireAdmin`, `optionalAuth`
- Startup cleanup in `backend/src/index.ts` marks orphaned `running` sync logs as `failed`

### Frontend Structure

- Routing (`frontend/src/App.tsx`): `/`, `/discover`, `/auth/callback`, `/admin/*`
- State: TanStack Query + Context API (`useNavigation`, `useAuth`, `useExperienceContext`)
- API layer (`frontend/src/api/`): calls use `authFetchJson()` from `fetchUtils.ts` with JWT from localStorage
- Map: MapLibre GL via `react-map-gl`; `RegionMapVT.tsx` renders vector tiles from Martin; `ExperienceMarkers.tsx` uses declarative `<Source>/<Layer>` with native GeoJSON clustering
- Hooks (`frontend/src/hooks/`): `useNavigation`, `useExperienceContext`, `useAuth`, `useVisitedRegions`, `useVisitedExperiences`

### Martin Vector Tiles

- Config: `martin/config.yaml` (auto-discovers PostGIS tables/functions)
- Tile endpoints: `tile_gadm_root_divisions`, `tile_world_view_root_regions`, `tile_region_subregions`
- Frontend config: `MARTIN_URL` from `VITE_MARTIN_URL`; source layers `regions`, `divisions`, `islands`

## Key Patterns

### Sync Services

Follow pattern: `syncX()`, `getXSyncStatus()`, `cancelXSync()`. In-memory progress via `runningSyncs` map. `finally` blocks use captured `thisProgress` references to avoid timer race conditions.

### Geometry and Triggers

Two triggers fire on region geometry changes: `update_region_metadata()` (area, archipelago flag) and `update_region_focus_data()` (anchor point, focus box). Hull services in `backend/src/services/hull/` handle dateline-crossing geometries.

### Antimeridian Handling

`focus_bbox` format is `[west, south, east, north]`; `west > east` means antimeridian crossing. MapLibre `cameraForBounds()` does not handle this case. Use precomputed `anchorPoint` as map center and compute zoom from shifted bbox (`east + 360`).

### Experience Images

- UNESCO/landmarks: downloaded locally to `/data/images`
- Museums/artworks: remote Wikimedia URLs
- Thumbnails: `Special:FilePath/X.jpg?width=N` (120, 250, 330, 500, 960, 1280 px)
- Wikimedia integration requirements: proper `User-Agent`, handle 429 + `Retry-After`, and keep ~1.5s delay between downloads

### Shared Components

Reusable UI components live in `frontend/src/components/shared/`. Check shared components before creating inline implementations. If a component can be reused, place it in `shared/` early.

### Curation System

- Shared dialogs: `CurationDialog` (edit + reject/unreject) and `AddExperienceDialog` (search/assign or create new) in `frontend/src/components/shared/`
- Used from map mode (`ExperienceList.tsx`) and discover mode (`DiscoverExperienceView.tsx`, `DiscoverPage.tsx`)
- Rejection filtering:
  - `getExperiencesByRegion` excludes rejected items (descendant-aware for `includeChildren`)
  - `getExperienceRegionCounts` excludes rejected items from tree counts
- `requireCurator` middleware enforces role checks; admins have implicit curator powers

### MapLibre Gotchas

- Symbol layers with broken glyph URLs can silently stall GeoJSON source rendering
- Glyph server: `fonts.openmaptiles.org`; supported family is Open Sans (regular/bold/semibold), not Noto Sans
- `frontend/src/components/discover/DiscoverExperienceView.tsx` has its own inline map style with a separate glyph URL from shared `MAP_STYLE`
- `ExperienceMarkers.tsx` uses 3 declarative `<Source>` blocks (clustered markers, highlight, hover) with circle and symbol layers

## Documentation

Docs layout:

```text
docs/
├── inbox/            # unsorted docs awaiting categorization
├── tech/             # technical details of implemented features
│   └── planning/     # plans for features to build next
└── vision/           # non-technical vision, user stories, concepts
    └── vision.md     # root vision document
```

See `docs/README.md` for the full index.

### Documentation Workflow (Keep This In Sync)

When working on this codebase, keep docs synchronized with code changes:

- Planning a feature: create or update a doc in `docs/tech/planning/`
- Implementing a feature: update a relevant `docs/tech/` doc (or create one)
- Any user-facing change: always update `docs/vision/vision.md` (new UI, changed workflows, new input methods, and anything users/curators/admins can see or do)
- Completing a plan: trim planning docs to unimplemented ideas only; remove fully implemented sections
- Pure idea or concept: add to `docs/vision/`
- Unsorted notes: place in `docs/inbox/` and categorize later
