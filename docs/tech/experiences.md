# Experiences System

This document describes the current Experiences implementation: data model, assignment logic, curation, and API surface.

## Overview

Experiences are location-based entities linked to regions. The system supports:

- Public browsing and map visualization
- User visit tracking (experience-level and location-level)
- Flexible location model (0, 1, or many locations per experience)
- Curator workflows (reject/edit/assign/create)
- Multi-source ingestion (UNESCO, museums, monuments)

## Active Categories

`experience_categories` is ordered by `display_priority` (lower first).

- `UNESCO World Heritage Sites` (priority `1`)
- `Top Museums` (priority `2`)
- `Public Art & Monuments` (priority `3`)

## Core Data Model

### Main tables

- `experiences`: canonical experience record (`location`, optional `boundary`, curation metadata)
- `experience_regions`: assignment to regions (`assignment_type = auto | manual`)
- `user_visited_experiences`: per-user visit state
- `experience_sync_logs`: sync audit log by category

### Location model

An experience can have zero, one, or many locations. Location-bound experiences (museums, monuments) have physical coordinates; non-location-bound ones (books, films) are tied to regions conceptually. Multi-location experiences (UNESCO serial nominations) have independently trackable child locations.

- `experience_locations`: locations per experience (0..N)
- `experience_location_regions`: region assignment per location
- `user_visited_locations`: per-user location visits

### Treasures (artworks/artifacts)

Treasures are independently trackable things inside venue experiences. Currently implemented for museum artworks. Treasures have a many-to-many relationship with venues via `experience_treasures` junction table; iconic treasures are called **highlights** (`is_iconic` flag). See [`EXPERIENCES-OVERVIEW.md`](../vision/EXPERIENCES-OVERVIEW.md) for the full concept.

- `treasures`: globally unique treasures (artworks, artifacts), keyed by `external_id`
- `experience_treasures`: many-to-many junction linking treasures to venue experiences
- `user_viewed_treasures`: per-user treasure tracking

### Curation support

- `curator_assignments`: scoped permissions (`global`, `region`, `category`)
- `experience_rejections`: region-scoped hidden items for non-curators
- `experience_curation_log`: audit trail (`created`, `edited`, `rejected`, `unrejected`, `added_to_region`, `removed_from_region`)

## Sync Architecture

Each source has a dedicated sync service in `backend/src/services/sync/`. All follow the same pattern: `syncX()`, `getXSyncStatus()`, `cancelXSync()`. In-memory progress is tracked via the `runningSyncs` Map; `finally` blocks use a captured `thisProgress` reference to avoid timer race conditions.

### Sync orchestrator

The generic sync lifecycle (progress init, already-running check, sync log creation, force cleanup, processing loop with cancel checks, final status, error handling, delayed cleanup) is implemented once in `syncOrchestrator.ts`. Each service provides a `SyncServiceConfig<T>` with domain-specific callbacks:

- **`fetchItems(progress, errorDetails)`** — Fetch and prepare items. Returns `{ items: T[], fetchedCount }`. Can append pre-processing errors (e.g., museums without coordinates) to `errorDetails`.
- **`processItem(item, progress)`** — Process a single item, return `'created'` or `'updated'`. Throw to count as error.
- **`getItemName(item)`** / **`getItemId(item)`** — Display name and external ID for progress messages and error reporting.
- **`cleanup?(progress)`** — Optional custom cleanup for force sync (replaces default `cleanupCategoryData`). Museum uses this for treasure pre-cleanup.

Generic `getSyncStatus(categoryId)` and `cancelSync(categoryId)` replace per-service status/cancel functions. The controller dispatches via a registry map instead of if-else chains.

### Shared modules

Common sync logic lives in three shared utility files:

- **`syncOrchestrator.ts`** — Generic sync lifecycle orchestration (`orchestrateSync<T>()`), plus `getSyncStatus()` and `cancelSync()` parameterized by category ID.
- **`wikidataUtils.ts`** — SPARQL query execution with retry/backoff (`sparqlQuery()`), QID extraction, WKT point parsing, delay helper, and constants (endpoint URL, user agent, timeouts). Used by museum and landmark services.
- **`syncUtils.ts`** — Experience upsert with curated_fields-aware conflict handling (`upsertExperienceRecord()`), single-location upsert (`upsertSingleLocation()`), sync log CRUD (`createSyncLog()`, `updateSyncLog()`), and FK-ordered category data cleanup cascade (`cleanupCategoryData()`). Used by all three services. Museum service calls its own treasure cleanup before invoking the shared cascade.

### UNESCO (`unescoSyncService.ts`)

- Fetches the full UNESCO World Heritage list via the UNESCO API
- Fetches English Wikipedia article URLs from Wikidata using property P757 (UNESCO World Heritage Site ID) via `schema:about` + `schema:isPartOf` SPARQL pattern, stored as `metadata.wikipediaUrl`. Fails open (sync proceeds without Wikipedia links if Wikidata is unavailable)
- Multi-location support: serial nominations create multiple `experience_locations`
- Images downloaded locally to `/data/images/`

### Top Museums (`museumSyncService.ts`)

- SPARQL queries to Wikidata for entities that are instances of museum (Q33506) with notable collections
- Fetches per-type artwork content (paintings, sculptures, etc.) with SPARQL limits per type (2000 for paintings, 500 for others)
- Sitelinks filter: `> 10` ensures only notable museums
- Museum validation: artwork queries rely on `wdt:P195` (collection) to find artworks in institutions, then downstream filtering (coordinate check, department resolution, cap at 100) naturally excludes non-museum collections. The old `FILTER EXISTS { ?collection wdt:P31/wdt:P279* wd:Q33506 }` subclass traversal was removed because it caused Wikidata 504 timeouts
- Images use remote Wikimedia `Special:FilePath` URLs (not downloaded locally)
- Fetches English Wikipedia article URL via `schema:about` + `schema:isPartOf` SPARQL pattern, stored as `metadata.wikipediaUrl`

**SPARQL reliability**: Requests include a 120s server-side timeout parameter (Blazegraph `timeout`) plus a 130s client-side AbortController safety net. Exponential backoff retries (up to 5 attempts, 5s→10s→20s→30s), honors `Retry-After` header from 429 responses. If the full artwork query (e.g. paintings) times out, falls back to two range queries with different sitelink thresholds (high-fame first, then wider net), merging and deduplicating results

### Public Art & Monuments (`landmarkSyncService.ts`)

Two-phase fetch:

1. **Sculptures** — `wdt:P31 wd:Q860861` (outdoor sculpture), sitelinks > 15, LIMIT 300
2. **Monuments** — `wdt:P31 ?type` with `VALUES` for 4 monument types (Q4989906 memorial, Q575759 war memorial, Q721747 monument, Q5003624 cenotaph), sitelinks > 20, LIMIT 300. Falls back to per-type queries if the combined query fails

Results are merged, deduplicated by QID, sorted by sitelinks descending, and capped at `TARGET_COUNT` (currently 200). Duplicate names are disambiguated by appending location hints from the description. Fetches English Wikipedia article URL and own website URL, stored as `metadata.wikipediaUrl` and `metadata.website`.

**SPARQL reliability**: All Wikidata queries use direct `wdt:P31` (instance-of) rather than `wdt:P31/wdt:P279*` (subclass traversal) to avoid timeouts on the Wikidata endpoint. Requests include a 120s server-side timeout parameter (Blazegraph `timeout`) plus a 130s client-side AbortController safety net. Exponential backoff retries (up to 5 attempts) with 1s delay between requests. Falls back to per-type queries if the combined monument query fails.

### Shared patterns

- Proper `User-Agent` header required by Wikimedia policy (constant in `wikidataUtils.ts`)
- SPARQL retries with exponential backoff, 429 + `Retry-After` header handling, 120s server-side + 130s client-side timeouts (all in `sparqlQuery()`)
- 1.5s delay between image downloads
- `curated_fields` JSONB on `experiences` protects curator edits during sync upserts — each field is checked individually in the `ON CONFLICT` clause (implemented in `upsertExperienceRecord()`)
- Sync log lifecycle: `createSyncLog()` → processing → `updateSyncLog()` (also updates `experience_categories.last_sync_*`)
- Force-sync cleanup via `cleanupCategoryData()`: deletes in FK order (visited locations → visited experiences → auto-assigned location regions → auto-assigned experience regions → locations → experiences), preserving manual curator assignments
- Startup cleanup in `index.ts` marks orphaned `running` sync logs as `failed`

## Assignment Model

### Region assignment

- Spatial assignment writes `auto` rows to `experience_regions`
- Manual curator assignment writes/overwrites `manual`
- Re-assignment and sync flows only clear/recompute `auto`, preserving manual curation

### Rejection filtering

- Public/user responses exclude rejected items
- Curators with scope see rejected items with `is_rejected`/`rejection_reason`
- `includeChildren=true` in region queries applies descendant-aware rejection checks

## API Endpoints

### Public browse

| Method | Endpoint | Notes |
|--------|----------|-------|
| GET | `/api/experiences` | Filters: `categoryId`, `category`, `country`, `regionId`, `search`, `bbox`, `limit`, `offset` |
| GET | `/api/experiences/:id` | Full detail |
| GET | `/api/experiences/by-region/:regionId` | Supports `includeChildren`, `limit`, `offset`; optional auth affects rejection visibility |
| GET | `/api/experiences/search` | `q`, `limit` |
| GET | `/api/experiences/categories` | Active categories ordered by priority |
| GET | `/api/experiences/region-counts` | `worldViewId` required, optional `parentRegionId` |
| GET | `/api/experiences/:id/locations` | Multi-location list; optional `regionId` adds `in_region` |
| GET | `/api/experiences/:id/treasures` | Treasures list (artworks/artifacts) |

### User visits (`requireAuth`)

| Method | Endpoint |
|--------|----------|
| GET | `/api/users/me/visited-experiences` |
| GET | `/api/users/me/visited-experiences/ids` |
| POST | `/api/users/me/visited-experiences/:experienceId` |
| PATCH | `/api/users/me/visited-experiences/:experienceId` |
| DELETE | `/api/users/me/visited-experiences/:experienceId` |
| GET | `/api/users/me/visited-locations/ids` |
| POST | `/api/users/me/visited-locations/:locationId` |
| DELETE | `/api/users/me/visited-locations/:locationId` |
| GET | `/api/users/me/experiences/:id/visited-status` |
| POST | `/api/users/me/experiences/:experienceId/mark-all-locations` |
| DELETE | `/api/users/me/experiences/:experienceId/mark-all-locations` |
| GET | `/api/users/me/viewed-treasures/ids` |
| POST | `/api/users/me/viewed-treasures/:treasureId` |
| DELETE | `/api/users/me/viewed-treasures/:treasureId` |

### Curator (`requireAuth + requireCurator`)

| Method | Endpoint | Body |
|--------|----------|------|
| POST | `/api/experiences` | Create manual experience. Required `categoryId` (no default). Optional `websiteUrl` stored in `metadata.website` |
| POST | `/api/experiences/:id/reject` | `{ regionId, reason? }` |
| POST | `/api/experiences/:id/unreject` | `{ regionId }` |
| POST | `/api/experiences/:id/assign` | `{ regionId }` |
| DELETE | `/api/experiences/:id/assign/:regionId` | Manual assignment removal |
| DELETE | `/api/experiences/:id/remove-from-region/:regionId` | Full removal (any assignment type). Keeps rejection as guard against spatial recompute |
| PATCH | `/api/experiences/:id/edit` | Editable fields (`name`, descriptions, `category`, `imageUrl`, `tags`, `websiteUrl`). `websiteUrl` is stored in `metadata.website` via JSONB merge |
| GET | `/api/experiences/:id/curation-log` | Latest curation actions |

### Geocoding (public + admin)

| Method | Endpoint | Notes |
|--------|----------|-------|
| GET | `/api/geocode/search` | Nominatim proxy. Params: `q`, `limit` (default 5). Rate-limited 1 req/sec. Returns `wikidataId` from Nominatim extratags |
| POST | `/api/geocode/ai` | AI geocoding (curator/admin). Body: `{ description }`. Returns `{ lat, lng, name, confidence }` |
| GET | `/api/geocode/suggest-image` | Wikidata image suggestion (curator/admin). Params: `name`, `lat`, `lng`, `wikidataId` (at least one required). Layered lookup: direct QID → SPARQL spatial → name search. Returns `{ imageUrl, source, entityLabel, wikidataId, wikipediaUrl?, description? }`. `wikipediaUrl` is extracted from Wikidata entity sitelinks (enwiki) |

### Admin (`/api/admin`, admin-only)

| Method | Endpoint |
|--------|----------|
| GET | `/api/admin/sync/categories` |
| PUT | `/api/admin/sync/categories/reorder` |
| POST | `/api/admin/sync/categories/:categoryId/start` |
| GET | `/api/admin/sync/categories/:categoryId/status` |
| POST | `/api/admin/sync/categories/:categoryId/cancel` |
| POST | `/api/admin/sync/categories/:categoryId/fix-images` |
| GET | `/api/admin/sync/logs` |
| GET | `/api/admin/sync/logs/:logId` |
| POST | `/api/admin/experiences/assign-regions` |
| GET | `/api/admin/experiences/assign-regions/status` |
| POST | `/api/admin/experiences/assign-regions/cancel` |
| GET | `/api/admin/experiences/counts-by-region` |
| GET | `/api/admin/curators` |
| POST | `/api/admin/curators` |
| DELETE | `/api/admin/curators/:assignmentId` |
| GET | `/api/admin/curators/:userId/activity` |

## Curation Guarantees

- `curated_fields` on `experiences` protects edited fields during sync upserts
- Manual experiences (`is_manual = true`) are not replaced by source sync
- Manual region assignments are preserved across assignment recompute jobs

## Frontend Integration Notes

- Discover and Map UIs share `CurationDialog` and `AddExperienceDialog`
- `AddExperienceDialog` has Create New as the first (default) tab, Search & Add as the second. Props: `defaultCategoryId` pre-selects the category dropdown, `defaultTab` controls which tab opens (0=Create, 1=Search). Dialog closes automatically on successful creation and invalidates experience queries so map markers and lists refresh immediately. Category selector filters out "Curator Picks" — curators must assign new experiences to an existing category (UNESCO, Top Museums, or Public Art & Monuments). Category is required for creation. When the curator types a name (3+ chars, debounced 800ms), the system auto-fills coordinates (Nominatim), image URL, description, and link URL (Wikidata 3-layer lookup: direct QID → spatial SPARQL → name search). The link is auto-filled from the English Wikipedia sitelink in the Wikidata entity. The Nominatim query appends the current region name for geo-disambiguation. Auto-fill fires only once — after the first successful lookup, name edits don't re-trigger. After auto-fill, a suggestion info box appears below the name field showing the matched Wikidata entity (label + QID) with a prominent "Re-lookup" link. Clicking Re-lookup re-runs the full auto-fill pipeline (Nominatim + Wikidata), overwriting all previously auto-filled fields. Auto-filled fields use `useRef` flags (including `linkAutoFilled`) so Re-lookup overwrites them but manual edits are preserved. Thumbnail preview shown when image URL is set. Uses `LocationPicker` for coordinate input — supports 4 modes: click-on-map, Nominatim search, multi-format coordinate paste, and AI geocoding. Accepts `regionName` prop from both call sites (Map mode via `useNavigation().selectedRegion.name`, Discover mode via `activeView.regionName`)
- `CurationDialog` fetches full experience detail to populate two link fields: Wikipedia URL (from `metadata.wikipediaUrl`) and Website URL (from `metadata.website`). Both fields are editable and saved via JSONB merge. `AddExperienceDialog` auto-fills the Wikipedia URL from Wikidata lookup and provides a separate Website URL field. The backend edit/create endpoints accept both `wikipediaUrl` and `websiteUrl`
- External links are unified across all sources — no source-specific rendering logic. Every experience shows up to two links based solely on metadata: a **Wikipedia** button (`MenuBook` icon, from `metadata.wikipediaUrl`) and a **Website** button (`Language` icon, from `metadata.website`). UNESCO page URLs are stored in `metadata.website` during sync, so they appear as "Website" alongside any Wikipedia link. Both Map mode (icon buttons) and Discover mode (text buttons in detail panel) use the same unified logic
- In Map mode (`ExperienceList.tsx`), each category group header has a "+" button that opens AddExperienceDialog with `defaultCategoryId` pre-set for that category. An "Add experience of a new category" button at the top opens Create New with no category pre-selected. Category name → ID mapping is resolved via the `experience-categories` query
- In Discover mode, add buttons appear in two places: (1) the list header "Add" button when viewing a specific category for a region — opens with `defaultCategoryId` pre-set from `activeView.categoryId`; (2) a "+" icon button in each region row's category pills area (in `DiscoverRegionList`) — opens with no category pre-selected so the curator can pick any category. The tree-level "+" is scope-aware: `DiscoverPage` fetches curator assignments from `/api/users/me` and passes a `canAddToRegion` predicate to the list. Admins and global/category-scoped curators see "+" on all regions. Region-scoped curators see "+" only on their assigned regions and descendants (detected via breadcrumb ancestry match)
- Cache invalidation after mutations must include both `['experiences', 'by-region', regionId]` (Map mode) and `['discover-experiences']` (Discover mode) query key prefixes. Both `AddExperienceDialog` and `CurationDialog` invalidate both
- Creating a manual experience inserts into 4 tables within a transaction: `experiences`, `experience_locations`, `experience_regions`, and `experience_location_regions`. The last one is critical — without it, the location's `in_region` flag is false and the marker won't appear on the map
- `LocationPicker` lives in `frontend/src/components/shared/` with coordinate parsing in `frontend/src/utils/coordinateParser.ts`. Accepts `name` prop to pre-populate search/AI fields; coordinates sync across all modes (e.g. map click shows in Coordinates tab). Exposes `onPlaceSelect` callback that passes Wikidata ID from Nominatim search results
- Visited tracking uses location-level system (`user_visited_locations`) for both the root checkbox and the "Mark Visited" button. The experience-level table (`user_visited_experiences`) is maintained for backward compatibility but the UI is driven entirely by location visits. The `markAllLocations` batch endpoint handles both single- and multi-location experiences consistently
- Rejected experience visibility is scope-dependent and returned by backend
- Multi-location experiences expose `location_count` in region browse responses for map/list UX
- Detailed marker interaction architecture is documented in `experience-map-ui.md`
