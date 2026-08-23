# ADR-0031: A display rung drops what a reader cannot see

**Date:** 2026-08-23
**Status:** Accepted

---

## Context

A zoom-3 tile of the administrative mirror cost 483 ms to answer 103 kB, and a zoom-3 tile of the
eight root regions cost 508 ms to answer 22 kB (#551). The obvious fix — serve those zooms from
the existing overview rung, which answers the same tiles in 4-47 ms — produces a map that has
fallen apart: neighbouring countries no longer share a border, the Mediterranean is full of white
cracks, and Scandinavia is a handful of shards. Rendered and looked at, it is not a map anybody
would ship.

Measuring why exposed the actual shape of the problem, and it is not the ladder's zoom boundaries.

**Simplification never deletes a ring.** `ST_SimplifyVW`, `ST_SimplifyPreserveTopology` and
`ST_CoverageSimplify` all keep every polygon they are given, at a minimum of four points each.
Europe's root region is roughly twelve thousand pieces, so it holds 84,217 points at full
resolution and still holds 49,942 after simplification at a 50 km tolerance — a tolerance five
times wider than the entire continent's rendering at that zoom. The administrative mirror's
leaves hold 117,100 pieces between them, which is a floor of half a million vertices that no
tolerance can get under. **The rungs between the cheapest and the full geometry are therefore
near-duplicates of each other**: 5 km gives 773,264 vertices, 1 km gives 1,014,000, full
resolution gives 1,077,000. The ladder had four rungs and two distinct answers.

**The one rung that was cheap was cheap for the wrong reason.** `geom_overview` used plain
Douglas-Peucker, which *does* delete rings — by annihilating any piece narrower than the
tolerance, per row, with no knowledge of the neighbours. That is where the shards come from: a
shared border simplified independently on each side diverges by up to twice the tolerance, and at
50 km that is a visible white sliver from zoom 2 onward. The rung was drawing the world map that
way already; nobody had looked at it beside the rung below.

**Rule 12 of the geometry pipeline** (`docs/tech/geometry-columns.md`) said *never drop small
islands entirely*, and it is what put the project in this position: it is the reason every rung
preserves every ring, and preserving every ring is the whole cost.

## Decision

**1. A display rung may drop a part a reader cannot see, and must keep the largest one.** The
floor is an area, and the largest piece of a geometry is kept whatever its size, so a region that
*is* an archipelago — Åland, the Aegean islands, Nauru — never simplifies to nothing. This
narrows rule 12: geometry is still never annihilated, but a speck below a rung's own scale is no
longer carried up the ladder. Rule 12's other half — a minimum vertex floor for what survives —
is untouched.

**2. The floor is the tolerance squared.** One knob per rung, read the way `ST_SimplifyVW`
already reads its tolerance as an area (rule 13). Measured in SRID 3857 on purpose: Web Mercator
inflates area away from the equator by exactly the factor it inflates everything else on the
screen, so a fixed 3857 area *is* a fixed number of pixels.

The coarse rung is sized by the pixel rule: zoom 3, its finest zoom, draws 9,784 m to the pixel,
so 10 km of tolerance and the 100 km² that follows are 1 pixel and 1.05 square pixels there. The
overview rung is not — it keeps the 50 km it has always had, which is 2.5 pixels at zoom 2 and a
floor of 6.5 square pixels, so a part of up to about 2.5 × 2.5 pixels can go at zoom 0-2 (the Isle
of Man is 4.4 of them, Bornholm 4.7). Sizing it by the rule instead costs 898 ms for the world
tile of the administrative mirror against 626 ms, and the difference is not what a reader is
looking at when the whole world is on screen.

**3. A cheap rung is coverage-simplified, like the rungs below it.** Rule 15 already required
`ST_CoverageSimplify` for sibling regions and was simply never applied to the overview rung. The
floor goes on before the coverage pass — dropping a speck cannot open a gap along a shared border,
since a speck has no neighbour to share one with — and the pass then moves both sides of every
border identically. Per-row simplification is kept as the fallback for a row the pass does not
reach.

Three kinds of border are outside it, all pre-existing and none closed here, and the tolerance
doubling at zoom 3-4 raises each ceiling from 10 km to 20 km:

1. **Across sibling sets.** The pass makes a border shared *within* one set, and
   `tile_world_view_all_leaf_regions` draws every set of a world view onto one layer — so two
   adjacent leaves with different parents are simplified in two separate runs. Measured on the
   85 km Grand Est / Rheinland-Pfalz border, the two sides come apart by about 1.4 km on average:
   0.15 of a screen pixel at zoom 3, and it does not show in a rendering of the shipped column.
2. **Root regions.** `simplify_coverage_regions()` is keyed on a parent id, and a world view's roots
   are siblings with no parent to key on — every caller filters them out. On the administrative
   mirror no two roots touch at all, so nothing moves there, but a world view whose continents share
   a land border would see it.
3. **`administrative_divisions`.** No coverage pass over its rendered columns at all; its own runs on
   the 4326 columns the GeoJSON API answers with.

All three belong with #560, which already owns the third.

**4. There are two cheap rungs, not one.** A single rung cannot serve zoom 0 and zoom 3: sized for
zoom 3 it turns the world tile from 217 ms into 1,494 ms and its payload from 158 kB into 428 kB,
for detail eight times finer than zoom 0 can draw; sized for zoom 0 it is the shattered map above.
So `geom_overview` keeps its 50 km scale for zoom 0-2 and a new `geom_simplified_coarse` serves
zoom 3-4 at 10 km. The 5 km rung stays as the input both are derived from, and as the shape the
GeoJSON API answers with.

**5. No tile serves a feature whose stored geometry is out of proportion to it.** The eight root
divisions of GADM weigh 386 MB between them; merely reading that column takes 1.9 s, which is the
floor under every tile that touches them, at any zoom, even one whose honest answer is 62 bytes —
a zoom-9 tile over Lisbon cost 2,746 ms. Clipping first makes it worse, because the cost is the
read and not the clip. Above a per-feature budget of 10 MB the ladder therefore serves one rung
down, which answers that tile in 83 ms. `pg_column_size()` reads the TOAST header rather than the
geometry — 0.4 ms for those same 386 MB — so asking the question is free.

## Consequences

- **The world map stops being shattered.** Zoom 0-2 costs more: the world tile of the mirror goes
  from 217 ms to 724 ms (3.3×) and the landing zoom from 163 ms to 316 ms (1.9×), and both now
  draw continuous borders instead of shards. That trade is deliberate: the cheap version was
  drawing a map that misdescribes the world.
- **Zoom 3-4 gets cheaper and stays honest.** The mirror's zoom-3 tile: 483 ms to 216 ms. The
  eight root regions: 508 ms to 37 ms. Europe's subregions: 388 ms to 90 ms. Rendered side by
  side at zoom 3 and zoom 4, the coarse rung and the 5 km rung it replaces are hard to tell apart.
- **Specks disappear at zoom 0-4, and only there.** A part *other than its region's largest* goes
  if it is under 100 km² at zoom 3-4, or under 2,500 km² at zoom 0-2 (SRID 3857 area, i.e. screen
  area). Measured against the administrative mirror: Bornholm is Hovedstaden's second part at
  1,813 km², so it goes at zoom 0-2 and is back at zoom 3; Gozo is Malta's second at 67 km², so it
  goes at zoom 0-4 and is back at zoom 5. The largest part is always kept, so a region that *is* an
  island or an archipelago never loses it — the Isle of Man, Gotland, Saare and Sardegna each keep
  their island at every rung, and Åland's 951 pieces become 7 at zoom 3-4 and its main island at
  zoom 0-2. The part floor stops at zoom 4: zoom 5 and beyond draw every piece they always did.
- **A huge feature loses full resolution at zoom 9+.** A continent-sized row is drawn from the 1 km
  rung there — coarse but recognisable, and it is the layer a reader chooses a continent from
  rather than the one they read. Nothing under 10 MB is affected, which is every region of every
  world view and all but the top two levels of GADM.
- **The specks still cost everywhere else.** Zoom 5-8 reads the 1 km rung with all 117,100 pieces
  in it, and the divisions' rendered columns are still per-row rather than coverage-simplified.
  Both are #560, which this decision gives its mechanism to rather than doing its work.

## Alternatives Considered

- **Move the overview rung up to zoom 3 and change nothing else**, as #551 proposed. Refuted by
  rendering it: see the Context. It is the cheapest possible change and it ships a broken map.
- **Add the missing rung without a part floor** — coverage-simplify the 5 km rung at 10 km. Keeps
  every ring, so it lands at 576,428 vertices against 773,264: a 25% saving for a new column, and
  the zoom-3 tile stays over 300 ms.
- **Drop the parts without the coverage pass.** Cheaper to compute and it was measured too: the
  borders around the Alps separate into visible white slivers, because per-row simplification
  moves each side of a shared border its own way.
- **Pre-clip each row to the tile envelope** with `ST_ClipByBox2D` before `ST_AsMVTGeom`. Measured
  and rejected: 124 s against 75 s for the same zoom-3 tile of GADM roots. The cost is reading the
  row, and clipping adds a second pass over what was read.
- **Store the geometry subdivided** so a tile reads only the pieces it needs (`ST_Subdivide`).
  Lossless and the standard answer to the read cost, but a line layer then draws the subdivision
  cuts as if they were borders, and the region layer draws its outlines that way. It needs a
  separate answer for outlines before it can be considered.
