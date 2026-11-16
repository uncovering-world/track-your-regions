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
decisions 2 and 3 (an automatic row gains a mark of whether the place's own point put it there;
a curator's manual row is read into every world view, and outlives its region). No ADR records the refusal of #764 that decision 6 replaces; it is described in
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
and that every world view paints its regions from it. The maintainer decided on 2026-11-16 (#2579, two
decision comments) what a tick on a region refers to, what happens when that region goes, what a
tick on a record with no ground paints, and how a traveller says where inside a ticked region.
The same day the maintainer decided that visits are recorded and counted on **one layer of regions**, as
NomadMania does. That layer is the canon, which is still to be built: one layer, grouped into
larger regions above it and perhaps divided below it. Until it exists, the leaf layer of a
world view plays that part. A tick above the layer is a lighter kind of visit. This replaces
two lines of #768's direction of 2026-09-30, which is an issue and no ADR, so it is recorded
here: that a visit is "not recorded against a world view's region", for a tick on a region
only; and that it is not recorded against "an own atom id", since the canon's region is what a
region visit will refer to. A tick on a place stays a place with a coordinate. This ADR records
those decisions and the model they need.

The scenes it is built from:

1. A traveller has the Administrative world view on screen and clicks *Toscana*. It is painted
   at once, with Italy and Europe. Another, entering thirty countries on a first evening, clicks
   *France* and says no more; a week later they remember, and tick *Provence-Alpes-Côte d'Azur*.
2. The line under the tick offers to say where (#1170). The traveller skips it, or ticks the
   Uffizi from the region's places, or picks *Siena* from the list of settlements, or sets a
   point on a beach. Under *France* the same line offers France's places, its settlements and a
   point on its map, and nothing makes them choose.
3. They switch the picker to the Wikivoyage view and expect Tuscany painted there, with no
   second tick.
4. On the Louvre's card they tick the *Mona Lisa*, and the date offer asks when.
5. Months later an admin imports the Wikivoyage view again and deletes the old one. The
   traveller opens the map and expects their travels still on it.
6. A curator, on the card of thieboudienne, adds it to *Senegal*. The same import happens.

Measured on the development database on 2026-11-16, read-only:

- 10 place visits of one traveller, no trip, 5 works seen, **no region visit**, no note and no
  rating. No row of `experience_regions` is manual (73,643 are automatic), and no rejection
  names a region. Nothing here needs a data migration.
- The Administrative view has 3,831 regions in three levels (8, 237, 3,586), each with a
  geometry and exactly one division. 229 of its 237 countries are not leaves, so a tick on a
  country ("tick the countries visited", the milestone's criterion 2) is a tick on a region
  with children; today's writer accepts a tick on a region of any level. The Wikivoyage
  view has 4,301 regions and **none has a geometry** (4,003 are unmatched), so it lists no place
  and can paint nothing today, though it is public.
- A Wikidata item is no key of a region: the Administrative view carries none, and in the
  Wikivoyage view 768 items are shared by 2,147 regions (Armenia appears twice, Wyoming three
  times).
- Reading the regions of 2,000 visited places in the Administrative view took about 10 ms
  (6,402 rows of `experience_regions`, 1,017 regions; one run, a stand-in set).
- Testing which leaves of a view lie where Toscana's outline is took 2,164 ms against the
  outline itself (19,796 points) and 240 ms against its 160 subdivided pieces
  (`region_geom_pieces`). Toscana held 1.000000 of its own area and each of its five neighbours
  0.000000. A circle of 2 km around a point in Siena, through the index on the pieces, took
  10 ms.
- Eight regions, seven of them coastal (Umbria is landlocked), are drawn by both OpenStreetMap (`workbench.wikidata_geoshapes`, the
  import's shapes) and GADM. Their areas differ by 0.1 % to 1.3 %, so those shapes are cut at
  the shore. Intersected at about 1 km detail, each source's region holds 0.9816 to 0.9976 of
  the other's (242 ms for the eight).
- By their stored areas, the leaves under a country of the Administrative view together hold
  1.0000 of it, while single leaves are small: 68 of Turkey's 78 hold under 2 % of Turkey each,
  32 of Japan's 47, 3 of Italy's 20. A rule that reads single leaves' shares fails on a view
  finer than the ticked region.

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
  the layer. France is counted among countries, told apart from the placed ones as #1169 has it
  ("30 countries, 12 of them not yet placed"). It waits to be narrowed to a region, and #2594's
  guide helps.
- **The two kinds are the same row.** Which one a tick is follows from the predicate, and a
  canon that moves the layer re-reads every tick. A region that gains its first child leaves
  the layer, and its ticks read lighter from then on. The edit that adds the child marks them
  (`former_region_name`, decision 6), so the traveller is told why their count fell and a tick
  made lighter by the map is told apart from "France, I am not sure where".
- **A region with no outline cannot be ticked.** A region of an import that is not matched yet
  is not painted on any map, and nothing could be computed from a tick on it. The writer
  refuses the tick and says why. All 4,301 regions of the Wikivoyage view on the development
  database are in that state today.
- **A lighter tick is satisfied, and stays.** When the traveller who ticked *France* on the
  first evening ticks *Provence-Alpes-Côte d'Azur* a week later, France holds a counted region:
  the lighter tick stops waiting, and nothing asks about it again. The row is kept as history
  with any trip and note it carries ("France, 2003"), and it keeps France painted if Provence is
  later unticked. Narrowing it on purpose, through the guide or on its own row, moves it to the
  region with its trips and notes.
- **Below the layer** nothing is ticked: saying more is a place, a settlement or a point
  (decision 8).

**4. Another world view paints a region when that region wholly covers the ticked one.** In the
Wikivoyage view, a *Tuscany* with the same outline is painted, and so are Central Italy, Italy
and Europe above it. A view that holds only Tuscan provinces paints none of them and paints the
smallest region that holds all of Toscana. A tick on the Administrative *France* paints the
Wikivoyage France and nothing under it. In each view the tick is read by decision 3 on the
region that covers it there: counted where that region is on the view's layer, lighter where it
is above.

**The covering region is the smallest region of the view whose leaves together hold 95 % or
more of the ticked outline's land.** The share is divided by the land of the ticked outline,
never by its whole area and never by what the other view happens to hold:

- *The land of an outline* is the part of it that lies inside the base layer's country
  divisions (`administrative_divisions`, at their rung simplified to about 1 km). It is
  derived in the job that writes the answer and stored nowhere. A coast drawn out to sea, by an
  import's shape or by a curator's hand, then weighs the same as one drawn at the shore.
- The regions that hold 95 % lie on one branch, so the smallest is one region or none. Where
  none does, or the outline has no land, the view paints nothing for that tick.
- Two outlines are *the same* when each holds 95 % or more of the other's land.

Checked on:

- *The same Tuscany, drawn by two sources.* Measured on eight regions, seven of them coastal, that both
  OpenStreetMap (the import's stored shapes) and GADM draw: Toscana, Liguria, Umbria,
  Calabria, Sicily, Sardinia, Corsica and Crete. GADM's region holds 0.9920 to 0.9968 of the
  OpenStreetMap shape, and the shape holds 0.9816 (Crete) to 0.9976 of GADM's. So each is the
  other's covering region and the same outline, with room to spare at 95 % and almost none at
  98 %.
- *A coastal region drawn with its inshore sea*: its land is what Toscana holds, so Toscana
  covers it and is painted.
- *A region that is mostly sea by design*, an archipelago: its land is its islands, and the
  region that holds them covers it. A region of water alone has no land and paints nothing in
  another view; in its own view it is painted like any ticked region.
- *France in a finer view*, of départements or of 78 provinces as Turkey has: no leaf holds
  much, and the leaves under that view's France together hold all of it, so France is painted
  and nothing under it.
- *Tuscany in a view whose leaves are cities*: the cities hold a small part of Toscana's land,
  so no region covers it and nothing is painted there. Painting that view's Tuscany would claim
  the cities.
- *A region that straddles two regions of the other view*: the smallest region above both.
- *A region larger than anything in the other view* (a tick on Asia against a view of Japan
  alone): none, and nothing is painted.

The eight regions measured run from 5,400 to 25,700 km². A smaller region's border weighs more
against its area, so the 95 % is measured on small regions before it is fixed.

The answer is the same for every traveller who ticked that region, and it takes 240 ms to
compute for one leaf and one view, and longer for a region with children, whose outline is its
leaves' pieces together. A read cannot pay that for every tick, so the answer is kept in
`region_covers` (the ticked region, the other view, the covering region there and whether its
outline is the same). **It
is a derived cache and nothing else**: written when a region is first ticked or placed on and
after a view's geometry is computed, deleted with either region, and rebuilt from the outlines
at any time. Nothing a person said is stored per view.

**5. A tick on a place paints the regions its own point lies in**, in every view, through the
rows placement already writes (`experience_regions`). The Uffizi paints Toscana, Italy and
Europe. A station of the Struve Arc in Finland paints Finland and not Moldova; the Arc is shown
visited, "1 of 34", and paints nothing, because it holds no coordinate (ADR-0206). A place that
is also listed where its outline or its line reaches is painted only where its pin is. For that
an automatic row of `experience_regions` gains a new column, `of_pin`, which
`refresh_place_regions()` writes: true where the place's own point, or the nearest region to it,
puts it there. So a tick on the Øresund Bridge does not claim a country the traveller did not
name.

A tick on a record with no ground paints by its kind (#1676 declares which). An event held at
its place paints its region as "somewhere in": the Gion Matsuri paints Kyoto. A dish, a drink
and a class object paint nothing; the product asks where ("Where did you try it?"), and the
answer is an ordinary visit that paints: a region, a place or a point.

**6. A tick is never lost when its region changes or goes, and an edit is refused for it in one
case only.** A region whose members or outline change is the same region, and the tick stays on
it. When a region goes, the one writer of regions (`db/regionWriter.ts`) moves every tick on it,
in the same transaction, before the row is deleted. No region is kept for the sake of a tick,
and no outline is copied.

The tick moves to S, the region that takes the old one's place:

- in an edit inside a view, the region the edit hands the old one's land to (a merge's target,
  a flatten's parent), else its parent. This reads the tree and no outline, since the
  survivors' outlines are computed after the edit;
- when a whole view is replaced by a new import, the covering region in the replacing view,
  read from `region_covers`, where it has stood since the replacing view's geometry was
  computed. The confirmation dialog names the replacing view.

Decision 3 then says what the tick is:

- **The replacement is plain when the tick still counts**: S has the same outline, or S is on
  the counting layer. No question follows.
  - *The same region.* Tuscany after a re-import, with the same outline.
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

One exception keeps a tick exact: where `region_covers` shows a region of the same outline in
another view (the Administrative *Toscana* when the Wikivoyage Tuscany is split), the tick moves
there and stays counted, and the view that changed reads it by decision 4.

This replaces the refusal of #764: deleting, merging, flattening and pruning go through, and so
does replacing a view. **One refusal is left**: a ticked region that has no parent, no region
handed its land and no covering region in any other view cannot be deleted, since nothing would
be left to hold the tick. It is named by that condition and by no kind of region. It is met by
a root region whose land no other view covers; by a view replaced before its replacement's
geometry is computed, where no other view covers its ticked regions either; by a custom view of
ground the other views divide differently or not at all; and by the last world view. The
foreign key stops it, and the writer says which ticks stand in the way.

**7. A curator's placement of a record refers to a region the same way.** Thieboudienne added to
*Senegal* is a manual row of `experience_regions` on that region, as today, and like a tick it
is refused on a region with no outline. Every other view lists the record in the region that
covers Senegal and in the regions above it, through decision 4's rows, as a basis `named` of
`experience_shape_regions` (the interface ADR-0218 leaves for it). When Senegal goes, the same
transaction moves the row to S by decision 6, so the cascade no longer takes it. A placement
has no counting layer, so its replacement is plain only where S has the same outline. Anywhere
else the row carries the same two marks, and the question is a curator's, in the review queue,
with the new regions offered.

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
  region of a view, where that view draws the coast further in, paints nothing there.
- It is seen by its owner only: read and written under `/api/users/me`, never in a log, a URL,
  an error message or a tile, in no read across travellers, and deleted for good on request.
  The database is set to log no statement parameter. Rounding is not the protection.

**9. A region's visited state is read, never stored.** One read answers, for a traveller and a
view, which regions are painted and how: by a place (decision 5, and an own point), by a
counted tick, by holding a counted region, or only "somewhere in" (a lighter tick). The counts
read the same answer: regions of the layer that are counted, and the regions above them. A
derived state paints nothing: a whole visited through a part, an area visited through a place
inside it.

**What this leaves, and the interface each builds against.**

| Issue | It decides | It builds against |
|---|---|---|
| #2008 | The catalogue offered for a past trip | A trip's `year`, `month`, `day` under a visit of any of the four, read by `@tyr/shared/approximateDates`; ADR-0217 decision 8 |
| #1948 | Sections, the walk in kilometres, what a walk paints | A visit on the section's record; a row beside the trip for the kilometres and the two stops |
| #1676 | The kinds, their verbs, which kinds paint | A visit on a record of shape `none`; the kind's declaration read by decision 5; the answer to "where" as a visit of its own, linked from the record's visit when the first such kind is built |
| #616 | The country a visit was in | A trip's date and the visit's ground: the record's pin, the own point, or the ticked region's anchor. Not a table keyed on a region of one view |
| #584 | The depth of a region | The tick on a region as the row its marks hang on; the trips and marks of the places visited in it |
| #2015 | The marks per kind and type, and their grades | A table of marks under `user_visits`, each optionally tied to a trip; a plain tick has no row |
| #1173 | The local list of settlements | Decision 8: a pick writes an own point with the settlement's coordinate, name and size |
| #2594 | The guide that narrows a lighter tick to a region | The lighter ticks of a traveller that hold no counted region (decision 3); the regions of the layer under the ticked one, or `offered_region_ids` where a region went; its answer moves the visit to the chosen region with its trips and notes |
| #587 | The canon | `countedRegionSql`: the canon marks its layer and changes that predicate. A region visit then refers to a canon region |
| #1169, #1170, #1171 | How "somewhere in" is drawn and counted, the offer, the picker | Decision 9's read; decision 8 |
| #2135 | A border place in every country a source names | Decision 4's rows, for a region a source names |

## Alternatives Considered

| Option | Why rejected |
|--------|-------------|
| A shared table of areas (a name and a geometry in no world view), which a tick and a placement refer to | Proposed first in this design. The maintainer rejected it on 2026-11-16: the problem arises only when a ticked region changes, and at that moment the traveller can be asked. It adds an entity no screen shows, a find-or-make rule for "the same Tuscany" and a copy of GADM's or OpenStreetMap's outlines with their licences. |
| A point with a size for "somewhere in" | Rejected with it: a region already has an outline, and the traveller ticked the region, not a circle. |
| Keep a region that goes, with its outline, in an inactive holding world view until its ticks are answered | Proposed first in this design. It keeps the old outline, so a waiting tick paints every view exactly as before. It costs dead regions no reader may see, a view that exists to hold them, a later pass to re-home them and their outlines on the public tile server. Re-pointing in the same transaction loses one thing: where no view holds a region of the same outline, a waiting tick paints the coarser region until the traveller answers. |
| A copy of the outline on each waiting visit | One copy per traveller of a 19,796-point polygon, and a second way to paint. |
| A tick only on the counting layer | 229 of the Administrative view's 237 countries are not on it, and the milestone asks to "tick the countries visited". The maintainer decided on 2026-11-16 that a tick above the layer is a lighter visit. |
| A column on the visit that says counted or lighter | It would be written at the tick and go stale when a region gains children or the canon moves the layer. The predicate reads it from the region. |
| A column on the world view that names its counting layer | It would hold one value until the canon exists. A predicate with one owner is the room the canon needs. |
| Remove a lighter tick once a region inside it is ticked | "France, 2003" may be another trip than Provence last week, and unticking Provence would then leave France unpainted. Satisfied is read, and the row stays. |
| Ask "was this where you were in France?" after every tick inside a lighter one | A question on a one-click tick, for a row that changes neither the map nor the counts once France holds a counted region. |
| A waiting mark on a tick re-pointed after a split | Such a tick is a lighter tick, which waits by what it is. What is kept is the name of the region it counted on, so the product can say what changed. |
| The covering region as the smallest region above every leaf that holds 2 % of the ticked outline | This ADR's first wording. It has no answer when the other view is finer: 68 of Turkey's 78 provinces hold under 2 % of Turkey each. |
| Take the share of the ticked outline's whole area | An outline drawn out to sea, by an import's shape or a curator's hand, is held under the threshold by every land-only region, so the tick paints nothing in the other view and has no covering region when its view is replaced. |
| Take the share of the part of the outline that the other view's leaves hold | A view whose leaves are cities holds all of what it holds, so its Tuscany would be painted and the cities claimed; a view of Japan alone would cover a tick on Asia. |
| A threshold of 98 % | Measured on eight regions two sources drew, the lowest share is 0.9816. |
| Allow a tick on a region with no outline, and match it by its member divisions or its source's id | No map paints such a region, so no scene makes the tick. Measured, 251 of the Wikivoyage view's 4,301 regions have a member division, and 768 of its source ids are shared by 2,147 regions. |
| Compute the mapping from the outlines when a region goes | An edit clears the outlines of the regions above it until they are computed again, and a region about to be deleted may hold none at that moment. The tree and the cache are both there. |
| Keep the refusal of #764 | A curator's edit fails because of a traveller they cannot see, and an import still cannot replace a view without deleting visits after a count. |
| Record the tick against administrative divisions | #768 rejected a substrate unit. Measured, 251 of the Wikivoyage view's 4,301 regions are tied to divisions, and the Administrative mirror is a stopgap (ADR-0018). |
| Record it against a stable key of the region (a Wikidata item) | #768 rejected an atom id. Measured, the Administrative view carries no item and 768 items are shared by 2,147 Wikivoyage regions. |
| Compute the covering regions on every read, with no cache | 240 ms for one leaf and one view (2,164 ms against the outline itself). A traveller with thirty ticks would wait about seven seconds for the map of another view. |
| One table per thing visited, with a shared shape | A trip, a mark, #1887's question, a journey entry (#606) and the export would each need one of four parents. The table split is what #2120 removed for places. |
| The traveller's own point as a private row of `experiences` | Location data about a person in the catalogue's main table, which 29 tables reference and every public read scans. One missed predicate publishes it. |
| Round the own point to about 100 m | Proposed first in this design. The radius states uncertainty, and privacy fails at publishing and aggregating, not at stored precision (the session's research report on location input, 2026-11-16). |
| Move a split region's tick to the part that holds a place the traveller ticked | The maintainer named a split as a case to ask. The screen may offer that part first. |
| A tick on a place paints every region the place is listed in | A wide area or a long line is listed in every region it reaches; ticking it would claim them all. |

## Consequences

**Positive:**

- Each case #2579 names is held: the Uffizi on two trips, "somewhere in Tuscany, around 2015",
  the *Mona Lisa*, a section of the Camino de Santiago as a record, thieboudienne tried and
  asked where.
- One tick shows in every world view, and no import, merge, flatten or split loses it. None of
  them is refused for it, but for the one case decision 6 names. The milestone's "re-import a world view: no visit is lost" needs no special path.
- A curator's placement survives the same way, and reads in every view.
- ADR-0199's read, ADR-0202's trips and the date offer, ADR-0206 and ADR-0211's `whole_leaves`
  and "k of N", the merge's carry of visits and #1887's question keep their logic. The visited
  set of 2,000 places (7.3 ms, #2121) is read from the same index.
- The 409 path of every region writer and `db/regionVisits.ts` go. No dead region, no hidden
  world view and no outline of a region that is gone is kept.

**Negative / Trade-offs:**

- `user_visited_experiences` is renamed, through the generated types, the lint rules and the
  API's visit reads.
- Where a region goes and no view holds one of the same outline, a waiting tick paints the
  coarser region that covers it, in every view, until the traveller answers: Tuscany split in a
  view that stood alone would leave Italy painted and Toscana not.
- A view can be replaced without a question only once the replacing view's geometry is
  computed, since the mapping is read from `region_covers`. Replaced earlier, every tick moves
  to another view's covering region, or the delete is refused (decision 6's one refusal).
- A tick on a region with no outline is refused, so nothing can be ticked in a view whose
  import is not matched, though the view may be public.
- `experience_regions` gains a column, `of_pin`, on its automatic rows.
- `region_covers` is a derived cache that placement must keep in step after a geometry
  computation. Until a view has geometry, nothing is painted in it and no tick moves into it:
  the Wikivoyage view on the development database is in that state.
- A visit and a manual row each gain two columns that are empty unless an edit of the map
  changed what they stand on.
- A counted tick turns lighter when its region gains children, and the count of regions falls
  by one until the traveller narrows it. The edit marks the tick, so the product says why.
- A view finer and sparser than the ticked region (leaves that are cities) paints nothing for
  that tick.
- A lighter tick that carries a trip ("France, 2003") stops being asked about once any region
  of France is counted, though where that trip was is still not known.
- The 95 % of decision 4 rests on eight regions two sources drew, none under 5,400 km². The
  slice that builds it measures small regions, and regions inside a view once the Wikivoyage
  view has geometry.
- A region of water whose outline clips a strip of coast is covered by whatever region holds
  the strip. Its outline is what a curator corrects.
- The cover job reads the base divisions as well as the two views, to take an outline's land.
- The vision's sentence that a station in Finland "marks neither Finland nor Moldova" and
  `docs/tech/world-views.md` § A hierarchy edit keeps every visit are rewritten when this is
  built.
- The exact coordinate of an own point is personal data held at full precision. Its protection
  is that nothing publishes, aggregates or logs it, which every later read must keep.

## References

- Related ADRs: ADR-0018, ADR-0022, ADR-0069, ADR-0100, ADR-0197, ADR-0199, ADR-0202,
  ADR-0206, ADR-0207, ADR-0211, ADR-0217, ADR-0218
- Related docs: `docs/tech/experiences.md` § User visits, `docs/tech/world-views.md`,
  `docs/security/SECURITY.md`, `docs/vision/vision.md`
- Issues: #2579, #2580, #768, #1167, #1168, #1169, #1170, #1171, #1173, #773, #764, #2120,
  #2121, #2008, #1948, #1676, #616, #584, #2015, #1887, #606, #602, #2135, #594, #2594, #587,
  Epic #2115
