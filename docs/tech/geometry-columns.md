# Geometry System Reference

This document describes the geometry pipeline: columns, rules, functions, triggers, and tile serving strategy.

## Pipeline Rules

### Core Geometry Rules

1. **`geom` is sacred** — never simplify source geometry. `administrative_divisions.geom` holds GADM at full resolution and nothing writes a simplified shape back into it. **`regions.geom` has one exception**, long-standing and previously undocumented: the union compute path ends its hole/sliver cleaning step with `ST_SimplifyPreserveTopology(geom, 0.0001)` — roughly 11 m at the equator — and saves that (`geometryComputeSingle.ts`, `geometryComputeSSE.ts`). The single-division fast path simplifies not at all, so a region that is exactly one division carries its member's full resolution — that path is the one obeying this rule. Which of the two behaviours is wanted is open, tracked as #443. See `world-views.md` § Geometry Computation.
2. **Always validate** — every geometry write uses `validate_multipolygon()` for canonical validation.
3. **Type consistency** — always MultiPolygon via `ST_Multi()`.
4. **SRID discipline** — store 4326, compute in appropriate SRID, render 3857.
5. **Derivation chain** — derive from source, not from derived.
6. **Computation order** — bottom-up for hierarchies.
7. **Simplify last** — only in derived columns, apart from the 0.0001° cleaning pass named in rule 1.
8. **Triggers idempotent and deterministic** — same input = same output.
9. **NULL vs empty geometry** — `validate_multipolygon()` returns NULL for empty.
10. **Antimeridian** — never assume [-180, 180].
11. **Operation cost awareness** — pre-compute expensive ops.

### Coastline & Island Rules

12. **Never drop small islands entirely** — minimum vertex floor (>=4 vertices per polygon); if simplified polygon degenerates, keep unsimplified. **Narrowed by ADR-0031 for the two cheap rungs**: `geom_overview` and `geom_simplified_coarse` drop the parts below their own scale (the tolerance squared) and keep the largest part unconditionally, so a region that *is* an archipelago never simplifies to nothing. The rungs at 5 km and finer, and everything at zoom 5 and beyond, keep every part. This is the rule that made the ladder expensive: no simplification deletes a ring, so preserving every ring put a floor of half a million vertices under the mirror's leaves that no tolerance could get under.
13. **Use Visvalingam-Whyatt for coastlines** — `ST_SimplifyVW` preserves coastal shape character better than Douglas-Peucker (area-based vs distance-based elimination).
14. **Coverage-aware simplification for GADM siblings** — `ST_CoverageSimplify` for GADM import ensures gap-free borders between adjacent divisions (`simplify_coverage_siblings()`).
15. **Coverage-aware simplification for region siblings** — `simplify_coverage_regions()` runs `ST_CoverageSimplify` on sibling regions (same parent) to eliminate slivers between adjacent regions at simplified zoom levels. Called automatically after geometry computation. **All four derived rungs go through it**, the two cheap ones included (ADR-0031): they were per-row Douglas-Peucker until then, which is why the world map drew Scandinavia as shards and put white cracks between neighbours. What it makes gap-free is a border *inside* one sibling set. Three kinds of border are outside it, and ADR-0031 decision 3 measures what each costs: **across two sibling sets** (`tile_world_view_all_leaf_regions` draws every set of a world view on one layer, so a border between leaves with different parents spans two runs — about 1.4 km apart on the Grand Est / Rheinland-Pfalz border, 0.15 of a pixel at zoom 3), **a world view's root regions** (the pass is keyed on a parent id and they have none), and **every rendered rung of `administrative_divisions`** (its own pass runs on the 4326 columns instead). All three predate this change and belong to #560. Per-row simplification is what a row outside a sibling set falls back to.
16. **Area-proportional tolerance** — small islands get gentler simplification scaled to their bounding box.

### Hull Rules

17. **Single flag: `uses_hull`** — controls hull display in tile functions, simplified column derivation, and island tile source filtering. Auto-detected on INSERT only, preserved across geometry recomputation (invalidate→recompute cycles don't reset it). Manually editable.
18. **Hull is for overview, real geometry for detail** — hull provides territorial extent at z0-8; real coastlines at z9+.
19. **Simplified columns derive from hull when `uses_hull = true`** — `COALESCE(hull_geom_3857, geom_3857)` for z0-8 overview.
20. **Real geometry must be accessible at all zoom levels** — the island tile source serves real coastlines with zoom-appropriate simplification (pre-computed `geom_simplified_*_real` columns).
21. **Auto-detection with three criteria** — see `should_use_hull()` function.
22. **Post-batch refresh** — `refresh_uses_hull_flags()` re-checks after all siblings are computed.
23. **Hull generation should auto-trigger** — when `uses_hull` is detected and geometry is available, auto-generate hull.
24. **Hull is never the only geometry at high zoom** — tile functions serve `geom_3857` (not `hull_geom_3857`) at z9+.

---

## `regions` table geometry columns

### Source geometries (SRID 4326 — WGS84 lat/lon)

| Column | Type | Description |
|--------|------|-------------|
| `geom` | MultiPolygon | **Primary geometry**. Computed by merging member division geometries, with a 0.0001° topology-preserving pass on the union path and none on the single-division fast path (rule 1). The authoritative shape: every simplified column derives from it. |
| `hull_geom` | MultiPolygon | **Concave hull** generated for hull regions. Provides territorial extent for scattered island groups. |
| `hull_params` | JSONB | Parameters used to generate the hull (buffer, concavity, simplify tolerance). |
| `anchor_point` | Point | Label anchor point. Auto-computed by `update_region_focus_data()` trigger. |
| `focus_bbox` | double precision[4] | `[west, south, east, north]` for `smartFitBounds()`, never for a raw `fitBounds()` — a `west > east` box, which says antimeridian crossing, is what that call cannot frame (#666). |

### Derived 3857 geometries (SRID 3857 — Web Mercator)

Auto-maintained by the `trg_regions_geom_3857` trigger whenever source geometries change — or when `geom_simplified_low` is written directly, which `simplify_coverage_regions()` does.

| Column | Type | Derived from | Description |
|--------|------|-------------|-------------|
| `geom_3857` | MultiPolygon | `geom` | Full-resolution in Web Mercator for MVT generation. |
| `hull_geom_3857` | MultiPolygon | `hull_geom` | Full-resolution hull in Web Mercator. |
| `geom_overview` | MultiPolygon | `geom_simplified_low` | **Zoom 0-2**. 50km tolerance, coverage-aware, parts under 2,500km² dropped (ADR-0031). |
| `geom_simplified_coarse` | MultiPolygon | `geom_simplified_low` | **Zoom 3-4**. 10km tolerance, coverage-aware, parts under 100km² dropped — one screen pixel at zoom 3 (ADR-0031). |
| `geom_simplified_low` | MultiPolygon | `COALESCE(hull_geom_3857, geom_3857)` when `uses_hull`, else `geom_3857` | 5km tolerance. **No longer the rung a tile function reaches for** — the coarse rung covers the zooms it used to serve — but still the arm the ladder falls through to at zoom 0-4 when a cheap rung is NULL, and still the input both cheap rungs derive from. |
| `geom_simplified_medium` | MultiPolygon | Same logic | **Zoom 5-8**. Simplified with 1km tolerance. |
| `geom_simplified_low_real` | MultiPolygon | `geom_3857` (always real, never hull) | **Island tile source zoom 0-4**. Real coastlines simplified. |
| `geom_simplified_medium_real` | MultiPolygon | `geom_3857` (always real, never hull) | **Island tile source zoom 5-8**, and what an over-budget row draws from at zoom 9+ (ADR-0031, decision 5). Real coastlines simplified. |

> Note: Despite lacking `_3857` in the name, all simplified columns are stored in SRID 3857.

### Render geometry selection

```
Zoom 0-2:  geom_overview (main tile source)
Zoom 3-4:  geom_simplified_coarse (main tile source)
Zoom 5-8:  geom_simplified_medium (main tile source)
Zoom 9+:   geom_3857 (real geometry) — unless the row exceeds the display budget
           of 10 MB, which serves geom_simplified_medium instead (ADR-0031,
           decision 5). No region of any world view reaches that today; the two
           top levels of GADM do.
```

#### Why the two cheap rungs exist, and why there are two of them

Tile cost is proportional to what `ST_AsMVTGeom` is handed, and what it is handed
is dominated by *pieces*, not by outline detail. No simplification PostGIS offers
deletes a ring: `ST_SimplifyVW`, `ST_SimplifyPreserveTopology` and
`ST_CoverageSimplify` all keep every polygon at a minimum of four points. The
mirror's 3,594 leaves hold 117,100 pieces between them, so the 5 km rung's
773,264 vertices are mostly a floor that no tolerance can lower — 50 km of
topology-preserving simplification still leaves 576,428. That is why the rungs
between the cheapest and the full geometry were near-duplicates, and why a zoom-3
tile of that layer cost 483 ms to answer 103 kB (#551).

A cheap rung therefore has to drop parts, which is what ADR-0031 permits and rule
12 now says: below the rung's own scale, and never the largest one. Both rungs
take a single tolerance and floor their parts at its square. Only the coarse one
is sized by the pixel rule — 10 km is one pixel at zoom 3, and its floor is 1.05
square pixels there. The overview rung keeps the 50 km it has always had, which
is 2.5 pixels at zoom 2 and a floor of 6.5 square pixels: sizing it by the rule
instead costs 898 ms for the world tile against 626 ms, and at these zooms the
extra coarseness is not what a reader is looking at.

| rung | tolerance | floor | zooms | mirror's leaves |
|------|-----------|-------|-------|-----------------|
| `geom_overview` | 50 km | 2,500 km² | 0-2 | 86,496 vertices, 3,992 parts |
| `geom_simplified_coarse` | 10 km | 100 km² | 3-4 | 183,052 vertices, 6,047 parts |
| `geom_simplified_low` | 5 km | — | (input only) | 773,264 vertices, 117,100 parts |

Two rungs rather than one, because a single rung cannot serve both ends. Sized
for zoom 3 it makes the world tile 1,494 ms and 428 kB, against 217 ms and 158 kB
— eight times finer than zoom 0 can draw. Sized for zoom 2 it is four times
coarser than zoom 3 shows, which is a visibly angular map at the zoom where a
reader starts recognising countries.

Both are coverage-simplified (rule 15). Before ADR-0031 the overview rung was
per-row Douglas-Peucker, and it drew the world map with the borders of
neighbouring regions diverging by up to twice the tolerance — white gashes
through the Baltic, Scandinavia in shards, cracks between countries across
Africa. Douglas-Peucker also annihilated 1,324 of the mirror's 3,594 leaves
outright, and the staged fallbacks that rescued them gave those rows *more*
detail than their neighbours. Dropping parts by area and simplifying the rest by
coverage replaces both behaviours: nothing is annihilated, because the largest
part is always kept.

`NULL` in either column means "not computed", and the tile functions fall through
to `geom_simplified_low` when they see it. That is what makes both backfills —
`db/migrations/008-overview-lod-backfill.sql` and
`db/migrations/030-cheap-rungs-coverage-and-floor.sql` — optional rather than
hard prerequisites: a database that has not run them renders as it did before,
slowly, instead of rendering nothing.

Three writers keep both current. The geometry triggers maintain them — including
on `geom_simplified_low` alone, because `simplify_coverage_regions()` writes that
column directly and nothing else in the trigger would notice. That same coverage
pass then overwrites what the trigger wrote, since only it can keep a shared
border shared. The GADM bulk import fills them in `db/init-db.py`, which runs
with the triggers disabled and hand-computes the derived columns.

None of them reaches rows that were already in the table when a column was added
or its meaning changed; `db/migrations/030-cheap-rungs-coverage-and-floor.sql` is
the one-shot path for those (and `008-overview-lod-backfill.sql` was, for the
overview column's arrival). Optional rather than prerequisites — see the NULL
contract above — but a database that skips 030 keeps drawing the shattered
world map and paying the old zoom-3 cost.

For `uses_hull` regions at z0-8, the simplified columns already derive from hull geometry (via trigger), so the transition is automatic.

The island tile source separately serves real coastlines for hull regions:
```
Zoom 0-4:  geom_simplified_low_real
Zoom 5-8:  geom_simplified_medium_real
Zoom 9+:   geom_3857 — unless the row exceeds the 10 MB display budget, which
           serves geom_simplified_medium_real instead
```

No cheap rung here, deliberately: this layer exists to draw the small parts
`drop_small_parts()` throws away, so flooring it would empty it. The display
budget is orthogonal to that and applies as it does everywhere else — these rows
are hull regions, whose real geometry is every island they are made of.

`world_view_id` is required on this source, the way `parent_id` is on the two
subdivision sources: `uses_hull` is the only other thing it filters on, so a
request that named no world view answered with the islands of every hull region
in the database — drawn over whichever world view was open, above the main
source, and clickable there (#660). It answers an unscoped request with an empty
tile rather than with everything, and the two world-view sources have answered
the same way since #662. `parent_id` stays optional and narrows within the world view:
the root of a world view draws all of its hull regions, a selected region draws
its children's.

---

## `administrative_divisions` table geometry columns

### Source geometries (SRID 4326)

| Column | Type | Description |
|--------|------|-------------|
| `geom` | MultiPolygon | **Primary geometry** from GADM data. Full-resolution boundary. |
| `geom_simplified_low` | MultiPolygon | Simplified in 4326. Used for GeoJSON API responses. |
| `geom_simplified_medium` | MultiPolygon | Simplified in 4326. Used for GeoJSON API responses. |
| `anchor_point` | Point | The centre of the frame `focus_bbox` describes. Auto-computed by `update_division_focus_data()` from `geometry_focus()` (#674). |
| `focus_bbox` | double precision[4] | `[west, south, east, north]` for `smartFitBounds()`, never for a raw `fitBounds()` — a `west > east` box, which says antimeridian crossing, is what that call cannot frame (#666). Auto-computed with `anchor_point`; read by the division lists, so a click frames without downloading the geometry. |

### Derived 3857 geometries (SRID 3857)

| Column | Type | Derived from | Description |
|--------|------|-------------|-------------|
| `geom_3857` | MultiPolygon | `geom` | Full-resolution in Web Mercator. |
| `geom_overview_3857` | MultiPolygon | `geom_simplified_low_3857` | **Zoom 0-2**. 50km tolerance, parts under 2,500km² dropped (ADR-0031). |
| `geom_simplified_coarse_3857` | MultiPolygon | `geom_simplified_low_3857` | **Zoom 3-4**. 10km tolerance, parts under 100km² dropped (ADR-0031). |
| `geom_simplified_low_3857` | MultiPolygon | `geom_3857` | 5km tolerance. Input to the two rungs above, and the arm the ladder falls through to at zoom 0-4 when one of them is NULL. |
| `geom_simplified_medium_3857` | MultiPolygon | `geom_3857` | **Zoom 5-8**. 1km tolerance. |

### Render geometry selection

```
Zoom 0-2:  geom_overview_3857
Zoom 3-4:  geom_simplified_coarse_3857
Zoom 5-8:  geom_simplified_medium_3857
Zoom 9+:   geom_3857 — unless the row exceeds the 10 MB display budget, which
           serves geom_simplified_medium_3857 instead (ADR-0031, decision 5)
```

Same contract as `regions`: a NULL rung means "not computed" and falls through to
`geom_simplified_low_3857`, so a database that has not run the backfill renders
as it did before. `tile_gadm_root_divisions` and `tile_gadm_subdivisions` both
follow this ladder.

The display budget matters here and nowhere else. The eight root divisions weigh
386 MB between them and the 237 countries another 437 MB; reading those columns
is 1.9 s for the roots alone, which was the floor under every tile that touched
them at any zoom — a zoom-9 tile over Lisbon spent 2,746 ms to answer 62 bytes.
`pg_column_size()` reads the TOAST header rather than the geometry (0.4 ms for
the same 386 MB), so the ladder can ask what a row weighs for free.

Unlike `regions`, **every 3857 rung on this table is simplified per row**. This
table's coverage pass (`simplify_coverage_siblings`) works on the 4326 columns
the GeoJSON API answers with, and nothing has ever made the rendered columns
gap-free, so two neighbouring divisions can diverge by up to twice the tolerance
along a shared border. Tracked as part of #560.

---

## `region_members` table

| Column | Type | Description |
|--------|------|-------------|
| `custom_geom` | Geometry | Optional partial geometry override when a division is split across regions. |
| `custom_name` | VARCHAR(255) | Optional name override for the member. Same width as `regions.name`, which the request bound behind it has to fit — see "Field limits" in `world-views.md`. |

Effective geometry: `COALESCE(rm.custom_geom, ad.geom)` — centralized in `region_member_effective_geom` view.

---

## Database functions

### `validate_multipolygon(geom)`

Canonical validation applied at every geometry write site:
```sql
CASE
  WHEN geom IS NULL THEN NULL
  WHEN ST_IsEmpty(geom) THEN NULL
  ELSE ST_Multi(ST_CollectionExtract(ST_MakeValid(geom), 3))
END
```

### `should_use_hull(geom, parent_region_id, region_id)`

Auto-detection for `uses_hull`. Three criteria (any match = true):

| Criterion | Condition | Examples |
|-----------|-----------|----------|
| (a) Small multi-part | >= 2 parts AND < 5000 km^2 | Bermuda, Saint-Barthelemy |
| (b) Many-part with high sparsity | >= 10 parts AND area/hull ratio < 0.1 | Fiji, Indonesia |
| (c) Single small isolated | < 100 km^2 AND not touching siblings | Nauru, Jarvis Island |

Criterion (c) filters out inland enclaves like Vatican (touches Italy).

### `children_focus_arc(p_region_id)`

The smallest longitude window round a region's children's `focus_bbox`es, as an arc on
the circle: each child contributes `[start, start + span]` with the span measured the
way its box says (the short way round for a `west > east` box), and one running past 360 is folded back in as `[0, end − 360]`; sorted by start, a
running maximum of the ends finds every gap the union leaves, the gap between the last
end and the first start plus 360 closes the circle, and the window starts where the
widest gap ends. Returns `west, south, east, north, center_lng, center_lat` and
`covers_globe` — true when the children leave no gap or when the window would exceed
`near_global_deg()` (a child whose own box is global is one such window by construction);
then the caller keeps
`geometry_focus()`'s answer. `update_region_focus_data()` reads it for a near-global
parent (#673). Nothing else aggregates focus boxes.

### `refresh_uses_hull_flags(parent_region_id)`

Re-checks all children of a parent region. Called after batch geometry computation since auto-detection depends on sibling geometry existing.

### `simplify_for_zoom(geom, tolerance, min_area, smooth_iterations)`

Three-stage pipeline:
1. **Stage 1 — Simplify**: `ST_SimplifyVW` at tolerance^2 (Visvalingam-Whyatt, area-based). Better coastal shape preservation than Douglas-Peucker.
2. **Stage 2 — Fallback**: If Stage 1 produced NULL (small islands), retry with tolerance scaled to `max_polygon_width / 10`. Minimum vertex floor: >=4 vertices per polygon.
3. **Stage 3 — Smooth**: `ST_ChaikinSmoothing` if `smooth_iterations > 0`.

### `drop_small_parts(geom, min_part_area)`

Keeps the parts of a MultiPolygon at or above `min_part_area`, plus the largest
part unconditionally. The area is SRID 3857 area, which is the point: Web
Mercator inflates area away from the equator by the same factor it inflates
everything else on the screen, so a fixed 3857 area is a fixed number of screen
pixels. Keeping the largest part is what makes the rule safe for a region that
*is* an archipelago — Åland, the Aegean islands, Nauru — and for the e2e
fixture's single 56 × 87 km region.

### `simplify_for_overview(geom, tolerance)`

Fills both cheap rungs: `geom_overview` / `geom_overview_3857` at 50 km, and
`geom_simplified_coarse` / `geom_simplified_coarse_3857` at 10 km. Two steps, in
this order:

1. **Floor** — `drop_small_parts(geom, tolerance²)`. The parts go first because
   they are the cost: nothing PostGIS offers deletes a ring, so a rung that keeps
   every piece cannot get under four points per piece however wide its tolerance.
2. **Simplify** — `ST_SimplifyPreserveTopology` at the tolerance, wrapped in
   `validate_multipolygon()`. The topology-preserving variant because what
   survived the floor is what a reader looks for, and it must not be annihilated;
   the fallback stages the Douglas-Peucker version needed are gone with it.

The floor is the tolerance squared — the area of a tolerance-sized square — so
one knob sets a rung's scale for both outlines and pieces, the way
`ST_SimplifyVW` already reads its tolerance as an area (rule 13). One of the two
callers passes one screen pixel at the finest zoom its rung serves: the coarse
rung's 10 km against zoom 3's 9,784 m. The overview rung passes the 50 km it has
always had, which is 2.5 pixels at zoom 2 with a floor of 6.5 square pixels —
sizing it by the pixel rule instead costs 898 ms for the world tile of the
administrative mirror against 626 ms. A third rung wanting a tolerance should
start from the pixel rule and depart from it only with a measurement like that.

Per-row, so it cannot keep a border shared with anything:
`simplify_coverage_regions()` runs the same reduction over a whole sibling set
and overwrites what this wrote. This is what a row outside a sibling set falls
back to — a world view's root regions, which have siblings but no parent to key
the pass on, and every row of `administrative_divisions`.

### `simplify_coverage_siblings(parent_division_id, tolerance_low, tolerance_medium)`

Coverage-aware simplification using `ST_CoverageSimplify` (PostGIS 3.6+, GEOS 3.14+). Produces gap-free simplified versions of adjacent GADM divisions. Called from `precalculate-geometries.py` after computing parent geometries.

### `simplify_coverage_regions(parent_region_id, tolerance_low, tolerance_medium)`

Coverage-aware simplification for **sibling regions** (same parent). Uses `ST_CoverageSimplify` on `geom_3857` columns to produce gap-free `geom_simplified_low` and `geom_simplified_medium`, then the two cheap rungs from the low rung it has just written. Default tolerances: 5000m (low), 1000m (medium); the cheap rungs' 50000m and 10000m are constants inside the function rather than parameters, so the signature every caller passes today (the parent id alone) keeps resolving — widening it would leave an overload behind on databases that hold the three-argument version.

- Only affects non-hull regions (hull regions derive simplified from hull geometry)
- Requires >=2 siblings with geometry; returns 0 if skipped
- Called automatically after single-region compute (SSE and non-SSE endpoints)
- Called as post-pass after batch "Compute All" for each parent with >=2 children
- Overwrites the per-row trigger simplification with coverage-aware versions
- The cheap rungs run last, because writing the low rung fires the trigger that recomputes them per row, and the coverage result is the one that has to survive

---

## Triggers

| Trigger | Table | Fires on | Does |
|---------|-------|----------|------|
| `update_simplified_geometries` | `administrative_divisions` | `geom` change | Per-row simplification of 4326 simplified columns. Fallback for individual updates (batch import uses `simplify_coverage_siblings`). |
| `update_admin_div_geom_3857` | `administrative_divisions` | `geom` or simplified change | Transforms to 3857, computes 3857 simplified columns. |
| `update_region_metadata` | `regions` | `geom` change | Computes area, detects `uses_hull` on INSERT. |
| `update_region_focus_data` | `regions` | `geom` or `hull_geom` change | Stores `anchor_point` and `focus_bbox` from `geometry_focus()`, taking a near-global parent's box from its children instead. See [How a crossing region is told from a global one](#how-a-crossing-region-is-told-from-a-global-one). |
| `update_division_focus_data` | `administrative_divisions` | `geom` change | Stores `anchor_point` and `focus_bbox` from `geometry_focus()`. No children aggregation. Disabled during the bulk GADM load, which computes the columns in one pass (step 1b). |
| `trg_regions_geom_3857` | `regions` | `geom`, `hull_geom`, or `geom_simplified_low` change | Transforms to 3857, computes all simplified columns (hull-based and real-geom-based), including both cheap rungs. The third condition exists for `simplify_coverage_regions()`, which writes `geom_simplified_low` directly — without it `geom_overview` and `geom_simplified_coarse` would keep the pre-coverage shape and serve it at zoom 0-4. |

### How a crossing region is told from a global one

`focus_bbox` is `[west, south, east, north]`, and `west > east` says the box
crosses the antimeridian. Deciding which of the two a shape is happens in
**one function, `geometry_focus(geom)`**, and is worth stating in full, because
getting it wrong is not visible in the data — the row looks like an ordinary
box, and only the map shows what it claims.

The shape is measured twice: once as it stands, and once with negative
longitudes carried up by 360. Whichever measurement is *tighter* is the truthful
one. A shape crossing the dateline is compact only in the shifted frame; one
that really wraps the world is wide in both, and keeps a full-width box, because
no window onto it would be a frame. `near_global_deg()` (350°) is where "wide in
both" begins, stated once for the function and for the children aggregation.

Where the answer lives (#674):

- **Stored, for what the database holds.** `update_region_focus_data()` and
  `update_division_focus_data()` both call `geometry_focus()` and write the two
  columns at geometry write time, so every read is a column read. The division
  lists carry them, and the map frames a division from the list entry instead
  of downloading its geometry to measure it — 17 MB of GeoJSON for the Far
  Eastern Federal District, on every click, until then. The regions trigger adds
  the one thing that needs its table: a parent whose own union spans nearly
  every longitude takes its box from its children (see below). The divisions
  trigger adds nothing; after the snap, Russia, Oceania and Kiribati measure
  compact on their own, and the only divisions that are wide either way are the
  two Antarctica rows.
- **`focusFromGeoJson()`** (`frontend/src/utils/mapUtils.ts`), for what exists
  only in the client — a boundary being drawn, a cut in progress, a combined
  selection of several divisions. The same rule, with a one-way shift, so it
  needs no snap. `turf.bbox` is not a substitute: it returns the extremes of the
  raw longitudes, which for a shape over the dateline is `[-180, …, 180]`.
- **Nothing else decides.** A backend module reads `focus_bbox[1] > focus_bbox[3]`
  where the stored box describes the shape in question — the region geometry
  read does, for the hull it serves — or asks `geometry_focus()` in one query
  where it does not. Two places do the latter: the hull preview on a custom
  geometry sent in the request, and the hull generator, which measures the very
  `region_members` points it is about to hull. The generator cannot read the
  stored box: `focus_bbox` describes `COALESCE(hull_geom, geom)`, the hull is
  built from members, and `invalidateRegionGeometry()` clears `geom` but not
  `hull_geom` after a member change — so until the next recompute, which
  neither hull endpoint runs first, that box describes the *previous* hull.
  Two detections were retired for reading Antarctica as crossing: an envelope
  test in the region geometry read, and a ±150° threshold over a hull's point
  cloud.
  `backend/src/db/regionFocusAntimeridian.test.ts` holds all of this — the one
  `ST_ShiftLongitude` in the schema, both triggers, the retired names, the
  frontend threshold — and fails on the mutation each guard exists for. What
  none of that can see is a wrong *row*; **Admin panel → Catalogue Checks**
  asks two questions of these columns independently
  (`docs/tech/data-assertions.md`): `framed-as-the-world` checks a stored
  `focus_bbox` claiming every longitude against the geometry, measured by its
  longitude bands rather than through this function so it cannot agree with the
  trigger on a row the trigger got wrong; `anchor-far-from-its-region` compares
  the stored `anchor_point` with the region's own shape, which is a different
  question and a watch rather than an invariant (#668).

Three things make the rule harder than it reads:

- **GADM's geometry overshoots the antimeridian.** Five vertices of the Far
  Eastern Federal District sit at `180.0000000000001`, nine of Fiji's do — 1e-13
  degrees past the meridian, about 11 nanometres on the ground at the equator and
  less further north. `ST_ShiftLongitude` wraps in *both* directions, so it
  carried those vertices back to `-179.9999999999999` and the shifted span came
  out at 370°, wider than the unshifted 360°. Both regions were filed as global
  and framed as the whole Earth at zoom 1, anchored in the wrong ocean (#666).
  `geometry_focus()` snaps to `1e-9` degrees before measuring — the measurement
  only; the stored geometry is untouched.
- **A parent's box comes from its children** when its own union spans the world,
  because a union of things either side of the dateline spans it by
  construction. That aggregation has to run bottom-up, and it is not a MIN and a
  MAX: a child's box is an interval on a circle, and `children_focus_arc()` finds
  the smallest window round a set of them as the complement of the widest gap
  between them (#673). MIN/MAX of the shifted edges read a child crossing
  Greenwich — `west < 0 < east`, which the shift turns into `west + 360 > east` —
  as two unrelated numbers, so a parent with Russia and France beneath it came
  out ending at France's western edge; and a child whose own box is global
  collapsed to a point under the shift, which is how Antarctica's continent row
  claimed a 347° window with a 13° gap over Queen Maud Land. The arc answers
  the first with a window — France east through the dateline to Chukotka — and
  the second with `covers_globe`, where the parent keeps `geometry_focus()`'s
  answer.
- **The triggers fire only on geometry writes.** An existing database does not
  heal itself when the function changes or a column is added:
  `db/migrations/032-antimeridian-focus-data.sql` re-fires the regions trigger
  over the rows a rule change can reach, and `033-division-focus-data.sql` fills
  the divisions' columns once, in about five minutes over 392 112 rows.

## Tile cache busting

Martin caches tile responses in memory. When geometry changes, stale tiles must be invalidated.

- **`world_views.tile_version`** — integer column, incremented by the backend when geometry is computed (SSE single-region compute, batch compute), and by the two backfills (`008-overview-lod-backfill.sql`, `030-cheap-rungs-coverage-and-floor.sql`), each of which changes the geometry a whole band of tiles is built from without changing any tile URL. The backend's three sites each bump one world view (`WHERE id = $1`); the migration's is unqualified and bumps every row at once, because the backfill rewrites both `regions` and `administrative_divisions`. They are also the only incrementers an operator runs by hand. 008 bumps only when it actually filled rows, so a re-run leaves a warm cache alone; 030 recomputes rather than fills, so it bumps every time it is run.
- **Frontend initialization** — `useNavigation` reads `tileVersion` from the world view API response and initializes the in-memory `tileVersion` state from it. This ensures fresh page loads use the correct version.
- **Frontend increment** — `invalidateTileCache()` increments `tileVersion` by 1 (called when the WorldView Editor closes). The `_v` query param on Martin tile URLs changes, bypassing Martin's cache.
- **Why not timestamps?** — Using `Date.now()` would break caching entirely. The version must be a stable integer that only changes when geometry actually changes.

---

## Region creation workflow

```
1. Create world view
2. Create root regions (continents) — no geometry yet
3. Create child regions (country groups) — no geometry yet
4. Create leaf regions (countries/areas) — no geometry yet
5. Assign GADM divisions to leaf regions (region_members)
   -> Leaf geometry computable (from members via ST_Union)
6. Compute leaf geometry (manual trigger or on-the-fly cache)
   -> Triggers fire: metadata, focus_data, 3857+simplified
   -> uses_hull auto-detected on INSERT
7. Parent geometry auto-cascades up (children_only source)
   -> Each level recomputes from children
8. Hull auto-generated for detected uses_hull regions
   -> hull_geom stored, triggers update simplified columns from hull
9. Post-batch: refresh_uses_hull_flags() corrects detection
```

---

## GADM import pipeline

```
1. init-db.py loads GADM divisions with validate_multipolygon()
   -> the three geometry triggers are DISABLED for the bulk insert
      (trigger_simplify_geom, trg_admin_div_geom_3857,
      trigger_division_focus_data) and re-enabled after step 1b, so none
      fires per row
1b. init-db.py batch-computes the derived columns itself, in one pass:
   -> geom_simplified_low/medium (4326), then geom_3857,
      then geom_simplified_low_3857/medium_3857,
      then geom_overview_3857 and geom_simplified_coarse_3857 from the low rung,
      then focus_bbox and anchor_point from geometry_focus() (step 4/4)
2. precalculate-geometries.py computes parent geometry bottom-up
   -> triggers are on again, so a parent's focus data is written per row
   -> ST_CoverageUnion for valid coverages, ST_Union fallback
   -> validate_multipolygon() wraps all writes
   -> No simplification applied to geom (Rule 1)
3. simplify_coverage_siblings() runs per-level
   -> ST_CoverageSimplify produces gap-free simplified versions
   -> Overwrites the per-row 4326 columns only. The rendered 3857 rungs are
      refilled by trg_admin_div_geom_3857, which that write fires — per row,
      so they stay per-row (see rule 15)
```

---

## PostGIS requirements

**PostGIS 3.4+ with GEOS 3.12+** required for (we use 3.5 / GEOS 3.13):
- `ST_CoverageSimplify` — gap-free sibling simplification
- `ST_CoverageUnion` — faster parent geometry merging
- Improved `ST_SimplifyVW` — Visvalingam-Whyatt area-based simplification
