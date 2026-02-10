# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run check              # Lint + typecheck (run before committing)
npm run security:all       # Semgrep SAST + npm audit (run before committing)
npm run dev                # Start all services via Docker Compose
npm run dev:backend        # Start backend only (local, no Docker)
npm run dev:frontend       # Start frontend only (local, no Docker)
npm run db:shell           # Open psql shell to active database
npm run db:status          # Show current DB info and row counts
npm run security:scan      # Semgrep SAST scan via Docker (OWASP, Node.js, React, secrets)
npm run security:deps      # npm audit for backend + frontend dependencies
npm run security:all       # Run security:scan + security:deps
npm run help               # Full command reference
```

Backend runs on port 3001, frontend on port 5173, Martin tile server on port 3000.

## Architecture

### Stack
Express backend + React/MUI frontend + PostgreSQL/PostGIS + Martin vector tile server. TypeScript everywhere. Drizzle ORM for queries, raw `pool` for PostGIS geometry operations.

### Database
- **Name**: `track_regions` (NOT `track_your_regions`)
- **Container**: `tyr-ng-db` — access via `docker exec -i tyr-ng-db psql -U postgres -d track_regions`
- **Schema**: `db/init/01-schema.sql` (tables, triggers, auth), `02-martin-functions.sql` (tile functions), `03-geom-3857-columns.sql` (SRID 3857 for Martin)
- **Extensions**: PostGIS, pg_trgm, unaccent

### Domain Model
- **administrative_divisions** — GADM official boundaries (tree via `parent_id`), pre-simplified at 3 LOD levels
- **world_views** — Custom regional hierarchies. Default world view (id=1) is GADM itself
- **regions** — User-defined groups within a world view, hierarchical via `parent_region_id`. Has computed geometry, `focus_bbox`, `anchor_point`, `is_leaf`
- **region_members** — Links regions to divisions, supports `custom_geom` for partial coverage
- **experiences** — UNESCO sites, museums, public art. Multi-location via `experience_locations` table
- **experience_sources** — UNESCO (id=1), Top Museums (id=2), Public Art & Monuments (id=3). `display_priority` controls ordering (lower = first)

### Backend Structure
- **Routes** (`backend/src/routes/`): authRoutes, divisionRoutes, worldViewRoutes, experienceRoutes, adminRoutes, userRoutes, aiRoutes, viewRoutes
- **Controllers** (`backend/src/controllers/`): Organized by domain — division*, worldView/region*, experience*, sync*, ai*
- **Services** (`backend/src/services/`): Sync services (UNESCO, museum, landmark), hull calculation, image downloading, region assignment, OpenAI integration
- **Middleware**: `requireAuth`, `requireAdmin`, `optionalAuth` in `middleware/auth.ts`
- Startup cleanup in `index.ts` marks orphaned `running` sync logs as `failed`

### Frontend Structure
- **Routing** (`App.tsx`): `/` (main map), `/discover` (experience browsing), `/auth/callback`, `/admin/*`
- **State**: TanStack Query for server state, Context API for UI state (`useNavigation`, `useAuth`, `useExperienceContext`)
- **API layer** (`frontend/src/api/`): All calls use `authFetchJson()` from `fetchUtils.ts` with in-memory JWT. Refresh token stored as httpOnly cookie
- **Map**: MapLibre GL via react-map-gl. `RegionMapVT.tsx` renders vector tiles from Martin. `ExperienceMarkers.tsx` uses declarative `<Source>`/`<Layer>` with native GeoJSON clustering
- **Hooks** (`frontend/src/hooks/`): `useNavigation` (world views, divisions, breadcrumbs, tile version), `useExperienceContext` (experiences, hover sync, selection), `useAuth`, `useVisitedRegions`, `useVisitedExperiences`

### Martin Vector Tiles
- Config: `martin/config.yaml` (auto-discovers PostGIS tables/functions)
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
UNESCO/landmarks: download locally to `/data/images`. Museums/artworks: remote Wikimedia URLs. Thumbnails via `Special:FilePath/X.jpg?width=N` (CDN-cached sizes: 120, 250, 330, 500, 960, 1280px). Wikimedia requires proper User-Agent, 429+Retry-After handling, 1.5s delay between downloads.

### Shared Components
Reusable UI components live in `frontend/src/components/shared/`. When building features, check shared components before creating inline implementations. If a new component could be useful elsewhere, place it in `shared/` from the start.

### Curation System
- **Shared dialogs**: `CurationDialog` (edit + reject/unreject) and `AddExperienceDialog` (search+assign / create new) in `frontend/src/components/shared/`
- Used from both Map mode (`ExperienceList.tsx`) and Discover mode (`DiscoverExperienceView.tsx`, `DiscoverPage.tsx`)
- Rejection filtering: `getExperiencesByRegion` excludes rejected items (descendant-aware for `includeChildren`), `getExperienceRegionCounts` excludes from tree counts
- `requireCurator` middleware checks role; admins have implicit curator powers

### MapLibre Gotchas
- Symbol layers with broken glyph URLs silently stall the entire GeoJSON source rendering pipeline
- Glyph server: `fonts.openmaptiles.org` — supports `Open Sans Regular/Bold/Semibold` only (NOT Noto Sans)
- `DiscoverExperienceView.tsx` has its own inline map style with glyphs URL (separate from shared `MAP_STYLE`)
- `ExperienceMarkers.tsx` uses 3 declarative `<Source>` components (clustered markers, highlight, hover) with circle + symbol layers

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

- **Planning a feature** → create or update a doc in `docs/tech/planning/`
- **Implementing a feature** → update relevant `docs/tech/` doc (or create one)
- **Any user-facing change** → **always** update `docs/vision/vision.md`. This applies to any change that affects what visitors, users, curators, or admins can see or do — new UI, changed workflows, new input methods, etc. Vision docs describe the product from the user's perspective
- **Security-relevant change** → update `docs/security/SECURITY.md` (profile, known gaps) and/or `docs/security/asvs-checklist.yaml` (requirement status). This applies to new auth flows, new API endpoints, new input surfaces, file handling changes, new roles/permissions, or changes to token/session handling
- **Completing a plan** → trim the planning doc to only unimplemented ideas/improvements. Remove fully implemented sections
- **Pure idea or concept** → add to `docs/vision/`
- **Unsorted** → drop in `docs/inbox/`, categorize later
