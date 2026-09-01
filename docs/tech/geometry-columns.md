# Geometry System Reference

This document describes the geometry pipeline: columns, rules, functions, triggers, and tile serving strategy.

## Pipeline Rules

### Core Geometry Rules

1. **`geom` is sacred** — never simplify source geometry. `administrative_divisions.geom` holds GADM at full resolution and nothing writes a simplified shape back into it, and since #443 no writer of `regions.geom` coarsens what it stores either — no simplification, and nothing else that sheds or rewrites vertices. (Snapping is not that, and it is worth having the whole account here rather than a reassuring half of it, because this rule is where the compute code's comments send their reader. Where a region has child regions and the writer does not skip the step, the union path snaps those children to one another within 0.001°, which is what stops two adjacent children leaving a sliver between them; moving a vertex onto a neighbour's is not a coarsening, since it makes borders agree rather than making an outline cheaper. The step replaces the geometry collected for the union, so what it hands back has to be the whole of that geometry and not only the part it touched: it snaps the children, and it collects the region's **direct members** back out with them, untouched. Reading the children alone is what it used to do, and on a region holding both kinds the members' territory never reached the union — Andorra stored 439.3 km² of its member division's 451.1, and North America's member held 9,843,418 km² that no child of it held, because Canada's own region row had no geometry yet (#736). The members are carried across the step as a parameter rather than re-read inside it, because the collect step has already applied the input-side timeout guard to them and this rule forbids that statement a coarsening call of its own. Snapping aligns borders; it does not decide which inputs the union is made of.

   Whether it runs at all is a caller's choice on all three writers, and one they make the same way: `skipSnapping`, absent meaning *snap*. One Zod schema is mounted on all three endpoints rather than one written per endpoint, and `computeRegionGeometryCore`'s own signature carries the same default, so an absent instruction means the same thing in process as it does over HTTP — it used to mean the opposite there, which was the one place this rule was decided twice. `POST …/geometry/compute` took no such parameter until #736 and snapped whenever a region had children, so the one writer reachable only by API had no say in the most expensive step of its own pipeline; the bulk endpoint read the parameter off a query nothing validated, so nothing supplied the default either. Both UI paths pass "skip" explicitly — the editor's checkbox defaults to on — and a direct API call that names nothing gets the borders cleaned. An ordinary leaf assembled from divisions has no children to snap and never reaches the step.) The union path used to end its hole/sliver cleaning step with `ST_SimplifyPreserveTopology(geom, 0.0001)` — roughly 11 m at the equator — while the single-division fast path and the two smaller union writers (`recomputeRegionGeometry`, the reset-to-GADM handler) simplified not at all; the pass was removed rather than spread, because 11 m of error at the source is inherited by `geom_3857` and every `geom_simplified_*` column and can never be recovered there, and what it bought was storage — 2–25 % over the six largest union regions, 10 % over Ukraine's. It is not a light touch on every shape: on a fragmented coastline it discards far more, taking Thailand's 194,059-point union down to 87,335. **One departure survives**, and it is a timeout guard rather than a tolerance the shape is meant to carry: when a region's inputs exceed 300,000 points the union path pre-simplifies *its inputs* at 0.005° (~500 m) before unioning them, so that the union stays inside the five-minute bound the code sets for itself. It belongs to #459 with the rest of that bound.

   That guard and this rule are not independent, which is worth stating plainly because the coarser of the two is the survivor. A parent's gate sums its children's **stored** point counts, and those are exactly what removing the pass grows — so a parent close to 300,000 can be carried over the line by children that got more honest, and come out at 500 m where it used to come out at 11 m. Measured on the dev database when the pass was removed: 8 union-path regions have union-path children at all, 82 are already above the threshold (67 of the 236 that currently hold geometry — **28 %** of them, which is why `vision.md` calls the exception more than one in four rather than a rarity; the 82 counts every union-path region, geometry or not, and dividing it by 236 would compare two different sets), and **none** crosses it even if every union child more than doubled (the +122 % of Thailand's case, the worst measured). So the mechanism is real and its effect on this catalogue is nil; a catalogue of a different shape should re-measure rather than assume. The same growth also lengthens each parent's `ST_UnaryUnion` against the unchanged 300 s statement timeout, which is #459's other half.

   See `world-views.md` § Geometry Computation.
2. **Always validate** — every geometry write uses `validate_multipolygon()` for canonical validation.
3. **Type consistency** — always MultiPolygon via `ST_Multi()`.
4. **SRID discipline** — store 4326, compute in appropriate SRID, render 3857.
5. **Derivation chain** — derive from source, not from derived.
6. **Computation order** — bottom-up for hierarchies.
7. **Simplify last** — only in derived columns, apart from the input-side timeout guard named in rule 1.
8. **Triggers idempotent and deterministic** — same input = same output.
9. **NULL vs empty geometry** — `validate_multipolygon()` returns NULL for empty.
10. **Antimeridian** — never assume [-180, 180].
11. **Operation cost awareness** — pre-compute expensive ops.

### Coastline & Island Rules

12. **Never drop small islands entirely** — minimum vertex floor (>=4 vertices per polygon); if simplified polygon degenerates, keep unsimplified. **Narrowed by ADR-0031 for the two cheap rungs**: `geom_overview` and `geom_simplified_coarse` drop the parts below their own scale (the tolerance squared) and keep the largest part unconditionally, so a region that *is* an archipelago never simplifies to nothing. The rungs at 5 km and finer, and everything at zoom 5 and beyond, keep every part. This is the rule that made the ladder expensive: no simplification deletes a ring, so preserving every ring put a floor of half a million vertices under the mirror's leaves that no tolerance could get under.
13. **Use Visvalingam-Whyatt for coastlines** — area-based elimination preserves coastal shape character better than Douglas-Peucker's distance-based one. **Narrowed by ADR-0036 to its topology-preserving form**: the call is `ST_CoverageSimplify`, which GEOS implements with `TPVWSimplifier`, and never `ST_SimplifyVW`. Plain VW moves each ring on its own, so the simplified outline crosses itself and two parts that were disjoint come to overlap — and rule 2's `ST_MakeValid` then resolves each overlap the only way it can, by carving it out as an interior ring. That is why the rung the map serves drew 66 holes over north-eastern Thailand where the data has 8, and why it dropped 436 of Asia's 26,151 pieces against rule 12 (#685). A row's parts are disjoint polygons — a coverage by construction — so the pass applies to one row the way rule 15 applies it to a sibling set.
14. **Coverage-aware simplification for GADM siblings** — `ST_CoverageSimplify` for GADM import ensures gap-free borders between adjacent divisions (`simplify_coverage_siblings()`).
15. **Coverage-aware simplification for region siblings** — `simplify_coverage_regions()` runs `ST_CoverageSimplify` on sibling regions (same parent) to eliminate slivers between adjacent regions at simplified zoom levels. Called automatically after geometry computation. **All four derived rungs go through it**, the two cheap ones included (ADR-0031): they were per-row Douglas-Peucker until then, which is why the world map drew Scandinavia as shards and put white cracks between neighbours. What it makes gap-free is a border *inside* one sibling set. Three kinds of border are outside it, and ADR-0031 decision 3 measures what each costs: **across two sibling sets** (`tile_world_view_all_leaf_regions` draws every set of a world view on one layer, so a border between leaves with different parents spans two runs — about 1.4 km apart on the Grand Est / Rheinland-Pfalz border, 0.15 of a pixel at zoom 3), **a world view's root regions** (the pass is keyed on a parent id and they have none), and **every rendered rung of `administrative_divisions`** (its own pass runs on the 4326 columns instead). All three predate this change and belong to #560. Per-row simplification is what a row outside a sibling set falls back to.
16. **Area-proportional tolerance** — small islands got gentler simplification scaled to their bounding box. **Retired by ADR-0036.** Its only implementation was `simplify_for_zoom()`'s second stage, which retried at a tenth of the largest part's envelope width when the first stage came back empty — and it existed because plain `ST_SimplifyVW` could annihilate a part below its tolerance. Coverage simplification does not, so there is nothing left to retry at a gentler tolerance; `renderedRungTopology.test.ts` fails if the stage comes back. What still protects a small island is rule 12's vertex floor and, at the two cheap rungs, `drop_small_parts()` keeping the largest part unconditionally.

### Hull Rules

17. **Single flag: `uses_hull`** — controls hull display in tile functions, simplified column derivation, and island tile source filtering. Auto-detected on INSERT only, preserved across geometry recomputation (invalidate→recompute cycles don't reset it). Manually editable.
18. **Hull is for overview, real geometry for detail** — hull provides territorial extent at z0-8; real coastlines at z9+.
19. **Simplified columns derive from hull when `uses_hull = true`** — `COALESCE(hull_geom_3857, geom_3857)` for z0-8 overview. Because the flag *chooses* the input, changing it alone rebuilds the four derived rungs: `trg_regions_geom_3857` tests `uses_hull` for a change beside `geom` and `hull_geom`. The invalidation is the database's rather than a caller's, for ADR-0035's reason — `updateRegion` writes the flag by itself, and a writer that has to remember is a writer that will forget.
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
| `geom` | MultiPolygon | **Primary geometry**. Computed by merging member division geometries, with small holes and slivers removed on the union path and no coarsening applied to the result on any path — except that a union of more than 300,000 input points has *its inputs* pre-simplified at 0.005° to stay inside the timeout, so that row is not at source resolution. Rule 1 has the whole of it, the snapping step included. **This is what a writer stores from now on, not what the table holds**: #443 came with no backfill, so a row computed before it still carries the 0.0001° pass until its geometry is next computed, and nothing in the row says which. The authoritative shape: every simplified column derives from it. |
| `hull_geom` | MultiPolygon | **Concave hull** generated for hull regions. Provides territorial extent for scattered island groups. |
| `hull_params` | JSONB | Parameters used to generate the hull (buffer, concavity, simplify tolerance). |
| `anchor_point` | Point | Label anchor point. Auto-computed by `update_region_focus_data()` trigger. |
| `focus_bbox` | double precision[4] | `[west, south, east, north]` for `smartFitBounds()`, never for a raw `fitBounds()` — a `west > east` box, which says antimeridian crossing, is what that call cannot frame (#666). |

### Derived 3857 geometries (SRID 3857 — Web Mercator)

Auto-maintained by the `trg_regions_geom_3857` trigger whenever source geometries change, when `uses_hull` changes — the flag chooses which source the rungs are made of (rule 19), and `updateRegion` writes it on its own — or when `geom_simplified_low` is written directly, which `simplify_coverage_regions()` does.

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
is dominated by *pieces*, not by outline detail. No simplification this pipeline
uses deletes a ring: `ST_SimplifyPreserveTopology` keeps every polygon at a
minimum of four points, which PostGIS documents, and `ST_CoverageSimplify` does
the same — measured rather than documented, which is why the catalogue check
`rung-unlike-its-source` asks the rungs at 5 km and finer whether they still hold
every piece their source has (see the function's own entry below). (Plain `ST_SimplifyVW` did delete
one — a part below its tolerance came back degenerate and the vertex floor then
dropped it, which cost Asia 436 of its 26,151 pieces at the 1 km rung against
rule 12. That was a defect, not a saving: it went with ADR-0036 and the rungs got
*cheaper*.) The
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

Fills the four rungs derived from full resolution: `geom_simplified_low` /
`geom_simplified_medium` and the `_real` pair on `regions`, and
`geom_simplified_low_3857` / `geom_simplified_medium_3857` on
`administrative_divisions`.

`ST_CoverageSimplify` at the tolerance, wrapped in `validate_multipolygon()`.
The row goes through the pass as **one element**: the parts of a valid
MultiPolygon are disjoint polygons, which is what a coverage is, so they stop
colliding with each other as they are simplified. This is rule 13's algorithm —
GEOS implements the call with `TPVWSimplifier`, topology-preserving
Visvalingam-Whyatt — and it is the same call `simplify_coverage_regions()` makes
over a whole sibling set. What that function makes shared *between* two rows,
this makes consistent *within* one; neither does the other's job, and this stays
what a row outside a sibling set falls back to.

The tolerance is passed as the distance it is. `ST_SimplifyVW` reads an *area*
and was handed the square; `ST_CoverageSimplify` reads a distance and squares it
itself for the same Visvalingam-Whyatt criterion, so 1 km still means 1 km —
Asia's 1 km rung is 243,877 points against VW's 247,651.

It used to be `ST_SimplifyVW`, which is where the holes on the map came from:
1,933 interior rings across the eight root regions of the Administrative world
view at the 1 km rung, against the 610 they hold (#685, ADR-0036). Both rungs
now come back with exactly 610, for 1.1 % and 2.1 % *fewer* vertices, and with
every part kept.

`min_area` and `smooth_iterations` are passed as 0 by every caller. They stay in
the signature because narrowing it would leave the four-argument function behind
on every database that already holds it, beside the new one — the same hazard
`simplify_coverage_regions()` names about widening its own.

The two fallback stages are gone. Measured on PostGIS 3.5.6 / GEOS 3.14.1,
coverage simplification drops neither a part nor a hole — a 100 m speck 50 km
from a square and a 200 m lake inside it both survive a 5 km pass — so the retry
at a tolerance scaled to the largest part's width has nothing left to catch. That
is a measurement, not a documented guarantee, and the image tag floats GEOS: the
catalogue check `rung-unlike-its-source` is what notices if it stops holding, and
the last resort stays — a rung that came back empty keeps the unsimplified shape
rather than nothing.

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
   they are the cost: no simplification this pipeline uses deletes a ring, so a
   rung that keeps every piece cannot get under four points per piece however
   wide its tolerance.
2. **Simplify** — `ST_SimplifyPreserveTopology` at the tolerance, wrapped in
   `validate_multipolygon()`. The topology-preserving variant because what
   survived the floor is what a reader looks for, and it must not be annihilated;
   the fallback stages the Douglas-Peucker version needed are gone with it.

The floor is the tolerance squared — the area of a tolerance-sized square — so
one knob sets a rung's scale for both outlines and pieces. The two are different
kinds of number, deliberately: `ST_SimplifyPreserveTopology` takes a distance,
and the part floor takes the area a piece of that size covers on the screen.
One of the two
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

Coverage-aware simplification using `ST_CoverageSimplify` (PostGIS 3.4+, GEOS 3.12+ — see PostGIS requirements below). Produces gap-free simplified versions of adjacent GADM divisions. Called from `precalculate-geometries.py` after computing parent geometries.

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
| `trg_regions_geom_3857` | `regions` | `geom`, `hull_geom`, `uses_hull`, or `geom_simplified_low` change | Transforms to 3857, computes all simplified columns (hull-based and real-geom-based), including both cheap rungs. `uses_hull` is there because it *chooses* the input the rungs are made of (rule 19) and is manually editable (rule 17): `updateRegion` writes the flag on its own, and without this arm a region toggled to hull display kept rungs traced from its real outline while the island tile source switched to the hull at once. `geom_simplified_low` is there for `simplify_coverage_regions()`, which writes that column directly — without it `geom_overview` and `geom_simplified_coarse` would keep the pre-coverage shape and serve it at zoom 0-4. |

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

- **`world_views.tile_version`** — integer column, incremented by the backend when geometry is computed (SSE single-region compute, batch compute) or when a `uses_hull` flip rebuilds a region's rungs (`updateRegion`, rule 19 — compared against the stored value, so a form saved unchanged does not bust every tile URL), and by the three recomputing migrations (`008-overview-lod-backfill.sql`, `030-cheap-rungs-coverage-and-floor.sql`, `037-topology-preserving-rungs.sql`), each of which changes the geometry a whole band of tiles is built from without changing any tile URL. The backend's four sites each bump one world view (`WHERE id = $1`); the migrations' is unqualified and bumps every row at once, because they rewrite both `regions` and `administrative_divisions`. They are also the only incrementers an operator runs by hand. 008 bumps only when it actually filled rows, so a re-run leaves a warm cache alone; 030 and 037 recompute rather than fill, so they bump every time they are run. **Bumping is not a rule the writers of `geom` and `hull_geom` follow as a class, and the exceptions have not been counted.** The compute paths bump; the editing endpoints do not — `updateRegionGeometry` and `resetRegionToGADM` (`geometryCompute.ts`), `saveHullGeometry` (`services/hull/generator.ts`), `createRegion` with a drawn boundary — and a grep for writes of those two columns finds them across sixteen files, so any list here would be the kind that turns out short one round at a time (#679's shape). What each of them costs is the same: the acting session is covered by `invalidateTileCache()` when the editor closes, and every *other* session keeps the pre-edit shape at unchanged `_v` URLs until something else bumps the world view. #688 carries the audit and the decision it needs — whether the bump belongs in a statement-level trigger, the way ADR-0035 settled ancestor invalidation, or at each writer.
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
7. Every derived ancestor's geometry is nulled: it is the union of its
   children and one of them just changed. The database does it, from
   trg_regions_geom_invalidates_parent, one level per firing.
   A hand-drawn boundary is left as drawn, and stops the walk there
8. The next world-view run computes what has no geometry AND every
   derived ancestor of one, deepest first, so a parent is unioned after
   the children it is the union of
9. Hull auto-generated for detected uses_hull regions
   -> hull_geom stored, triggers update simplified columns from hull
10. Post-batch: refresh_uses_hull_flags() corrects detection
```

**Steps 7 and 8 are what makes the tree converge, and both were missing
until #667.** A compute did nothing to its parent but simplify the siblings'
coverage, and a run selected `geom IS NULL`, which never revisits a parent that
already has geometry. A child computed after its parent therefore stayed outside
the parent's outline for good: the Administrative world view's North America drew
Mexico and the Caribbean, 18.3 % of what it contains, because the import attached
the members of countries split across continents three days after the continents
were computed. An ancestor is nulled rather than recomputed on the spot —
recomputing Asia is around a hundred seconds of union, which a curator computing
one Russian oblast should not wait for — so a continent is absent from the map
until the next run, and Catalogue Checks reports it in the meantime
(`region-without-geometry`, `parent-short-of-its-children`).

Both steps stop at a **hand-drawn boundary** (`is_custom_boundary`, #283), in
both directions. Such a region's outline is drawn rather than unioned from its
members, so a descendant gaining geometry does not move it — and if it does not
move, nothing above it moves either. It is therefore neither nulled by step 7,
nor selected by step 8, nor walked *through* by either: an empty hand-drawn
region asks for no recompute above it, and one partway up the tree ends the walk
rather than passing a child's news to the continent overhead.

**Step 7 belongs to the statement that writes `regions.geom`, and is enforced
by the database** ([ADR-0035](../decisions/0035-ancestor-geometry-invalidation-lives-in-the-database.md)).
The run's selection in step 8 is evaluated once, so a write that skipped it
would break convergence rather than merely delay it: a parent whose own union
times out keeps its stale outline, nothing beneath it is `NULL` any more, and no
later run selects it again while every run reports Complete.

`trg_regions_geom_invalidates_parent` (`AFTER UPDATE OF geom`, `WHEN OLD.geom IS
DISTINCT FROM NEW.geom`) and `trg_regions_geom_insert_invalidates_parent`
(`AFTER INSERT`, `WHEN NEW.geom IS NOT NULL`) both run
`invalidate_parent_region_geometry()`, which nulls **the immediate parent only**:

```sql
UPDATE regions
SET geom = NULL, geom_3857 = NULL,
    geom_simplified_low = NULL, geom_simplified_medium = NULL
WHERE id = NEW.parent_region_id
  AND is_custom_boundary IS NOT TRUE
  AND geom IS NOT NULL;
```

The walk upward is the cascade: nulling the parent is itself a write to
`regions.geom`, so the trigger fires again for the grandparent, and again, until
one of the two guards writes no row. `is_custom_boundary IS NOT TRUE` is the
step-7 half of the hand-drawn stop above; `geom IS NOT NULL` ends the climb at an
ancestor already waiting to be recomputed, and is also what makes a cycle in
`parent_region_id` terminate, where a recursive CTE would not.

`IS DISTINCT FROM` on `geometry` is exact equality in PostGIS, not a
bounding-box test — a collinear redraw of the same outline reads as a change, an
identical geometry does not — so a write that changes nothing invalidates
nothing. Only four columns are cleared because a cleared `geom` does not clear
its own derivatives: `trg_regions_geom_3857` recomputes those only from a
geometry that is there. The two cheap rungs do follow, since that trigger sees
`geom_simplified_low` go to `NULL` and clears `geom_overview` and
`geom_simplified_coarse` with it.

**Until #680 this was eight calls in TypeScript, one per writer.** The review of
#679 found seven writers beyond the one #667 described, one round at a time, and
every miss was permanent in the way the paragraph above describes. Enforcing it
in the database ends the counting: `computeSingleMemberFastPath`,
`computeGroupGeom`, `computeRegionGeometryCore`, `recomputeRegionGeometry`,
`runUnionPipelineSteps`, `updateRegionGeometry`, `resetRegionToGADM` and
`createRegion` now write and nothing more, and a writer added tomorrow carries
the rule without knowing it exists.

It also ends two problems the calls had. The invalidation could **fail on its
own**, after the write it belonged to had committed, leaving the ancestors stale
with nothing `NULL` beneath them; it was raised rather than swallowed for that
reason, and `createRegion` could not even raise, since an `INSERT` is not
idempotent and a 500 after the row had committed would have made a retry create
a second region. Inside the statement there is no separate failure to handle. And
`getSubregionGeometries` (`geometryRead.ts`), which cached a missing child's
geometry as a side effect of a public `GET`, no longer writes geometry at all —
neither does `getRootRegionGeometries`. Storing a bare union there took the
region out of step 8's closure, so the pipeline never computed the good geometry;
under the trigger it would have blanked a continent for every visitor as well.
A read path does not write `regions.geom`.

What still lives in TypeScript is the *other* half: `invalidateRegionGeometry`,
which a member or structure edit calls when nothing wrote a geometry but what the
region's outline is derived from changed. It nulls that one region by primary key
— and since that is itself a write to `regions.geom`, the trigger takes it
upward from there. A lock or deadlock on it is swallowed, a tolerance carried
over from #283 rather than a guarantee, with `parent-short-of-its-children`
watching.

**A structural change names its rows itself, because the trigger cannot see
one.** No geometry is written, and the unions change all the same:

- `deleteRegion` nulls the departed region's parent, since a `DELETE` fires no
  trigger on `geom`;
- `updateRegion` nulls the moved region, the old parent **and** the new parent
  when a reparent happens. The third is not redundant. The moved region's own
  call reaches the new parent through the trigger only while it writes a row,
  and for a hand-drawn region it writes none — nothing derived from members may
  wipe a drawn shape (#283) — while a parent's union *does* hold a hand-drawn
  child, since it collects every child that has geometry and filters none out.
  Without the explicit call, moving a drawn region into a continent would leave
  that continent short of what it holds, with geometry of its own and nothing
  `NULL` beneath it: outside every later run's closure, exactly the state this
  whole mechanism exists to prevent. `deleteRegion`'s move-children-to-parent
  branch is covered by the same call, since the parent it nulls is the parent
  those children move to.

Those two are the World View Editor's, and they were **not the whole set**. The
import-review tree operations move and delete regions too, and invalidated
nothing until **#496**. Six of them do now, each naming the rows whose own union
changed and leaving the ancestors to the trigger:

| Handler | What changed | What it nulls |
|---|---|---|
| `reparentRegion` | a region changes parents | the old parent and the new one |
| `mergeChildIntoParent` | the parent absorbs its only child's members and grandchildren | the parent |
| `removeRegionFromImport` | a region is deleted, its children and divisions moved up or deleted with it | the parent, when there is one |
| `dismissChildren` | every descendant is deleted and nothing moves up | the region they were under |
| `pruneToLeaves` | every grandchild and deeper is deleted | each direct child that lost descendants |
| `smartFlatten` | the descendants are deleted and their divisions absorbed | the region that absorbed them |

`reparentRegion` names two rows where `updateRegion` names three, and the
difference is not an omission: the editor's reparent also carries a division
membership between the two parents, so the moved region's own union changes,
while the import statement writes `parent_region_id` and nothing else.
`pruneToLeaves` names the direct children that actually lost descendants —
carried out of its recursive CTE as `root_child` — and not every direct child,
since one that was already a leaf draws exactly what it drew. `#496`'s own list
had five handlers; `smartFlatten` was the sixth, found by reading every
statement that deletes a region rather than by trusting the list — an inventory
that reads as complete is how the last one went stale one round at a time.

Their **undo** paths name nothing, deliberately. Every region an undo recreates
arrives with `geom NULL`, which is exactly what seeds a run's closure, so the
restored rows are selected and every ancestor of one with them. Restore a
snapshot of `geom` there and that stops being true;
`wvImportStructuralInvalidation.test.ts` fails if the restoring `INSERT` ever
names a geometry column.

What is still open in that path is the **member** half, **#718**: a dozen
import-review routes rewrite `region_members` *without* moving or deleting a
region — accepting a match, clearing members, resolving an overlap, collapsing a
parent, and the three undo arms that restore members without recreating one —
and not one of them calls `invalidateRegionGeometry`, leaving a region drawing
divisions it no longer holds. The three handlers in the table above that move
members as part of a structural change are covered by the call they already
make. A trigger on `regions.geom` closes neither half, because neither
writes any geometry; a trigger on `region_members` could close the member one,
which is the question #718 carries and an ADR's to answer.

A failed *pipeline* is still answered softly, and is now the only kind of failure
`computeRegionGeometryCore` has to answer: it wrote nothing, so the region stays
`NULL`, the next run takes it, and the run tallies a skip and reports Complete.

Neither of the heavy steps that follow a write makes an ancestor stale in its own
right, which is why they are not writers: `simplify_coverage_regions` writes only
the render columns (`geom_simplified_low`, `geom_simplified_medium`,
`geom_overview`) and hull generation writes `hull_geom`, while a parent's union
reads `geom` and nothing else. Neither fires the trigger.

The descendant writers were the subtle half of the old arrangement and are now
the ordinary case. Computing a region computes its missing descendants first, so
a curator who clicks Compute on a continent writes geometry to every country
under it *before* the continent's own union runs — and that union is the
expensive one, the one that hits the 300 s timeout (#459). Each of those child
writes marks the tree above it stale by being a write, so the attempt to repair a
continent cannot be what puts it beyond the reach of every later run.

**Cost.** Measured on the dev database over 400 real regions of the
Administrative world view (3 831 regions, maximum depth 3): 0.53 ms per `geom`
write, 6.1 % over a write that itself costs 8.7 ms — some two seconds added to a
run that writes every region, against per-region unions measured in seconds and
minutes. The trigger's behaviour is verified by a probe run by hand against the
dev database in a rolled-back transaction, since the mocked `pg` lane cannot see
a trigger and the repository has no executable SQL lane (#522);
`backend/src/db/regionAncestorInvalidation.test.ts` is the text-level guard that
the rule keeps having exactly one implementation.

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

**PostGIS 3.4+ with GEOS 3.12+** is the floor, and `docker-compose.yml` pins
`postgis/postgis:17-3.5-alpine` to clear it — the Debian image's GEOS 3.9 lacks
`ST_CoverageSimplify` entirely. Measured here at PostGIS 3.5.6 / GEOS 3.14.1;
the tag floats within 3.5, which is why what the pass does about pieces and
holes is watched by a catalogue check rather than asserted from a version. What
needs it:
- `ST_CoverageSimplify` — the four rungs `simplify_for_zoom()` fills (ADR-0036):
  topology-preserving Visvalingam-Whyatt within one row. It is also what
  `simplify_coverage_regions()` runs over a sibling set, which is where a border
  is made gap-free and where the two cheap rungs get it too; outside such a set —
  a world view's root regions, a lone child, a hull region, every row of
  `administrative_divisions` — those two are `ST_SimplifyPreserveTopology`, from
  `simplify_for_overview()`
- `ST_CoverageUnion` — faster parent geometry merging
