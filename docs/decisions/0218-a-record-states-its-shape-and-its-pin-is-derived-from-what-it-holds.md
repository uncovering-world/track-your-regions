# ADR-0218: A record states its shape, and its pin is derived from what it holds

**Date:** 2026-11-16
**Status:** Draft
**Issue:** [#2577](https://github.com/uncovering-world/track-your-regions/issues/2577), Epic #2115
**Built by:** #2577, #505, #2248, #1948, #1676, #2582, #2583, #2579, #2580, #2125, #1969, #2623
**Narrows (once accepted):** [ADR-0210](0210-a-dispersed-whole-holds-no-point-and-every-line-of-a-serial-site-is-a-part.md)
decisions 1, 2 and 5 (a whole's two shapes, the row constraint, and "every reader asks the
column");
[ADR-0207](0207-a-places-regions-come-from-its-own-geometry-and-a-point-no-region-holds-takes-its-nearest.md)
decision 1 (when an outline is tested as the place's own, and its `line` basis, which places a
record only by a line that is its own);
[ADR-0212](0212-the-openstreetmap-layer-keeps-whole-the-objects-of-a-bridges-item-and-its-line-places-it.md)
decision 4 (the same: every place that holds a line of its own);
[ADR-0206](0206-one-visited-place-visits-the-whole-which-reads-k-of-n-over-its-offered-leaves.md)
decision 2 (when a leaf is offered, only for a leaf that has no point: by its record in its
whole; a leaf that has a point is offered as that decision has it) and decisions 2 and 3 (a
part that has a shape of its own and parts of its own is counted as one place of the whole above
it, decision 2);
[ADR-0203](0203-a-place-made-of-parts-is-never-merged-and-claims-no-item.md)
decisions 1, 3 and 5 ("claims no item", "never merged" and what the join leaves out hold for a
record with parts and no shape of its own, decision 13; and a curator's answer "the same group"
is the one way a kind's record comes onto such a record, decision 14) and decision 6 (the check
`merge-onto-a-whole` leaves out a merge that records such an answer, decision 14);
[ADR-0086](0086-a-merge-is-a-record-that-moves-a-place-into-another-and-back.md)
decision 2 (in a "same group" answer the serial object stays, whichever id is lower,
decision 14);
[ADR-0150](0150-wikidatas-part-of-answers-a-near-pair.md)
decision 1 (a statement answers a near pair without a curator only toward a record that already
has parts, decision 14)

---

## Context

A record of the catalogue cannot say what it is on the ground. The schema infers it from a
missing point: `experiences_location_iff_not_dispersed` allows a place no coordinate only when
it is a dispersed whole (ADR-0210 decision 2), and every reader takes `location IS NULL` to
mean "a dispersed whole" (decision 5). The maintainer decided on 2026-11-16 that the whole
catalogue model is designed before a fresh database fixes the schema, and four things do not
fit it:

- **An area a traveller is inside.** The maintainer decided on 2026-10-28 that a place a
  traveller stands inside is shown by its own outline, with a point only while no outline is
  held (#2125). The constraint forbids that.
- **A line a traveller goes along** (#1948). The Canal du Midi runs 240 km and is held as one
  point in Toulouse.
- **A record with no ground of its own** (#1676): thieboudienne in Senegal, the Gion Matsuri
  in Kyoto.
- **The points a traveller arrives at** (#505): an entrance, a visitor centre, a trailhead. The
  maintainer said on 2026-11-16 that a World Heritage area or a nature reserve needs its
  outline and its arrival points together.

Measured on the development catalogue on 2026-11-16, read-only:

- Of 24,383 rows not merged away, 22,119 hold a point only, 1,583 a point and an outline (all
  drawn by Archaeology), 188 a point and a line, 7 all three, and 486 are wholes with no point.
  *Offered* rows (an admitted record in a kind that is not pending) number 4,019.
- All 486 wholes are `dispersed`, and each holds a World Heritage record. **No `container`
  whole exists.** Museum Island and Naqsh-e Jahan Square (*Meidan Emam, Esfahan*), the places
  #2125 names as containers, are plain rows with a point and no parts.
- 214 offered World Heritage places that are not wholes are inscribed with 100 km² or more, 115
  with 1,000 km² or more and 39 with 10,000 km² or more. Yellowstone, the Serengeti and the
  Great Barrier Reef are among them, each as one point. Five of the ten offered places that no
  region lists are such areas at sea.
- The Canal du Midi is place 532: offered as a World Heritage Site and, on the same row,
  refused in Bridges & engineering marvels as "a canal: a long object". 58 canals carry that
  refusal. So one row is a point for one kind and a line for another.
- The 1,591 outlines held run from a 20 m² footprint to 774 km² (624 under 1 ha), and 100 of
  them lie more than 1 km from their place's point and are another object (ADR-0207). Holding
  an outline does not make a place an area.
- 325 places already stand inside another place's outline of 1 ha or more.
- 29 tables reference `experiences(id)`, through 37 foreign keys.
- The coverage surveys (27 regions, 5,633 entries) file 402 entries under food, 402 under
  activities, 244 under events and 107 under routes. A festival names a venue in 95 of 237
  entries, a dish in 4 of 402. Of the 107 routes, 41 are itineraries ("Golden Triangle: Delhi,
  Agra and Jaipur"), which are lists of places and not lines.

Two rulings of the maintainer followed, and this Draft is amended to them (the last note under
the Decision says where). On 2026-11-16 (#2581, #2248) the maintainer decided when a visit to a place ticks
a type of thing: only where the place is in the catalogue as a place of that type, as Noratus
cemetery is the field of khachkars. On 2026-11-16 and 2026-11-17 (#2578) the maintainer decided that nothing
is put into the model that a curator would have to enter from nothing: every fact a curator sets
has a source that proposes candidates, which the curator confirms, corrects or refuses.

So the same catalogue was read on 2026-11-16 for what could propose each fact a curator sets
here, with the Wikidata subset, the OpenStreetMap layer (`workbench.osm_objects`, joined by its
`wikidata` tag) and the English Wikivoyage pages the workbench holds. "Read by hand" is a
reviewer's reading of the named places, with no outside page fetched.

- **A shape.** OpenStreetMap holds an object for 3,340 of the 4,019 offered places, and a way or
  a relation for 2,960. Of six read by hand it draws five as what they are: Yellowstone a
  protected-area polygon, Naqsh-e Jahan Square a `place=square` multipolygon, the Canal du Midi a
  waterway relation, Hadrian's Wall a set of `historic=wall` ways, Museum Island a site relation.
  Pompeii is a locality node only.
- **An outline.** The layer keeps a polygon for 124 of the 214 wide World Heritage areas
  (Yellowstone among them) and nothing for 90.
- **Arrival points.** A tourist information office or a visitor centre stands near 126 of the 214
  in the layer, counted in a box around the point, so some belong to a neighbour. The layer's
  selection (`LAYER_SELECTION`) keeps `tourism` and not `entrance`, `barrier` or
  `highway=trailhead`, so a gate or a trailhead is held for 24 of the 214, and only because
  another tag kept it. English Wikivoyage has a page of its own for 117 of the 214, and 8 carry
  entrances as typed markers with coordinates: all five of Yellowstone's. Wikidata states an
  entrance coordinate on one offered place. Of five areas read by hand four have a proposal
  (Yellowstone, the Grand Canyon, the Serengeti, Plitvice) and Tsingy de Bemaraha has none.
- **Parts.** 965 offered places state a whole in Wikidata, and for 406 the whole has a record.
  81 items name the Canal du Midi as their whole, the Fonserannes locks among them. Museum
  Island's item names no part, and the Neues Museum names the museum authority as its whole.
- **The places a type is met at.** Of 8,781 khachkars, 7,370 state where they are, and they name
  35 records of the catalogue, 12 of them offered. The five with the most are right: Etchmiadzin
  Cathedral (47), Tatev (15), Goshavank (11), Geghard (10) and Sanahin (6). Noratus is not among
  the 35: the item of its article is the village, no khachkar names it, and it has no record.
- **A region by name, and an event's place.** Of eight dishes read, Wikidata's country of origin
  is right for six (thieboudienne, Senegal), coarse for paella (Spain) and wrong for khash
  (Iraq). Seven of nine festivals state a location: the Gion Matsuri at Yasaka Shrine.

A third ruling followed on 2026-11-17, recorded in two comments on #2581
([the maintainer's words on identity, geography and "part of"](https://github.com/uncovering-world/track-your-regions/issues/2581#issuecomment-6943049715) and
[the decision on Khajuraho](https://github.com/uncovering-world/track-your-regions/issues/2581#issuecomment-6943873765), the second also on #2126), and the Draft is amended to it in
decisions 2, 13 and 14:

- a Wikidata item and a coordinate are separate things: a serial site has no coordinate of its
  own and may still hold an item, which is the link to the article that describes it as a whole;
- a serial object and an extended object are different: the first has no geography of its own
  and consists of its points, the second (a large square, a long canal) is an entity of its own
  on the map and may also hold other places as its parts;
- two places are not merged because they share a Wikidata item. A shared or carelessly set item
  is a hint that proposes "one is a part of the other";
- Khajuraho: Places of worship's "Khajuraho Group of Monuments" and the serial World Heritage
  site of that name are the same 15 temples, and a traveller sees one whole offered in both
  kinds, one card, "3 of 15". Making them one is a curator's answer and never automatic.

Read on the development catalogue on 2026-11-17, read-only, with the items checked against the
Wikidata subset:

- 50 admitted records of the Wikidata kinds that a curator has read carry an item that a serial
  World Heritage site holds without being found by it (ADR-0203 decision 1). Khajuraho
  (Q167298) is one: the site has shape `none` and 15 parts, and the Places of worship record is
  a second place, a point.
- Three records were joined onto a serial site by an equal item in October 2026 and separated
  by a curator on 2026-11-13 (ADR-0203 decision 6). Archaeology's Baalbek carries Q178835, which
  is Wikidata's item for the city. Archaeology's Mausoleum of the First Qin Emperor (Q910180)
  stands 34 m from the component of that name, 441-001, one of its site's two. Bridges' Rideau
  Canal (Q651323) carries the item of component 1221-001, one of its site's six.
- All 5,645 part relations come from the World Heritage list. 69 near pairs are answered
  *part of*, 29 by a curator and 40 by the catalogue from a Wikidata statement (ADR-0150), and
  none of the 69 is a relation: the answer is kept on the pair and writes nothing. None of the
  69 names a record that has parts as the whole, since the pairing pass leaves every record
  with parts out.
- The Canal du Midi (Q202494) is one place found by its item, with no parts. The item of the
  Fonserannes locks (Q586271) states "part of" toward it.

## Decision

**1. A record states its shape** (`experiences.shape`), which says what the record itself is on
the ground:

| shape | the traveller | examples |
|---|---|---|
| `point` | goes to it | the Uffizi; Charles Bridge; a dolmen |
| `area` | is inside it | Naqsh-e Jahan Square; Pompeii; Trastevere; Yellowstone; one component of the Wadden Sea |
| `line` | is on it, or goes along it | the Canal du Midi; Nevsky Prospect; the Øresund Bridge; the Ring of Kerry; the GR 65 |
| `none` | meets it at places, or in a region | the Struve Geodetic Arc; thieboudienne; the Gion Matsuri; the khachkar |

The shape is the record's and not a kind's (ADR-0084): the Canal du Midi is a line whichever
kind offers it. It is a statement about the thing, and the geometry columns say what the
catalogue holds of it. Yellowstone is an `area` while only its point is held. The column is
`NOT NULL`, and its four values are a closed set.

**2. Having parts is a second fact, and not a shape, and what a record is is a third.** A
record holds three facts, and none of them is read from another (the maintainer, 2026-11-17,
[#2581](https://github.com/uncovering-world/track-your-regions/issues/2581#issuecomment-6943049715): "a Wikidata item and a coordinate are separate things"):

- **what it is**: the catalogue's own id, and the outside items that link to its articles. A
  Wikidata item is the link to the article that describes the record. It says nothing of where
  the record is, a record with no ground of its own may hold one, and an equal item on two
  records does not by itself make them one (decisions 13 and 14);
- **where it is**: its shape (decision 1), which is a point, an area, a line, or none;
- **what it consists of, and what it is a part of**: a record of any shape may have parts and
  may be a part (`experience_parts`, ADR-0198). `whole_shape` goes.

A record with parts has one of two forms, which the maintainer's words of 2026-11-17 keep apart:

- **a serial object** has shape `none` and parts. It has no geography of its own and is shown
  by its parts. The Struve Geodetic Arc is its 34 points; the Wadden Sea is its components, each
  of them an `area`; a serial World Heritage site is always one (decision 3);
- **an extended object** has a shape of its own, and parts. Museum Island is an `area` with
  parts (the Neues Museum, by a curator's answer). The Canal du Midi is a `line` with parts: the
  Fonserannes locks, by the maintainer's decision of 2026-11-16 (#2577) that a lock is a part of
  its canal. The locks are offered among locks and are a part of the canal.

"Shown by its parts" is a serial object: it has no pin of its own, and a direct tick on it
reads "? of N". An extended object is ticked for itself, and "k of N" stands beside the tick
where it has parts.

**A part that is itself an extended object is counted as one place of the whole above it.**
Once Bridges' Rideau Canal and component 1221-001 of the Rideau Canal site are one place
(decision 14), that place is a `line`, a part of the site, and its lock stations may become its
own parts. A traveller who ticks "I was on the canal" has been to one of the site's six parts,
and the site reads "1 of 6". ADR-0206 decisions 2 and 3 count only places that have no parts and
read a tick on a nested whole as "?": they stand for a nested serial object (Hadrian's Wall
within the Frontiers of the Roman Empire, #2126, a collection of its forts of shape `none`, #1723) and are narrowed for a part
with a shape of its own. This rule is the session's design of 2026-11-17: it follows from the
maintainer's ruling of the same day on the two forms and from "ticked for itself" above, and no
ruling states it.

**A site's count follows its source's list of components.** The Rideau Canal is one of its
site's six, and its lock stations are not counted there: a visit to a lock station is a visit to
the canal, and through it to one of the six. The session closed this on 2026-11-17 (#2619 line
1.17), open to the maintainer's veto.

**A part can hold what a visitor finds there** (the maintainer, 2026-11-17,
[#2059](https://github.com/uncovering-world/track-your-regions/issues/2059#issuecomment-6947367409)): something to
see, unknown, or nothing to see, with who proposed the value and who confirmed it. Köln-Alteburg,
a component of the Lower German Limes, is a Roman fleet base under a residential street of
Cologne. The model holds the fact so that the fresh database needs no migration for it, and
nothing more is decided here: what the map shows by default, which signals propose a value and
what a traveller reports are #2059's, decided when it is built, after a study of the catalogue's
own points.

**3. The default shape comes from one function, and a curator may pin it.**

- A record the World Heritage list gives components to is `none`, whatever the walk between
  them (Würzburg's two, 159 m apart).
- A record a curator confirms as a series is `none` at once, before any part arrives (the
  maintainer, 2026-10-28, #2126: "a confirmed series is a whole at once: no coordinate, its row
  stays in lists, nothing drawn while no part is shown"). The Egyptian pyramids, whose pin stands
  at an arbitrary point in Cairo, lose it on the answer. The row stays in its kind's list, and in
  its regions through the point its kind record reports (decision 11), and nothing is drawn for
  it until a part is shown. This replaces the Draft's reading, the session's, that the pin
  stayed until a first part made the record `none`. #2133 names what a confirmed whole with no
  part is, which a class object (decision 9), also `none` with no parts, is not.
- A `point` that gains parts becomes `none` when they lie more than 1 km apart and an `area`
  otherwise, as ADR-0210 decision 1 had it for dispersed and container. An `area` or a `line`
  that gains parts from any other source keeps its shape.
- Otherwise the shape is what the record's kinds declare for its type (the type vocabularies
  of `@tyr/shared`): a square is an area, a street a line, a dish none. Where two kinds of
  one place differ, a line stands over an area, and an area over a point.
- A bridge, a tunnel, a causeway or a dam is a `line` where the structure spans 1 km or more
  from end to end, and a `point` otherwise or while no line is held. The span is the greatest
  distance between two points of the line ADR-0212 holds for it, never its summed length,
  which counts both carriageways, both tubes or the ring of an outline: Charles Bridge's line
  sums to 1,760 m and spans 503 m. The Øresund Bridge (8.3 km), the Channel Tunnel (48 km),
  Itaipu's dam (5.2 km) and the Golden Gate Bridge (2.8 km) are lines: no one point is where
  they are, and a source's coordinate for them stands mid-water or at one end. Charles Bridge
  and Tower Bridge (322 m) are points a traveller goes to, each with its line as a drawing.
  Of the 195 lines held on 2026-11-16, 55 span 1 km or more. The tick is the same on both,
  "I was on it", so the rule decides only the pin and the drawing. The slice that writes the
  defaults confirms the span.
- A curator pins the shape from the record's card (`shape_pinned_by`, `shape_pinned_at`),
  and the pinned shape stands over every rule here but the first: a serial World Heritage site is
  `none` (the maintainer, 2026-10-28).
- Hadrian's Wall stays a collection of its forts, shape `none` (the maintainer's decision of
  2026-10-19, #1723, and #2126). The Hadrian's Wall Path, walked for 135 km, is a trail record of
  its own (#1948).

Which types are areas, and from what size, is measured in the slice that writes the defaults.

**4. A row constraint holds the shape to the point** and replaces
`experiences_location_iff_not_dispersed`:

```sql
CHECK (CASE shape
    WHEN 'point' THEN location IS NOT NULL
    WHEN 'area'  THEN location IS NOT NULL OR boundary IS NOT NULL
    WHEN 'line'  THEN location IS NOT NULL OR path IS NOT NULL
    WHEN 'none'  THEN location IS NULL
    ELSE false
END)
```

`location` is the record's coordinate: a claim, with each source's view on its record, a
curator's correction and the gate. An `area` holds one until it holds an outline of its own,
and a `line` until it holds a line of its own (decision 6); the trigger of decision 5 keeps
that, since a row constraint cannot tell whose an outline is. Naqsh-e Jahan Square with its
outline holds no coordinate, and no curator is asked which of two sources' points is the
square. So on an area or a line, an empty coordinate says "the outline, or the line, held is
its own". A record of any shape may hold an outline or a line that is only a drawing: Charles
Bridge's line, a dig's outline on a `point`, the Mausoleum of the First Qin Emperor's outline
on a record of shape `none`.

**5. Every record with a shape has a pin, derived and never claimed** (`experiences.pin`). It
is the record's coordinate where it holds one; else a point on the surface of an `area`'s
outline, or the point of a `line`'s line nearest its middle; and empty on `none`. So it is
the coordinate or stands on geometry that is the record's own. One trigger writes it with
`extent` (the box of the outline or line held) and `shape_min_zoom` (the zoom from which that
reads on screen), and nothing else does. It is what a marker, the heat map, crowding, a
distance and the near-places pass read, in the one indexed point column the markers read uses
today. It is not a source's view, no curator moves it, and no question is asked about it.

The pin is an output only. No rule that decides a shape, an outline, a line or a coordinate
reads it. Where a rule needs a point for a record that holds no coordinate, it reads the
record's **reference point**: the coordinate a curator claimed, where one is kept; else the
point its kind records report, an admitted record's before a refused one's, and among those
the kind with the lowest id. The Canal du Midi's is its World Heritage record's point; where
its canal record reports another, that difference is a question between two sources' views,
as on any place.

**A curator's coordinate is not dropped.** A curator's claim is the place's own today: the
value stands in the place's column and `curated_fields` names the column (ADR-0029,
ADR-0077). So when an outline or a line takes away a coordinate a curator claimed
(`curated_fields` holds `location`), the trigger moves it to a column of the place,
`experiences.claimed_location`, and the claim stays in `curated_fields`. It is the first
reference point, and it is what the record takes back, still claimed, so no run overwrites
it. A curator who moved the Øresund Bridge's point onto its deck gets that point back if the
line goes, and the Pergamon Altar's outline is tested against a curator's point in Berlin
where one was set. No record of a source carries it, and ADR-0198 stands as it is.

**The same trigger runs on every insert, every change of shape and every write of a
coordinate, an outline or a line**, whoever makes it: a run, the default rule of decision 3,
a curator's pinned shape, a part gained or lost. The shape is taken as stated and is never refused or
changed by the trigger; what the trigger settles is the coordinate:

| The record is | and holds | its coordinate |
|---|---|---|
| an `area` | an outline of its own (decision 6) | is emptied, and the pin stands on the outline |
| an `area` | no outline, or one that is not its own | is kept, or taken back as below. An outline that is not its own stays a drawing, and the check `outline-away-from-its-place` names the record |
| a `line` | a line of its own (decision 6) | is emptied, and the pin stands on the line |
| a `line` | no line, or one that is not its own | is kept, or taken back as below. A line that is not its own stays a drawing, and a check names the record |
| a `point` | anything | is kept, or taken back as below. An outline or a line is a drawing |
| `none` | anything | is emptied. An outline or a line is a drawing |

So the stated shape and the pin cannot disagree, whatever came first. Museum Island, a point
a curator states an area, keeps its coordinate until its outline is held. An Archaeology
record that arrives as an area with another object's outline is an area that holds its
coordinate. A bridge becomes a line when a line spanning 1 km arrives and a point again when
that line goes. A part gained changes nothing on an `area` or a `line`; on a `point` it may
change the default shape (decision 3), and the row then follows the table. A record that loses
its last part takes its default shape again, unless a curator pinned its shape: an area its
parts made is a point again, as a record of shape `none` is, and an area or a line its kind
states stays one.
The trigger runs on a write to the record. Where a source later moves the reference point away
from an outline already taken as the record's own, the check names the record, and the next
write to it settles the row.

**A record that must hold a coordinate again takes back its reference point.** That is an
area or a line whose own outline or line goes, an area or a line that becomes a point, and a
record of shape `none` whose default is a shape again after it loses its last part. Where it
has no reference point:

- a record of shape `none` keeps its shape, and a check names it (ADR-0210 decision 2's rule,
  kept);
- an area or a line with no kind record and no claimed coordinate is a curator's own. Only a
  curator removes its outline or line or changes its shape, and that edit names the
  coordinate. The constraint refuses the write otherwise.

**6. An outline or a line takes a record's coordinate away only when it is the record's
own.** One test each, run by the trigger of decision 5 and by nothing else:

- an outline is the record's own when it holds the record's point or lies within 1 km of it
  (`outline_reaches_place()`, ADR-0207);
- a line is the record's own when it passes within 5 km of the record's point
  (`line_reaches_place()`, at the distance ADR-0212 decision 2 takes a bridge's objects from);
- an outline or a line a curator claimed (`curated_fields` holds `boundary` or `path`) is the
  record's own by the curator's word.

The record's point is its coordinate while it holds one, and its reference point after. Both
are a claim, a curator's or a source's, and never the pin. `writeLines` measures its 5 km from
the same point, so no line sets the radius its replacement is found in, its lines pass the
test by how they are gathered, and ADR-0212 decision 2 stands as it is. Every other writer of
a line, a canal's or a trail's (#1948) or a source's view chosen for the place (#2583), writes
`experiences.path` and is held to the same test by the trigger. The Pergamon Altar's outline,
which is the ancient city's in Izmir, takes no point away, on the altar as a `point` or on any
record a curator states an `area`.

What may be written as a record's outline is the outline of the record itself: a World
Heritage site's inscribed property and not its buffer zone, a square's own surface, a town's
built quarter and not its commune. A buffer zone, where one is kept, is another kind of view
of #2583's and is not the record's `boundary`.

**7. A record holds the points a traveller arrives at, beside its shape**
(`place_arrival_points`): none, one or several, each with a role (`entrance`,
`visitor_centre`, `ticket_office`, `trailhead`, `landing`), a name, a coordinate, and at most
one marked main. The maintainer asked on 2026-11-16 (#2577) that the model hold these points
beside the shape and say which point the pin and a navigation link use; the answers below are the
session's.

- They are not parts. An arrival point has no card, no kind, no tick, and places its record in
  no region.
- A record of any shape but `none` may hold them: Yellowstone its five entrances; the
  Serengeti its Naabi Hill gate; the Uffizi its door, where that is not where its coordinate
  is; a trail its trailheads. Each part of a serial site holds its own, and the site none.
- **A navigation link goes to the main arrival point**, else to the only one, else to the pin
  (the targets of ADR-0115). The card lists the others. At close zoom the map draws the open
  record's arrival points as small marks.
- **The pin never moves to an arrival point.** Yellowstone's North Entrance is at Gardiner,
  Montana, on the park's edge; the Canal du Midi starts in Toulouse, at one end of
  240 km, which is the defect #1948 was filed for. A pin there would say where to go in and
  not where the thing is.
- **They are proposed, and a curator answers** (the maintainer's principle of 2026-11-16 and
  2026-11-17, decision 12; the Draft's first text had a curator set them, with a helper or a run
  that might propose). Two sources propose them. The OpenStreetMap layer gives visitor centres
  and information offices today, and gates and trailheads once its tag selection
  (`LAYER_SELECTION`) keeps `entrance`, `barrier` and `highway=trailhead`. The typed markers of
  English Wikivoyage's pages give entrances with their coordinates: Yellowstone's five. The role
  follows from the tag or the marker. The main one has no source and is the curator's choice
  among the proposed points. An AI helper (ADR-0016, ADR-0087) may suggest an answer on the card.
  A reader sees a proposal only once a curator has confirmed it, and one read from OpenStreetMap
  names its object (ADR-0059). The card's section is built with its proposals, and not before.
- No row is written by default. A check lists the arrival points a source proposed and no
  curator has answered, on a record of any shape, which is the "still unchecked" list #505 asks
  for, without a copy of the source's point on every museum.
- An area no source proposes an arrival point for is counted, and no curator is asked: Tsingy de
  Bemaraha in Madagascar, for which neither the OpenStreetMap layer nor English Wikivoyage
  proposes one. Its navigation link goes to its pin. That follows from the maintainer's principle
  that a curator enters no fact from nothing (decision 12), and #2619 line 1.15 closed it so on
  2026-11-17; the reading is the session's.

**8. A record that is not a place is a row of `experiences` with shape `none`,** in the kind
that offers it. It keeps the name, picture and credit, source records, admission, gate, review
queue, merge, curation log, region rows, parts and visit that every other record has. Its
dates hang on its own row: the Gion Matsuri holds a season (1 to 31 July), and Holy Week in
Seville is a record of its own (ADR-0217 decisions 2 and 9, which left the row to #1676). A
`held` period of one year is a word of that vocabulary which nothing writes until a source gives
a year's dates (ADR-0217 decisions 9 and 13). UNESCO's "Yama, Hoko, Yatai, float festivals in
Japan" is a record of shape `none` whose 33 parts are festivals, the Gion Matsuri among them.
Such a part has no point, and ADR-0206 decision 2 offers a leaf "when a reader is shown one of
its points", so none of the 33 would be counted. A leaf that has no point is therefore offered by
its record in its whole, where that record is one a reader is shown (ADR-0213 decision 1): a
traveller who was at the Gion Matsuri reads "1 of 33" on the float festivals. The rule reaches no
further. A leaf that has a point is offered as ADR-0206 decision 2 has it, by a point a reader is
shown, and this ADR moves no count of such a leaf: Seville Cathedral, were a curator to refuse
its record in Seville's site while another kind still showed its point, is counted or not exactly
as it is today. Whether such a leaf should follow its record too is asked when the point tables
go (#2124), and not here.

This decision was checked on three forms of the register of kinds
(`db/catalogue-coverage/kinds.jsonl`): food (eight dishes read, thieboudienne among them), event
(nine festivals read: the Gion Matsuri, Holy Week in Seville, the float festivals) and a type met
at places (the khachkar, decision 9). It was not checked on the register's other forms: drink,
activity, title, person, species, object and sound, nor on the itineraries filed under route
("Golden Triangle: Delhi, Agra and Jaipur"), which are lists of places and not lines (#1948).
#1676 writes the mapping of every form, with real entries for each. A species whose season
differs by region ("Puffins in Iceland in June") may ask for a season per region, which nothing
here holds.

**9. A class object is a record of shape `none` with no parts.** The khachkar (8,781 instances
on the Wikidata subset), Last Address and the Stolpersteine are types a traveller must see
some of and no particular one of (the maintainer, 2026-11-04, #2248). The maintainer's direction of that day
left open whether such a type is a whole with no parts listed or an object of its own. The
session answered it for this Draft on 2026-11-16 (#2248), and the maintainer's ruling of the same day on
#2581 takes the answer as given: "the khachkar is one record, a type and not one stone". Such a
record is not a sixth shape and not a whole:

- it has no ground of its own, so its shape is `none`, and it belongs to its regions by name
  (the khachkar to Armenia), as a dish does;
- its instances are not parts, so nothing reads "3 of 8,781" and nothing maps every plaque;
- the places it is met at are linked to it by #2581's relation ("met at"): the Noratus
  cemetery, Geghard. Opening its card lights those places;
- a visit is one tick on the record, "I saw one", made on the record or read from a visit to a
  place, as below.

**A visit to a place ticks the type only where the place is in the catalogue as a place of that
type, and a visitor cannot be there without seeing one** (the maintainer, 2026-11-16, #2581 and
#2248). So the relation between a type and a place has two strengths, and a curator says which:

- **"this place is one of them"** ticks the type. Noratus cemetery is offered as the field of
  khachkars, so a visit to it ticks the khachkar;
- **"one can be seen here"** ticks nothing, as a visit to a museum does not tick a work it holds.
  A museum with one khachkar in a room is such a place.

The strength is asked only on a pair a source proposed, and a proposed pair starts as
"one can be seen here", which ticks nothing. That is the session's rule of 2026-11-17, from the
maintainer's principle (decision 12): the strength has no source, so it is a yes or a no on a
proposed pair and never an entry from nothing. The pairs are proposed from where the instances
say they are: for the khachkar, 35 records of the catalogue, with Etchmiadzin Cathedral (47
khachkars) and Geghard (10) among them. Noratus is not proposed, since no khachkar's item names
it and it has no record. Until a second source is read (the type article's own
links, which #2248 names), the pair in the maintainer's own example is offered to no curator, and
nothing is built that would have a curator add it from nothing.

**What tells a series from a class object** (the maintainer, 2026-11-17,
[#2248](https://github.com/uncovering-world/track-your-regions/issues/2248#issuecomment-6949601870)): a series has
a short, closed list of parts, each visited for itself; a class object has instances in the
thousands, whether or not a few are famous. The Egyptian pyramids are a series (Khufu's, the
Bent Pyramid), so they stay a whole with parts (#2126). A type with thousands of instances is a
class object even when a few are gone to by name, and the named ones are places tied to it as
"this place is one of them". Some 7,000 nuraghi stand across Sardinia: "nuraghe" is one record,
one tick, "I saw one", and nothing reads "1 of 7,000". Su Nuraxi di Barumini, a World Heritage
site offered in Archaeology, stays a place of its own, and a visit to it ticks the type. This
replaces the session's test of 2026-11-16 (#2248), whether the instances are places a traveller
goes to by name, which the ruling confirms in sharper wording.

**10. A wide area needs no model of its own** (#2582). Yellowstone, the Serengeti, the Great
Barrier Reef, a neighbourhood (Trastevere) and a town visited for itself are `area` records. A
record is never a region of a world view and a region never a record. A visit to a place that
lies within an area counts the area (#2125), so a traveller who stood at Old Faithful has been
to Yellowstone. An area no land region holds (the Great Barrier Reef, 117 km from the nearest one)
is placed by a region a source or a person names (#2580).

A region a source names is that source's view, as its coordinate is (ADR-0084's `reported_*`):
it is kept on the source's record, the placement is derived from it, and a curator's placement
stands over it. Wikidata's country of origin names Senegal for thieboudienne. That is the
session's rule of 2026-11-17 (#2619 line 3.2), from ADR-0084's pattern and the maintainer's
ruling of 2026-11-16 on #2579 (comment of 18:33Z) that a curator's placement refers to the region
it was made on. Resolving "Senegal" to a region is the matching the Wikivoyage view has not
solved.

Checked on the Wadden Sea, which #2582 names. It is a serial World Heritage site, so `none`
(decision 3), and each of its components is an `area` (decision 2). A visit inside a component
counts that component and, through it, the site, which reads "k of N". By decision 11 the site
is drawn by its parts with the outlines they hold, framed by `focus` and placed in its parts'
regions, and a component no land region holds is placed by a region a source or a person names,
as the Great Barrier Reef is. Nothing in it asks for a model of its own.

**11. Readers ask the shape and the pin, never a missing coordinate.**
`db/readerPredicates.ts` gives `hasPinSql` (a marker, a distance or a fly-to can stand on it)
and `shownByPartsSql` (shape `none` with parts), and the backend lint refuses
`location IS NULL` and a spelled shape test elsewhere. The API keeps nullable `latitude` and
`longitude`, read from the pin, and `focus`, and adds `shape`.

| | point | area | line | none with parts | none without |
|---|---|---|---|---|---|
| Drawn | a pin; the outline or line it holds when it is hovered or selected, as today | a pin until `shape_min_zoom`, then its outline; a pin at every zoom while it holds its coordinate | a pin until `shape_min_zoom`, then its line; a pin at every zoom while it holds its coordinate | its parts, with the outline or line it holds | nothing of its own |
| Found, then | fly to the pin | frame `extent`; fly to the pin while it holds its coordinate | frame `extent`; fly to the pin while it holds its coordinate | frame `focus` | frame the places it is met at, else its region |
| A tick means | "I was there" | "I was in it" | "I was on it", anywhere along it | "k of N" | "I tried it", "I was at it", "I saw one" |

**Placement reads the geometry a record holds, never its shape.** ADR-0207 decisions 1 and 2
and ADR-0212 decision 4 stand for every shape, narrowed as below: a record is in the leaves of
its point, of its own outline and of its own line, together; where none of those places it, in the
leaf nearest its point; with its parts' regions; and, where nothing else offers it, in the
leaf of the point its kind record reports. Charles Bridge, a `point`, and the Øresund Bridge,
a `line`, are both placed by their lines, the second in Hovedstaden and Skåne; the Theban
Necropolis is in Luxor by its dig's outline, whatever its shape. Yellowstone, an `area` held
as a point, is where its point is until its outline arrives. Two placements are new: a record
with no geometry (thieboudienne, the khachkar) and an area no land region holds (the Great
Barrier Reef) are placed by a named region (#2580), and #1676 says whether the places a record
is met at place it too. This narrows two things. The first is what ADR-0207 tests an outline against
on a record that holds no coordinate: its reference point, and its emptied coordinate already
says the outline is its own (decision 6). The second is the `line` basis: it places a record
only by a line that is its own, as an outline places it only when it is its own. A line that
fails `line_reaches_place()` stays a drawing and places nothing, or a canal would be listed in
the regions of the object whose line it was given. The lines `writeLines` gathers pass by how
they are gathered, so no bridge, tunnel or dam is placed differently.

An area or a line trades its pin for its outline or line, and is framed by `extent`, only
where that geometry is its own, which is where it holds no coordinate. Yellowstone and the
other 213 wide areas held as one point today are each a pin at every zoom, and a search flies
to it, until its outline is held.

Below the zoom where an outline reads, an area is its pin: Naqsh-e Jahan Square, 560 m long, is
under a pixel on a map of Iran. The Draft's first text gave this as the maintainer's ruling of
2026-11-16. No comment on #2577 or #2125 and nothing in the Draft's pull request records it, so
it stands here as the session's until the maintainer confirms it. A long
object that is not a trail takes a plain tick (the maintainer, 2026-11-16); sections and
kilometres are for hiking trails and cycling routes (#1948).

**12. The model holds no fact a curator would have to enter from nothing** (the maintainer,
2026-11-16 and 2026-11-17, #2578). Every fact a curator sets has a source that proposes
candidates, which the curator confirms, corrects or refuses.

The session reads the principle as a rule about the model and what is built on it, and not as a
limit on a curator: **the model holds no fact without a source that can propose it, and nothing
is built that needs a curator to enter a fact from nothing.**

- A curator may complete or correct a proposed row: the main one among proposed arrival points, the
  stronger of two strengths on a proposed pair.
- A curator may still give, on their own knowledge, the verdicts the product already has
  (*lost* and *former*, ADR-0217 decisions 4, 5 and 13), and the edits a card already offers: a
  coordinate, a part named from either place's card. Each is about a fact that has a source of
  proposals.
- A fact with no source keeps its place in the vocabulary, and no form or card is built for it:
  ADR-0217 decision 9 has the one such fact, a movable event's dates for one year. Here the
  strength of "met at" has no source of its own and is asked only on a pair a source proposed.

Which source proposes each fact below is the session's reading of the Context's second
measurement.

| A curator sets | What proposes it | What is not built yet |
|---|---|---|
| A pinned shape (decision 3) | The default rule gives every record a shape, so a pin is a correction and never a first entry. What OpenStreetMap draws for the item proposes a correction, and a curator answers it: Hadrian's Wall, a set of `historic=wall` ways under a default of `none`, stays `none` (#1723) | A check that lists the records whose default shape and OpenStreetMap's drawing disagree |
| A claimed coordinate (decision 5) | Each source's point on its record, on 3,995 of the 4,019 offered places; a difference is a review row | — |
| A claimed outline or line (decision 6) | OpenStreetMap's polygon or line for the item: a polygon for 124 of the 214 wide areas (Yellowstone). For the 90 it does not draw, a curator's own outline (#2471) would be an entry from nothing, and nothing asks for one | The outlines of the kinds beside Archaeology (#1969), the choice between two sources' views (#2583), a canal's or a trail's line (#1948) |
| The parts of a record by a curator's answer (decisions 2 and 14) | Wikidata's part-of statements: 81 items name the Canal du Midi, the Fonserannes locks among them. Containment in an outline held (325 places), which is what proposes Museum Island's museums, since its item names none. And nearness with a like name, the pairing pass's own rule | A finder that proposes parts as review rows (#2125, #2126); the pairing pass asking about a record that has parts (decision 14) |
| How a kind's record stands to a serial object that holds its item (decision 14) | The shared item: 50 read records on 2026-11-17, Khajuraho among them | The finder, the question and its four answers (#2126) |
| Arrival points and their roles (decision 7) | The OpenStreetMap layer's visitor centres and information offices, near 126 of the 214 wide areas, and the typed markers of English Wikivoyage's pages, on 8 of them. A marker's coordinate is a fact read by a parser, and no text is kept | The table and the card; `entrance`, `barrier` and `highway=trailhead` in the layer's selection, and a rebuild of the layer; a reader of the markers. Best after the outlines, which tell a visitor centre inside the area from one next door |
| The main arrival point (decision 7) | No source: a choice among the proposed points | — |
| The places a class object is met at (decision 9) | Its instances' own locations: 35 records for the khachkar | #2581's relation, a finder and a card; the type article's links as a second source, without which Noratus is not proposed |
| The strength of that relation (decision 9) | No source: a yes or a no on a proposed pair, which starts as the weaker | Nothing that asks it on a pair no source proposed |
| A region named for a record with no ground of its own (decisions 9 and 10, #2580) | Wikidata's country of origin, right for six of eight dishes read (thieboudienne, Senegal), and the region each of the coverage surveys' 402 food entries is filed under. For an area at sea, the World Heritage record's State Party, which was not measured | #1676's kinds, and a match from a country's item to a region |
| The place an event is held at (decision 8) | The location its item states, on seven of nine festivals read: the Gion Matsuri at Yasaka Shrine | #1676 |
| What a visitor finds at a part (decision 2) | Signals #2059 measured (the part offered in another kind, an article of its own, a picture, a mapped object nearby), which do not yet tell something from nothing, and a traveller's report | #2059: the study of the signals, the default the map shows, the report |

**13. A record is found by its item unless it is a serial object.** ADR-0203 decisions 1 and 3
say that a place made of parts claims no Wikidata item by any column and that a merge never joins
it. Both hold for a record with parts and no shape of its own, and for no other. This narrowing
is the session's design of 2026-11-17. It follows from two rulings of the maintainer: that a
lock is a part of its canal (2026-11-16, #2577), and that a serial object and an extended object
are different while an item and a coordinate are separate things (2026-11-17,
[#2581](https://github.com/uncovering-world/track-your-regions/issues/2581#issuecomment-6943049715)). No ruling states the narrowing itself.

ADR-0203's reason is a serial site's: it is its parts on the ground, so an item it carries names
the site, one of its parts or their ensemble. The item on the Historic Ensemble of the Potala
Palace is the palace's, which is one of its three parts. An extended object's item names the
object. Q202494 is the Canal du Midi with or without its locks. Under ADR-0203 as built, the
canal would stop being found by Q202494 the day the Fonserannes locks become its part, a later
kind that reads the item would create a second Canal du Midi, and the merge that would repair it
would be refused. So:

- **"is a serial object" is one test, and every reader asks it of one function.**
  `place_is_whole()` is true for a record that has a part and whose shape is `none`. It is not
  the only place the rule is spelled today. `place_identifier_claims()` and `sharedItemsSql`
  read the function. `partsBarMerge` (`partWriter.ts`) asks `experience_parts` itself whether
  either place has a part, and the part writer's `merged-onto` refusal (`addRefusal` in
  `partRecordController.ts`, through `whole_has_parts`) does the same. Narrowing the function
  alone would leave the merge refusing the Canal du Midi once it has a lock, which is the
  failure this decision removes. So all three take the shape test by going through
  `place_is_whole()`, and none spells "has a part" as the test of a serial object: a rule has
  one owner. The `merged-onto` refusal cannot ask the function of the state it reads today,
  which is the state before the write: before its first part no record is a serial object,
  a series a curator confirmed included, though it is `none` from the answer on (decision 3);
  until its first part it claims its item as a record without parts does, which is the
  session's reading. It
  asks `place_is_whole()` after the part's record is written, in the same transaction, when
  `shape_follows_parts()` has set the shape from the parts, and rolls the write back where the
  answer is true and the record has a standing merge that is not a "same group" answer
  (decision 14). A `point` with another place merged into it that gains two parts more than
  1 km apart becomes `none` with them, and is refused; a canal that another kind's canal was
  merged into is a `line`, and takes its first lock. ADR-0203 decision 5 is narrowed with decisions 1 and 3, since what the join leaves out
  is what the function says;
- an extended object with parts keeps claiming its items as a place without parts does, is found
  by a run's lookup (ADR-0143 decision 3), and may be one place with another kind's record of
  the same object. No second canal is created;
- ADR-0203 decision 4 stands for the parts of every record: two parts of one whole stay two
  places, whatever the whole's shape;
- the curator's part writer warns that a first part makes a place "never merged, no longer found
  by its own item" (`makesWhole`) only where the first part makes the record a serial object.

**The claim follows the shape.** A curator who pins a shape changes what the record is found by.
A record with parts and shape `none` that a curator states an `area` or a `line` is identified
by its item from that write on, and a later record of another kind that carries the item is one
place with it. Pinned back to `none`, it holds
the item as referring again, and its own kinds' runs still find it through their records. A
record whose kind states it an `area` or a `line` (the Canal du Midi, once the defaults of
decision 3 are written) is never a `point` when it gains its first part, so it never passes
through `none` and never loses its claim. A `point` that gains parts more than 1 km apart
becomes `none` by decision 3 and a serial object with them.

The registry must be refreshed on that write, and nothing does so today.
`place_identifiers_follow_wholes()` refreshes a place when a statement on `experience_parts`
gives it its first part or takes its last, and stays for a record whose shape does not move with
its parts. The one trigger on `experiences` that refreshes the registry,
`trg_place_identifiers_place_merged`, fires on `merged_into_id` alone. A second trigger on
`experiences`, on a write of `shape`, has to call `place_identifiers_follow_place()`. It then
also follows `shape_follows_parts()`, which writes the shape from a statement on
`experience_parts`. The shape card says what the pin does to the item, as the part writer's
card does for a first part.

**14. A shared item never joins a record onto a serial object: it proposes a question, and a
curator answers it** (the maintainer, 2026-11-17, [#2581](https://github.com/uncovering-world/track-your-regions/issues/2581#issuecomment-6943873765), also recorded on #2126).
Places of worship's "Khajuraho Group of Monuments" and the serial World Heritage site of that
name share Q167298 and are the same 15 temples. A traveller sees one whole offered in both
kinds: one card, "3 of 15". Making them one is a curator's answer and never automatic. The
maintainer's four answers:

| The curator answers | What follows | Case |
|---|---|---|
| The same group | One record, offered in both kinds, shown by its parts, with one count | Khajuraho, the maintainer's own case |
| A part of it | The relation: the kind's place is a part of the serial object | Archaeology's Baalbek and the Baalbek site. The maintainer's answer for that pair (2026-11-17, [#2581](https://github.com/uncovering-world/track-your-regions/issues/2581#issuecomment-6943049715)): "not merged; related as a part and its whole" |
| The same place as one of its parts | The kind's place and that part are one place, a part of the serial object and offered in the kind | Archaeology's Mausoleum of the First Qin Emperor and component 441-001, 34 m apart; Bridges' Rideau Canal and component 1221-001 |
| Unrelated | Two records, and the pair is not asked again | A pair whose item names neither record's thing |

An item cannot choose among these answers: Baalbek's Q178835 is the city's, and the pair is a
part and its whole all the same. The answers and "never automatic" are the maintainer's. What each answer writes is the
session's design of 2026-11-17:

- *the same group* moves the kind's record onto the serial object and folds the kind's place
  into it under a merge record, so that it can be undone (ADR-0086). The serial object keeps
  shape `none`, holds the item as referring as before, and the kind's run finds it through its
  record. This is the one way a kind's record comes onto a serial object, and ADR-0203
  decision 3 is narrowed for it: no run, no join and no other merge joins one.
  **The serial object is the one that stays.** ADR-0086 decision 2 keeps the place with the
  lower id, and a pair answered *one place* passes its first place as the survivor
  (`mergeProposalController.ts`). A kind's place that is older than its site would then keep
  its point and take the site's parts. For this answer the survivor is the serial object,
  whichever id is lower, which narrows ADR-0086 decision 2.
  **The check `merge-onto-a-whole` leaves this merge out.** ADR-0203 decision 6 lists every
  standing merge onto a place made of parts and asks a curator to undo it
  (`identifierAssertions.ts`). The serial object is still such a place, so the check would list
  Khajuraho as a defect and its remedy would reverse the curator's answer. A merge that records
  a "same group" answer is told apart by its merge record and is not listed, which narrows
  ADR-0203 decision 6. Every other merge onto a serial object stays a defect;
- *a part of it* writes a curator's record in the whole, as an answer from the place's card
  does (ADR-0198 decision 5, #2118);
- *the same place as one of its parts* is a merge of the part and the kind's place, which
  ADR-0100 decision 4 and ADR-0203 decision 4 allow. #2528 has the same merge for a place
  about to be added as a second part;
- *unrelated* writes the answer alone. Where the item is wrong for one of the two, the curator
  corrects it as ADR-0143 decision 5 has it.

**What proposes the question.** No curator enters a relation from nothing (decision 12):

- the shared item: a kind's record that carries an item which a serial object holds as
  referring. The probe of #2276 found these records, and it seeds the finder;
- a Wikidata part statement between the two records' items (ADR-0150): the item of the
  Fonserannes locks states "part of" toward the Canal du Midi's;
- nearness with a like name, the pairing pass's rule (ADR-0046 decisions 2 to 4). The pass
  leaves every record with parts out today, so the one surface that asks "is this a part of
  that?" never asks it of a whole. It stops leaving them out: a pair of a kind's place and a
  serial object, or one of its parts, is proposed where the rule finds it;
- containment in an outline held, for an area's parts (decision 12).

**For two ordinary places an equal item still makes one place.** Cologne Cathedral (Q4176) is
one place in World Heritage and in Places of worship (ADR-0084; #755, closed on the maintainer's
decision of 2026-10-30), because a run finds a place by its item before it creates one
(ADR-0143 decision 3). The Karnak Temple Complex (Q522862), a part of Ancient Thebes, is one
place with two kinds' records the same way. The maintainer confirmed on 2026-11-17
([#2581](https://github.com/uncovering-world/track-your-regions/issues/2581#issuecomment-6949443990)) that the
words of that morning, "two places are not merged because they share a Wikidata item", reach a
record with parts, where an item can name the city, one component or the whole, and a curator
answers. For two records that each have geography of their own and no parts, the join on an equal
item stays automatic and raises no card. A wrong join of that sort is found by the Catalogue
Checks and separated by a curator; #1944 measures components bound to a wrong item.

**A near pair answered *part of* writes the relation.** The ruling of 2026-11-17 says that what
is wanted between such records is the relation; the rule that the answer writes it is the
session's design. A curator's answer writes a curator's record in the whole (ADR-0198
decision 5). The catalogue's answer from a statement (ADR-0150) writes a record under the
`wikidata-statement` id scheme, which names the statement; the schema declares the scheme
and no source uses it yet. Either way `parts_follow_records()`
makes the relation, and taking the answer back (ADR-0150 decision 4) takes the record away.

**Becoming a record with parts is a curator's answer; being a part of one may be a source's
claim.** This is the session's design of 2026-11-17, from #2126 ("no rule makes a place a
whole") and the ruling that a link is a hint. The World Heritage list alone gives a record its
first part without a curator (ADR-0100, ADR-0210 decision 4). So a statement toward a record
that has no part is shown on the question and a curator answers it; toward a record that
already has parts it is a claim, as a list line is, and the pass answers the pair. ADR-0150
decision 1 has the pass answer every such pair, and is narrowed to the second case. Its
decisions 2 to 5 stand.

The relation between a class object and the places it is met at is not "part of" and stays as
decision 9 has it: the khachkar and Noratus cemetery.

**What this leaves, and the interface each builds against.**

| Issue | It decides | It builds against |
|---|---|---|
| #1948 | The kinds that are lines; a trail's sections and whether they are part records; the walk in kilometres; where a line and its stated length come from; that an itinerary is not a line | `shape = 'line'`; `experiences.path`, written through its one writer and held to `line_reaches_place()` by the trigger (decision 6); `experience_parts`; the `line` basis of `experience_shape_regions`; arrival points of role `trailhead` |
| #1676 | The kinds and their verbs; "met at" and whether it places a record; whether a country's dish is listed in every region under the country; whether an event ever states a point of its own | `shape = 'none'` on `experiences`; `place_periods` and `place_seasons` on the same row |
| #2582 | Nothing further: decision 10 answers it. The outlines of offered wide areas are a build issue | `shape = 'area'`, `experiences.boundary` |
| #2583 | Where each source's and a curator's outline and line are kept, what a view outlines (the site or its buffer zone), and how the choice of ADR-0146 is recorded | `experiences.boundary` and `experiences.path` through their one writer; decision 6's tests, `outline_reaches_place()` and `line_reaches_place()`, which the trigger of decision 5 runs on the column, whoever chose the view |
| #2579 | The visit referents, the verb, and a section's kilometres | Every shape is a row of `experiences`, so a place, an area, a line, a section, a dish and a class object are one referent |
| #2580 | The region referent that survives a re-import | A basis `named` in `experience_shape_regions`, read by `refresh_place_regions()`: a dish, a class object and an area at sea alike |
| #2581 | The relations between records as one design: the table of "met at", "replaced by" and the others it lists. "Part of" is decided here (decisions 2, 13 and 14) | Every shape is a row of `experiences`, so a relation joins two rows; "met at" carries decision 9's two strengths, the weaker by default, and only the stronger is read as a visit to the type |
| #2126 | The series-candidate check, cast groups, nesting, and the finder and card of decision 14's question | Decision 14's four answers and what each writes; `place_is_whole()` as decision 13 narrows it |
| #2125 | Containers and "lies within" | `shape = 'area'` and `boundary`; it removes no point by hand |
| #1969 | The read of outlines and lines by viewport, the layers, the credit | `shape`, `shape_min_zoom`, `extent` |
| #2059 | What the map shows by default of what a visitor finds at a part, the signals that propose it, and a traveller's report | The part's fact with its three values and who proposed and confirmed it (decision 2) |
| #2133 | What a confirmed whole with no part is, and the parts proposed for it | Shape `none` from the curator's answer (decision 3) |

**Amended while Draft, in the pull request of its first slice (#2577):** decision 5 said a
part gained or lost changes nothing on an `area` or a `line`. That left an area its parts had
made an area for good once its last part was taken out: nothing had stated it one, and
decision 3 asks the default only of a `point`, so parts 44 km apart added later would not have
made it `none`. A record that loses its last part now takes its default again, which is what
`whole_shape_follows_parts()` did for a container.

**Amended as a Draft, to the maintainer's rulings of 2026-11-16 and 2026-11-17 (#2581, #2248,
#2578):** the Draft was merged before both rulings were recorded.

- Decision 9 says when a visit to a place ticks a type, with the two strengths of "met at"
  (Noratus cemetery against a museum with one khachkar), from the maintainer's ruling of 2026-11-16. The
  interface table gains #2581's row. The Draft's first text had no visit to a place tick a type.
- Decision 12 is new: the maintainer's principle that a curator enters nothing from nothing, with the source
  that proposes each fact this ADR has a curator set. Its reading is the session's: a rule about
  what the model holds and what is built, and no limit on what a curator may do on a card. Decision 7 no longer has a curator set
  arrival points from an empty card, and says that the layer's tag selection must grow before
  gates and trailheads are proposed. Decision 9 says a strength is asked only on a proposed pair.
- Decision 8 follows ADR-0217's amendment of the same day: nothing writes a `held` period of one
  year until a source gives the dates.
- Decision 8 says a leaf that has no point is offered by its record in its whole, since a
  festival that is a part has none; the header names ADR-0206 decision 2, which it narrows for
  such a leaf only. A leaf with a point is counted as that decision has it.
- The Consequences name the maintainer's ruling of 2026-11-17 (#2116, #2586) that no curator's decision is
  carried from the development catalogue. The Draft said nothing of carrying one.
- Attributions are corrected. Decision 7 says the maintainer asked the question and the session
  answered it. Decision 9 says which part of the class object is the maintainer's and which the session's.
  Decision 11's "an area is its pin" below the zoom where an outline reads was given as the maintainer's
  ruling of 2026-11-16, which no issue records, and stands as the session's until the maintainer confirms it.

**Amended as a Draft, to the maintainer's ruling of 2026-11-17 on identity, geography and
"part of" (#2581, #2126):** the ruling is recorded in two comments of that day on #2581, the
second also on #2126. It was to be reconciled with ADR-0203, with #2126's requirement that a
twin's record lands on the whole, and with this Draft, in one statement of the model.

- Decision 2 says a record holds three facts, with what it is as the third, and names the two
  forms of a record with parts, the serial object and the extended object. The three facts and
  the two forms are the maintainer's (2026-11-17, #2581). The Draft's first text had the shape
  and the parts as two facts and said nothing of the item.
- Decision 2 says a part that is itself an extended object is counted as one place of the whole
  above it, and the header names ADR-0206 decisions 2 and 3. The session's design.
- Decision 13 is new: ADR-0203 decisions 1 and 3 hold for a serial object only, and the claim
  follows the shape. The session's design, from the maintainer's rulings of 2026-11-16 (#2577,
  a lock is a part of its canal) and 2026-11-17 (#2581, the two forms). It is written here
  because ADR-0203 is Accepted and is narrowed only by another ADR's header: its Status line
  names this ADR when this ADR is accepted, and not before.
- Decision 14 is new. That a shared item only proposes a question, the four answers, and one
  whole in both kinds for Khajuraho are the maintainer's (2026-11-17, #2581 and #2126). They
  replace the automatism of #2126's requirement, which was a design and no ruling, and with it
  the reason ADR-0203's alternatives table gave against asking a curator. What each answer
  writes, what proposes the question, that a near pair answered *part of* writes the relation,
  and that becoming a record with parts is a curator's answer are the session's design. The
  header names ADR-0150 decision 1, which the last of these narrows.
- Decision 14 gives Archaeology's Baalbek under *a part of it*, which is the maintainer's
  answer for that pair (2026-11-17, #2581, the first comment of that day). Its item, the
  city's, is kept only as the reason an item cannot decide.
- After the first review of this amendment's pull request, three things were added, all the
  session's design. Decision 13 named `place_is_whole()` as the one test, where `partsBarMerge`
  and the `merged-onto` refusal spell "has a part" on their own: it now names the three readers
  and has each go through the function, and the header names ADR-0203 decision 5. Decision 14
  said nothing of the check `merge-onto-a-whole`, which would have listed every "same group"
  answer for undo: the check leaves such a merge out, and the header names ADR-0203 decision 6.
  Decision 14 did not say which place stays: the serial object does, and the header names
  ADR-0086 decision 2.
- After the second review, decision 13 says when the `merged-onto` refusal asks the function:
  after the part is written, since before a first part `place_is_whole()` is false for every
  record. The session's design.
- Decision 14 keeps "one thing in two kinds is one place" for ordinary places (ADR-0084, #755).
  That the ruling of 2026-11-17 concerns records with parts is the session's reading.
- Decision 12's table says what proposes a part and the question of decision 14, and the
  interface table gains #2126's row.

Not decided by these amendments, and the maintainer's to decide before the ADR is accepted:

- whether the check of decision 7 lists an area for which no source proposes an arrival point
  (Tsingy de Bemaraha), which would ask a curator to enter one from nothing;
- whether "two places are not merged because they share a Wikidata item" reaches further than a
  record with parts: a part's item (the Karnak Temple Complex, joined with two kinds' records by
  Q522862; #1944 measures components bound to a wrong item) or every place (Cologne Cathedral).
  Decision 14 reads it as reaching neither;
- whether the parts of an extended object that is itself a part are counted in the whole above
  it as well. Decision 2 counts the extended object; the Rideau Canal's lock stations would
  make the site's six parts more if they were counted too.

**Amended as a Draft, to the maintainer's rulings of 2026-11-17 put from #2619 (#2581, #2248,
#2059), to two earlier decisions of the maintainer the Draft did not follow (#2126, #1723), and
to the lines of #2619 the session closed the same day.** Each change names its line in #2619.

- **Decision 3, a confirmed series (line 1.13).** A series a curator confirms is `none` at once:
  no coordinate, its row in lists, nothing drawn while no part is shown, as the maintainer decided
  on 2026-10-28 (#2126). The Draft's reading, the session's, kept the pin until a first part.
  Decision 13, which depends on it, says that such a record is still no serial object for
  `place_is_whole()` until its first part, the session's reading. The interface table gains
  #2133's row.
- **Decisions 2, 3, 12 and 13 and the Consequences, Hadrian's Wall (line 1.14).** The sentence
  that the wall "becomes a `line` with parts when a curator says so" is struck, with the example
  of decision 13 built on it and the two sentences of the Consequences that followed from it.
  The maintainer's decision of 2026-10-19 (#1723) stands: the wall stays a collection of its
  forts, and the Hadrian's Wall Path is a trail record of its own. Decision 13 states the claim's
  rule with no example, and decision 12's table says a curator keeps the wall `none`.
- **Decision 7, an area no source proposes an arrival point for (line 1.15).** It is counted,
  no curator is asked, and its navigation link goes to its pin; the check lists the proposed
  points not yet answered, on a record of any shape. From the maintainer's principle of
  decision 12; the reading is the session's. The Consequences and an alternative follow.
- **Decision 14, a shared item (line 1.16).** The maintainer confirmed on 2026-11-17
  ([#2581](https://github.com/uncovering-world/track-your-regions/issues/2581#issuecomment-6949443990)) that the ruling
  on a shared item reaches a record with parts, and that two ordinary places with an equal item
  stay joined automatically (Cologne Cathedral). The paragraph no longer calls that reading the
  session's.
- **Decision 2, the lock stations (line 1.17).** A site's count follows its source's list of
  components: the Rideau Canal is one of its site's six, its lock stations are not counted
  there, and a visit to one is a visit to the canal. Closed by the session.
- **Decision 9, a series against a class object (line 1.18).** The test is the maintainer's, in
  the ruling's wording ([#2248](https://github.com/uncovering-world/track-your-regions/issues/2248#issuecomment-6949601870)): a
  short, closed list of parts against instances in the thousands, with the nuraghe as its case.
  It no longer carries the session's mark.
- **Decision 2, what a visitor finds (line 3.1).** A part can hold it, with three values and who
  proposed and who confirmed it (the maintainer, 2026-11-17,
  [#2059](https://github.com/uncovering-world/track-your-regions/issues/2059#issuecomment-6947367409)). The
  default the map shows stays #2059's. Decision 12's table and the interface table gain its row.
- **Decision 10 (lines 3.2 and 3.28).** A region a source names is that source's view, the
  session's rule from ADR-0084's pattern. The decision is checked on the Wadden Sea, which #2582
  names, against what decisions 10 and 11 say.
- **Decision 8 (line 3.29)** says which forms of the register of kinds it was checked on, and
  which not.

The three questions the note above left to the maintainer are answered: the check of decision 7
for an area no source proposes for (line 1.15), how far the ruling on a shared item reaches
(line 1.16), and the lock stations of a part that is itself an extended object (line 1.17).

## Alternatives Considered

| Option | Why rejected |
|--------|-------------|
| No stated shape: read it from the geometry held | It cannot say Yellowstone is an area before its outline arrives, so 214 wide areas stay points and no check can list what is missing. It calls 624 footprints under a hectare areas and the 140 bridges that span under 1 km lines. A second source's footprint would flip a place's shape. It needs a flag for "none" anyway. |
| A table per form (places, areas, routes, topics) under a parent | 29 tables and 37 foreign keys move, with every writer of ADR-0069. A shape changes in curation (Museum Island from a point to an area when its outline arrives), which would be a move between tables. The Canal du Midi is one row offered by two kinds of two forms (ADR-0084). |
| Every bridge and tunnel a point, with its line a drawing | The Channel Tunnel's pin would stand wherever a source put its coordinate along 50 km, and its line would show only on hover. 55 of the 195 lines held span 1 km or more. |
| Every bridge a line | 140 of the 195 lines held span under 1 km: the Pons Fabricius (66 m) would trade its pin for a line a few pixels long. A traveller goes to such a bridge as to a monument. |
| Placement keyed on the shape (a point by its point only) | It would take the Øresund Bridge's two banks and the Theban Necropolis's Luxor away from records ADR-0212 and ADR-0207 placed by the geometry they hold. |
| A record that holds an outline that is not its own cannot be an area: it keeps the shape it had | A curator's pinned shape of `area` and the stated shape would disagree, and an inserted row has no shape to keep. The shape says what the thing is; whose the outline is decides only the coordinate. |
| The curator's coordinate as a record of the Curators source, in no kind and no whole | It narrows ADR-0198 decision 1 for a value that is the place's own today: a curator's claim is a column of the place named in `curated_fields`, never a record. |
| `parts` as a fifth shape, as #2577 was filed | Being an area and having parts are two facts: no container whole exists, the Canal du Midi is a line with locks, Museum Island an area with museums. One column would make each choose. |
| An equal item puts a kind's record on a serial object without a curator, as #2126 was filed | The item names the group for Khajuraho, a component for the Mausoleum of the First Qin Emperor and the Rideau Canal, and the city for Baalbek, and nothing in the item tells them apart. The three joins of October 2026 were undone by hand. The maintainer decided against the automatism on 2026-11-17 (#2581, #2126). |
| The twin of a serial site as one more part of it | Khajuraho would read "k of 16" with a sixteenth pin that is the other fifteen. |
| The twin as a second whole of the same parts, nested in the site | Two cards of one name, each "k of 15". The maintainer decided on 2026-11-17 (#2581) that a traveller sees one card. |
| Keep ADR-0203's test, "has a part", for every shape | The Canal du Midi would stop being found by its item when its first lock became its part, and a second canal could be created and never merged. It ties what a record is to what it consists of. |
| Every equal item is a question to a curator | It undoes ADR-0084 in practice. ADR-0143 counted 570 equal-item merges, 2 of them undone. Asked of Cologne Cathedral, "is this a part of that?" has no meaning. |
| A sixth shape for the class object | It differs from a dish in nothing the schema holds: no ground, a region by name, places it is met at, one tick. |
| A class object as a whole whose parts are not listed | A whole reads "k of N" and is drawn by its parts; 8,781 khachkars are neither counted nor mapped, and no source ranks them. |
| A visit to any place a type is met at ticks the type | A museum with one khachkar in a room would tick the khachkar, where no visit to a museum ticks a work it holds. The maintainer decided against it on 2026-11-16. |
| No visit to a place ticks a type (this Draft's first text) | A traveller who walked the field at Noratus has seen khachkars, and a product that asks them to say so again does not know what Noratus is. |
| Arrival points a curator sets from an empty card (this Draft's first text, the session's) | Yellowstone's five entrances would be typed from nothing, where Wikivoyage states all five with coordinates. The maintainer's principle of 2026-11-16 and 2026-11-17 refuses it. |
| Keep the coordinate on an area that holds an outline of its own | ADR-0210 rejected a stored, unread coordinate for a whole, for a reason that holds here: every run would keep writing it and every reader of the column would take it for where the place is. A curator's claimed coordinate is kept, but in a column no run writes and no reader of `location` sees. The milestone's exit criterion asks for "a whole with an outline and no point". |
| No pin on an area that holds an outline | Read literally, "shown by its outline" removes the square from every map below the zoom where 9 ha can be seen, and from the heat map, search, crowding and "near me". |
| The pin at the main arrival point | Yellowstone would stand on its edge in Montana, and the Canal du Midi at one end again. Inside an area small enough to be a pin, the difference cannot be seen; on a wide one it misleads. |
| The arrival point on the record's coordinate, as #505 was filed ("the reader-facing coordinate … is the arrival point") | It makes one column carry where the thing is and where to go in, the two facts #505 itself tells apart. |
| An arrival point defaulted to the source's point on every record | About 24,000 rows that say nothing. The check of decision 7 lists what was proposed and not answered. |
| An arrival point as a part place | A park gate would get a card, a tick and a line in "k of N". |
| A non-place in a table of its own | A second copy of the gate, the queue, merges, regions, periods and visits, or foreign keys to two tables. |

## Consequences

**Positive:**

- No place loses a region: placement is as ADR-0207 and ADR-0212 have it.
- Each record #2577, #2582 and #2248 name is held: the Uffizi (point, with its door as an
  arrival point), Naqsh-e Jahan Square (area, an outline and no coordinate), Yellowstone
  (area, five entrances), the Canal du Midi (line, its locks as parts), the Ring of Kerry
  (line, a plain tick), the Struve Geodetic Arc (none, 34 parts), the Gion Matsuri and
  thieboudienne (none), the khachkar (none, met at Noratus).
- A missing point is a defect the constraint catches again, since "no point" is stated and not
  inferred.
- The markers read stays one indexed point column. No outline or line enters it.
- #2125 is unblocked, and #2582 closes into this decision.
- A canal, a square or an island keeps the item every kind finds it by when it gains parts, so
  the Fonserannes locks can be a part of the Canal du Midi and no second canal appears.
- Khajuraho becomes one card in two kinds by one answer, and the same question separates the
  Mausoleum of the First Qin Emperor and the Rideau Canal, which an item cannot.
- An answer *part of* is a relation a traveller's visit follows, where 69 such answers on the
  development catalogue changed nothing.
- The catalogue can list what it lacks: an area or a line that still holds its coordinate
  (no outline or line of its own), and the arrival points proposed and not yet answered. The
  wide areas no source proposes a point for are counted.

**Negative / Trade-offs:**

- `whole_shape` and its two words go; nine backend files that read it, and about as many that
  read a missing coordinate, move to the two predicates. The readers that mean "where to draw
  or measure" move to `pin`, best with #2124, which moves them off the point tables anyway.
- One more trigger on `experiences`, with a point-on-surface for each written outline, and
  one more column for the few coordinates a curator claimed on a record that then took an
  outline or a line.
- An area's pin is computed, and may stand in a field. Only a navigation link cared, and it
  goes to the arrival point.
- A curator cannot move the pin of an area that holds an outline of its own; a wrong pin
  there is a wrong outline (#2471).
- A series a curator confirms loses its stray pin at once and is drawn by nothing until a part
  is shown: the Egyptian pyramids before their first pyramid.
- What a record is found by now moves with a curator's pinned shape, and needs one more trigger
  on `experiences` (decision 13).
- The 50 twins of serial sites are 50 questions, most of them answered alike, where #2126's
  automatism asked none.
- Wikidata's statement no longer answers a pair toward a record with no part. All 40 answers the
  catalogue gave on the development catalogue named such a record, so each would be a question
  with the statement shown.
- A kind's place answered *a part of* a serial World Heritage site adds a place to the count
  beside the list's components, and the question's card has to say so.
- A bridge's default shape reads the span of the line held for it, so a bridge whose line
  arrives later moves from a pin at its source's coordinate to a pin on its line.
- A record of shape `none` sits in tables named for places (`place_periods`, the "place" in
  many function names).
- The rule for which types are areas is not measured yet, and it decides where "lies within"
  cascades a visit (325 places stand inside an outline held today).
- No shape a curator pinned, coordinate a curator claimed or part a curator named on the
  development catalogue is carried to the fresh database (the maintainer, 2026-11-17, #2116 and
  #2586; it covers the "part of" answers #2125 planned to carry). Museum Island's museums are
  proposed and answered again (decision 12).
- Noratus, the maintainer's own example of a place that ticks a type, is proposed by no source
  read today, so no visit ticks the khachkar until the type article's links are read.
- Gates and trailheads are proposed only after the OpenStreetMap layer is rebuilt with three more
  tags, and an area no source proposes a point for (Tsingy de Bemaraha) keeps its navigation link
  on its pin.

## References

- Related ADRs: ADR-0016, ADR-0028, ADR-0029, ADR-0045, ADR-0046, ADR-0048, ADR-0059, ADR-0061, ADR-0069, ADR-0077,
  ADR-0084, ADR-0086, ADR-0087, ADR-0100, ADR-0115, ADR-0143, ADR-0146, ADR-0150, ADR-0198, ADR-0203, ADR-0205,
  ADR-0206, ADR-0207, ADR-0210, ADR-0211, ADR-0212, ADR-0213, ADR-0217
- Related docs: `docs/tech/experiences.md` § Location model, `docs/tech/experience-map-ui.md`,
  `docs/tech/geometry-columns.md`, `docs/tech/catalogue-coverage.md`
- Issues: #2577, #505, #2248, #2582, #2125, #1948, #1676, #2583, #2579, #2580, #2581, #1969,
  #2471, #714, #2124, #2578, #2116, #2586, #2126, #2118, #2528, #2276, #1944, #755, #1723, #2059,
  #2133, #2619, Epic #2115
