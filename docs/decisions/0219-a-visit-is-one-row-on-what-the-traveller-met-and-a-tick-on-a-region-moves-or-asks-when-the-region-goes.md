# ADR-0219: A visit is one row on what the traveller met, and a tick on a region moves or asks when the region goes

**Date:** 2026-11-16
**Status:** Draft
**Issue:** [#2579](https://github.com/uncovering-world/track-your-regions/issues/2579),
[#2580](https://github.com/uncovering-world/track-your-regions/issues/2580), Epic #2115; it
settles #768
**Narrows (once accepted):**
[ADR-0199](0199-a-visit-is-one-row-on-the-place-ticked-and-a-whole-is-read-through-its-parts.md)
decision 1 (the one visit table also holds a work seen, a tick on a region and the traveller's
own point);
[ADR-0202](0202-a-visit-holds-its-trips-each-with-an-approximate-date.md) decision 1 (a trip
hangs under a visit of any of the four);
[ADR-0206](0206-one-visited-place-visits-the-whole-which-reads-k-of-n-over-its-offered-leaves.md)
decision 7 (a region is painted from a visit's own point; a whole shown visited still paints
none);
[ADR-0197](0197-a-places-regions-are-one-row-per-region-written-by-one-function-from-the-points-it-shows.md)
decision 3 (a curator's manual row is read into every world view, and outlives its region). No ADR records the refusal of #764 that decision 6 replaces; it is described in
`docs/tech/world-views.md` § A hierarchy edit keeps every visit.

---

## Context

What a traveller can record is split across three tables that share no model:

- a place visited is a row of `user_visited_experiences`, with its dated trips
  (`user_visit_trips`, ADR-0202);
- a work seen is a row of `user_viewed_treasures`, which keeps the moment of the tick and no
  trip;
- a region visited is a row of `user_visited_regions` on one world view's region. It shows in
  that view only, and a curator's edit of the hierarchy is refused while it stands (#764).

A curator's placement of a record in a region (`experience_regions`, `assignment_type =
'manual'`) references the region with `ON DELETE CASCADE`. An import always makes a new world
view (`importTree`), so importing a view again means deleting the old one, and every manual row
goes with it. The same happens, with no warning, on a merge, a remove, a prune or a flatten
inside a view. A place with a coordinate is placed again from its geometry; a record with no
ground (#1676) has nothing to be placed again from.

The maintainer decided on 2026-09-30 (#768) that a visit to a place is recorded as the place,
and that every world view paints its regions from it. Four rulings of the maintainer on #2579,
all of 2026-11-16, are recorded here:

- what a tick on a region refers to, that another view paints the region that covers it with
  nothing stored per view, that a tick is never lost when its region changes or goes, that a
  curator's placement works the same way, and that a record with no ground paints by its kind:
  an event paints its place's region, a dish paints nothing and the product asks where;
- how a traveller says where inside a ticked region, what an own point keeps and who sees it;
- that visits are recorded and counted on **one layer of regions**, as NomadMania does, and
  that a tick above it is a lighter kind. That layer is the canon, which is still to be built:
  one layer, grouped into larger regions above it and perhaps divided below it. Until it
  exists, the leaf layer of a world view plays that part;
- that a tick on a record that lies in several counted regions paints none of them by itself,
  and the traveller is asked which.

The same day the maintainer corrected this ADR's first cover rule: every world view is assembled
from the base layer's divisions, so a region covers another by its bricks, with a tolerance
where a brick is cut between regions. On 2026-11-17 the maintainer confirmed (#2579) that the
tolerance stays on every brick, cut or whole, and gave the reason: if territories are ever
compared, different levels of simplified geometry may cause trouble, so an exact match must not
be required.
The same day the maintainer ruled (#2579) that a region that changes is either redrawn, and a
tick on it carries over, or replaced as an entity, by a change of country or of power, and then
the region is closed with its dates and kept with its ticks (decision 6).

The third ruling replaces two lines of #768's direction of 2026-09-30, which is an issue and no
ADR, so it is recorded here: that a visit is "not recorded against a world view's region", for
a tick on a region only; and that it is not recorded against "an own atom id", since the
canon's region is what a region visit will refer to. A tick on a place stays a place with a
coordinate.

Everything else in this ADR is the design's: rules the session reached from those rulings and
from the milestone, open to the maintainer's veto. Where a decision below holds one, it says
so. They are: a tick on a place paints the region of its own point; a lighter tick is satisfied
by a counted region inside it, and stays; a region with neither bricks nor an outline cannot be
ticked, and one drawn by hand with no division paints only itself; the common region painted
lighter while a place's side is not said; the value
of decision 4's tolerance, 95 % by area (that a tolerance stands on every brick is the
maintainer's); the one refusal decision 6 leaves; an event's tick counts its place's region in
full; and an area visited only through a part or a place inside it reads as visited.

The scenes it is built from:

1. A traveller has the Administrative world view on screen and clicks *Toscana*. It is painted
   at once, with Italy and Europe. Another, entering thirty countries on a first evening, clicks
   *France* and says no more; a week later they remember, and tick *Provence-Alpes-Côte d'Azur*.
2. The line under the tick offers to say where (#1170). The traveller skips it, or ticks the
   Uffizi from the region's places, or picks *Siena* from the list of settlements, or sets a
   point on a beach. Under *France* the same line offers France's places, its settlements and a
   point on its map, and nothing makes them choose. The scenes are illustrations: under a lighter
   tick such as *France*, the offer is the help of #2594 to name a region, and when it shows and
   how often is #1170's mock (#2619 line 1.3, closed on 2026-11-17 as no contradiction).
3. They switch the picker to the Wikivoyage view and expect Tuscany painted there, with no
   second tick.
4. On the Louvre's card they tick the *Mona Lisa*, and the date offer asks when.
5. Months later an admin imports the Wikivoyage view again and deletes the old one. The
   traveller opens the map and expects their travels still on it.
6. A curator, on the card of thieboudienne, adds it to *Senegal*. The same import happens.

Measured on the development database on 2026-11-16, read-only:

- 10 place visits of one traveller, no trip, 5 works seen, **no region visit**, no note and no
  rating. No row of `experience_regions` is manual (73,643 are automatic), and no rejection
  names a region. Nothing here needs a data migration. The maintainer decided on 2026-11-17
  (#2116) that nothing a curator decided on the development catalogue is carried to the fresh
  database, so no placement a curator makes there before then is carried either.
- The Administrative view has 3,831 regions in three levels (8, 237, 3,586), each with a
  geometry and exactly one division. 229 of its 237 countries are not leaves, so a tick on a
  country ("tick the countries visited", the milestone's criterion 2) is a tick on a region
  with children; today's writer accepts a tick on a region of any level. The Wikivoyage
  view has 4,301 regions and **none has a geometry**: 301 hold a division, their own or one of
  a region under them, and 4,000 hold none. So it lists no place and can paint nothing today,
  though it is public. A second import of the same source, made to measure a matching pass
  (#622), has 3,234 regions, 477 of them with a division.
- A Wikidata item is no key of a region: the Administrative view carries none, and in the
  Wikivoyage view 768 items are shared by 2,147 regions (Armenia appears twice, Wyoming three
  times).
- Reading the regions of 2,000 visited places in the Administrative view took about 10 ms
  (6,402 rows of `experience_regions`, 1,017 regions; one run, a stand-in set).
- **Every region of every view is assembled from the same base layer.** A region holds
  divisions of `administrative_divisions` (GADM today) through `region_members`, and its
  outline is the union of its members and of its child regions (`collectUnionInputs`). A member
  may be a part of a division cut by hand (`custom_geom`). OpenStreetMap's shapes
  (`workbench.wikidata_geoshapes`) help an import match a region to divisions and are never
  stored as a region's outline. One kind of region is not the sum of its members: one whose
  boundary an admin drew by hand (`is_custom_boundary`, written by `saveDrawnOutline` and
  `insertDrawnRegion`). A hull is drawn in place of an outline at low zoom and replaces nothing
  stored. On the development database no region is drawn by hand, none is drawn as a hull and
  no member is cut: 0 of the 4,576 member rows of the three views.
- The views hold the tree of divisions at different levels. The Administrative view's members
  are at levels 0 to 2 of it (continents, countries, the level under), and both imports' at
  levels 1 to 6. A region with children may hold a division of its own beside them: each of the
  Administrative view's 237 countries holds the country's division while its children hold that
  division's children (3,823 child regions of 3,823). The base layer has 392,198 divisions,
  356,484 of them leaves, and `administrative_divisions.geom_area_km2` is declared and written
  on none.
- A view may hold one division in two regions with no cut: the Wikivoyage view lists the
  Caucasus under two roots (6 divisions), and the second import also holds Kern County under two
  regions of California (9 divisions in all).
- The base layer divides 22 countries between two continents or more. Of the country as a
  whole, the largest part holds: Portugal 99.998 %, the United States 99.70 % (Hawaii is
  0.18 %), Spain 98.51 % (the Canaries, Ceuta and Melilla are 1.49 %), Turkey 96.94 %,
  Kazakhstan 95.70 %, Egypt 93.82 % (Sinai is 6.18 %), Indonesia 77.8 %, Russia 77.2 %.
- A division's area says nothing of its weight to a traveller. 946 of the Administrative view's
  3,594 leaves are under 1 % of their country and 296 under 0.1 %: Bamako is 244 km², 0.02 % of
  Mali; Berlin 0.25 % of Germany; the District of Columbia 0.002 % of the United States.
- Compared by their divisions, the Administrative view and the second import agree where the
  import is matched. Each view's Italy holds 1.0000 of the other's. The import's Mali is its
  eight regions and holds 0.9998 of the Administrative Mali, which is one division: Bamako is
  not matched yet. Of the Administrative view's 3,831 regions, 2,752 have some of their ground
  in the import; for 2,722 the import holds 96.9 % or more of it, and for the other 30 between
  0.02 % and 94.5 %, with none in between (the highest is Palestine, of which the import holds
  the West Bank and not Gaza).
- That comparison reads no geometry. A prototype of it, one statement over `region_members`,
  `regions` and the divisions' `parent_id`, took 26 to 62 ms for one ticked region and one
  view, 34 to 92 ms for thirty, and 2.1 s for all 3,831 regions of a view (three runs; the
  areas read from the Administrative view's stored ones, since the divisions' column is empty).
  The same question asked of the outlines took 240 ms for one leaf, against Toscana's 160
  subdivided pieces (`region_geom_pieces`), and 2,164 ms against the outline itself (19,796 points).
- A circle of 2 km around a point in Siena, through the index on the pieces, took 10 ms.
- By their stored areas, the leaves under a country of the Administrative view together hold
  1.0000 of it (233 of 237 countries within 0.01 %; the furthest is 0.9950), while single leaves
  are small: 68 of Turkey's 78 hold under 2 % of Turkey each, 32 of Japan's 47, 3 of Italy's 20.
- Eight regions are drawn by both OpenStreetMap (the import's shapes) and GADM, and each
  source's shape holds 0.9816 to 0.9976 of the other's. That compared a matching aid with the
  base layer, never two regions: it says how far two drawings of one coast differ, and nothing
  about how two views differ.

## Decision

**1. A visit is one row per traveller and thing met, in one table** (`user_visits`, which
`user_visited_experiences` becomes). The row says which of four things it is on:

| on | the scene | example |
|---|---|---|
| a catalogue record | a tick on a card or a list row | the Uffizi; a station of the Struve Geodetic Arc; later a dish or a festival, which are records too (ADR-0218) |
| a work | a tick in a museum's list of works | the *Mona Lisa* |
| a region | a click on a region of the view on screen: counted on the layer, lighter above it (decision 3) | *Toscana*; *France* |
| the traveller's own point | a settlement picked, or a point set, when saying where | Siena; a beach near Vernazza |

`user_viewed_treasures` and `user_visited_regions` are folded into it and dropped. A route's
section, a dish, a festival and a class object are rows of `experiences` and need no referent of
their own.

**2. Trips, notes and the rating hang on that row, the same for all four.** ADR-0202 stands as
written, with the visit of any of the four as a trip's parent: "somewhere in Tuscany, around
2015" is a tick on *Toscana* with one trip of the year 2015, and the *Mona Lisa* seen in 2015 is
a visit on the work with one trip. Seeing a work still writes its venue's visit (ADR-0199
decision 6). What kind of evidence a visit rests on (#768) is which of the four it is on; an
import (#602) adds its own mark when it is built. Marks of how a place was met (#2015) and of
how deeply a region was known (#584) are rows under the visit when those issues are built, and
nothing is stored for them now.

**3. Visits to regions are counted on one layer, and a tick on a region is read by where that
region stands to it.** A tick refers to the region that was clicked and nothing else is stored
for it: no copy of the outline, no shared table of areas, and no column saying which kind of
tick it is.

- **The counting layer of a world view is its leaves**, until a canon marks its own. One
  predicate says whether a region is on the layer (`countedRegionSql`, beside the reader
  predicates); it reads `regions.is_leaf` today, and the canon changes that one body when it
  brings its mark. Nothing else of the canon is designed here.
- **A tick on a region of the layer is the visit that counts.** *Toscana* is counted. Italy and
  Europe are painted and counted because they hold a counted region. So is a region that holds a
  visited place or the traveller's own point (decisions 5 and 8).
- **A tick above the layer is a lighter visit**: "France, I am not sure where". It paints France
  and what is above it as "somewhere in", claims no region inside it and counts no region of
  the layer. France is counted among countries, told apart from the placed ones ("30 countries,
  12 of them not yet placed"; the wording is #1169's to settle, whose own example predates the
  layer). It waits to be narrowed to a region, and #2594's guide helps.
- **The two kinds are the same row.** Which one a tick is follows from the predicate, and a
  canon that moves the layer re-reads every tick. A region that gains its first child leaves
  the layer, and its ticks read lighter from then on. The edit that adds the child marks them
  (`former_region_name`, decision 6), so the traveller is told why their count fell and a tick
  made lighter by the map is told apart from "France, I am not sure where".
- **A region with neither bricks nor an outline cannot be ticked** (the design's rule; the
  maintainer's is that a traveller ticks only a region that exists). A region that holds no
  division of the base layer, its own or one of a region under it, and that nobody drew, is
  not matched yet: no outline can be computed for it, no map paints it, and nothing could be
  read from a tick on it. The writer refuses the tick and says why. On the development
  database that is 4,000 of the Wikivoyage view's 4,301 regions and none of the Administrative
  view's.
- **A region drawn by hand that holds no division can be ticked, and paints only itself** (the
  design's rule). `insertDrawnRegion` makes such a region: an outline, `is_custom_boundary`,
  and no row of `region_members`. If an admin draws *Chianti* in a view of wine regions and
  gives it no division, a map paints it, so a traveller can tick it. The tick paints Chianti
  and the regions above it in that view. It takes part in no comparison by bricks: it paints
  nothing in another view (decision 4), no tick made elsewhere paints it, and nothing moves
  to it or from it by itself (decision 6). No such region exists on the development database.
  This is the one exception to the rule above, and every later mention of "a region with no
  bricks" means one with no outline either.
- **A lighter tick is satisfied, and stays** (the design's rule; the maintainer's is that a
  lighter tick waits for the traveller to name a region). When the traveller who ticked *France* on the
  first evening ticks *Provence-Alpes-Côte d'Azur* a week later, France holds a counted region:
  the lighter tick stops waiting, and nothing asks about it again. The row is kept as history
  with any trip and note it carries ("France, 2003"), and it keeps France painted if Provence is
  later unticked. Narrowing it on purpose, through the guide or on its own row, moves it to the
  region with its trips and notes.
- **Below the layer** nothing is ticked: saying more is a place, a settlement or a point
  (decision 8).

**4. Another world view paints the region whose bricks hold the ticked one's.** Every region of
every view is assembled from the same divisions of the base layer, so whether one region covers
another is a comparison of the divisions they hold, and no outline is read for it. In the
Wikivoyage view, a *Tuscany* that holds what *Toscana* holds is painted, and so are Central
Italy, Italy and Europe above it. A view that holds only Tuscan provinces paints none of them
and paints the smallest region that holds all of Toscana. A tick on the Administrative *France*
paints the Wikivoyage France and nothing under it. In each view the tick is read by decision 3
on the region that covers it there: counted where that region is on the view's layer, lighter
where it is above.

**A region's bricks** are the divisions it holds: its own members and those of every region
under it (`region_members`). **The covering region is the smallest region of the view whose
bricks hold 95 % or more of the ticked region's bricks, by area.** The share is divided by all
of the ticked region's bricks, never by the part of them the other view happens to hold.

- *A brick against its own parts.* The divisions are a tree, and two views hold it at different
  levels: the Administrative Mali is one division, and the import's Mali is the eight divisions
  under it. A brick is held by a region that holds it or a division above it; where a region
  holds divisions under it, the brick is held by as much as those weigh. The comparison walks
  up the tree from each brick (`parent_id`) and never expands a region to the 356,484 leaves.
  A division a region holds twice, itself and through a division above it, counts once.
- *A brick's weight* is its area, `administrative_divisions.geom_area_km2`, which the slice
  that builds this fills: it is declared and written on no row today. A division and the
  divisions under it weigh the same within the tolerance: by the Administrative view's stored
  areas, 233 of 237 countries are within 0.01 % of their children's sum and the furthest is
  0.5 % off.
- *A cut brick* (`custom_geom`, a part of a division) weighs the area of its part. A region
  that holds its division whole, or a division above it, holds all of it. Against another cut
  of the same division it is held by the share of it that lies inside that cut, and that is
  the one place where the comparison reads a geometry: two parts of one division, never two
  regions.
- *A region drawn by hand* is compared by the divisions it holds, like any other. Its drawing
  is not read. One that holds no division is in no comparison: it covers nothing and nothing
  covers it.
- The regions that hold 95 % lie on one branch, so the smallest is one region or none, unless a
  view lists the same ground twice (the Wikivoyage view's two Caucasus branches): then the
  smallest on each branch is painted. Where none holds 95 %, the view paints nothing for that
  tick.
- Two regions hold *the same bricks* when each holds 95 % or more of the other's.

**Why a tolerance on every brick, and why 95 %.** The maintainer's correction of 2026-11-16
allowed a tolerance where a brick is cut between regions. On 2026-11-17 the maintainer
confirmed (#2579) that the tolerance stays on every brick, and the reason is the maintainer's
own: if territories are ever compared, different levels of simplified geometry may cause
trouble, so an exact match must not be required. That is the reason for the number. Two
regions matched to the same divisions still compare as exactly 1, with no geometry read. The
tolerance is spent where an area is compared with another: a division against the divisions
under it (the furthest country of the Administrative view is 0.5 % off the sum of its
children), and one cut of a division against another.

The value, 95 %, is the design's, from the data below. It has a second effect, which is the
design's reason and not the maintainer's. It also holds for two views that assemble a region a
little differently:

- *All of the bricks fails whole countries.* The base layer divides 22 countries between
  continents. A view that keeps Spain whole, with the Canaries, would paint nothing in the
  Administrative view for a tick on Spain: its Europe's Spain holds 98.51 %, and no region
  stands above Europe and Africa. The same holds for the United States (99.70 % without
  Hawaii), Portugal, Turkey (96.94 %) and Kazakhstan (95.70 %). A brick not matched yet does
  the same: the import's Mali lacks Bamako, 0.02 %, and at 100 % a tick on Mali would paint
  nothing there.
- *What 95 % refuses.* Egypt without Sinai is 93.82 % and Palestine without Gaza 94.5 %: the
  part left out is a destination of its own, and the tick paints the region above both or
  nothing. Of the Administrative view's regions that the second import holds any of, none
  falls between 94.5 % and 96.9 %.
- *What 95 % lets through.* Area is not what a traveller came for: Bamako is 0.02 % of Mali
  and the Canaries 1.49 % of Spain. A tick on a whole Spain paints Europe's Spain in the
  Administrative view, also for a traveller who saw Tenerife alone. That claims nothing false:
  Europe's Spain has regions under it, so the tick reads lighter there, "somewhere in Spain",
  counts no region, and waits to be narrowed (#2594). The same holds for every divided country
  and for Mali without Bamako, whose covering regions all stand above the layer.
- *The one real cost* is a covering region that is on the layer and lacks a brick another
  region of the layer holds: a leaf made of Bamako and the region around it, ticked in one
  view, counts as that region alone in a view that holds the two apart. No number prevents it,
  since 99.98 % still loses Bamako, and no such pair of leaves exists on the development
  database.

The number is confirmed, or moved, when the first second view is matched whole: today the
Wikivoyage view is 7 % matched, and no member of any view is cut.

Checked on:

- *The same Tuscany in two views.* Both hold the division Toscana, or one holds its provinces:
  each holds all of the other's, so they hold the same bricks. Measured on Italy, which both
  the Administrative view and the second import hold: 1.0000 each way. That import's Tuscany
  holds no division yet, so a tick on Toscana paints its Italy there, as "somewhere in", and
  Tuscany from the first read after it is matched.
- *France against a view with finer regions*, of départements or of 78 provinces as Turkey
  has: the divisions under France's, held by the regions under that view's France, together
  weigh what France weighs. France is painted and nothing under it. Measured on Mali, one
  division against eight: 0.9998 one way (Bamako unmatched) and 1.0000 the other.
- *Tuscany in a view whose leaves are cities*: the cities hold a few communes of Toscana, so
  no region holds 95 % of it and nothing is painted there. Painting that view's Tuscany would
  claim the cities.
- *A region that straddles two regions of the other view*: the smallest region above both. A
  whole Turkey against the Administrative view, where Asia holds 96.94 % of it and Europe the
  rest: Asia's Turkey is painted. A whole Egypt: no region holds 95 %, none stands above Africa
  and Asia, and nothing is painted.
- *A region larger than anything in the other view* (a tick on Asia against a view of Japan
  alone): that view holds a small part of Asia's bricks, so none covers it and nothing is
  painted.
- *A region whose bricks are cut*: a view whose Florida Keys are a part cut from Monroe County.
  A tick on the Keys paints the Administrative Florida, which holds the division above the
  county. A tick on Florida paints that view's Florida, whose regions hold the other counties
  whole and the county in two cuts that together make it up. No cut exists on the development
  database, so the cut's share is unmeasured.
- *A region with no bricks*: it covers nothing, so no tick made elsewhere paints it. With no
  outline either it cannot be ticked (decision 3). Drawn by hand with no division, as a
  *Chianti* of a wine view would be, it can be ticked and paints its own view only: a tick on
  it paints nothing in the Administrative view, and a tick on Toscana does not paint it.
- *A custom view that divides the ground differently*: a view of mountain ranges whose Alps
  hold communes of four countries. A tick on the Alps paints Europe in the Administrative
  view, as "somewhere in", since no country holds 95 % of them. A tick on Toscana paints
  nothing in the view of ranges, which holds none of it.

**No answer is stored**, as the maintainer ruled: it is computed, and nothing is kept per view.
The covering regions of all of a traveller's ticks, for the view on
screen, are read in one statement over the members of the two views: 34 to 92 ms for thirty
ticks in the prototype, where the test of outlines took 240 ms for one. So there is no table
of covers, no job that fills one and nothing to keep in step: a member added to a region
changes the next read.

**5. A tick on a place paints the region its own point lies in, and a place that lies in
several counted regions paints none until the traveller says which.** The first half is the
design's rule, from the milestone's criterion 3 and #768; the second is the maintainer's
(2026-11-16).

- *A place in one counted region* paints it in every view, with the regions above, through the
  rows placement already writes (`experience_regions`). The Uffizi paints Toscana, Italy and
  Europe. A station of the Struve Arc in Finland paints Finland and not Moldova; the Arc is
  shown visited, "1 of 34", and paints nothing, because it holds no coordinate (ADR-0206).
- *A place listed in several regions of the counting layer* (the Øresund Bridge, in
  Hovedstaden and in Skåne, by its line) paints none of them by itself. The tick stands: the
  bridge is visited, with its trips and notes. The traveller is asked which side they were
  on, and is offered the counted regions the place is listed in, in the view on screen: one,
  the other, or both. The question can be left unanswered.
- *While it is unanswered, the smallest region that holds all the listed ones is painted as a
  lighter visit*, with the regions above it. This is the design's rule; the maintainer's
  ruling covers only "none of them". It reads like the lighter tick of decision 3,
  "somewhere in", but no row is written for it: it is derived from the place's listings
  (decision 9), so it goes when the bridge is unticked or the side is answered. It counts no
  region of the layer: the bridge unanswered paints Europe in the
  Administrative view, since that much is certain, and neither Denmark nor Sweden, nor
  Hovedstaden nor Skåne. Nothing at or below the listed regions is painted until the
  traveller answers. A view with no region above all of them paints nothing.
- *The answer is a tick on each region chosen*, linked from the place's visit. It is read by
  decision 3, painted in other views by decision 4 and kept through an edit by decision 6, so
  nothing new holds it. How the answer is kept is the design's.
- No mark of where the pin lies is added to `experience_regions`. This ADR first painted the
  side the pin is nearer to, through a column `of_pin`; the maintainer's ruling replaces that,
  and the column is not built. The screen may offer the pin's side first.
- A view in which the place lies in one counted region paints that region, with no question.

A tick on a record with no ground paints by its kind (#1676 declares which), as the maintainer
ruled. An event held at its place paints its place's region: the Gion Matsuri paints Kyoto.
That it counts Kyoto in full, as a place visited there does, and not as "somewhere in", is the
design's rule: being at the Gion Matsuri is being in Kyoto. A dish, a drink and a class object
paint nothing; the product asks where ("Where did you try it?"), and the answer is an ordinary
visit that paints: a region, a place or a point.

**6. A tick is never lost when its region changes or goes, and an edit is refused for it in one
case only.** A region whose members or outline change is the same region, and the tick stays on
it. A region drawn by hand that holds no division is the exception (decision 3, the design's):
no bricks say whether a redrawn outline is the same ground, so redrawing it marks its ticks
and asks the traveller; when it goes, its tick moves to its parent as a lighter tick that
asks, never as a plain replacement; and no tick is moved onto such a region without the
traveller's answer.

**A region that changes is either redrawn or replaced as an entity, and only a redrawing carries
a visit over** (the maintainer, 2026-11-17,
[#2579](https://github.com/uncovering-world/track-your-regions/issues/2579#issuecomment-6950332028)). The
maintainer refused the recommendation that a tick moves to the region's successor in every case,
as a simplification.

- **A redrawing** changes nothing about the fact of a visit: an editor re-slices a view, or a
  state redraws its own administrative borders, as France merged Languedoc-Roussillon into
  Occitanie in 2016. The traveller was in that town, and its region is now cut or named
  differently. The tick carries over, moving or asking, as the rest of this decision says.
- **A replacement as an entity** is a change of country or of power: Artsakh, dissolved on
  1 January 2024; the Estonian SSR, which is not today's Estonia. The region is closed with its
  dates and kept, never deleted. The tick stays on the closed region and is not carried to what
  holds the ground today: a visit to Artsakh in 2019 is not a visit to Azerbaijan, and one could
  only be in the Estonian SSR while it existed.
- **The model holds, at each change, which of the two it is**: an administrative redrawing, in
  which nothing changes in fact, or a change of the entity that is tracked.

Still to design, the session's, and not decided by this ADR:

- how today's map shows ground visited under a closed region;
- whether the traveller may, by their own act, count today's region too;
- where the mark of a change is set, and by whom;
- a change of sovereignty that leaves a region continuing (Hong Kong in 1997), which the mark
  per change settles case by case, with no rule deciding it;
- that the country of such a visit is read from the canon and not from an outside set of
  historical borders (#616).

What follows is the redrawing. When a region goes in one, the one writer of regions
(`db/regionWriter.ts`) moves every tick on it, in the same transaction, before the row is
deleted. No region is kept for the sake of a tick in a redrawing, and no outline is copied; a
region replaced as an entity is kept, closed, for what it was (above).

The tick moves to S, the region that takes the old one's place:

- in an edit inside a view, the region the edit hands the old one's land to (a merge's target,
  a flatten's parent), else its parent. This reads the tree and no outline, since the
  survivors' outlines are computed after the edit;
- when a whole view is replaced by a new import, the covering region in the replacing view
  (decision 4), computed in that transaction from the members of both. It needs the replacing
  view matched to the base layer, and not its geometry computed. The confirmation dialog names
  the replacing view.

Decision 3 then says what the tick is:

- **The replacement is plain when the tick still counts**: S holds the same bricks (decision
  4), or S is on the counting layer. No question follows.
  - *The same region.* Tuscany after a re-import, matched to the same divisions.
  - *A merge.* Tuscany and Umbria made one leaf: both ticks move to it and become one visit,
    which keeps the trips and notes of both.
  - *A flatten.* A region's children are removed and it becomes a leaf: a tick on a child moves
    to it.
- **Otherwise a counted tick has become a lighter one**, and it waits like any lighter tick.
  - *A split in three.* The tick sits on Central Italy, "somewhere in". The traveller may
    choose one or several of the new regions, as #1887 lets them answer "both"; each chosen
    region gets the visit with its trips and notes.
  - *A region removed.* The tick sits on the region above, with nothing to offer.
  - *A region that gains children.* The tick stays where it is, and its region is no longer on
    the layer.

**The traveller is told, at once and in words.** A count that falls with no act of theirs reads
as a lost visit. So whichever edit turns a counted tick lighter writes on the visit the name of
the region it counted on (`former_region_name`) and, where the regions that replace it are
known, those (`offered_region_ids`); where they are not, the regions under the ticked one are
offered as they stand. The product says "Tuscany was divided in three. Which were you in?", or
"Tuscany is no longer on this map". Both columns are emptied when the tick counts again.

One exception keeps a tick exact: where another view holds a region of the same bricks (the Administrative *Toscana* when the Wikivoyage Tuscany is split), the tick moves
there and stays counted, and the view that changed reads it by decision 4.

This replaces the refusal of #764: deleting, merging, flattening and pruning go through, and so
does replacing a view. **One refusal is left**, and it is the design's: the maintainer's
ruling is that moving or asking takes the place of the refusal of #764, and it names no case
where there is nowhere to move to. A ticked region that has no parent, no region handed its
land and no covering region in any other view cannot be deleted, since nothing would be left to
hold the tick. It is named by that condition and by no kind of region. It is met by
a root region whose bricks no other view covers; by a view replaced before its replacement
is matched to the base layer, where no other view covers its ticked regions either; by a custom view of
ground the other views divide differently or not at all. It is never met by the last world view:
the default world view cannot be deleted at all (`deleteWorldView` in
`backend/src/controllers/worldView/worldViewCrud.ts`). The foreign key stops it, and the writer
says which ticks stand in the way. The refusal stays as the design's safeguard (#2619 line 1.2,
closed on 2026-11-17 as no product question).

**7. A curator's placement of a record refers to a region the same way.** Thieboudienne added to
*Senegal* is a manual row of `experience_regions` on that region, as today. Like a tick it is
refused on a region with neither bricks nor an outline, and allowed on a region drawn by hand
that holds no division, where it lists the record in that view only (the design's rule, as
decision 3): a wine placed in a hand-drawn *Chianti* is listed there and in no other view, and
a change to that region asks the curator. Every other view lists the record in the region that
covers Senegal and in the regions above it, by decision 4's comparison, as a basis `named` of
`experience_shape_regions` (the interface ADR-0218 leaves for it). When Senegal goes, the same
transaction moves the row to S by decision 6, so the cascade no longer takes it. A placement
has no counting layer, so its replacement is plain only where S holds the same bricks. Anywhere
else the row carries the same two marks, and the question is a curator's, in the review queue,
with the new regions offered.

When the region is not redrawn but replaced as an entity (decision 6: Artsakh), a placement does
not stay on the closed region as a tick does: a placement says where the record belongs today, so
the row is marked and the curator is asked where it goes, with the regions that now hold the ground
offered. That is the session's rule of 2026-11-17 (#2619 line 1.22), open to the maintainer's veto.

A region a source names for a record is that source's view, as ADR-0218 decision 10 says: kept on
the source's record, the placement derived from it, and a curator's placement standing over it.
Wikidata's country of origin names Senegal for thieboudienne, and a curator who adds it to
*Senegal* writes the placement that stands. That is the session's rule of 2026-11-17 (#2619 line
3.2), from ADR-0084's `reported_*` pattern and the maintainer's ruling of 2026-11-16 on #2579
(comment of 18:33Z).

**8. The traveller's own point keeps a coordinate, a name and a radius in metres.**

- It is made when a traveller says where, under a tick on a region or after a tick on a record
  with no ground: a settlement picked from the product's own list (#1173), which brings its name and its size, or a point
  set on the map, whose first radius comes from the zoom it was set at.
- The radius is never zero, and the traveller may change it. The coordinate is kept as given,
  neither rounded nor moved: the radius says how sure the traveller is, as the point-radius
  method of Darwin Core and iNaturalist has it.
- In every view it paints the smallest region that holds every leaf its circle touches, and
  the regions above. Under a ticked leaf that adds nothing in the view it was made in; under
  *France*, a point in Lyon paints Auvergne-Rhône-Alpes. Only the regions the circle touches
  are read, so a circle that reaches the sea still paints its region; one that touches no
  region of a view, where that view holds no division, paints nothing there.
- A circle is geometry and is tested as geometry, against the outlines of the regions it
  touches through their pieces (10 ms, measured). It is not a set of divisions, and decision
  4's comparison is not asked of it. A view therefore paints an own point only once its
  outlines are computed, while it paints a tick on a region as soon as it is matched.
- It is seen by its owner only: read and written under `/api/users/me`, never in a log, a URL,
  an error message or a tile, in no read across travellers, and deleted for good on request.
  The database is set to log no statement parameter. Rounding is not the protection.

**9. A region's visited state is read, never stored.** One read answers, for a traveller and a
view, which regions are painted and how: by a place (decision 5: a place in one counted region,
an event's place, and an own point), by a counted tick, by holding a counted region, or only
"somewhere in" (a lighter tick, or a place whose side is not said yet, decision 5). The counts read the same answer: regions of the layer that are
counted, and the regions above them.

A derived state reads as visited and paints nothing of its own: a whole visited through a part
(ADR-0206), and an area visited only through a part or a place inside it. A visit cascades up
to the record (Epic #2115), and the regions are painted by the place that was ticked. This is
the design's rule.

What a visit counts as under a kind is not decided here. A count under a kind is read over the
list of the date shown, and when a visit happened changes none; no "when were you there?" is
asked for a place that left a list. That is the maintainer's ruling of 2026-11-17 on #2578
(comments of 10:24Z and 10:30Z), which replaces the one of 2026-11-16 (comment of 21:06Z) this paragraph
named, and ADR-0217 decision 8 carries it. This read counts regions, takes no date and no
listing into account, and a visit to a place that left its list or no longer stands paints its
region like any other: Liverpool, delisted in 2021, paints its region whenever the traveller
was there.

**What this leaves, and the interface each builds against.**

| Issue | It decides | It builds against |
|---|---|---|
| #2008 | The catalogue offered for a past trip | A trip's `year`, `month`, `day` under a visit of any of the four, read by `@tyr/shared/approximateDates`. Which list a count is read over is ADR-0217's (decisions 6 and 8, #2578): the list as it stood on the date shown, never the date of the visit, so no count reads a trip and no "when?" is asked on a tick of a place that left a list or is not yet on it. The date offered on a tick of a place that no longer stands (ADR-0217 decision 7) files the visit under a trip, and is no condition of counting |
| #1948 | Sections, the walk in kilometres, what a walk paints | A visit on the section's record; a row beside the trip for the kilometres and the two stops |
| #1676 | The kinds, their verbs, which kinds paint | A visit on a record of shape `none`; the kind's declaration read by decision 5; the answer to "where" as a visit of its own, linked from the record's visit when the first such kind is built |
| #616 | The country a visit was in | A trip's date and the visit's ground: the record's pin, the own point, or the ticked region's anchor. Not a table keyed on a region of one view |
| #584 | The depth of a region | The tick on a region as the row its marks hang on; the trips and marks of the places visited in it |
| #2015 | The marks per kind and type, and their grades | A table of marks under `user_visits`, each optionally tied to a trip; a plain tick has no row |
| #1173 | The local list of settlements | Decision 8: a pick writes an own point with the settlement's coordinate, name and size |
| #2594 | The guide that narrows a lighter tick to a region | The lighter ticks of a traveller that hold no counted region (decision 3); the regions of the layer under the ticked one, or `offered_region_ids` where a region went; its answer moves the visit to the chosen region with its trips and notes |
| #587, #770 | The canon, and a country as an explicit marking on one of its nodes, not a depth or a leaf (#770) | `countedRegionSql`: the canon marks its layer and changes that predicate. A region visit then refers to a canon region |
| #1169, #1170, #1171 | How "somewhere in" is drawn and counted, the offer, the picker | Decision 9's read; decision 8 |
| #2135 | A border place in every country a source names | Decision 4's comparison, for a region a source names |

**Amended while Draft (2026-11-16, #2579), before any slice builds it:** decision 4 first read
the covering region from the outlines: the smallest region whose leaves hold 95 % of the ticked
outline's land, with the land cut out of the base layer, a threshold measured on eight regions
that both OpenStreetMap and GADM draw, and a derived table `region_covers` because that test
took 240 ms. The maintainer rejected its premise: there are no two sources. However the ground
is divided into regions, every view is assembled from one and the same base layer; a division
may be cut, but the bricks are always the same, and a tolerance belongs where a brick is cut.
The code agrees: a region's outline is
the union of the divisions it holds, and OpenStreetMap's shapes only help an import match them.
Decision 4 is restated on bricks, and what the premise carried is removed: the land clip, the
eight shapes as the ground for 95 %, `region_covers`, and the wait for a replacing view's
geometry. "A region with no outline" in decisions 3 and 7 is now a region with no bricks, and
"the same outline" in decisions 6 and 7 is the same bricks. The 95 % stands on other ground,
stated in decision 4, and where it reaches past a cut brick it is the design's.

**Amended while Draft (2026-11-17, #2579, #2578):** three recorded rulings are carried in.
Decision 5 painted a place listed in two counted regions on the side its pin is nearer to,
through a column `of_pin`; by the maintainer's ruling it paints neither until the traveller
says which, and the column is gone. An event's tick now counts its place's region in full, and
an area visited through a part reads as visited: both are the design's and marked so. Decision
9 and the #2008 row leave what a visit counts as to ADR-0217. Each rule that stood as the
maintainer's and is the design's is marked: the place's own point, the satisfied lighter tick,
the region with no bricks, and the reasons given for rejecting a shared table of areas.

**Amended while Draft (2026-11-17, #2579, #2116), a second time:** the maintainer confirmed on
2026-11-17 that decision 4's tolerance stays on every brick, with a reason of the maintainer's
own: if territories are ever compared, different levels of simplified geometry may cause
trouble, so an exact match must not be required. Decision 4, its row in the alternatives and
its line in the consequences give that as the reason, and the tolerance is no longer listed as
open to veto. What the amendment above called the design's reach past a cut brick is now the
maintainer's rule; the value of 95 % and its second effect, on the 22 countries the base layer
divides between continents, stay the design's. The one refusal decision 6 leaves is marked as
the design's, since the maintainer's ruling names no refusal. The count quoted in decision 3 is
no longer given as #1169's own words, which are "12 regions, 3 of them somewhere-in" and
predate the counting layer. The context records the maintainer's decision of 2026-11-17 on
#2116: nothing a curator decided on the development catalogue is carried to the fresh database.
This ADR held no sentence that carried a tick or a placement over.

**Amended while Draft (2026-11-17, the review of the pull request that carries these
amendments):** two rules of the design are made whole. The ADR gave two answers on a region
with no bricks. It now gives one, in decisions 3, 4, 6 and 7, the alternatives and the
consequences: a region with neither bricks nor an outline cannot be ticked or placed on; a
region drawn by hand that holds no division can, paints only itself in its own view, takes part
in no comparison by bricks, and a change to it asks. Decision 5 said a place listed in several
counted regions paints "nothing above them", which reached past the maintainer's ruling
("none of them") unmarked. The smallest region that holds all the listed ones is now painted
as a lighter visit while the question is open, marked as the design's.

**Amended while Draft (2026-11-17, #2578), to the maintainer's ruling of that day on counts:**
decision 9's paragraph on what a visit counts as under a kind, and the #2008 row of the table
after it, named the maintainer's ruling of 2026-11-16 (#2578, comment of 21:06Z): a visit made
while a place was listed, and a tick made today on a place no longer listed or standing, "which
asks when". The maintainer replaced that on 2026-11-17 (#2578, comments of 10:24Z and 10:30Z): a count is
read over the list of the date shown, when a visit happened changes none, and no "when were you
there?" is asked for a place that left a list. Both sentences now say so and point to ADR-0217
decisions 6, 7 and 8, amended the same day. Nothing this ADR decides changes: a visit holds its
trips as before, and the read of decision 9 never took a date or a listing into account. The
"visit to a former place" the paragraph spoke of is gone with the rule that made one.

**Amended while Draft (2026-11-17, #2579), to the maintainer's ruling of that day on a region
that changes, and to the lines of #2619 the session closed the same day:** each change names its
line in #2619.

- **Decision 6, a region that changes (line 1.22).** A redrawing carries the visit over as this
  decision had it; a replacement as an entity (a change of country or of power: Artsakh, the
  Estonian SSR) closes the region with its dates and keeps it, the tick stays on it, and nothing
  is carried to what holds the ground today. The model holds which of the two each change is
  (the maintainer, 2026-11-17, [#2579](https://github.com/uncovering-world/track-your-regions/issues/2579#issuecomment-6950332028),
  against the session's recommendation). This narrows the sentence "No region is kept for the
  sake of a tick" to a redrawing. The Consequences' "no dead region … is kept" is narrowed the
  same way, a trade-off is added, and the alternatives gain the recommendation the maintainer
  refused, and the Context names the ruling. What is still to design is listed in decision 6 as
  the session's, not decided.
- **Decision 6, the one refusal (line 1.2).** It stays as the design's safeguard. "The last
  world view" is taken off its cases, since the default world view cannot be deleted at all
  (`deleteWorldView`).
- **Scene 2 (line 1.3).** The scenes are illustrations: under a lighter tick the offer is the
  help of #2594, and #1170's mock decides when it shows and how often.
- **Decision 3 (line 1.4)** needs no change: a satisfied lighter tick stops waiting and its row is
  kept, as it already says.
- **Decision 7 (line 3.2).** A region a source names is that source's view, the session's rule,
  as ADR-0218 decision 10 has it.
- **The table of what this leaves (lines 3.5 and 6.20)** names #770 beside #587.

## Alternatives Considered

| Option | Why rejected |
|--------|-------------|
| A shared table of areas (a name and a geometry in no world view), which a tick and a placement refer to | Proposed first in this design. The maintainer ruled on 2026-11-16 that no shared area table is built: a tick refers to the region it was made on, and a traveller can only tick a region that exists. The design's own reasons: it adds an entity no screen shows, a find-or-make rule for "the same Tuscany" and a copy of GADM's or OpenStreetMap's outlines with their licences. |
| A point with a size for "somewhere in" | Rejected with it: a region already has an outline, and the traveller ticked the region, not a circle. |
| Keep a region that goes, with its outline, in an inactive holding world view until its ticks are answered | Proposed first in this design. It keeps the old outline, so a waiting tick paints every view exactly as before. It costs dead regions no reader may see, a view that exists to hold them, a later pass to re-home them and their outlines on the public tile server. Re-pointing in the same transaction loses one thing: where no view holds a region of the same bricks, a waiting tick paints the coarser region until the traveller answers. |
| A copy of the outline on each waiting visit | One copy per traveller of a 19,796-point polygon, and a second way to paint. |
| A tick only on the counting layer | 229 of the Administrative view's 237 countries are not on it, and the milestone asks to "tick the countries visited". The maintainer decided on 2026-11-16 that a tick above the layer is a lighter visit. |
| A column on the visit that says counted or lighter | It would be written at the tick and go stale when a region gains children or the canon moves the layer. The predicate reads it from the region. |
| A column on the world view that names its counting layer | It would hold one value until the canon exists. A predicate with one owner is the room the canon needs. |
| Remove a lighter tick once a region inside it is ticked | "France, 2003" may be another trip than Provence last week, and unticking Provence would then leave France unpainted. Satisfied is read, and the row stays. |
| Ask "was this where you were in France?" after every tick inside a lighter one | A question on a one-click tick, for a row that changes neither the map nor the counts once France holds a counted region. |
| A waiting mark on a tick re-pointed after a split | Such a tick is a lighter tick, which waits by what it is. What is kept is the name of the region it counted on, so the product can say what changed. |
| The covering region read from the outlines: the smallest region whose leaves hold 95 % of the ticked outline's land | This ADR's earlier wording, with a land clip, a threshold measured on eight regions that OpenStreetMap and GADM both draw, and a cache for a test of 240 ms. The maintainer rejected it on 2026-11-16: every view is assembled from one base layer, so there are no two sources to reconcile, and the eight shapes compared a matching aid with the base layer. Two regions matched to the same divisions differ by nothing, at no cost in geometry. |
| The covering region as the smallest region above every leaf that holds 2 % of the ticked region | This ADR's first wording. It has no answer when the other view is finer: 68 of Turkey's 78 provinces hold under 2 % of Turkey each. |
| Take the share of the part of the ticked region's bricks that the other view holds | A view whose leaves are cities holds all of what it holds, so its Tuscany would be painted and the cities claimed; a view of Japan alone would cover a tick on Asia. |
| Ask for all of the ticked region's bricks, but for a cut | The maintainer's correction of 2026-11-16 as first recorded. The maintainer confirmed on 2026-11-17 that the tolerance stays on every brick: if territories are ever compared, different levels of simplified geometry may cause trouble, so an exact match must not be required. The design's second reason: the base layer divides 22 countries between continents, so a whole Spain, United States, Portugal, Turkey or Kazakhstan would paint nothing in the Administrative view; and one unmatched brick, Bamako at 0.02 % of Mali, would unpaint a country. |
| A tolerance for unmatched ground only, and every brick the other view holds elsewhere asked for | It keeps Bamako and the Canaries exact, and it is the rule above for the 22 divided countries: the Canaries are held elsewhere, so a whole Spain paints nothing. |
| A tighter number, 99 % | Turkey (96.94 %) and Kazakhstan (95.70 %) would paint nothing, and it protects no small place: Bamako is lost at 99.98 %. |
| Expand every region to the leaf divisions and compare the sets | 356,484 leaves, most of them under regions no view divides that far. Walking up from each brick reads only the levels the two views use. |
| Allow a tick on a region with neither bricks nor an outline, and match it by its source's id | No map paints such a region, so no scene makes the tick; and 768 of the Wikivoyage view's source ids are shared by 2,147 regions. A region drawn by hand with no division is painted, so it can be ticked (decision 3). |
| Refuse a tick on a region drawn by hand that holds no division | A map paints it, so a traveller can click it, and a refusal would have nothing to say. It paints its own view only, since nothing compares it with another. |
| Paint nothing above the listed regions while a place's side is not said | The Øresund Bridge ticked and never answered would leave Europe unpainted, though the traveller was certainly there. The common region painted lighter claims nothing false, as a whole Spain does in decision 4. |
| Compute the mapping from the outlines when a region goes | An edit clears the outlines of the regions above it until they are computed again, and a region about to be deleted may hold none at that moment. The tree and the members are both there. |
| A region whose country or power changes is redrawn like any other, and its tick moves to its successor (the recommendation on #2619 line 1.22) | The maintainer refused it on 2026-11-17 as a simplification (#2579): a visit to Artsakh in 2019 is not a visit to Azerbaijan, and one could only be in the Estonian SSR while it existed. |
| Keep the refusal of #764 | A curator's edit fails because of a traveller they cannot see, and an import still cannot replace a view without deleting visits after a count. |
| Record the tick against administrative divisions | #768 rejected a substrate unit, and a tick says a region, not the divisions it held that day. The bricks are read to compare two regions and are never written on a visit. |
| Record it against a stable key of the region (a Wikidata item) | #768 rejected an atom id. Measured, the Administrative view carries no item and 768 items are shared by 2,147 Wikivoyage regions. |
| A derived table of covering regions (`region_covers`) | This ADR's earlier wording, needed while the test read outlines at 240 ms a leaf. Read from the members it is 34 to 92 ms for thirty ticks in one statement (a prototype), and a table would have to be kept in step with every member added to either view. If the read's budget later asks for one, it stores this statement's answer and changes no rule. |
| One table per thing visited, with a shared shape | A trip, a mark, #1887's question, a journey entry (#606) and the export would each need one of four parents. The table split is what #2120 removed for places. |
| The traveller's own point as a private row of `experiences` | Location data about a person in the catalogue's main table, which 29 tables reference and every public read scans. One missed predicate publishes it. |
| Round the own point to about 100 m | Proposed first in this design. The radius states uncertainty, and privacy fails at publishing and aggregating, not at stored precision (the session's research report on location input, 2026-11-16). |
| Move a split region's tick to the part that holds a place the traveller ticked | The maintainer named a split as a case to ask. The screen may offer that part first. |
| A tick on a place paints every region the place is listed in | A wide area or a long line is listed in every region it reaches; ticking it would claim them all. |
| A tick on a place listed in several counted regions paints the side its pin is nearer to (`of_pin`) | This ADR's earlier wording. The maintainer replaced it on 2026-11-16: the tick paints neither, and the traveller is asked which side. A pin's side is where the catalogue drew the place, not where the traveller stood. |
| Keep the answer to "which side" as a list of regions on the place's visit | A second way for a visit to name a region, which decision 6 would have to move when a region goes. A tick on the region is moved already. |

## Consequences

**Positive:**

- Each case #2579 names is held: the Uffizi on two trips, "somewhere in Tuscany, around 2015",
  the *Mona Lisa*, a section of the Camino de Santiago as a record, thieboudienne tried and
  asked where.
- One tick shows in every world view, and no import, merge, flatten or split loses it. None of
  them is refused for it, but for the one case decision 6 names. The milestone's "re-import a world view: no visit is lost" needs no special path.
- A curator's placement survives the same way, and reads in every view.
- What one region is in another view is read from the members both views already hold. There
  is no land clip, no cover job, no table of covers and no threshold that depends on how a
  coast is drawn; two regions matched to the same divisions are the same with no tolerance
  spent.
- A view paints a tick on a region, and takes over the ticks of a view it replaces, as soon as
  its regions are matched to the base layer, before any geometry is computed for it.
- ADR-0199's read, ADR-0202's trips and the date offer, ADR-0206 and ADR-0211's `whole_leaves`
  and "k of N", the merge's carry of visits and #1887's question keep their logic. The visited
  set of 2,000 places (7.3 ms, #2121) is read from the same index.
- The 409 path of every region writer and `db/regionVisits.ts` go. No dead region of a
  redrawing, no hidden world view and no outline of a region a redrawing took away is kept; a
  region replaced as an entity is closed and kept for what it was (decision 6).

**Negative / Trade-offs:**

- `user_visited_experiences` is renamed, through the generated types, the lint rules and the
  API's visit reads.
- Where a region goes and no view holds one of the same bricks, a waiting tick paints the
  coarser region that covers it, in every view, until the traveller answers: Tuscany split in a
  view that stood alone would leave Italy painted and Toscana not.
- A view can be replaced without a question only once the replacing view is matched to the
  base layer. Replaced earlier, every tick moves to another view's covering region, or the
  delete is refused (decision 6's one refusal).
- A tick on a region with neither bricks nor an outline is refused, so nothing can be ticked in
  the part of a view that is not matched, though the view may be public: 4,000 of the
  Wikivoyage view's 4,301 regions on the development database.
- A tick on a region drawn by hand that holds no division shows in its own view and in no
  other, and a change to that region asks the traveller where a matched region's would not.
- A tick on a place listed in several counted regions paints none of them until its question
  is answered, and the question can be left. The Øresund Bridge ticked and never answered
  leaves Denmark and Sweden unpainted, and Europe painted as "somewhere in".
- The answer to that question is a tick on a region, so unticking the bridge leaves the side
  ticked unless the product removes the linked tick with it.
- `administrative_divisions.geom_area_km2` is filled, at the load of the base layer and once
  for a database that already holds one. A cut member's area is measured when it is compared.
- The comparison runs on the read. Its prototype took 34 to 92 ms for thirty ticks, and the
  slice that builds the read measures it under `perf:api`.
- The tolerance is by area, and area is not importance. Above the layer that costs nothing
  false: a whole Spain paints Europe's Spain as "somewhere in". On the layer it can: a leaf
  that held Bamako with the region around it would count as that region alone in a view that
  holds the two apart.
- The tolerance stands on every brick, as the maintainer confirmed on 2026-11-17, so no
  comparison of two territories asks for an exact match. Its value is the design's: held to
  100 %, the 22 divided countries would paint nothing in the Administrative view when ticked
  whole.
- A region drawn by hand is compared by its members, so where the drawing and the members
  disagree the map and the answer do; one that holds no division can be ticked and placed on,
  and paints its own view only. No such region exists on the development database.
- Geometry is still read in four places: a place's own point, outline or line against the
  regions (decision 5, ADR-0207), the traveller's circle (decision 8), one cut of a division
  against another cut of the same one, and matching a region to divisions in the first place.
  The last is where a change of base layer lands (ADR-0018, #587): every view is matched again
  to the new divisions, from its regions' outlines or by hand, and until a region is matched
  it has no bricks, is covered by nothing and keeps the ticks made on it.
- A visit and a manual row each gain two columns that are empty unless an edit of the map
  changed what they stand on.
- A counted tick turns lighter when its region gains children, and the count of regions falls
  by one until the traveller narrows it. The edit marks the tick, so the product says why.
- A view finer and sparser than the ticked region (leaves that are cities) paints nothing for
  that tick.
- A lighter tick that carries a trip ("France, 2003") stops being asked about once any region
  of France is counted, though where that trip was is still not known.
- The 95 % of decision 4 rests on how one base layer divides 22 countries and on an import
  that is 7 % matched. No two whole views exist to compare, and no cut. The slice that
  builds it measures the first second view once it is matched, and the first cuts.
- The vision's sentence that a station in Finland "marks neither Finland nor Moldova" and
  `docs/tech/world-views.md` § A hierarchy edit keeps every visit are rewritten when this is
  built.
- The exact coordinate of an own point is personal data held at full precision. Its protection
  is that nothing publishes, aggregates or logs it, which every later read must keep.
- A region replaced as an entity stays in the model, closed, and no rule carries a tick on it to
  the region that holds the ground today: Artsakh, ticked for 2019, is not Azerbaijan. How
  today's map shows that ground is still to design (decision 6).

## References

- Related ADRs: ADR-0018, ADR-0022, ADR-0069, ADR-0100, ADR-0197, ADR-0199, ADR-0202,
  ADR-0206, ADR-0207, ADR-0211, ADR-0217, ADR-0218
- Related docs: `docs/tech/experiences.md` § User visits, `docs/tech/world-views.md`,
  `docs/security/SECURITY.md`, `docs/vision/vision.md`
- Issues: #2579, #2580, #768, #1167, #1168, #1169, #1170, #1171, #1173, #773, #764, #2120,
  #2121, #2008, #1948, #1676, #616, #584, #2015, #1887, #606, #602, #2135, #594, #2594, #587,
  #770, #786, #2619, Epic #2115
