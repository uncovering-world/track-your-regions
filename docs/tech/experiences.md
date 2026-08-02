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
- **`processItem(item, progress, context)`** — Process a single item and return a `ProcessItemResult`: the outcome (`'created'` / `'updated'` / `'unchanged'`), the change set, and whether the row had been flagged missing. `context` carries `dryRun`, so a service can skip its own writes in a preview. Throw to count as error.
- **`getItemName(item)`** / **`getItemId(item)`** — Display name and external ID for progress messages and error reporting.
- **`cleanup?(progress)`** — Optional custom cleanup for force sync (replaces default `cleanupCategoryData`). Museum uses this for treasure pre-cleanup.

Generic `getSyncStatus(categoryId)` and `cancelSync(categoryId)` replace per-service status/cancel functions. The controller dispatches via a registry map instead of if-else chains.

### Shared modules

Common sync logic lives in seven shared utility files:

- **`syncOrchestrator.ts`** — Generic sync lifecycle orchestration (`orchestrateSync<T>()`), plus `getSyncStatus()` and `cancelSync()` parameterized by category ID.
- **`wikidataUtils.ts`** — SPARQL query execution with retry/backoff (`sparqlQuery()`), QID extraction, WKT point parsing, delay helper, and constants (endpoint URL, user agent, timeouts). Used by museum and landmark services.
- **`syncUtils.ts`** — Experience upsert with curated_fields-aware conflict handling (`upsertExperienceRecord()`), single-location upsert (`upsertSingleLocation()`), sync log CRUD (`createSyncLog()`, `updateSyncLog()`), and FK-ordered category data cleanup cascade (`cleanupCategoryData()`). Used by all three services. Museum service calls its own treasure cleanup before invoking the shared cascade.
- **`changeSet.ts`** — Pure diff between the stored row and the incoming record (`computeChangeSet()`). No database, no network. Normalises before comparing: JSONB by value rather than key order, country and tag arrays as sets, coordinates by distance (below 10 m is jitter, above 1 km is `major`), and `null`/`''`/absent as one absence
- **`changeRecorder.ts`** — Batched persistence of the per-object changeset (`recordSyncChanges()`, 500 rows per statement)
- **`missingDetection.ts`** — Whether absence may be acted on (`missingDetectionSkipReason()`) and the flagging itself (`flagMissingExperiences()`)
- **`fixtureSource.ts`** — Development-only source substitution via `SYNC_SOURCE_FIXTURE`; see § Change provenance below

### Change provenance (issue #480, [ADR-0020](../decisions/0020-experience-lifecycle-and-run-changeset.md))

Every run records what it did to each object in `experience_sync_changes`: one row per
object created, changed, in conflict, missing, returned, or failed, with a per-field diff in
`changed_fields`. Rows that came through **unchanged are counted on the log, never stored** —
a UNESCO run would otherwise write 1247 rows of noise around the few dozen that carry
information. Two kinds of unchanged row are stored anyway, because each carries news the
counters cannot: `conflict`, where `curated_fields` refused the source's edit and the two now
disagree, and `returned`, where an object flagged `missing_since` is listed again — typically
unmodified, after a transient source gap, which is precisely when a field-change requirement
would have hidden it.

`changed_fields` holds the value the source proposed **even when `curated_fields` rejected
it**, marked `curatedConflict`. That is what makes a curator's later "accept source" possible;
without it the proposed value exists nowhere.

**`total_updated` changed meaning.** It used to count every row that passed through
`ON CONFLICT DO UPDATE`, identical or not. Since migration 009 it counts rows that actually
changed, and `total_unchanged` absorbs the rest. Logs 1–4 are therefore not comparable with
later ones.

**Two lifecycle axes** on `experiences`, both curator-set:

- `source_membership` — `present` / `former`: whether the source still lists the object
- `existence` — `extant` / `lost`: whether the object physically survives

They are independent because reality is: the Bamiyan Buddhas were destroyed but remain
inscribed; Dresden Elbe Valley is intact but was delisted in 2009. Rows a curator created by
hand (`is_manual`) are outside all of this — their `curator-<id>-<ts>` key was never in a
source listing, so they are excluded from detection and from its coverage denominator.
Absence is judged against the external ids the run actually saw, not against
`last_seen_sync_log_id` — a dry run stamps
nothing, and a row that arrived but failed to process is not missing either. The machine only
ever sets `missing_since`, and only when all four guards pass — the source is `authoritative` (declared
per service in `SyncServiceConfig`, `ranked` for the two top-N Wikidata sources), the run
finished clean and uncancelled, it was not a force run (which deletes the category first, leaving
nothing to go missing), and it saw at least 90 % of the previously present rows.
When detection is skipped the reason is stored in `experience_sync_logs.detection_skipped_reason`.

**Dry runs** (`POST /sync/categories/:id/start` with `{"dryRun": true}`) walk the same path and
write the log and changeset with `is_dry_run = true`, but touch no experiences, locations,
treasures or images. Dry-run logs are excluded from every "latest run" query, so a preview
cannot disturb provenance. Combining `dryRun` with `force` is refused: force deletes the
category before there would be anything to preview against.

**Fixture source** — setting `SYNC_SOURCE_FIXTURE` to a directory makes UNESCO sync read
`unesco.json` from it instead of the live API. Development only — the switch is refused
outright when `NODE_ENV=production`, which is the guard that matters; the directory itself is
operator-set and used as given, while the file name it reads is a module constant checked to
be a bare name so the read cannot leave that directory. In the Docker stack the variable is passed
through `docker-compose.yml`, and the path is the **container's** — put the fixture under the
already-mounted data directory (`./data/sync-fixtures` on the host,
`SYNC_SOURCE_FIXTURE=/app/data/sync-fixtures` in `.env`), since nothing else is mounted
writable. It exists because the real sources make a poor
inner loop and cannot be asked for "the same list, minus one object" — the case the delisting
path needs.

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

- `experience_regions` and `experience_location_regions` reference `regions(id)` only — there is no direct experience-to-division relation. Experiences reach the administrative base layer through a mirror world view imported from it (`source_type = 'base_layer'`, one region per division), never directly; assignment always targets a region, whether it belongs to a hand-built world view or to the base layer mirror. See [ADR-0018](../decisions/0018-base-layer-mirror-world-view.md)
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
| GET | `/api/experiences/by-region/:regionId` | Supports `includeChildren`, `limit` (default 100, max 5000), `offset`; optional auth affects rejection visibility. Rows come back `ORDER BY e.name`, so a `limit` under the region's size truncates alphabetically rather than paging — both callers pass `WHOLE_REGION_LIMIT` and take the region whole. `total` is a `COUNT(DISTINCT e.id)` over the same predicate, not the page size, so `offset + experiences.length < total` says rows remain beyond the returned window — truncation for a caller that started at `offset` 0 and asked for the whole region, plain `hasMore` for one that is paging; the server cannot distinguish those, since the difference is intent. Distinct because the rejection join can multiply rows per experience |
| GET | `/api/experiences/by-region/:regionId/locations` | Batch: all locations for all experiences in region, grouped by `experience_id`. Supports `includeChildren`. Eliminates N+1 per-experience location fetches |
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
| PATCH | `/api/experiences/:id/edit` | Editable fields (`name`, descriptions, `category`, `imageUrl`, `tags`, `websiteUrl`, `wikipediaUrl`). The last two are stored in `metadata.website` / `metadata.wikipediaUrl` via JSONB merge |
| GET | `/api/experiences/:id/curation-log` | Latest curation actions, filtered to the caller's curator scope (see Curation Guarantees) |

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
| GET | `/api/admin/sync/logs/:logId/changes` |
| POST | `/api/admin/experiences/assign-regions` |
| GET | `/api/admin/experiences/assign-regions/status` |
| POST | `/api/admin/experiences/assign-regions/cancel` |
| GET | `/api/admin/experiences/counts-by-region` |
| GET | `/api/admin/curators` |
| POST | `/api/admin/curators` |
| DELETE | `/api/admin/curators/:assignmentId` |
| GET | `/api/admin/curators/:userId/activity` |

### Field limits

What a curator edits or creates is bounded by the column it is stored in, not
by a number chosen at the API — the rule and its reasoning are in
`world-views.md` § "Field limits":

| Field | Limit | Column |
|-------|-------|--------|
| Experience name | 500 | `experiences.name`, and `experience_locations.name` for the location created with it |
| Category label | 100 | `experiences.category` |
| Image URL | 1000 | `experiences.image_url` |
| Country code | 10 | one element of `experiences.country_codes` |
| Country name | 255 | one element of `experiences.country_names` |

Short description, description, tags, and the website and Wikipedia URLs are
not on this list: the first three are `TEXT`/`JSONB` columns and the last two
live inside the `metadata` JSONB, so none of them has a width to align with.
`backend/src/types/columnBounds.test.ts` holds every entry above to its column.

## Curation Guarantees

- `curated_fields` on `experiences` protects edited fields during sync upserts
- Manual experiences (`is_manual = true`) are not replaced by source sync
- Manual region assignments are preserved across assignment recompute jobs
- The curation log is scope-filtered per row, not per experience. `getCurationLog`
  reaches the log only if something in it is attributable to the caller's scope —
  a region the experience is assigned to, or a region its log rows already name —
  and then returns the rows for the regions they cover plus the rows that name no
  region. The two halves of that gate are deliberate: removing an experience from
  a region deletes the assignment and logs the removal, so assignments alone would
  refuse a curator the record of their own last act there. Admins, global curators,
  and curators of the experience's category see everything. The predicate is
  `CURATOR_SCOPED_REGIONS_CTE` (`backend/src/middleware/auth.ts`) — the
  descendant closure of a curator's region assignments, the same set
  `checkCuratorScope` reaches by walking ancestors, expressed so it can qualify
  a result set instead of one region. Gate and filter run off that one closure,
  so the gate never admits a row the filter would drop — it is strictly the
  stronger of the two. Where they part is deliberate: a row naming no region
  satisfies neither half of the gate, so an experience whose log holds only
  those is refused outright rather than handed over. That refusal is the hole
  #442 names; without the gate, any curator could read such a log
- An edit is granted on the experience, not on one of its regions.
  `editExperience` intersects the experience's assignments with
  `CURATOR_SCOPED_REGIONS_CTE`, so a curator scoped to any one of the regions it
  sits in may edit it. The previous shape read one region out of an unordered
  `LIMIT 1` and refused the curator whenever that row named a different region
  of the same experience (#450). The same query answers what the `edited` log
  row names: for a region-scoped curator, the lowest-id region of the experience
  their scope covers — every candidate is a region they genuinely cover, and
  naming one keeps the entry visible to its own author under the per-row filter
  above; for admins, global curators, and curators of the experience's category,
  `NULL`, since no single region is where their authority came from and a row
  naming none stays visible to every curator who can reach the log. Every other
  curation handler is told its region by the request — `regionId` in the body or
  the path — so this is the only place the question arises

## Frontend Integration Notes

- Discover and Map UIs share `CurationDialog` and `AddExperienceDialog`
- `AddExperienceDialog` has Create New as the first (default) tab, Search & Add as the second. Props: `defaultCategoryId` pre-selects the category dropdown, `defaultTab` controls which tab opens (0=Create, 1=Search). Dialog closes automatically on successful creation and invalidates experience queries so map markers and lists refresh immediately. Category selector filters out "Curator Picks" — curators must assign new experiences to an existing category (UNESCO, Top Museums, or Public Art & Monuments). Category is required for creation. When the curator types a name (3+ chars, debounced 800ms), the system auto-fills coordinates (Nominatim), image URL, description, and link URL (Wikidata 3-layer lookup: direct QID → spatial SPARQL → name search). The link is auto-filled from the English Wikipedia sitelink in the Wikidata entity. The Nominatim query appends the current region name for geo-disambiguation. Auto-fill fires only once — after the first successful lookup, name edits don't re-trigger. After auto-fill, a suggestion info box appears below the name field showing the matched Wikidata entity (label + QID) with a prominent "Re-lookup" link. Clicking Re-lookup re-runs the full auto-fill pipeline (Nominatim + Wikidata), overwriting all previously auto-filled fields. Auto-filled fields use `useRef` flags (including `linkAutoFilled`) so Re-lookup overwrites them but manual edits are preserved. Thumbnail preview shown when image URL is set. Uses `LocationPicker` for coordinate input — supports 4 modes: click-on-map, Nominatim search, multi-format coordinate paste, and AI geocoding. Accepts `regionName` prop from both call sites (Map mode via `useNavigation().selectedRegion.name`, Discover mode via `activeView.regionName`)
- `CurationDialog` fetches full experience detail to populate two link fields: Wikipedia URL (from `metadata.wikipediaUrl`) and Website URL (from `metadata.website`). Both fields are editable and saved via JSONB merge. `AddExperienceDialog` auto-fills the Wikipedia URL from Wikidata lookup and provides a separate Website URL field. The backend edit/create endpoints accept both `wikipediaUrl` and `websiteUrl`
- External links are unified across all sources — no source-specific rendering logic. Every experience shows up to two links based solely on metadata: a **Wikipedia** button (`MenuBook` icon, from `metadata.wikipediaUrl`) and a **Website** button (`Language` icon, from `metadata.website`). UNESCO page URLs are stored in `metadata.website` during sync, so they appear as "Website" alongside any Wikipedia link. Both Map mode (icon buttons) and Discover mode (text buttons in detail panel) use the same unified logic
- In Map mode (`ExperienceList.tsx`), each category group header has a "+" button that opens AddExperienceDialog with `defaultCategoryId` pre-set for that category. An "Add experience of a new category" button at the top opens Create New with no category pre-selected. Category name → ID mapping is resolved via the `experience-categories` query
- In Discover mode, add buttons appear in two places: (1) the list header "Add" button when viewing a specific category for a region — opens with `defaultCategoryId` pre-set from `activeView.categoryId`; (2) a "+" icon button in each region row's category pills area (in `DiscoverRegionList`) — opens with no category pre-selected so the curator can pick any category. The tree-level "+" is scope-aware: `DiscoverPage` fetches curator assignments from `/api/users/me` and passes a `canAddToRegion` predicate to the list. Admins and global/category-scoped curators see "+" on all regions. Region-scoped curators see "+" only on their assigned regions and descendants (detected via breadcrumb ancestry match)
- Cache invalidation after mutations must include both `['experiences', 'by-region', regionId]` (Map mode) and `['discover-experiences']` (Discover mode) query key prefixes. Both `AddExperienceDialog` and `CurationDialog` invalidate both
- Discover's experiences query is keyed `['discover-experiences', regionId]` — **not** by category. The response is category-independent; the category filter runs in `select`, per observer. Keying by category would give each tab its own cache entry and refetch the whole region on every switch
- Creating a manual experience inserts into 4 tables within a transaction: `experiences`, `experience_locations`, `experience_regions`, and `experience_location_regions`. The last one matters — without it the location's `in_region` flag is false. The marker still appears (`buildExperienceMarkers` falls back to a location of any kind, flagged `inRegion: false`, so a hand-assigned experience is not invisible), but everything that counts in-region locations reads zero: the `0/N` chip on the row, the visited counts, and the mark-all-locations checkbox, which marks in-region locations and so marks nothing
- `LocationPicker` lives in `frontend/src/components/shared/` with coordinate parsing in `frontend/src/utils/coordinateParser.ts`. Accepts `name` prop to pre-populate search/AI fields; coordinates sync across all modes (e.g. map click shows in Coordinates tab). Exposes `onPlaceSelect` callback that passes Wikidata ID from Nominatim search results
- Visited tracking uses location-level system (`user_visited_locations`) for both the root checkbox and the "Mark Visited" button. The experience-level table (`user_visited_experiences`) is maintained for backward compatibility but the UI is driven entirely by location visits. The `markAllLocations` batch endpoint handles both single- and multi-location experiences consistently
- **Batch location fetching**: `useRegionLocations(regionId)` hook (`frontend/src/hooks/useRegionLocations.ts`) fetches all locations for all experiences in a region via a single `GET /api/experiences/by-region/:regionId/locations` call. Both `ExperienceMarkers` and `ExperienceList` consume this shared hook, eliminating ~300 individual API calls for a 150-experience region. Visit checkbox state is derived from the global `useVisitedLocations().isLocationVisited()` rather than per-experience `useExperienceVisitedStatus()` calls. The batch endpoint also returns `region_path` (full ancestor path from root to leaf region, e.g. "Europe > Germany > Bavaria") for each location via a recursive `LEFT JOIN LATERAL` on `experience_location_regions` + `regions`
- **Reads whose response depends on world-view visibility must be authenticated**: they go through `authFetchJson`, not `fetchJson` — `by-region/:regionId`, `by-region/:regionId/locations`, `:id/locations`, `region-counts`, and `GET /api/experiences/:id`. The first four carry `requireVisibleWorldView`, which answers **404, not 401**, when a world view has `is_public = false` and the caller is not an admin, so an unauthenticated read is indistinguishable from a missing region: react-query stores the rejection as `data: undefined` and nothing surfaces. `:id` is different in mechanism and identical in consequence — it is public by design and instead filters the `regions[]` it returns, admitting every assignment only for an admin, so without a token that documented bypass is unreachable and an experience assigned only to hidden world views returns an empty region list rather than an incomplete one. All five are covered by `frontend/src/api/experiences.auth.test.ts`. One membership is prospective rather than active: `:id/locations` is guarded on `regionIdQuery`, which passes the request through when no `regionId` is supplied, and neither caller supplies one — so as called today that response has no visibility dependence and cannot 404. The header is what keeps the route correct if a caller starts passing one. `GET /api/experiences` carries the same guard on its `regionId` query param and is listed in `SECURITY.md`, but has no frontend client — which is why it is absent here and from the test
- **An in-region count is only meaningful once the batch has settled**: `useRegionLocations` reports `locationsResolved`, and three consumers gate on it — the expanded card's ratio, the row's count chip, and the visited controls. The last is not a display concern and must not be dropped as one: visited state is derived from in-region locations, so an unresolved batch makes `inRegionCount` 0, which short-circuits `inRegionVisitedStatus` to `not_visited`; every toggle then passes "mark", always, and a fully-visited experience can be re-marked but never unmarked. The numerator is derived by filtering the batch while the denominator falls back to `experience.location_count`, which arrives with the experience — so an absent batch does not read as "no locations here", it reads as a confident `0/N`. The 404 above was one way to reach that state; a 500, an offline reload or an aborted navigation are others, which is why the fix is the gate rather than the 404
- **Out-of-region location display**: In the expanded sidebar details, locations are split into in-region (shown first, fully interactive) and out-of-region (collapsible section). Out-of-region locations show the first 3 with a "Show N more" toggle. Each displays its region path with the common prefix stripped — e.g. if all out-of-region locations are in Europe, "Europe > " is removed so you see "Germany > Bavaria", "France > Paris", etc.
- Rejected experience visibility is scope-dependent and returned by backend
- Multi-location experiences expose `location_count` in region browse responses for map/list UX
- Detailed marker interaction architecture is documented in `experience-map-ui.md`
