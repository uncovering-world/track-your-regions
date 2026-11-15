# ADR-0207: A place's regions come from its own geometry, and a point no region holds takes its nearest

**Date:** 2026-11-15
**Status:** Accepted
**Issue:** [#2122](https://github.com/uncovering-world/track-your-regions/issues/2122), Epic #2115
**Narrows:** [ADR-0197](0197-a-places-regions-are-one-row-per-region-written-by-one-function-from-the-points-it-shows.md)
decisions 2 and 3

---

## Context

ADR-0197 made a place's automatic region rows the regions of the points it shows, its own and its
direct parts', written by `refresh_place_regions()`, which reads no geometry. Its Alternatives
table left the area and the line to #2122. Three things a point alone cannot say, measured on the
development catalogue on 2026-11-13 and again on a copy on 2026-11-15 (world view 5, the only one
with geometry):

- **A point just outside every leaf is in no region.** 522 places, offered or waiting, have no
  point a region holds. Most lie within a kilometre of a coast or a gap of the test hierarchy: the
  Island of Gorée 14 m off Dakar, the Golden Gate Bridge 684 m off California, central Dublin,
  which no division of Leinster reaches, the Hiroshima Peace Memorial. A region's list does not
  hold them, so browsing cannot find them. The check `held-by-no-region` (#469) suggested the
  nearest leaf and decided nothing.
- **An outline crosses into a region its point is not in.** 1,753 places hold an outline, all
  drawn by Archaeology's site door. The Theban Necropolis's point is in Qina and 69% of its outline
  in Luxor. But 100 outlines lie more than a kilometre from their place's point and are another
  object of the same name: the Pergamon Altar's is the ancient city's in Izmir, 1,827 km from the
  altar in Berlin; Trelleborg's is the Swedish town's, 119 km from the Danish fortress.
- **A whole none of whose parts a reader may see is listed nowhere.** Wudang's 45 parts all wait
  for a curator; today its own point lists it in Hubei, and #2122 takes that point away. Its World
  Heritage record still reports where UNESCO puts the site.

Bridges, tunnels and dams need a line (the Øresund Bridge lies 3.1 km from Copenhagen and 4.5 km
from Skåne, and belongs to both). No line is stored yet: OpenStreetMap's layer keeps only a point
for them until ADR-0157's keep reaches their items.

## Decision

1. **A place's automatic rows come from its points and from its own geometry**, a union:
   - its points' regions, as ADR-0197 decision 2 says, its parts' included;
   - **area**: the leaves holding at least 1% of its outline, when the outline is its own, that
     is when it holds the place's point or lies within 1 km of it (`outline_reaches_place()`);
   - **line**: the leaves holding at least 1% of its line's length (`experiences.path`, added
     empty, owned by the source that draws it as the outline is, ADR-0146);
   - **nearest**: for a place none of whose own points a region holds and with no outline or line
     placing it, the leaf nearest each of its points, within 25 km, when no other leaf lies within
     1.5 times that distance. Past 25 km (the Great Barrier Reef 117 km, Malpelo 355 km and the
     Panamanian leaf it would get) and between two leaves nearly as near (the Øresund Bridge, the
     Pelješac Bridge) it places nothing, and the check `held-by-no-region` asks a curator;
   - a whole takes its parts' regions of every basis above (area, line and nearest), never their
     `record` rows (decision 2).
2. **Where none of those offers the place to a reader in a world view, its kind record's point
   does**: a place with no point of its own (a serial site) is placed in the leaf that holds the
   point each of its kind records reports, and readers find it there whenever they are shown the
   place at all; its other rows there become curators' (`scope`). Wudang stays in Hubei when its
   own point goes. Every reader's list still composes a record a reader is offered
   (`placeShownSql`), so a site whose record waits is listed nowhere.
3. **Placement computes the geometry's regions, the refresh still reads none.** Each basis reads
   geometry, so placement writes them into `experience_shape_regions` (place, region, basis; each
   leaf with the regions above it) through `refresh_place_shape_regions()`, under the places'
   region keys, and then calls `refresh_place_regions()`, which reads that table beside the point
   rows. The rows carry the place's visibility as its points give it, so `offered`, `scope` and
   `fallback` keep ADR-0197's meaning. A re-traced outline places its site as a moved point does.
4. **Two catalogue checks follow it.** `held-by-no-region` is what the nearest rule leaves, and
   `outline-away-from-its-place` lists the outlines that place nothing.

This narrows ADR-0197 decision 2 (a place's rows are no longer its points' alone, and a whole none
of whose parts a reader may see is listed by its record's point) and decision 3 (the refresh reads
a second input, which placement writes). ADR-0054 is unchanged: points are placed as before, and
the geometry is tested against the same pieces.

## Alternatives Considered

| Option | Why rejected |
|--------|-------------|
| Area first, points only where there is no outline | 100 outlines are another object; the Pergamon Altar would be listed in Izmir and nowhere in Berlin. A place never leaves the leaf its own point stands in. |
| The nearest leaf at any distance | At 117 km the Great Barrier Reef reaches Burdekin, and at 355 km Malpelo, a Colombian island, lands in Panama. The measured gap is between 15.5 km and 86 km. |
| The nearest leaf whatever the next one | The Øresund Bridge and the Channel Tunnel would be put on one side only. Where a second leaf is within 1.5 times the distance it is nearly always a place on both sides. |
| The nearest leaf as a point row in `experience_location_regions` | It would place a point's own region path too, and a place with an outline would get the nearest leaf of an offshore point beside the outline's leaves. The rule is about the place; #2124 folds point placement into the place-level table. |
| Geometry read inside `refresh_place_regions()` | The refresh runs in a curator's transaction from the point and part triggers; reading pieces there costs tens of milliseconds a place, and the nearest leaf's distances more. |
| A whole none of whose parts is read stays listed nowhere (ADR-0197's `fallback`) | The site is published and a reader can open it; with #2122 removing its own point it would vanish from every list until a curator reads one of its parts. |

## Consequences

**Positive:**
- On a copy of the development catalogue the backfill writes 7,681 geometry rows and changes the
  rows of 483 places, removing none: 202 places become findable in a region they were not, 182 by
  the nearest leaf (Gorée in Dakar, the Golden Gate Bridge in California, Dublin's Spire in
  Leinster, Surtsey in Suðurland) and 13 by their outline (the Theban Necropolis in Luxor as well
  as Qina, Red Bay in Newfoundland and Labrador); serial sites follow their parts (the Wadden Sea in Groningen,
  Fryslân, Lower Saxony, Schleswig-Holstein and Southern Denmark). 280 places waiting for a curator
  gain a row for curators only.
- A line placed later (#1969's drawing, the layer's keep for bridges) needs no new rule.

**Negative / Trade-offs:**
- The test hierarchy's borders decide a share of an outline: 33% of Yaxchilan's outline falls in
  Petén, Guatemala, though the city stands on the Mexican bank, and 79% of Petra's in Aqaba. The
  per-border sliver on real borders is #2135's.
- Ha Long Bay – Cat Ba is placed in Hải Phòng only (6.4 km, against 10.1 km to Quảng Ninh, where
  the bay is); the site is in both.
- The refresh reads one more table: a single place's expected rows take about 2 ms more
  (5.0 → 7.3 ms for the Louvre, 12.6 → 15.4 ms for a site of 758 parts), and the check
  `place-regions-out-of-step` 95 → 157 ms. Placement adds a statement: about 20 ms for a place,
  80 ms for the Rock Art of the Mediterranean Basin with its 758 parts, and 5.3 s to a full rebuild
  of the world view.
- The outline rule is a distance, not a match: an outline of another object that happens to lie
  within a kilometre places its place.

## References

- Related ADRs: ADR-0054, ADR-0059, ADR-0146, ADR-0157, ADR-0197, ADR-0205
- Related docs: `docs/tech/experiences.md` § Region assignment, `docs/tech/data-assertions.md`
- Issue: #2122 (Epic #2115)
