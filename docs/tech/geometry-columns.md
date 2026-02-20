# Geometry System Reference

This document describes the geometry pipeline: columns, rules, functions, triggers, and tile serving strategy.

## Pipeline Rules

### Core Geometry Rules

1. **`geom` is sacred** — never simplify source geometry. Full-resolution geometry is always stored in `geom`.
2. **Always validate** — every geometry write uses `validate_multipolygon()` for canonical validation.
3. **Type consistency** — always MultiPolygon via `ST_Multi()`.
4. **SRID discipline** — store 4326, compute in appropriate SRID, render 3857.
5. **Derivation chain** — derive from source, not from derived.
6. **Computation order** — bottom-up for hierarchies.
7. **Simplify last** — only in derived columns.
8. **Triggers idempotent and deterministic** — same input = same output.
9. **NULL vs empty geometry** — `validate_multipolygon()` returns NULL for empty.
10. **Antimeridian** — never assume [-180, 180].
11. **Operation cost awareness** — pre-compute expensive ops.

### Coastline & Island Rules

12. **Never drop small islands entirely** — minimum vertex floor (>=4 vertices per polygon); if simplified polygon degenerates, keep unsimplified.
13. **Use Visvalingam-Whyatt for coastlines** — `ST_SimplifyVW` preserves coastal shape character better than Douglas-Peucker (area-based vs distance-based elimination).
14. **Coverage-aware simplification for GADM siblings** — `ST_CoverageSimplify` for GADM import ensures gap-free borders between adjacent divisions (`simplify_coverage_siblings()`).
15. **Coverage-aware simplification for region siblings** — `simplify_coverage_regions()` runs `ST_CoverageSimplify` on sibling regions (same parent) to eliminate slivers between adjacent regions at simplified zoom levels. Called automatically after geometry computation.
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
| `geom` | MultiPolygon | **Primary geometry**. Computed by merging member division geometries. Never simplified — this is the authoritative shape. |
| `hull_geom` | MultiPolygon | **Concave hull** generated for hull regions. Provides territorial extent for scattered island groups. |
| `hull_params` | JSONB | Parameters used to generate the hull (buffer, concavity, simplify tolerance). |
| `anchor_point` | Point | Label anchor point. Auto-computed by `update_region_focus_data()` trigger. |
| `focus_bbox` | double precision[4] | `[west, south, east, north]` for `fitBounds()`. West > east = antimeridian crossing. |

### Derived 3857 geometries (SRID 3857 — Web Mercator)

Auto-maintained by the `trg_regions_geom_3857` trigger whenever source geometries change.

| Column | Type | Derived from | Description |
|--------|------|-------------|-------------|
| `geom_3857` | MultiPolygon | `geom` | Full-resolution in Web Mercator for MVT generation. |
| `hull_geom_3857` | MultiPolygon | `hull_geom` | Full-resolution hull in Web Mercator. |
| `geom_simplified_low` | MultiPolygon | `COALESCE(hull_geom_3857, geom_3857)` when `uses_hull`, else `geom_3857` | **Zoom 0-4**. Simplified with 5km tolerance. |
| `geom_simplified_medium` | MultiPolygon | Same logic | **Zoom 5-8**. Simplified with 1km tolerance. |
| `geom_simplified_low_real` | MultiPolygon | `geom_3857` (always real, never hull) | **Island tile source zoom 0-4**. Real coastlines simplified. |
| `geom_simplified_medium_real` | MultiPolygon | `geom_3857` (always real, never hull) | **Island tile source zoom 5-8**. Real coastlines simplified. |

> Note: Despite lacking `_3857` in the name, all simplified columns are stored in SRID 3857.

### Render geometry selection

```
Zoom 0-2:  extra-simplified geom_simplified_low (main tile source)
Zoom 3-4:  geom_simplified_low (main tile source)
Zoom 5-8:  geom_simplified_medium (main tile source)
Zoom 9+:   geom_3857 (real geometry, all regions)
```

For `uses_hull` regions at z0-8, the simplified columns already derive from hull geometry (via trigger), so the transition is automatic.

The island tile source separately serves real coastlines for hull regions:
```
Zoom 0-4:  geom_simplified_low_real
Zoom 5-8:  geom_simplified_medium_real
Zoom 9+:   geom_3857
```

---

## `administrative_divisions` table geometry columns

### Source geometries (SRID 4326)

| Column | Type | Description |
|--------|------|-------------|
| `geom` | MultiPolygon | **Primary geometry** from GADM data. Full-resolution boundary. |
| `geom_simplified_low` | MultiPolygon | Simplified in 4326. Used for GeoJSON API responses. |
| `geom_simplified_medium` | MultiPolygon | Simplified in 4326. Used for GeoJSON API responses. |
| `anchor_point` | Point | Label anchor point. |

### Derived 3857 geometries (SRID 3857)

| Column | Type | Derived from | Description |
|--------|------|-------------|-------------|
| `geom_3857` | MultiPolygon | `geom` | Full-resolution in Web Mercator. |
| `geom_simplified_low_3857` | MultiPolygon | `geom_3857` | **Zoom 0-4**. 5km tolerance. |
| `geom_simplified_medium_3857` | MultiPolygon | `geom_3857` | **Zoom 5-8**. 1km tolerance. |

---

## `region_members` table

| Column | Type | Description |
|--------|------|-------------|
| `custom_geom` | Geometry | Optional partial geometry override when a division is split across regions. |
| `custom_name` | text | Optional name override for the member. |

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

### `refresh_uses_hull_flags(parent_region_id)`

Re-checks all children of a parent region. Called after batch geometry computation since auto-detection depends on sibling geometry existing.

### `simplify_for_zoom(geom, tolerance, min_area, smooth_iterations)`

Three-stage pipeline:
1. **Stage 1 — Simplify**: `ST_SimplifyVW` at tolerance^2 (Visvalingam-Whyatt, area-based). Better coastal shape preservation than Douglas-Peucker.
2. **Stage 2 — Fallback**: If Stage 1 produced NULL (small islands), retry with tolerance scaled to `max_polygon_width / 10`. Minimum vertex floor: >=4 vertices per polygon.
3. **Stage 3 — Smooth**: `ST_ChaikinSmoothing` if `smooth_iterations > 0`.

### `simplify_coverage_siblings(parent_division_id, tolerance_low, tolerance_medium)`

Coverage-aware simplification using `ST_CoverageSimplify` (PostGIS 3.6+, GEOS 3.14+). Produces gap-free simplified versions of adjacent GADM divisions. Called from `precalculate-geometries.py` after computing parent geometries.

### `simplify_coverage_regions(parent_region_id, tolerance_low, tolerance_medium)`

Coverage-aware simplification for **sibling regions** (same parent). Uses `ST_CoverageSimplify` on `geom_3857` columns to produce gap-free `geom_simplified_low` and `geom_simplified_medium`. Default tolerances: 5000m (low), 1000m (medium).

- Only affects non-hull regions (hull regions derive simplified from hull geometry)
- Requires >=2 siblings with geometry; returns 0 if skipped
- Called automatically after single-region compute (SSE and non-SSE endpoints)
- Called as post-pass after batch "Compute All" for each parent with >=2 children
- Overwrites the per-row trigger simplification with coverage-aware versions

---

## Triggers

| Trigger | Table | Fires on | Does |
|---------|-------|----------|------|
| `update_simplified_geometries` | `administrative_divisions` | `geom` change | Per-row simplification of 4326 simplified columns. Fallback for individual updates (batch import uses `simplify_coverage_siblings`). |
| `update_admin_div_geom_3857` | `administrative_divisions` | `geom` or simplified change | Transforms to 3857, computes 3857 simplified columns. |
| `update_region_metadata` | `regions` | `geom` change | Computes area, detects `uses_hull` on INSERT. |
| `update_region_focus_data` | `regions` | `geom` or `hull_geom` change | Computes `anchor_point` and `focus_bbox`. |
| `trg_regions_geom_3857` | `regions` | `geom` or `hull_geom` change | Transforms to 3857, computes all simplified columns (hull-based and real-geom-based). |

## Tile cache busting

Martin caches tile responses in memory. When geometry changes, stale tiles must be invalidated.

- **`world_views.tile_version`** — integer column, incremented by the backend when geometry is computed (SSE single-region compute, batch compute).
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
   -> update_simplified_geometries trigger fires (per-row)
   -> update_admin_div_geom_3857 trigger fires
2. precalculate-geometries.py computes parent geometry bottom-up
   -> ST_CoverageUnion for valid coverages, ST_Union fallback
   -> validate_multipolygon() wraps all writes
   -> No simplification applied to geom (Rule 1)
3. simplify_coverage_siblings() runs per-level
   -> ST_CoverageSimplify produces gap-free simplified versions
   -> Overwrites per-row trigger simplified with coverage-aware versions
```

---

## PostGIS requirements

**PostGIS 3.4+ with GEOS 3.12+** required for (we use 3.5 / GEOS 3.13):
- `ST_CoverageSimplify` — gap-free sibling simplification
- `ST_CoverageUnion` — faster parent geometry merging
- Improved `ST_SimplifyVW` — Visvalingam-Whyatt area-based simplification
