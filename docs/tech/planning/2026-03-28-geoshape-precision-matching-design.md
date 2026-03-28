# Geoshape Precision Matching — Design Spec

**Date**: 2026-03-28
**Status**: Approved

## Problem

The geoshape matcher (`geoshapeMatchRegion()` in `geoshapeCache.ts`) prefers the shallowest GADM division that intersects the Wikidata geoshape. When a Wikivoyage region corresponds to part of a GADM province (e.g., Flores island within Nusa Tenggara Timur province), the whole province is suggested — even though it includes 5x the area of the actual region.

The user wants the tightest-fitting union of GADM divisions, automatically drilling down to sub-divisions when a parent is too imprecise.

## Design

### Excess-Triggered Drill-Down

After the existing covering set is built (Step 6: shallowest-first greedy selection), a new refinement step replaces imprecise divisions with their tighter-fitting children.

#### Algorithm

For each division in the covering set:

1. Compute **precision** = `intersection_area(geoshape, division) / gadm_area(division)`
2. If precision < **0.5** (division includes >2x the geoshape's covered area):
   - Query children of this division that `ST_Intersects` the geoshape
   - Compute each child's intersection area and GADM area
   - Filter out children with < 1% coverage of the geoshape (noise)
   - If children collectively cover ≥ 80% of what the parent covered, **replace parent with children**
   - Recurse on each child that also has precision < 0.5 (max depth = 3 levels)
3. If precision ≥ 0.5, keep the division as-is

#### Thresholds

- **Precision threshold: 0.5** — a division including >2x the shape's area is clearly too large. Divisions at 0.6+ precision (1.7x area) are acceptable — slight boundary differences between Wikidata and GADM are normal.
- **Child collective coverage: 80%** — children don't need to cover 100% of the parent's contribution (edges may fall between child boundaries or in water). Below 80%, drilling down loses too much — keep the parent.
- **Max recursion depth: 3** — GADM has at most ~4 levels. 3 levels of recursion is sufficient to reach the deepest sub-divisions.

#### SQL Query (per refinement level)

```sql
SELECT ad.id, ad.name, ad.parent_id,
  safe_geo_area(
    ST_ForcePolygonCCW(ST_CollectionExtract(
      ST_MakeValid(ST_Intersection(w.geom, ad.geom_simplified_medium)), 3
    ))
  ) AS intersection_area,
  safe_geo_area(ad.geom_simplified_medium) AS gadm_area
FROM administrative_divisions ad, wikidata_geoshapes w
WHERE ad.parent_id = $1
  AND w.wikidata_id = $2
  AND ST_Intersects(ad.geom_simplified_medium, w.geom)
```

Performance: `parent_id` is indexed, `ST_Intersects` uses spatial index. Typically 5-30 children per parent. At max 3 recursion levels, worst case ~90 divisions checked.

### Integration

#### Changes to `geoshapeCache.ts`

1. **Step 6 unchanged** — builds initial covering set (shallowest-first greedy)
2. **New Step 6b** — `refineCoveringSet()` function:
   - Input: initial covering set, wikidataId, wikiArea, DB client
   - For each entry with precision < 0.5, queries children and recursively refines
   - Output: refined covering set (same array shape as input)
3. **Steps 7-9 unchanged** — total coverage, suggestion writing, result assembly work on whatever covering set they receive

#### Hierarchy dedup

The current covering set skips children if a parent is selected. After refinement, the parent is replaced by children (removed from set, children added), so dedup logic doesn't conflict.

#### Path display

Children have deeper paths (e.g., "Manggarai > Nusa Tenggara Timur > Indonesia"). The existing path-building CTE handles arbitrary depths — no changes needed.

### What Doesn't Change

- API contract (`/geoshape-match` endpoint) — same request/response shape
- IoU computation for auto-accept/reject — unchanged
- Geoshape fetching and caching — unchanged
- Initial candidate discovery (Step 4) — unchanged
- Suggestion writing and scoring (Steps 8-9) — unchanged, receives refined set

### No Schema Changes

Uses existing tables (`administrative_divisions`, `wikidata_geoshapes`) and indexes. No new columns, tables, or migrations.

## Files to Modify

- **`backend/src/services/worldViewImport/geoshapeCache.ts`** — single file:
  - Add `refineCoveringSet()` function (recursive drill-down)
  - Call it after Step 6 covering set build
  - Add precision computation to covering set entries (intersection_area and gadm_area needed alongside existing coverage)

## Testing

- **Flores (Indonesia)**: Geoshape covers Flores island. Currently suggests NTT province. After fix: should suggest 5-8 regencies on Flores (Manggarai, Manggarai Barat, Ngada, Ende, Sikka, Flores Timur, etc.)
- **Compact match**: A region that maps 1:1 to a GADM division (e.g., a province that IS the region). Should NOT drill down — precision > 0.5.
- **Multi-island region**: A Wikivoyage region spanning multiple islands within a province. Should drill down to the island-level divisions, not the whole province.
- **Deep hierarchy**: Verify recursion stops at max depth 3 and doesn't produce duplicate suggestions.
