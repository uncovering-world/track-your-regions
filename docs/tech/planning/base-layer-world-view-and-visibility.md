# Base Layer World View + World View Visibility

> **Status:** Design agreed 2026-07-27, not implemented.
> **Why now:** Experience work (curation, map, treasures, new sources) is blocked —
> no world view can carry experiences today. Canon work continues in parallel and
> is not touched by this.

## Problem

Experiences attach only to `regions`. The administrative base layer (currently
GADM) lives in a different table and is not reachable from the experience model at
all. As a result, 1547 experiences / 6520 locations sit unassigned and every
experience surface is empty.

Verified facts:

- `experience_regions` and `experience_location_regions` reference `regions(id)`
  only — `db/init/01-schema.sql:1574`. No experience↔division relation exists.
- Navigation is split in two: the default (base layer) world view drives
  `selectedDivision`, custom world views drive `selectedRegion` —
  `frontend/src/hooks/useNavigation.tsx:18,22`.
- `ExperienceProvider` receives `regionId={selectedRegion?.id ?? null}`
  (`frontend/src/components/MainDisplay.tsx:46`), so in base-layer mode the
  experience query never fires.
- Discover is region-scoped too: `/api/experiences/region-counts` requires
  `worldViewId` and joins `regions`
  (`backend/src/controllers/experience/experienceQueryController.ts:376-403`).
- Assignment is region-scoped: `assignDirect` runs
  `ST_Contains(r.geom, el.location)` over `regions` of one world view
  (`backend/src/services/sync/regionAssignmentService.ts:64-88`).

Current database state (2026-07-27):

| | |
|---|---|
| World view 1 "GADM" (`is_default`) | 0 regions |
| World view 2 "Wikivoyage Regions" | 4301 regions, **all `geom IS NULL`**, 266 `region_members` |
| Experiences | 1247 UNESCO + 200 monuments + 100 museums |
| `experience_locations` | 6520 |
| `treasures` | 968 |
| `experience_regions` | **0** |

So no world view can serve experiences: one has no regions, the other has no
geometry.

Base layer tree (`administrative_divisions`, 392 112 rows):

| Depth | Rows | Full `geom` | `geom_simplified_medium` |
|---|---|---|---|
| 0 — continents | 8 | 335 MB | 9.7 MB |
| 1 — countries | 237 | 392 MB | 13 MB |
| 2 — subdivisions | 3586 | 540 MB | 19 MB |
| 3+ | 388 281 | — | — |

Database is 12 GB; 368 GB free on the host.

## Decisions

**D1 — Experiences keep attaching to regions only.** The base layer reaches them
through a materialized mirror world view, not through a new
experience↔division relation. A parallel division path would duplicate
assignment, counts, tiles, rejection filtering and the whole curation surface.
→ ADR-0018.

**D2 — The mirror is produced by the existing import pipeline, not a bespoke
seeder, and it goes through the matcher like any other source.** `importTree()`
is already source-agnostic (`backend/src/services/worldViewImport/importer.ts:78`,
takes `{ sourceType, source, description }`). Building the mirror through it
forces the generic path to actually work for a second source and surfaces
everything still hardcoded to Wikivoyage.

The importer emits **names and hierarchy only**. It does not carry the division
each node came from, even though it trivially could. Resolving a node to a
division is the matcher's job, and a base-layer import that asserted the mapping
instead of matching it would skip exactly the stage this exercise exists to
test. `matchCountryLevel` already works from names and parents read back out of
the database (`matcher.ts:339`), identifies countries by name, and drills into a
country's subdivisions with `findBestAmongChildren` — no new matcher is needed.

The names in a base-layer tree are the division names, so matching should resolve
them exactly. That is a property of the data, not a shortcut in the code: if the
matcher failed on them, that would be a finding about the matcher, and the review
UI would show it. Checked in the data: at depths 1 and 2 there are **no duplicate
sibling names**, so `importTree`'s find-or-create on duplicate siblings collapses
nothing.

Honest limitation: matching a tree derived from the base layer against that same
base layer is circular. It proves the pipeline is source-agnostic — the stated
goal — but it does not stress matching quality on hard names.

**D3 — No provider name in code.** The concept is "base layer"; the concrete
provider lives in data. `source_type = 'base_layer'`, service
`baseLayerImporter.ts`, endpoint `/api/admin/world-view-import/base-layer`, UI
label "Base layer". `world_views.source = 'GADM 4.1'` and the world view name are
import parameters. Switching to OpenBoundaries later means reloading
`administrative_divisions` and re-importing — no code change.

Pre-existing debt not addressed here (recorded in ADR-0018): tile functions
`tile_gadm_root_divisions` / `tile_gadm_subdivisions`, the API path
`resetRegionToGADM`, and the column `administrative_divisions.gadm_uid`.

**D4 — Mirror depth 2** (continents + countries + first-level subdivisions =
3831 regions). Depth 3 would add 42 164 regions; the full tree is out of the
question (mirroring 392 k divisions doubles the largest table).

**D5 — World view visibility becomes an explicit per-world-view setting**,
enforced server-side, default hidden. It replaces the current implicit rule
"the default world view is admin-only", which today is a client-side filter.

**D6 — Hidden means tiles are not served either.** Martin stops being publicly
reachable; tiles go through an authorizing backend proxy. → ADR-0019.

## Scope and order

- **Branch 1 = S1 + S3** — visibility flag + base-layer importer. Unblocks
  experience work. S1 is a prerequisite: the mirror must be creatable as hidden.
- **Branch 2 = S2** — tile boundary.

Ordering rationale: the mirror itself contains nothing private — it is public
GADM data. The leak worth closing is the *canon* world view, which is already
readable by anyone today (`getWorldViews` returns every active world view; region
endpoints are `optionalAuth` with no visibility check; Martin is wide open). S2 is
a fix to an existing gap, not a regression introduced by this work, so it does not
have to block S3.

---

## S1 — World view visibility

### Current behaviour

`getWorldViews` returns every `is_active` world view to anyone
(`backend/src/controllers/worldView/worldViewCrud.ts:12-22`). The default world
view is hidden **in the browser**, by
`frontend/src/components/HierarchySwitcher.tsx:121`
(`worldViews.filter(w => !w.isDefault)`). Region read endpoints are public with
`optionalAuth` and no visibility check
(`backend/src/routes/worldViewRoutes.ts:77-99`).

### Schema

```sql
ALTER TABLE world_views ADD COLUMN is_public BOOLEAN NOT NULL DEFAULT false;
UPDATE world_views SET is_public = NOT is_default;   -- preserves today's behaviour
```

Fresh databases get it in `db/init/01-schema.sql`; existing ones via a numbered
file in `db/migrations/`. Default `false` means every newly imported world view
starts hidden, which is what the mirror wants and a sane default for canon work in
progress.

### Backend

- `getWorldViews` filters by role: non-admin sees `is_public AND is_active`;
  admin sees all, with `isPublic` in the payload.
- `updateWorldView` (PUT `/api/world-views/:worldViewId`, already admin-only)
  accepts `isPublic`; extend `updateWorldViewBodySchema`.
- New middleware `requireVisibleWorldView` resolving the world view from either
  the route (`:worldViewId`) or a region (`:regionId` → `regions.world_view_id`),
  applied to the region read surface:
  - `/api/world-views/:worldViewId/regions{,/root,/search,/leaf}`
  - `/api/world-views/:worldViewId/regions/root/geometries`
  - `/api/world-views/regions/:regionId/**` (ancestors, subregions, geometry,
    members)
  - `/api/experiences/by-region/:regionId`, `/api/experiences/region-counts`
- Hidden + non-admin → **404**, not 403: do not confirm that the world view
  exists.
- Rule: hidden ⇒ admin-only. Curators do not get access to hidden world views;
  if that turns out to be needed later it is a separate decision (curator
  assignments are already scoped, `curator_assignments`).

### Frontend

- `WorldView` type gains `isPublic` (`frontend/src/api/worldViews.ts:30` area).
- Delete the `isDefault` filter in `HierarchySwitcher.tsx:118-128`; keep the
  "current selection is no longer visible" fallback, which now triggers on
  visibility changes instead.
- Admin world view list: a visibility toggle per world view and a "Hidden" chip.

### Verification

- Anonymous `GET /api/world-views` returns only public ones.
- Anonymous `GET /api/world-views/1/regions/root` → 404.
- Admin sees and can toggle; toggling to public makes it appear for anonymous
  users without a restart.

---

## S3 — Base layer importer

### No changes to the import tree format

`ImportTreeNode` stays as it is. A base-layer node is `{ name, children }` —
the same shape any other source produces. Nothing carries a division id, so
nothing can shortcut the matcher.

### New: `baseLayerImporter.ts`

- `buildBaseLayerTree({ maxDepth })` walks `administrative_divisions` by
  `parent_id` from the roots down to `maxDepth`, producing an `ImportTreeNode`
  tree under a synthetic `World` root (`importTree` skips the root and promotes
  its children — continents become root regions). Provider-agnostic by
  construction: it reads the table, never the word GADM.
- Every node is `{ name, children }`. Nothing else.
- `startBaseLayerImport({ name, providerLabel, maxDepth })` builds the tree and
  hands it to the existing `startImport`:

  ```ts
  startImport(tree, name, {
    matchingPolicy: 'country-based',
    sourceType: 'base_layer',
    source: providerLabel,
  })
  ```

  `runImport` (`worldViewImport/index.ts:90`) then runs the standard two phases —
  `importTree`, then `matchCountryLevel` — and marks the run ready for review.
  There is no base-layer-specific phase machine, no new progress fields, and no
  new status values.

### Geometry: the normal compute path

Matching creates the `region_members` rows, so geometry is computed the way every
other world view computes it: `POST /api/world-views/:id/compute-geometries`,
which already walks bottom-up (`ORDER BY gd.depth DESC`,
`computationProgress.ts:89`) with progress and cancellation. A leaf unions its one
member; a parent unions its children.

That is more expensive than copying the division polygon — a continent unions its
countries — but the cost buys the property that matters here: the geometry is
derived from what the matcher actually resolved, not from a mapping we asserted.
The fast path below removes most of the cost anyway.

Experience assignment stays what it already is: the existing admin action
`POST /api/admin/experiences/assign-regions`.

### Single-member fast path

In `computeRegionGeometryCore` (`geometryComputeSingle.ts:570`), when a region has
exactly one member, no child regions and is not a custom boundary, take the member
geometry directly instead of collect → make-valid → union → snap. This is a
general improvement — 1:1 regions are common in the Wikivoyage import too — and
with the direct-copy phase gone it is what keeps computing 3586 matched leaves
affordable.

### Generalizing the hardcoded source types

Four independent copies of the same allowlist block any new source from the import
UI:

```
backend/src/controllers/admin/wvImportLifecycleController.ts:142
backend/src/controllers/admin/wvImportFinalizeController.ts:85
backend/src/controllers/admin/wvImportRematchController.ts:35
backend/src/controllers/admin/wikivoyageExtractController.ts:58
    source_type IN ('wikivoyage','wikivoyage_done','imported','imported_done')
```

Replace with named predicates in a new
`backend/src/services/worldViewImport/sourceTypes.ts`. **They are not all the same
set** — `wikivoyageExtractController` lists world views eligible for *Wikivoyage
extraction*, which a base-layer world view must not be. At least two predicates:

- `isImportPipelineSource(sourceType)` — lifecycle, finalize, rematch
- `isWikivoyageSource(sourceType)` — Wikivoyage-specific actions

plus `finalizedSourceType(sourceType)` for the `_done` suffix rule
(`wvImportFinalizeController.ts:82-85`).

### Admin UI

An "Import base layer" action in the world view import admin page: world view
name, provider label, depth (default 2), reusing the progress display the
Wikivoyage flow already has. No provider name is prefilled — which dataset is
loaded is the admin's to state. The world view is created hidden (S1 default).

The import lands in the normal review UI with normal match statuses. The
expectation is that the review arrives essentially complete, because the names
came from the divisions the matcher searches — but that is an expectation to
**measure**, not to assert. Whatever ends up in `needs_review` is the interesting
output of this exercise: it is the generic pipeline telling us something about
itself.

### Expected result

- 3831 regions: 8 + 237 + 3586.
- Match statuses recorded by `matchCountryLevel`: countries `auto_matched` or
  `children_matched`, subdivisions `auto_matched`, with `region_members` rows
  created by the matcher — not by the importer.
- After the standard geometry compute and the existing assignment action,
  `experience_regions` is populated: 6520 locations assigned to their leaf, then
  propagated to country and continent by `assignAncestors`
  (`regionAssignmentService.ts:90-131`), then denormalized.
- Discover tree, region counts, map markers, curation and rejection flows all
  become exercisable.

### Verification

- Region count per depth matches the division count per depth.
- **Match outcome measured, not assumed**: the count per `match_status`, and the
  full list of anything that is not `auto_matched` / `children_matched`. A short
  list is a finding to look at; a long list means the country-based policy does
  not suit an administrative hierarchy and the design needs revisiting.
- Every matched region's member is the division of the same name, spot-checked
  across several countries — this is what proves the matcher resolved correctly
  rather than that we asserted it.
- No region has `geom IS NULL` after the compute.
- Spot-check: a known UNESCO site resolves to the right subdivision, country and
  continent.
- `experience_regions` is non-empty and its per-category totals match
  `getExperienceRegionCounts` output at root level.

---

## S2 — Tile boundary (second branch)

### The gap

`martin/config.yaml` runs with `auto_publish: { tables: true, functions: true }`
on a published port (`docker-compose.yml:104-105`). Every table and every function
in the database is reachable from the browser with no authentication. World view
visibility is only the most visible case of this.

The map's base style comes from CartoCDN, not Martin, so no fonts, glyphs or
sprites are involved — only our own tile sources.

### Design

- Martin loses its published port and becomes an internal compose service.
  Dev included: a hole that exists only in dev drifts back into prod.
- Backend gains `GET /api/tiles/:source/:z/:x/:y`:
  - `:source` against a **strict allowlist** of our tile functions. Without it the
    proxy re-exposes everything `auto_publish` publishes.
  - `z`/`x`/`y` validated as integers in range; query parameters whitelisted per
    source (`world_view_id`, `parent_id`, `_v`) — nothing forwarded blindly.
  - Authorization: base-layer division tiles are public; `tile_world_view_*`
    checks the world view's `is_public`; `tile_region_*` arrives with `parent_id`
    only, so it resolves region → world view through a small in-process memo cache
    (otherwise every tile costs an extra query).
  - `Cache-Control: public, max-age=…` for public sources, `private, max-age=…`
    for hidden ones — browser-cached but never in a shared cache. Not `no-store`:
    the payload is public-domain geometry, and killing the browser cache would
    make every pan re-fetch. Pass ETag through.
  - Its own rate limiter — a single map session issues hundreds of tile requests
    and must not consume the normal read budget (`docs/tech/rate-limiting.md`).
- Frontend: `useTileUrls.ts` builds `${API_URL}/api/tiles/...` instead of
  `MARTIN_URL`; MapLibre does not attach our in-memory JWT by itself, so the map
  components get a `transformRequest` that adds `Authorization` for same-origin
  tile URLs. `getAccessToken()` (`frontend/src/api/fetchUtils.ts:33`) is a module
  accessor and works from that closure.
- `scripts/test-stack.sh` and `.env.example` drop the Martin URL override in
  favour of the backend route.

### Verification

- Martin's port is not reachable from the host.
- A hidden world view's tiles return 404 for anonymous callers and render for an
  admin.
- Map interaction latency stays acceptable with the proxy in the path (measure
  before/after on a country-level drill-down).

---

## Non-goals

- Do not touch world view 1 or the division-based navigation. It stays the way to
  drill deeper than the mirror's two levels.
- No experience↔division relation.
- No mirror deeper than level 2.
- No renaming of the existing `tile_gadm_*` functions, `resetRegionToGADM` or
  `gadm_uid` in this work.
- No portability of region-scoped curation between world views. Rejections,
  manual assignments and the region-scoped curation log belong to the world view
  they were made in; experience-level work (`curated_fields`, images, treasures,
  `is_iconic`, Curator Picks, new categories) is world-view independent and
  carries over.

## Risks

- **Matching may not resolve cleanly.** The whole point of going through the
  matcher is that its result is not guaranteed. `matchCountryLevel` is written
  around a Wikivoyage-shaped tree, and `trySubdivisionDrillDown` is all-or-nothing:
  if even one of a country's children fails to match, the country is assigned at
  country level and *none* of its subdivisions get members. A handful of such
  countries is a normal review queue; many would mean the country-based policy is
  the wrong fit for an administrative hierarchy, and the answer would be a
  matching policy suited to this source — not a pre-resolved import.
- **Geometry compute cost.** Continents union their countries at full resolution.
  The single-member fast path removes the cost for the 3586 leaves, but the top
  two levels still go through the union machinery. Expect a long run; it has
  progress and cancellation already.
- **A second world view with 3831 regions** doubles the tile-serving surface.
  Wikivoyage already has 4301, so this is not new ground, but the mirror is the
  first one with geometry on every row.
- **Assignment runtime** across 3586 leaf geometries — spatial index exists
  (`idx_regions_geom`), 6520 points, should be minutes not hours. Measure.
- **Visibility middleware coverage.** The region read surface is wide; missing one
  endpoint leaves a hole. Enumerate the routes from `worldViewRoutes.ts` and
  `experienceRoutes.ts` explicitly rather than by memory.
- **Tile proxy throughput** (S2). Node in the tile path is the one real
  performance risk in this document.

## Documentation obligations

- **ADR-0018** — experiences attach to regions; the base layer reaches them via a
  materialized mirror world view built by the import pipeline. Records the
  rejected alternative (experience↔division relation) and the naming rule from D3,
  plus the pre-existing GADM-named surfaces left alone.
- **An ADR for the tile access boundary** (branch 2, next free number at the
  time — do not reserve one now): backend proxy with Martin internal, chosen over
  signed tile tokens and SQL-level filtering.
- `docs/tech/world-views.md` — visibility setting, base-layer source type.
- `docs/tech/world-view-import-format.md` — no format change; note that the
  base-layer source emits the same name-and-hierarchy tree as any other.
- `docs/vision/vision.md` — visibility is user-facing (line 20 already promises
  administrative browsing; the mirror is what finally delivers it, and line 109's
  "default world view mirrors the GADM hierarchy directly" needs correcting to
  match reality).
- `docs/security/SECURITY.md` + `docs/security/asvs-checklist.yaml` — the
  server-side visibility check and, in branch 2, the tile boundary.
- `docs/tech/experiences.md` — how experiences reach the base layer.
