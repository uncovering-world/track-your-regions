# ADR-0218: A record states its shape, and its pin is derived from what it holds

**Date:** 2026-11-16
**Status:** Draft
**Issue:** [#2577](https://github.com/uncovering-world/track-your-regions/issues/2577), Epic #2115
**Narrows (once accepted):** [ADR-0210](0210-a-dispersed-whole-holds-no-point-and-every-line-of-a-serial-site-is-a-part.md)
decisions 1, 2 and 5 (a whole's two shapes, the row constraint, and "every reader asks the
column");
[ADR-0207](0207-a-places-regions-come-from-its-own-geometry-and-a-point-no-region-holds-takes-its-nearest.md)
decision 1 (when an outline is tested as the place's own, and its `line` basis, which places a
record only by a line that is its own);
[ADR-0212](0212-the-openstreetmap-layer-keeps-whole-the-objects-of-a-bridges-item-and-its-line-places-it.md)
decision 4 (the same: every place that holds a line of its own)

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

**2. Having parts is a second fact, and not a shape.** A record of any shape may have parts
(`experience_parts`, ADR-0198). `whole_shape` goes:

- a serial World Heritage site has shape `none` and parts. The Struve Geodetic Arc is its 34
  points; the Wadden Sea is its components, each of them an `area`;
- Museum Island is an `area` with parts (the Neues Museum, by a curator's claim);
- the Canal du Midi is a `line` with parts: the Fonserannes locks, by the maintainer's decision
  of 2026-11-16 that a lock is a part of its canal.

"Shown by its parts" is a record of shape `none` that has parts: it has no pin of its own,
and a direct tick on it reads "? of N". A record with a shape of its own is ticked for itself,
and "k of N" stands beside the tick where it has claimed parts.

**3. The default shape comes from one function, and a curator may pin it.**

- A record the World Heritage list gives components to is `none`, whatever the walk between
  them (Würzburg's two, 159 m apart).
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
  `none` (the maintainer, 2026-10-28). Hadrian's Wall, a collection of its forts with shape `none` by the rule above (#1723, #2126),
  becomes a `line` with parts when a curator says so.

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
that line goes. A part gained or lost changes nothing on an `area` or a `line`; on a `point`
or on `none` it may change the default shape (decision 3), and the row then follows the table.
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
one marked main.

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
- A curator sets them from the record's card. An AI helper (ADR-0016, ADR-0087) or a run may
  propose them, and a reader sees a proposal only once a curator has confirmed it. A proposal
  read from OpenStreetMap names its object (ADR-0059).
- No row is written by default. A check lists the offered areas and lines that hold no main
  arrival point, which is the "still unchecked" list #505 asks for, without a copy of the
  source's point on every museum.

**8. A record that is not a place is a row of `experiences` with shape `none`,** in the kind
that offers it. It keeps the name, picture and credit, source records, admission, gate, review
queue, merge, curation log, region rows, parts and visit that every other record has. Its
dates hang on its own row: the Gion Matsuri holds a season (1 to 31 July) and, where known, a
`held` period of a year, and Holy Week in Seville is a record of its own (ADR-0217 decisions 2
and 9, which left the row to #1676). UNESCO's "Yama, Hoko, Yatai, float festivals in Japan" is
a record of shape `none` whose 33 parts are festivals, the Gion Matsuri among them.

**9. A class object is a record of shape `none` with no parts.** The khachkar (8,781 instances
on the Wikidata subset), Last Address and the Stolpersteine are types a traveller must see
some of and no particular one of (the maintainer, 2026-11-04, #2248). Such a record is not a
sixth shape and not a whole:

- it has no ground of its own, so its shape is `none`, and it belongs to its regions by name
  (the khachkar to Armenia), as a dish does;
- its instances are not parts, so nothing reads "3 of 8,781" and nothing maps every plaque;
- the places it is best met at are linked to it by #2581's relation ("met at"): the Noratus
  cemetery, Geghard. Opening its card lights those places;
- a visit is one tick on the record: "I saw one".

What tells it from a series is whether the instances are places a traveller goes to by name.
The Egyptian pyramids are (Khufu's, the Bent Pyramid), so they stay a whole with parts (#2126).

**10. A wide area needs no model of its own** (#2582). Yellowstone, the Serengeti, the Great
Barrier Reef, a neighbourhood (Trastevere) and a town visited for itself are `area` records. A
record is never a region of a world view and a region never a record. A visit to a place that
lies within an area counts the area (#2125), so a traveller who stood at Old Faithful has been
to Yellowstone. An area no land region holds (the Great Barrier Reef, 117 km from the nearest one)
is placed by a region a source or a person names (#2580).

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

Below the zoom where an outline reads, an area is its pin (the maintainer's ruling of
2026-11-16): Naqsh-e Jahan Square, 560 m long, is under a pixel on a map of Iran. A long
object that is not a trail takes a plain tick (the maintainer, 2026-11-16); sections and
kilometres are for hiking trails and cycling routes (#1948).

**What this leaves, and the interface each builds against.**

| Issue | It decides | It builds against |
|---|---|---|
| #1948 | The kinds that are lines; a trail's sections and whether they are part records; the walk in kilometres; where a line and its stated length come from; that an itinerary is not a line | `shape = 'line'`; `experiences.path`, written through its one writer and held to `line_reaches_place()` by the trigger (decision 6); `experience_parts`; the `line` basis of `experience_shape_regions`; arrival points of role `trailhead` |
| #1676 | The kinds and their verbs; "met at" and whether it places a record; whether a country's dish is listed in every region under the country; whether an event ever states a point of its own | `shape = 'none'` on `experiences`; `place_periods` and `place_seasons` on the same row |
| #2582 | Nothing further: decision 10 answers it. The outlines of offered wide areas are a build issue | `shape = 'area'`, `experiences.boundary` |
| #2583 | Where each source's and a curator's outline and line are kept, what a view outlines (the site or its buffer zone), and how the choice of ADR-0146 is recorded | `experiences.boundary` and `experiences.path` through their one writer; decision 6's tests, `outline_reaches_place()` and `line_reaches_place()`, which the trigger of decision 5 runs on the column, whoever chose the view |
| #2579 | The visit referents, the verb, and a section's kilometres | Every shape is a row of `experiences`, so a place, an area, a line, a section, a dish and a class object are one referent |
| #2580 | The region referent that survives a re-import | A basis `named` in `experience_shape_regions`, read by `refresh_place_regions()`: a dish, a class object and an area at sea alike |
| #2125 | Containers and "lies within" | `shape = 'area'` and `boundary`; it removes no point by hand |
| #1969 | The read of outlines and lines by viewport, the layers, the credit | `shape`, `shape_min_zoom`, `extent` |

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
| A sixth shape for the class object | It differs from a dish in nothing the schema holds: no ground, a region by name, places it is met at, one tick. |
| A class object as a whole whose parts are not listed | A whole reads "k of N" and is drawn by its parts; 8,781 khachkars are neither counted nor mapped, and no source ranks them. |
| Keep the coordinate on an area that holds an outline of its own | ADR-0210 rejected a stored, unread coordinate for a whole, for a reason that holds here: every run would keep writing it and every reader of the column would take it for where the place is. A curator's claimed coordinate is kept, but in a column no run writes and no reader of `location` sees. The milestone's exit criterion asks for "a whole with an outline and no point". |
| No pin on an area that holds an outline | Read literally, "shown by its outline" removes the square from every map below the zoom where 9 ha can be seen, and from the heat map, search, crowding and "near me". |
| The pin at the main arrival point | Yellowstone would stand on its edge in Montana, and the Canal du Midi at one end again. Inside an area small enough to be a pin, the difference cannot be seen; on a wide one it misleads. |
| The arrival point on the record's coordinate, as #505 was filed ("the reader-facing coordinate … is the arrival point") | It makes one column carry where the thing is and where to go in, the two facts #505 itself tells apart. |
| An arrival point defaulted to the source's point on every record | About 24,000 rows that say nothing. The check of decision 7 lists what lacks one where it matters. |
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
- The catalogue can list what it lacks: an area or a line that still holds its coordinate
  (no outline or line of its own), and a wide area with no arrival point.

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
- Hadrian's Wall stays a collection with no pin of its own until a curator states it a line.
- A bridge's default shape reads the span of the line held for it, so a bridge whose line
  arrives later moves from a pin at its source's coordinate to a pin on its line.
- A record of shape `none` sits in tables named for places (`place_periods`, the "place" in
  many function names).
- The rule for which types are areas is not measured yet, and it decides where "lies within"
  cascades a visit (325 places stand inside an outline held today).

## References

- Related ADRs: ADR-0016, ADR-0028, ADR-0029, ADR-0045, ADR-0059, ADR-0061, ADR-0069, ADR-0077, ADR-0084, ADR-0087,
  ADR-0100, ADR-0115, ADR-0146, ADR-0198, ADR-0205, ADR-0207, ADR-0210, ADR-0211, ADR-0212,
  ADR-0217
- Related docs: `docs/tech/experiences.md` § Location model, `docs/tech/experience-map-ui.md`,
  `docs/tech/geometry-columns.md`, `docs/tech/catalogue-coverage.md`
- Issues: #2577, #505, #2248, #2582, #2125, #1948, #1676, #2583, #2579, #2580, #2581, #1969,
  #2471, #714, #2124, Epic #2115
