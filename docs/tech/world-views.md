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

---

## Visibility

Every world view carries an `is_public` flag (`world_views.is_public`, default `false`), enforced server-side rather than left to a client-side filter:

- **Listing** — `getWorldViews` (`backend/src/controllers/worldView/worldViewCrud.ts`) always filters to `is_active = true`, and on top of that filters by `is_public` for non-admins; admins see every active world view regardless of public/hidden visibility, but not inactive ones — that filter applies regardless of role. The filter is a `WHERE` clause, so a hidden world view is absent from the response for non-admins (an inactive one for everyone), not merely unlabeled in it. Because the rows depend on the caller, the response carries `Cache-Control: private, no-store` and `Vary: Origin, Authorization` — Express's default ETag plus `Vary: Origin` says nothing about who asked, which is enough for a proxy to hand an admin's list to an anonymous visitor. The client caches it per identity for the same reason (`['worldViews', user?.id ?? 'anon']` in `useNavigation`), so an anonymous answer and an admin answer cannot occupy the same entry; asking before the session is restored used to freeze the anonymous one for the session (#460). The cache key only keeps the two answers apart; what acts on a change is the reconciliation in `useNavigation` — when the visible list changes, a selection no longer in it is replaced (the world view the address names, else the default, else the first), and the selected region, selected division and both breadcrumb trails are dropped. Discover no longer keeps a context of its own to drop: since #644 it derives its trail, its open category list and its card from the region `useNavigation` holds plus the address, so a switch takes all of it in the same commit.

The world view is a **path segment** since #644 — `/wv/5`, written through `useAppAddress`'s `go` rather than as a `?wv` query parameter — and the writes say which kind they are ([ADR-0034](../decisions/0034-a-place-has-an-address.md), [addresses.md](addresses.md)). A replacement rewrites the address, the way a manual switch does, and a switch drops the region and card segments with it, since the address says which world view a region is in. A first pick writes the address too whenever it does not already name what was adopted: only the *default* world view writes no segment, so a bare `/` stays bare for it alone — anything else must be named, or nothing under it could be addressed at all. An empty list clears the context and the address both. The traffic runs the other way too: an address changing to name a different world view the caller *can* see is itself a switch — editing the address bar, opening a shared link in a tab that already has a selection, or going back across a switch all select it and drop the previous one's context; following one writes nothing, since the address already says it — which is what keeps Back into a region of another world view landing on that region rather than on its root. Where the address stands in for one the app would never have built — a bare `/` resolving to a custom world view, an explicit `/wv/1` for the default — following writes the canonical form instead. An id absent from the visible list is not followed: while the selection is still visible the address is rewritten to name it, since nothing downstream would — the visibility guard returns precisely because the selection is fine. When neither survives, both are left to the reconciliation, which replaces the selection and rewrites the address in one pass rather than parking it on a second id the caller cannot see. Without that half the world view would flip while the departed one's region stayed on screen, which is the outcome hiding it is meant to prevent.
- **Region reads** — `requireVisibleWorldView` (`backend/src/middleware/worldViewVisibility.ts`) guards routes that take a `worldViewId` or a `regionId`. It resolves the id from a `worldViewId` (route or query param) or a `regionId` (route param on most of these; an optional query filter on the experience list and experience-locations reads, marked below). Admins bypass the check; everyone else gets **404**, never 403 — a 403 would confirm the world view exists, which is exactly what hiding it is meant to prevent. A missing mandatory id and a hidden world view answer identically; the optional `regionId` query filter is the exception — an absent one is a legitimate unfiltered read, so the guard passes it through rather than 404ing. The guarded routes (check against `worldViewRoutes.ts` / `experienceRoutes.ts` for the current set):
  - `GET /api/world-views/:worldViewId/regions`
  - `GET /api/world-views/:worldViewId/regions/root`
  - `GET /api/world-views/:worldViewId/regions/search`
  - `GET /api/world-views/:worldViewId/regions/root/geometries`
  - `GET /api/world-views/:worldViewId/compute-geometries/status`
  - `POST /api/world-views/:worldViewId/division-usage`
  - `GET /api/world-views/:worldViewId/display-geometry-status`
  - `GET /api/world-views/regions/:regionId/ancestors`
  - `GET /api/world-views/regions/:regionId/subregions`
  - `GET /api/world-views/regions/:regionId/members`
  - `GET /api/world-views/regions/:regionId/members/geometries`
  - `GET /api/world-views/regions/:regionId/members/descendant-geometries`
  - `GET /api/world-views/regions/:regionId/geometry`
  - `GET /api/world-views/regions/:regionId/subregions/geometries`
  - `GET /api/world-views/regions/:regionId/hull/params`
  - `GET /api/experiences/region-counts`
  - `GET /api/experiences/by-region/:regionId`
  - `GET /api/experiences/by-region/:regionId/locations`
  - `GET /api/experiences` (`regionId` query param is optional)
  - `GET /api/experiences/:id/locations` (`regionId` query param is optional)
- **Single-experience reads** — the second mechanism, for the one route the first can't cover. `GET /api/experiences/:id` (`getExperience`, `backend/src/controllers/experience/experienceQueryController.ts`) can never 404 on visibility, because the experience it serves is public data — only its association with a hidden world view is sensitive, not the experience itself. So instead of guarding the route, the controller filters the `regions[]` array it returns, using the same predicate `getWorldViews` (above) uses to filter its list — `wv.is_active = true`, plus `wv.is_public = true` unless the caller is an admin — matching it exactly so the two cannot drift apart. That is the world-view half and no longer the whole account of the array: since #521 it carries a second filter on a different axis, `readerRegionMembershipSql()`, so a region is named only where the object has a point there this caller may see. A region whose world view is perfectly public can therefore be absent — deliberately, because placement writes an unread point's region into `experience_regions` (ADR-0025 decision 5) and naming it would offer a region whose own list does not hold the object. That half is relaxed for a curator or admin whose scope reaches the object, not for admins alone, and a manual assignment is exempt from it; see [experiences.md](experiences.md) for the rule and the other five reads that carry it.
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
- Pipeline: collect geometries → analyze → snap neighbors → union → clean holes/slivers → save
- **Except for a region that is exactly one division** (one member, no child regions, no hand-drawn boundary): all three writers — the SSE stream, the `/geometry/compute` endpoint and the bulk core — short-circuit to `computeSingleMemberFastPath`, which copies the member's geometry through the same `validate_multipolygon` normalization the normal path applies and runs none of the six steps, so no simplification is applied and the SSE `complete` event carries no polygon/hole counts. This is deliberate: the single member already *is* the answer, and simplifying it would only degrade it. Common well beyond base-layer imports — it is the shape of any 1:1 match
- "Skip snapping" checkbox (default: on) skips the expensive neighbor-snapping step for faster computation. Snapping adds shared boundary vertices but is O(n²) on child count — can be slow for continents
- Uses a dedicated `pool.connect()` client for all computation queries, ensuring `SET statement_timeout` applies to the correct connection (not a random pool connection)
- Generates TS hull for archipelagos, clears stale hull data for non-archipelagos
- JWT is passed as `token` query parameter since `EventSource` can't send Authorization headers

**World View-wide Computation:**
- "Compute All Regions" button (shown when no region is selected)
- Processes all regions in dependency order (deepest children first)
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

### World Views
- `GET /api/world-views` - List all world views
- `POST /api/world-views` - Create world view
- `PUT /api/world-views/:worldViewId` - Update world view
- `DELETE /api/world-views/:worldViewId` - Delete world view

### Regions
- `GET /api/world-views/:worldViewId/regions` - List regions in world view
- `GET /api/world-views/:worldViewId/regions/root` - List root regions
- `GET /api/world-views/:worldViewId/regions/search` - Search regions
- `GET /api/world-views/regions/:regionId/subregions` - List a region's children (what the map and the list read one level at a time; there is deliberately no "every leaf in the world view" read — see `experience-map-ui.md` § What the map reads at each level)
- `POST /api/world-views/:worldViewId/regions` - Create region
- `PUT /api/world-views/regions/:regionId` - Update region
- `DELETE /api/world-views/regions/:regionId` - Delete region

### Region Members
- `GET /api/world-views/regions/:regionId/members` - List region members
- `GET /api/world-views/regions/:regionId/members/geometries` - Member geometries (custom-aware)
- `POST /api/world-views/regions/:regionId/members` - Add members
- `DELETE /api/world-views/regions/:regionId/members` - Remove members
- `POST /api/world-views/regions/:regionId/members/:divisionId/add-children` - Add children

### Operations
- `POST /api/world-views/regions/:parentRegionId/flatten/:subregionId` - Flatten subregion
- `POST /api/world-views/regions/:regionId/expand` - Expand to subregions

### Geometry
- `GET /api/world-views/regions/:regionId/geometry` - Get region geometry
- `PUT /api/world-views/regions/:regionId/geometry` - Set custom geometry
- `POST /api/world-views/regions/:regionId/geometry/compute` - Compute single region
- `GET /api/world-views/regions/:regionId/geometry/compute-stream` - Compute single region with SSE progress
- `POST /api/world-views/:worldViewId/compute-geometries` - Compute all geometries
- `GET /api/world-views/:worldViewId/compute-geometries/status` - Get computation status
- `POST /api/world-views/:worldViewId/compute-geometries/cancel` - Cancel computation
- `GET /api/world-views/:worldViewId/display-geometry-status` - Display geometry status
- `POST /api/world-views/:worldViewId/regenerate-display-geometries` - Regenerate display geometries
- `POST /api/world-views/regions/:regionId/hull/preview` - Preview hull geometry
- `POST /api/world-views/regions/:regionId/hull/save` - Save hull geometry

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

- `backend/src/types/columnBounds.test.ts` reads the widths out of
  `db/init/01-schema.sql` and holds each request bound equal to its column, so
  drift is named whichever way it happens — a column narrowed under its bound,
  or a column widened while the bound that should have followed stayed put. A
  bound deliberately tighter than its column carries the reason with it and is
  pinned at that number instead: the import's `providerLabel` at 949, because
  51 characters of prefix are added before it reaches
  `world_views.description`, and a registration email at 254, the longest
  address RFC 5321 will carry. Wider than the column is never deliberate. The
  same test covers the experience fields listed in `experiences.md` § "Field
  limits", the account fields in `authentication.md` § "Account Field Limits",
  and the two admin AI fields that reach a column — an `ai_settings` key and a
  learned rule's `feature`.
- `errorHandler.ts` catches what the test did not prevent: a `22001` that
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
