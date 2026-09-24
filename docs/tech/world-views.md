# World Views - Region Organization

This document describes the World Views feature that allows users to create 
custom regional organizations beyond the standard GADM (Global Administrative 
Areas) hierarchy.

## Terminology

| Term | Description | Example |
|------|-------------|---------|
| **Administrative Division** | Official geographic boundary from GADM | Germany, Bavaria, Munich |
| **World View** | A custom hierarchy for organizing regions | "Geographic Regions", "My Travel Map" |
| **Region** | A user-defined grouping within a World View | "Europe", "Baltic States", "Nordic Countries" |

### Code Mapping (Migration Complete)

The following table shows the completed migration from legacy naming to current naming:

| Concept | Database Table | TypeScript Type |
|---------|---------------|-----------------|
| Administrative Division | `administrative_divisions` | `AdministrativeDivision` |
| World View | `world_views` | `WorldView` |
| Region | `regions` | `Region` |
| Region Member | `region_members` | `RegionMember` |

### API Endpoints

| Resource | Path |
|----------|------|
| Administrative Divisions | `/api/divisions/*` |
| World Views | `/api/world-views` |
| Regions | `/api/world-views/:id/regions/*` |

## Overview

While GADM provides a standardized administrative hierarchy (Country → State → 
District), real-world use cases often require custom groupings. The World Views 
feature allows users to:

- Create custom World Views with their own regional organizations
- Combine multiple administrative divisions into logical regions
- Create nested hierarchies with subregions
- Define custom boundaries for partial regions
- Visualize and compute geometries for custom regions

For implementation details of the Create Subregions map tab (`assign`, `split`, `cut`), see `custom-subdivision-map-tools.md`.

---

## Core Concepts

### World View
A named collection of regions representing a custom way of organizing the world:
- "Geographic Regions" - continents, subcontinents, cultural regions
- "My Travel Map" - personal organization of visited areas
- "Sales Territories" - business regions

#### The default World View

GADM is the default World View, seeded with `is_default = true` by
`db/init/01-schema.sql`. The partial unique index
`idx_world_views_single_default` (`ON world_views(is_default) WHERE is_default`)
enforces **at most one** default — zero would satisfy it as well, so the second
half of the invariant lives in the API: `deleteWorldView` refuses to delete the
default World View. Together they keep it at exactly one.

The index is also the `ON CONFLICT` arbiter that keeps the seed idempotent when
the schema file is re-applied to an existing database. Databases created before
it exists get both the cleanup and the index from
`db/migrations/006-single-default-world-view.sql`.

The default World View's visibility is governed by the same `is_public`
column as any other world view (see [Visibility](#visibility) below) —
`is_default` carries no visibility meaning of its own, and the client has no
hardcoded rule hiding it. In practice, though, the picker's Settings dialog —
where the "Visible to everyone" toggle lives — is only offered when the
selected world view is not the default one (`isCustomWorldView` in
`HierarchySwitcher.tsx`), so there is currently no path from the picker to
flip the default world view's flag; only a direct
`PUT /api/world-views/:worldViewId` call reaches it. A duplicate default row,
the case the invariant above rules out going forward, would be hidden by that
same default until published that way, then showing as a repeated default
entry in the World View picker.

### Region
A node in the World View hierarchy that can contain:
- **Administrative Divisions** - direct references to GADM boundaries
- **Subregions** - nested regions for further organization

### Members
The contents of a region, which can be:
- **Administrative Divisions** - standard GADM boundaries
- **Subregions** - child regions in the hierarchy

### A hierarchy edit keeps every visit
A traveller's visit is recorded on a region (`user_visited_regions`), and it is the traveller's, not the curator's (#764). Deleting a region that carries a visit is refused, whichever writer sends the delete:
- **The rule is the database's.** `user_visited_regions.region_id` references `regions` with `ON DELETE NO ACTION`, so a delete that would take a visit fails. That holds for region CRUD, flatten, and the import review's merge, remove, dismiss, prune and smart flatten alike.
- **The answer is 409.** `errorHandler` recognises the violation (`isVisitedRegionDelete` in `backend/src/db/regionVisits.ts`) and answers 409 with a sentence for the curator. A writer that runs in one transaction has rolled back by then, and hands the error on: the import tree's operations rethrow it, and `smartFlatten`, which answers its other failures itself, rethrows this one.
- **A writer that is not one transaction asks first.** `deleteRegion` moves children and members before it deletes, and `flattenSubregion` does the same. `smartFlatten` auto-matches descendants before the transaction that deletes them opens. Each counts the visits it would take (`visitsUnder` for a branch, `visitsOn` for listed regions) and refuses before its first write, with the count. Refusing at the delete itself would leave the earlier writes standing. The count and the writes are still separate statements; putting them in one transaction is #689.
- **The screen says why.** `EditRefusedSnackbar` (`components/shared/`) shows the server's sentence when a refusal comes back. The World View Editor shows it for a delete or a flatten. Flatten-all stops at the first refused subregion, and the editor says first how many were flattened before it; the server's sentence speaks for the one refused edit ("this edit was not made"). The import review shows it for a merge, remove, dismiss, prune or smart flatten, through `useTreeMutations`' `treeEditError`, and for a remove chosen in AI Review Children, whose failed actions are summed up with the server's sentences by `failedActionsError` (`suggestChildrenOutcome.ts`).
- **The world view delete is the one exception.** Its preview counts the visits (`GET …/delete-impact`) and the admin confirms. `deleteWorldView` then removes them in the same statement as the regions. `NO ACTION` is checked at the end of that statement, which is why the constraint is not `RESTRICT`.

---

## Visibility

Every world view carries an `is_public` flag (`world_views.is_public`, default `false`), enforced server-side rather than left to a client-side filter:

- **Listing** — `getWorldViews` (`backend/src/controllers/worldView/worldViewCrud.ts`) always filters to `is_active = true`, and on top of that filters by `is_public` for non-admins; admins see every active world view regardless of public/hidden visibility, but not inactive ones — that filter applies regardless of role. The filter is a `WHERE` clause, so a hidden world view is absent from the response for non-admins (an inactive one for everyone), not merely unlabeled in it. Because the rows depend on the caller, the response carries `Cache-Control: private, no-cache` and `Vary: Origin, Authorization` — Express's default ETag plus `Vary: Origin` says nothing about who asked, which is enough for a proxy to hand an admin's list to an anonymous visitor. Since #597 those headers come from `optionalAuth` on the route rather than from the controller, as on every read whose answer is shaped by the caller (`docs/security/SECURITY.md` § Headers). The client caches it per identity for the same reason (`['worldViews', user?.id ?? 'anon']` in `useNavigation`), so an anonymous answer and an admin answer cannot occupy the same entry; asking before the session is restored used to freeze the anonymous one for the session (#460). The cache key only keeps the two answers apart; what acts on a change is the reconciliation in `useNavigation` — when the visible list changes, a selection no longer in it is replaced (the world view the address names, else the default, else the first), and the selected region, selected division and both breadcrumb trails are dropped. Discover no longer keeps a context of its own to drop: since #644 it derives its trail, its open kind list and its card from the region `useNavigation` holds plus the address, so a switch takes all of it in the same commit.

The world view is a **path segment** since #644 — `/wv/5`, written through `useAppAddress`'s `go` rather than as a `?wv` query parameter — and the writes say which kind they are ([ADR-0034](../decisions/0034-a-place-has-an-address.md), [addresses.md](addresses.md)). A replacement rewrites the address, the way a manual switch does, and a switch drops the region and card segments with it, since the address says which world view a region is in. A first pick writes the address too whenever it does not already name what was adopted: only the *default* world view writes no segment, so a bare `/` stays bare for it alone — anything else must be named, or nothing under it could be addressed at all. An empty list clears the context and the address both. The traffic runs the other way too: an address changing to name a different world view the caller *can* see is itself a switch — editing the address bar, opening a shared link in a tab that already has a selection, or going back across a switch all select it and drop the previous one's context; following one writes nothing, since the address already says it — which is what keeps Back into a region of another world view landing on that region rather than on its root. Where the address stands in for one the app would never have built — a bare `/` resolving to a custom world view, an explicit `/wv/1` for the default — following writes the canonical form instead. An id absent from the visible list is not followed: while the selection is still visible the address is rewritten to name it, since nothing downstream would — the visibility guard returns precisely because the selection is fine. When neither survives, both are left to the reconciliation, which replaces the selection and rewrites the address in one pass rather than parking it on a second id the caller cannot see. Without that half the world view would flip while the departed one's region stayed on screen, which is the outcome hiding it is meant to prevent.
- **Region reads** — `requireVisibleWorldView` (`backend/src/middleware/worldViewVisibility.ts`) guards routes that take a `worldViewId` or a `regionId`. It resolves the id from a `worldViewId` (route or query param) or a `regionId` (route param on most of these; an optional query filter on the experience list and experience-locations reads, marked below). Admins bypass the check; everyone else gets **404**, never 403 — a 403 would confirm the world view exists, which is exactly what hiding it is meant to prevent. A missing mandatory id and a hidden world view answer identically; the optional `regionId` query filter is the exception — an absent one is a legitimate unfiltered read, so the guard passes it through rather than 404ing. The guarded routes (check against `worldViewRoutes.ts` / `experienceRoutes.ts` for the current set):
  - `GET /api/world-views/:worldViewId/regions`
  - `GET /api/world-views/:worldViewId/regions/root`
  - `GET /api/world-views/:worldViewId/regions/search`
  - `GET /api/world-views/:worldViewId/compute-geometries/status`
  - `POST /api/world-views/:worldViewId/division-usage`
  - `GET /api/world-views/:worldViewId/display-geometry-status`
  - `GET /api/world-views/regions/:regionId/ancestors`
  - `GET /api/world-views/regions/:regionId/subregions`
  - `GET /api/world-views/regions/:regionId/members`
  - `GET /api/world-views/regions/:regionId/members/geometries`
  - `GET /api/world-views/regions/:regionId/members/descendant-geometries`
  - `GET /api/world-views/regions/:regionId/geometry`
  - `GET /api/world-views/regions/:regionId/hull/params`
  - `GET /api/experiences/region-counts`
  - `GET /api/experiences/by-region/:regionId`
  - `GET /api/experiences/by-region/:regionId/locations`
  - `GET /api/experiences` (`regionId` query param is optional)
  - `GET /api/experiences/:id/locations` (`regionId` query param is optional)
- **Single-experience reads** — the second mechanism, for the routes the first can't cover. `GET /api/experiences/:id` (`getExperience`, `backend/src/controllers/experience/experienceQueryController.ts`) can never 404 on visibility, because the experience it serves is public data — only its association with a hidden world view is sensitive, not the experience itself. So instead of guarding the route, the controller filters the `regions[]` array it returns, using the same predicate `getWorldViews` (above) uses to filter its list — `wv.is_active = true`, plus `wv.is_public = true` unless the caller is an admin — matching it exactly so the two cannot drift apart. That is the world-view half and no longer the whole account of the array: since #521 it carries a second filter on a different axis, `readerRegionMembershipSql()`, so a region is named only where the object has a point there this caller may see. A region whose world view is perfectly public can therefore be absent — deliberately, because placement writes an unread point's region into `experience_regions` (ADR-0025 decision 5) and naming it would offer a region whose own list does not hold the object. That half is relaxed for a curator or admin whose scope reaches the object, not for admins alone, and a manual assignment is exempt from it; see [experiences.md](experiences.md) for the rule and the other reads that carry it. `GET /api/experiences/search` answers with the same array since #592, and on stricter terms: it carries no session at all, so it filters to published world views for every caller with no admin bypass, and applies the membership half unrelaxed — a search row is a link somebody clicks, so a region whose own list would drop the object is not an answer there ([ADR-0042](../decisions/0042-a-search-answers-about-the-catalogue-and-opens-where-the-reader-is.md)).
- **Defaults hidden** — `is_public` defaults to `false` at the column level, so every newly created world view — imported through any source, or built by hand in the World View Editor — starts hidden. An admin publishes it explicitly.
- **Toggle** — the world view settings dialog (`HierarchySwitcher.tsx`) has a "Visible to everyone" switch; a hidden world view carries a "Hidden" chip in the picker.

This is **not** a tile boundary. Martin serves vector tiles on its own public port without authentication, so a hidden world view's geometry stays fetchable by anyone who knows its tile id — visibility bounds the REST API, not the tile server. The default world view does not even need that much: its map is GADM itself, and `tile_gadm_root_divisions` takes no parameter at all, so hiding it hides it from the REST API and from nothing else. See `docs/security/SECURITY.md` for the known gap and its planned fix.

---

## Base Layer Import

A world view can be created directly from the administrative base layer itself — `administrative_divisions` — rather than from an external hierarchy. `source_type = 'base_layer'` marks this kind of import in `world_views.source_type`, alongside `wikivoyage` and `imported`; like both of those it becomes `base_layer_done` once its match review is finalized (`backend/src/services/worldViewImport/sourceTypes.ts`).

**Creating one**: from the "Administrative base layer" source in the import panel, an admin gives the world view a name, a provider label (free text — the provider is never hardcoded; see below), and a depth (1, 2, or 3). `buildBaseLayerTree()` (`backend/src/services/worldViewImport/baseLayerImporter.ts`) reads `administrative_divisions` down to that depth with a recursive CTE and shapes it as an ordinary import tree, one node per division, carrying only names and hierarchy — never the division a node was read from, even though the tree is generated from those divisions and could trivially carry it. From that point on it is indistinguishable from a Wikivoyage or file import: the ordinary matcher runs against it, unmatched regions land in the ordinary review UI, and geometry is computed by the normal compute path. Most of a base-layer mirror's regions are exactly one division, so most of them take the single-division fast path described under § Geometry Computation — that path is general, not specific to this source.

Depth 2 (the default) produces 3831 regions — 8 root-level entries, 237 countries, 3586 subdivisions — matching the division counts at each level exactly. Depth is capped at 3; mirroring the full ~392,112-row table would roughly double the largest table in the database.

### Matching policies

The matcher is a set of interchangeable policies over one shared core
(`matcherUtils.ts`), selected by `defaultMatchingPolicy(sourceType)`
(`sourceTypes.ts`) rather than fixed per algorithm. `matcher.ts` is the barrel
naming them; each lives in its own module. See
[ADR-0019](../decisions/0019-matching-policy-per-source-shape.md).

| Policy | Module | Used by |
|---|---|---|
| `country-based` (default) | `matcherCountryPolicy.ts` | Wikivoyage and file imports, whose nodes may group several divisions |
| `hierarchical` | `matcherHierarchicalPolicy.ts` | `base_layer` — a mirror is one node per division |
| `none` | — | no matcher runs; every region starts `no_candidates`. An explicit choice per import (the file-upload form offers it) or per re-match (`matchingPolicy` in the request body), never derived from a source type |
| legacy leaf | `matcherLeafPolicy.ts` | not reached from the import pipeline |

`defaultMatchingPolicy(sourceType)` returns only the two that match, so `none`
cannot arrive by inference — it is always an explicit choice for one run.

`hierarchical` descends the import tree alongside the division hierarchy,
resolving each node among the divisions beneath **the division its nearest
resolved ancestor matched**. Two details carry the weight:

- **Ancestor context disambiguates.** The base layer shards countries with
  overseas territories across continents, so seven divisions are named "France";
  a global name index cannot choose. Exactly one France sits under a resolved
  Europe.
- **A node that resolves to nothing is transparent, not fatal.** Resolution is
  against the nearest *resolved* ancestor, so a Wikivoyage grouping node
  ("Benelux") costs only itself — Belgium is still found among Europe's
  descendants. Anchoring on a resolved parent's direct children would strand the
  subtree instead.

Within a sibling group, exact matches bind before fuzzy ones and each division is
claimed once; "Osh" and "Osh (city)" are each other's prefix match, so without
that ordering one could take the other's division. The parenthetical strip
(`cleanWvName`) is off under `hierarchical`: a base-layer node named "Osh (city)"
exists only because a division of that exact name does, so stripping it turns an
available exact match into a wrong one.

### Measured match outcome

A depth-2 base-layer import of 3831 regions (8 + 237 + 3586, matching the
division counts exactly), before and after the policy landed:

| `match_status` | `country-based` | `hierarchical` |
|---|---|---|
| `auto_matched` | 2372 (62%) | **3831 (100%)** |
| `no_candidates` | 1251 | 0 |
| `children_matched` | 157 | 0 |
| `needs_review` | 51 | 0 |

The mirror allows a check no other source does, because the correct answer was
withheld from the importer and is recoverable from the data: every bound
division's name equals its region's name, and 8 roots bind to root divisions
while 3823 non-roots bind to a division whose parent is exactly the division
bound to their parent region — zero exceptions. Two bindings that already existed
changed, both corrections: "Osh (city)" from the province "Osh" to the
identically-named city division, and root "Antarctica" from a child division to
the root one (GADM self-nests that continent).

`country-based` is untouched by the consolidation — a fresh run of the pre-change
code and a fresh run of the current code over the same 4301-region Wikivoyage
import produce byte-identical per-region outcomes.

Take a per-region snapshot with `scripts/match-snapshot.sh <world_view_id>`; it
emits `region_id|match_status|division_ids|name` sorted, so two runs are
comparable with `diff`. A total alone is too coarse to review a matcher change —
two different defects can produce the same total.

Re-matching (`POST /wv-import/matches/:id/rematch`) runs the world view's policy,
so it reproduces the import; pass `matchingPolicy` in the body to score the same
tree under another. **It is destructive**: every `region_members` row for the
world view is deleted, manual matches included, so hand-resolve after a re-match,
never before.


## Import Sources

Every world view import — Wikivoyage, JSON file, or base layer — starts from one panel (`WorldViewImportPanel.tsx` → `ImportSourcePanel.tsx`) over a single registry, `IMPORT_SOURCES` (`frontend/src/components/admin/importSources/`). A source contributes a stable id, a label for the selector, an optional suggested world view name (offered until the admin types their own), and a form component that owns its own inputs, mutation, error surface and start button; the shared panel owns only the card, the source selector, and the world view name field every source needs. That registry entry is only the frontend half of adding a source. See "How to Add a New Import Source" in `docs/tech/world-view-import-format.md` for the full recipe, including the backend half this section doesn't cover.

The three sources today:

- **Wikivoyage** (`WikivoyageSource.tsx`) — fetches and enriches the full Wikivoyage region hierarchy (extraction → enrichment → import → matching), with a persistent on-disk cache.
- **JSON file** (`FileSource.tsx`) — uploads a pre-generated JSON region tree for any other external source, with a matching-policy dropdown.
- **Administrative base layer** (`BaseLayerSource.tsx`) — see Base Layer Import above.

---

## Features

### 1. Create and Manage World Views

Create custom World Views to organize regions your way.

**Example:**
```
World View: "Geographic Regions"
├── Europe
│   ├── Western Europe
│   │   ├── France
│   │   ├── Germany
│   │   └── Benelux
│   │       ├── Belgium
│   │       ├── Netherlands
│   │       └── Luxembourg
│   ├── Eastern Europe
│   │   ├── Poland
│   │   ├── Ukraine
│   │   └── Baltic States
│   │       ├── Estonia
│   │       ├── Latvia
│   │       └── Lithuania
│   └── Nordic Countries
│       ├── Sweden
│       ├── Norway
│       ├── Finland
│       ├── Denmark
│       └── Iceland
└── Asia
    ├── Central Asia
    │   ├── Kazakhstan
    │   └── ...
    └── ...
```

### 2. Add Administrative Divisions to Regions

Search for any GADM administrative division and add it to your regions.

**Options when adding:**
- **Add as simple member** - just adds the administrative division
- **Create as subregion** - creates a region container
- **Include children as subregions** - also adds all subdivisions

**Example:**
Adding "Germany" to "Central Europe":
- Simple member: Just adds Germany's boundary
- As subregion with children: Creates Germany region with all 16 Bundesländer

### 3. Select Specific Children

When adding an administrative division, choose which specific children to include.

**Example Use Case:**
Creating "Somaliland" - GADM only has "Somalia":
1. Search for "Somalia"
2. Check "Select specific children"
3. Choose only the 5 regions that make up Somaliland
4. Give it a custom name "Somaliland"

### 4. Custom Boundaries (Partial Regions)

Draw custom polygons to define boundaries that don't match GADM borders.

**Example Use Cases:**

**Florida Keys:**
- GADM has Monroe County and Miami-Dade County
- Florida Keys is only the island chain
- Draw a polygon around just the keys

**Crimea:**
- Disputed territory needing custom handling
- Draw boundary to match preferred delineation

### 5. Staging Area for Multi-Division Regions

Collect multiple administrative divisions before creating a region.

**Example:**
Creating "Kazakhstan" (spans Europe and Asia in GADM):
1. Search for "Kazakhstan"
2. Stage both European and Asian portions
3. Click "Create Region"
4. Both portions combine into one region

The dialog suggests a name: what the staged names share, less any trailing separator (`findCommonPrefix` in `WorldViewEditor/utils`) -- "Kazakhstan" for the two rows above, "M" for Monroe County and Miami-Dade County. The suggestion is seeded once, when the dialog opens, and the field is the admin's from then on: it can be replaced or cleared, and a cleared field stays cleared (#282 -- seeding on every empty render put it straight back). The next staging gets its own suggestion; the detour through the boundary-drawing dialog keeps whatever was typed.

### 6. Flatten Subregions

Convert subregions back to simple administrative division members.

**Example:**
Before:
```
Germany
├── Bavaria (subregion)
├── Berlin (subregion)
└── ... 16 subregions
```

After flattening:
```
Germany
├── Bavaria (admin division)
├── Berlin (admin division)
└── ... 16 admin divisions
```

### 7. Expand to Subregions

Convert administrative division members to subregions (opposite of flatten).

**Example:**
Before:
```
Nordic Countries
├── Sweden (admin division)
├── Norway (admin division)
└── Finland (admin division)
```

After expanding:
```
Nordic Countries
├── Sweden (subregion)
├── Norway (subregion)
└── Finland (subregion)
```

Each member *row* becomes a subregion, and the row itself moves into it (`expandToSubregions`, #1004). A cut part keeps its geometry and takes its own name (`custom_name`, falling back to the division's). A division held as two parts — Russia west of the Urals and the Urals strip, say — becomes two subregions, each holding its part, never two copies of the whole of Russia.

**Members move as rows wherever a region's members go elsewhere** (`moveMembersToRegion` in `backend/src/controllers/worldView/helpers.ts`, #384). The writers that send a region's members elsewhere all call it:
- deleting a region with its children moved to the parent (`deleteRegion`);
- flattening a subregion into its parent, row by row for the subregion and every region under it (`flattenSubregion`);
- the import review's remove with its divisions moved to the parent (`removeRegionFromImport`);
- the import review's merge of a region's only child into it (`mergeChildIntoParent`, through `moveChildDataToParent`).

A cut part arrives as the part it is rather than widened to the whole division, and a cut the parent already holds stays beside it. The only row that does not move is a whole division the parent already holds whole: it adds nothing to the parent's coverage, and the unique index refuses a second copy.

### 8. Color Management

Each region has a color for map visualization.

**Features:**
- **Inherit parent color** - new subregions use parent's color
- **Propagate color** - apply a region's color to all descendants
- **Individual colors** - each region can have its own color

### 9. Drag-and-Drop Reorganization

Reorganize the hierarchy by dragging regions.

**Features:**
- Drag a region to another to make it a child
- Drag to "root" to make it top-level
- Visual feedback shows valid drop targets

### 10. Geometry Computation

Compute merged geometries for regions.

**Single Region Computation:**
- Click "Compute" on a specific region
- Uses SSE (Server-Sent Events) streaming for real-time progress (6-step pipeline)
- Computes bottom-up: recursively computes children without geometry first, then parent
- Afterwards every **derived ancestor**'s geometry is nulled: a parent is the union of its children, and one of them has just changed (#667). A hand-drawn boundary is left as drawn and ends the walk there — its outline does not move when a descendant gains one, so nothing above it does either (#283). They are not recomputed on the spot — recomputing a continent is around a hundred seconds of union — so an ancestor is absent from the map until the next world-view run picks it up, and Catalogue Checks reports it meanwhile
- Pipeline: collect geometries → analyze → snap neighbors → union → clean holes/slivers → save
- **No writer computes over a region while it is flagged hand-drawn** (`is_custom_boundary`, #439). Each geometry writer holds that rule itself:
  - **The bulk core, `computeRegionGeometryCore`,** turns such a region away before it computes or writes anything. It answers *not computed*, and a world-view run counts the region as skipped.
  - **Every geometry write asks again** (`WHERE … is_custom_boundary IS NOT TRUE`). This covers the core, the stream's save, the single-member fast path and the reset. A union can run for minutes, and a boundary drawn by hand in that time is kept: the write matches no row, and the writer answers *not computed* rather than success. The reset answers 409 in that case.
  - **`recomputeRegionGeometry`** (`helpers.ts`) guards its own write with `is_custom_boundary IS NOT TRUE`.
  - **The SSE stream** keeps the drawing (`shortCircuitForCustomBoundary`) unless a member carries its own `custom_geom`: then it clears the flag first and computes, since the region is no longer hand-drawn.
  - **Reset to GADM** (`resetRegionToGADM`, `POST …/geometry/reset`) is the explicit replacement: it clears the flag and then unions the members.
- **Except for a region that is exactly one division** (one member, no child regions, no hand-drawn boundary): both writers — the SSE stream and the bulk core — short-circuit to `computeSingleMemberFastPath`, which copies the member's geometry through the same `validate_multipolygon` normalization the normal path applies and runs none of the union path's steps (collect, analyse, snap, union, clean, save — spelled out in `geometryComputeSSE.ts` and again in `geometryComputeSingle.ts`), so the SSE `complete` event carries no polygon/hole counts. This is deliberate: the single member already *is* the answer, and putting it through the union path's steps would only degrade a geometry that is already right — its own interior rings included, which the hole filter would judge by a rule meant for the gaps a union leaves. Since #443 neither path applies a tolerance of its own either; what the union path still does above 300,000 input points is pre-simplify its *inputs* to stay inside the timeout (`geometry-columns.md` rule 1), and this path is exempt from that too. Common well beyond base-layer imports — it is the shape of any 1:1 match
- "Skip snapping" checkbox (default: on) skips the expensive neighbor-snapping step for faster computation. Snapping adds shared boundary vertices but is O(n²) on child count — can be slow for continents. Both writers read the same `skipSnapping` parameter with the same default, and an absent one means *snap*: the bulk endpoint read it off a query nothing validated until #736. What the step decides is only where the children's shared borders sit — a region's direct members are carried across it untouched, so the union sees everything the collect step gathered (`geometry-columns.md` rule 1)
- Uses a dedicated `pool.connect()` client for all computation queries, ensuring `SET statement_timeout` applies to the correct connection (not a random pool connection)
- Generates TS hull for archipelagos, clears stale hull data for non-archipelagos
- JWT is passed as `token` query parameter since `EventSource` can't send Authorization headers

**World View-wide Computation:**
- "Compute All Regions" button (shown when no region is selected)
- Processes all regions in dependency order (deepest children first)
- Takes a **closure, not a filter**: every derived region with no geometry *and every derived ancestor of one*, so a run leaves the tree consistent. Selecting `geom IS NULL` alone never revisited a parent that already had geometry, which is how four continents came to draw a fraction of themselves (#667). "Force" takes every region regardless. A user-drawn boundary is never recomputed from members on either arm (#283), and it bounds the closure in both directions: an empty one does not seed it, and one partway up the tree does not pass a child's news any further, because its own outline does not move
- The selection is evaluated **once per run**, which is why nulling the ancestors belongs to the statement that writes `regions.geom` rather than to whichever request finishes — and since #680 the database enforces exactly that, from `trg_regions_geom_invalidates_parent` ([ADR-0035](../decisions/0035-ancestor-geometry-invalidation-lives-in-the-database.md)). It covers the writes made to a region's *descendants* on the way to it: computing a continent computes its missing countries first, and if only the continent's own success invalidated, those descendant writes would consume the very NULLs the closure seeds on — leaving a continent whose union timed out with nothing NULL beneath it, unreachable by every later run. A structural change is the one thing the trigger cannot see, and `updateRegion` and `deleteRegion` name their rows themselves. See `docs/tech/geometry-columns.md` § Region creation workflow for the mechanism
- Shows progress with current region name and percentage
- Can be cancelled mid-process

---

## Real-World Examples

### Example 1: European Regions for Travel Tracking

```
Europe
├── Baltic States
│   ├── Estonia
│   ├── Latvia
│   └── Lithuania
├── Balkans
│   ├── Albania
│   ├── Bosnia and Herzegovina
│   ├── Bulgaria
│   ├── Croatia
│   └── ...
├── Benelux
│   ├── Belgium
│   ├── Netherlands
│   └── Luxembourg
└── Nordic Countries
    ├── Denmark
    ├── Finland
    ├── Iceland
    ├── Norway
    └── Sweden
```

### Example 2: Russia's Federal Districts

Organize Russia by federal districts rather than all 85 subjects:

```
Russia
├── Central Federal District
│   ├── Moscow
│   ├── Moscow Oblast
│   └── ...
├── Northwestern Federal District
│   ├── Saint Petersburg
│   └── ...
├── Southern Federal District
├── Volga Federal District
├── Ural Federal District
├── Siberian Federal District
└── Far Eastern Federal District
```

### Example 3: Transcontinental Countries

Handle countries spanning multiple continents:

**Kazakhstan:**
- Small part in Europe, majority in Asia
- Stage both GADM portions, create unified region

**Turkey:**
- Split into European Turkey and Asian Turkey
- Or keep unified in one region

**Russia:**
- European Russia in "Europe"
- Asian Russia in "Asia"
- Or keep unified

---

## API Endpoints

Every call `frontend/src/api/worldViews.ts`, `frontend/src/api/regions.ts` and `frontend/src/api/geometry.ts` make answers through a schema in `backend/src/api/responses/worldViews.ts`, `responses/regions.ts` or `responses/geometry.ts` (ADR-0066), except the ones that answer 204 with no body: deleting a world view or a region, and setting a region's geometry. Three geometry endpoints with no caller on the web were removed (#1006): the two public region-geometry list reads (`…/regions/root/geometries`, `…/subregions/geometries`), since the map draws Martin's tiles from stored geometry, and the unstreamed single-region computation (`POST …/regions/:regionId/geometry/compute`), since the editor computes through the stream. The two reads computed a union on request, for an anonymous caller, where the pipeline itself times out.

- **A region is one shape wherever it is answered.** The tree, the roots, a branch, the ancestors, and the region a create or an update leaves are all read by `REGION_SELECT_SQL` and mapped by `regionOf` (`controllers/worldView/regionAnswerRows.ts`).
  - The last ancestor is the selected region's whole row. It is what the client completes a selection clicked on the map from, and all a region restored from the address has.
  - A write answers with the row the tree would list, as the triggers and the rest of the handler left it, rather than with its own `RETURNING`. An update that flips `usesHull` adds the world view's bumped `tileVersion`.
- **A world view carries its `tileVersion` in every answer**, a create's and an update's included. The client selects the world view a settings save hands back, and keys every tile URL on that number. Every world view answer is mapped by `worldViewOf`, and the delete impact by `deleteImpactOf` (`controllers/worldView/worldViewAnswerRows.ts`).
- **A search match is its own shape** (`RegionSearchResult`): the region's `path` from the root and the `relevance_score` it was ranked by.
- **A member is a subregion or a division, in one shape** (`RegionMember`). A subregion carries its `color`; a division carries its `memberRowId` and `hasCustomGeometry`, since a division cut into parts is a member once per part. Each kind leaves the other's keys absent, and the schema's refinement holds that, with `isSubregion` agreeing with `memberType`. `subregionMemberOf` and `divisionMemberOf` (`controllers/worldView/regionMemberAnswerRows.ts`) map the two.
- **An outline is a GeoJSON feature.** A region's own read (`RegionGeometry`) is its stored outline, a `MultiPolygon` as the column holds it, or its hull with `detail=hull`, which says `displayMode` (`real` where the region has no hull) and whether the hull crosses the antimeridian. The editor's member reads simplify, and a simplified outline of one piece comes back a `Polygon`, so their features carry an `AreaGeometry`, one or the other. `regionGeometryOf`, `memberGeometryOf` and `descendantMemberGeometryOf` (`controllers/worldView/regionGeometryAnswerRows.ts`) map them.
- **A region's computation streams events a schema declares** (`ComputeProgressEvent`): a `progress` step with its own figures, then a `complete` whose `data` is a `ComputeResult` (the outline's points, polygons and holes, whether a hull was rebuilt, the region's new frame and the world view's tile version), or an `error` that ends the stream. The handler writes each through `writeEvent()` (`backend/src/api/respond.ts`). The editor merges the result's `usesHull`, `focusBbox` and `anchorPoint` into its selection and shows its points and polygons.
- **The geometry panel's status line reads `Outlines: withGeom/total`** from `DisplayGeometryStatus`: how many of the world view's regions have a computed outline. On the development database of 2026-09-23 that was 3,829 of 3,831, Europe and Canada being the two without one. The endpoint also sends how many have their frame (`withAnchor`), how many are drawn as a hull and how many have one built.
- **A world view's computation** answers its start with the same keys whether it started or found nothing to do (`started` says which), its status with `running` alone while no run is known, and a cancel with `cancelled: true`.
- **The hull editor** previews a hull (`HullPreview`), saves one (`HullSaved`) and reads the parameters a region's hull was saved with (`SavedHullParams`, null where it was never tuned), each carrying `HullParams`. The stored parameters are served by their three keys. The defaults it opens on and the server builds with are one constant, `DEFAULT_HULL_PARAMS` in `@tyr/shared/geometry`.
- **The member edits answer with what they did.** A removal counts the rows that went, not the ids the call named. Adding a division's children counts the children it placed, less any whose assignment to an existing subregion failed, and `removedOriginal` says whether a row of the division itself went. Adding divisions still counts the divisions the call named: in its child-selection mode it adds children rather than the named division, so no one count says what it placed. A move answers with the member row's id and the two regions, never the row itself, whose cut geometry can run to megabytes. Every subregion an edit creates, whether by adding divisions, adding a division's children or expanding the members, is a `CreatedSubregion` naming the division it was made for.
- On the client, `Region` in `frontend/src/types/index.ts` is derived from the answer. Past the six keys every selection sets, the rest of the row is optional, because a selection made on the map starts from what the vector tile carries.

### World Views
- `GET /api/world-views` - List all world views
- `POST /api/world-views` - Create world view
- `PUT /api/world-views/:worldViewId` - Update world view
- `GET /api/world-views/:worldViewId/delete-impact` - What a delete would destroy: its regions, the object assignments and the readers' visits that go with them
- `DELETE /api/world-views/:worldViewId` - Delete world view

### Regions
- `GET /api/world-views/:worldViewId/regions` - List regions in world view
- `GET /api/world-views/:worldViewId/regions/root` - List root regions
- `GET /api/world-views/:worldViewId/regions/search` - Search regions
- `GET /api/world-views/regions/:regionId/subregions` - List a region's children (what the map and the list read one level at a time; there is deliberately no "every leaf in the world view" read — see `experience-map-ui.md` § What the map reads at each level)
- `GET /api/world-views/regions/:regionId/ancestors` - The region and its ancestors, root first
- `POST /api/world-views/:worldViewId/regions` - Create region
- `PUT /api/world-views/regions/:regionId` - Update region
- `DELETE /api/world-views/regions/:regionId` - Delete region; 409 when a traveller has recorded a visit on it, or on a descendant the delete would take (§ A hierarchy edit keeps every visit)

### Region Members
- `GET /api/world-views/regions/:regionId/members` - List region members
- `GET /api/world-views/regions/:regionId/members/geometries` - Member geometries (custom-aware)
- `POST /api/world-views/regions/:regionId/members` - Add members
- `DELETE /api/world-views/regions/:regionId/members` - Remove members
- `POST /api/world-views/regions/:regionId/members/:divisionId/add-children` - Add children

### Operations
- `POST /api/world-views/regions/:parentRegionId/flatten/:subregionId` - Flatten subregion; 409 when a traveller has recorded a visit on the subregion or a region under it (§ A hierarchy edit keeps every visit)
- `POST /api/world-views/regions/:regionId/expand` - Expand to subregions

### Geometry
- `GET /api/world-views/regions/:regionId/geometry` - Get region geometry
- `PUT /api/world-views/regions/:regionId/geometry` - Set custom geometry
- `GET /api/world-views/regions/:regionId/geometry/compute-stream` - Compute single region with SSE progress (`force`, `skipSnapping`, `token`)
- `POST /api/world-views/:worldViewId/compute-geometries` - Compute all geometries (`force`, `skipSnapping`)
- `GET /api/world-views/:worldViewId/compute-geometries/status` - Get computation status
- `POST /api/world-views/:worldViewId/compute-geometries/cancel` - Cancel computation
- `GET /api/world-views/:worldViewId/display-geometry-status` - Display geometry status
- `POST /api/world-views/:worldViewId/regenerate-display-geometries` - Regenerate display geometries (`geom_area_km2`, and `anchor_point` + `focus_bbox` by re-firing `update_region_focus_data()` — it does not compute the anchor itself; see `docs/tech/geometry-columns.md` § How a crossing region is told from a global one)
- `POST /api/world-views/regions/:regionId/hull/preview` - Preview hull geometry
- `POST /api/world-views/regions/:regionId/hull/save` - Save hull geometry

### AI assistance (`/api/ai`, admin-only)

The subdivision dialog's AI tab sorts a region's members into its groups. Every call `frontend/src/api/ai.ts` makes answers through a schema in `backend/src/api/responses/ai.ts` (ADR-0066).

- `GET /api/ai/status` - Whether an API key is configured, the sentence to show, and the models in use and on offer (`AIStatus`)
- `GET /api/ai/models`, `POST /api/ai/models`, `POST /api/ai/models/web-search` - The models (`AIModels`), and choosing the one in use (`ModelSet`) or the one a web search uses (`WebSearchModelSet`)
- `POST /api/ai/suggest-group` - One region's group (`GroupSuggestion`), with what asking cost (`usage`), the escalation level it was asked at, and whether to ask again one level up
- `POST /api/ai/suggest-groups-batch` - A batch of regions, twenty to a request (`BatchSuggestions`): a suggestion per region the model answered for, the summed `usage`, and `apiRequestsCount`, the requests the model answered. An answer that could not be read is counted and costed, since it was paid for, but suggests nothing; a request that failed before any answer is neither
- `POST /api/ai/generate-group-descriptions` - A short description per group, and what writing them cost (`GroupDescriptions`)

**A model's JSON is read key by key.** Nothing holds what a model writes to a shape, so the services in `backend/src/services/ai/` read each key for the type the answer declares, and anything else becomes the empty reading of that key: a confidence outside `high`, `medium` and `low` is `low`, a `reasoning` that is not text is empty, and a source that is not a string is dropped. A group is resolved against the groups the request offered, ignoring case. A name the model invented is dropped from `splitGroups`, and as the suggested group it leaves no group and `low` confidence, in a batch as for one region.

### Field limits

`VARCHAR`-backed fields are bounded by the column they are stored in, not by a
number chosen at the API. `TEXT`-backed fields — experience descriptions, an
import's source URLs — have no width to align with and are not part of this
contract:

| Field | Limit | Column |
|-------|-------|--------|
| World view name | 255 | `world_views.name` |
| World view description | 1000 | `world_views.description` |
| World view source | 1000 | `world_views.source` |
| Region name | 255 | `regions.name` |
| Region description | 1000 | `regions.description` |
| Region color | 7 (`#rrggbb`) | `regions.color` |
| Member name override | 255 | `region_members.custom_name` |

The same widths bound what an import supplies: a tree node, a rename, a child
added during review, a coverage gap, or a `customName` on an added division all
land in `regions.name`, and the name given to a base layer mirror or a
Wikivoyage extraction lands in `world_views.name`. A `customName` is the one
that has to fit two columns — it names the subregion created for the division
and is stored beside the member as `region_members.custom_name` — so its bound
answers to whichever is narrower.

A bound wider than its column is not a laxer API, only a later failure: the
value passes validation and Postgres refuses it on the write with `22001`,
which carries no status code and so surfaces as a 500. One thing prevents
that, and one catches what still gets through:

- Each request bound *is* its column's width: `COLUMN_WIDTHS` in
  `backend/src/db/schema.generated.ts`, generated from `db/init/01-schema.sql`
  and held to it by the `db:types` gate (ADR-0064), so a column narrowed or
  widened moves the bound with it. A bound deliberately tighter than its column
  says so beside the number: the import's `providerLabel` is the description
  width minus the 51 characters of prefix added before it reaches
  `world_views.description`, and a registration email stays at 254, the
  longest address RFC 5321 will carry. Wider than the column is never
  deliberate. The
  same constant bounds the experience fields listed in `experiences.md` § "Field
  limits", the account fields in `authentication.md` § "Account Field Limits",
  and the two admin AI fields that reach a column — an `ai_settings` key and a
  learned rule's `feature`.
- `errorHandler.ts` catches what the bound did not prevent: a `22001` that
  reaches the database is answered 400 instead of 500. Postgres reports the
  type and width but never the column for this class, so the message quotes
  the width when the driver message carries one and stays generic when it does
  not. This prevents nothing — it keeps the failure honest, and reaching it at
  all means a bound has drifted.

The frontend mirrors the description limit in the field itself
(`WORLD_VIEW_DESCRIPTION_MAX_LENGTH` in `frontend/src/api/worldViews.ts`),
so the cap shows up as a counter while typing rather than as a rejected save.

---

## Tips and Best Practices

1. **Start with major regions** - Create continents/major areas first, then subdivide

2. **Use color inheritance** - Let subregions inherit parent colors for consistency

3. **Compute bottom-up** - System automatically processes children first

4. **Custom boundaries for edge cases** - Use draw tool for territories that don't match GADM

5. **Staging for complex regions** - Use staging area when combining multiple admin divisions

6. **Flatten when simplifying** - If you don't need subregion structure, flatten to reduce complexity

7. **Force recompute after changes** - After modifying members, recompute geometry to update the map
