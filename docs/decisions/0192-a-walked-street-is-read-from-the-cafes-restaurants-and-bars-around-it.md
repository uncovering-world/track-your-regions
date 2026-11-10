# ADR-0192: A walked street is read from the cafés, restaurants and bars around it

**Date:** 2026-11-10
**Status:** Accepted
**Issue:** [#2311](https://github.com/uncovering-world/track-your-regions/issues/2311)
**Adds to:** [ADR-0175](0175-a-place-kind-admits-by-quantiles-of-its-own-pool.md) decision 3 and [ADR-0181](0181-the-surroundings-tier-measures-a-place-against-neighbours-of-its-own-density-within-150-km.md): a fourth test of the surroundings tier, for Squares & streets alone; their three tests stand

---

## Context

Squares & streets admits a place by how widely it is described, read and named by guides. That
reads the famous squares and avenues, and misses the streets a traveller walks for the life along
them. Bauman Street, Kazan's pedestrian heart, was refused by the run of 2026-11-03: 8 Wikipedia
editions against a median of 17.5 for its neighbours, 16,086 readers a year against 21,536 asked,
and no Wikivoyage edition using its item. Bergmannstraße and Kastanienallee in Berlin have 4
editions. The kind's junk runs the other way: through streets and quiet squares a curator refuses.

The measurement of 2026-11-10
([report](../research/2026-11-10-a-walked-street-read-from-the-venues-around-it.md)) read every
candidate of the kind within Berlin, Istanbul and Kazan. Fame, the buildings on a street and the
venues along it were compared. OpenStreetMap's food-and-drink venues within 200 m of a street's point
put the walked streets at the top of their city and the refused ones at the bottom. ADR-0191 has the
layer keep those venues, so a run can count them.

The maintainer decided on 2026-11-10 (#2311) that every lively street is a candidate, nightlife and
neighbourhood streets included, each for a curator. The test only adds places. It reads streets and
squares, never a quarter, which is a separate kind (*Neighbourhoods & districts*, proposed). It must
not crowd the famous quiet streets off a crowded city's map, and what it adds is listed by name.

## Decision

**1. Squares & streets has a fourth test in its surroundings tier, by venues.** A candidate passes
when the OpenStreetMap layer's cafés, restaurants, bars, pubs, fast-food places, ice-cream parlours
and beer gardens within 200 m of its point reach half the median of the ten highest counts among the
kind's places within 150 km. The candidate itself is among them, and the area must hold 25 places of
the kind or more. The floors of the tier stand: two editions and the year's readers' floor. The
numbers live in the register (`SURROUNDINGS_REGISTER`: `venueRadiusM`, `venueShare`,
`venueGroupFloor`), with their derivation. A kind opts in by its declaration (`venues: true`), and
only Squares & streets does.

**1a. A street is read along its line where the layer keeps one** (amended 2026-11-11, before this ADR
landed: the dry run of 2026-11-10 showed what a point misreads). The OpenStreetMap layer keeps the
lines of the kind's candidates (ADR-0194). A place of a type the declaration names (`venueLines`:
street, promenade, stairway) is measured along them when they are 50 m long or more: the venues within
25 m of any of its lines, each once, per 100 m of line. Its reference is the ten best such measures
among the kind's places within 150 km that are read along their lines too, never point counts. A
square, a street with no line, and every place on a layer cut before ADR-0194 are read at their
point, as decision 1 states. So is a street with fewer streets read along their lines within 150 km,
itself included, than the area's floor of 25, counted again among the streets left until none falls
under it: the layer finds a street's line by the item its ways are tagged with, which few streets
carry in some cities, and too few lines make no reference. The
one-kind dry run of 2026-11-11 (log 860) lost Nakamise Street in Tokyo, Hatun Rumiyoc in Cusco, Rue du
Petit-Champlain in Quebec and Amoy Street in Singapore that way, each with 2 to 19 lined streets
around it. An artery, a street whose every line is a `motorway`, `trunk`, `primary` or `secondary`
road or one of their links, is let in by nothing the venue test reads, whether along its line or at
its point: a road driven through is lined with venues for its traffic, not walked for its life. It can still enter by its
fame. The share, the radius, the best ten and the area's floor are decision 1's: no number moves
(§ 11.3 of `docs/tech/filling-a-kind.md`).

The case was measured on the 203 street arrivals of the dry run of 2026-11-10 that a traveller's
reading labelled walked (115) or ordinary (87), read along their own lines cut from the planet. On
the 165 with a line, a held-out check refitted the thresholds on four fifths and scored the fifth
left out (5-fold, 20 repeats):

| Test | Walked kept | Ordinary let through |
|---|---|---|
| The point count | 89 % | 45 % |
| The line test | 86 % | 26 % |

On a dense core's ordinary streets this halves what a curator is asked about. On the walked streets
it costs a few, which fame keeps where they are famous. Squares stay at their point: there the
point count passed 21 of 23 walked squares against the line's 18.

The layer looks for the line of every candidate this tier judges: the kind's classes at the tier's
floor of Wikipedia editions (`SURROUNDINGS_CUT.minLanguages`, counted by `subsetWikipediaEditions`).
This narrows ADR-0194 decision 1. Its "pool's floor" was built as the subset pool's 15 sitelinks, and
the build of 2026-11-11 then looked for 470 candidates and lined 360. Those are the famous squares and
streets, which fame admits anyway, so nearly every candidate the door judges fell back to its point.

**2. The reference is read in a plain circle, among the kind's own places.** The other tests read the
neighbours of a place's own density (ADR-0181). This one reads every place of the kind within the
radius. A count of venues is itself how lively the ground is, so a street on a dense core's edge
passes only when it is as lively as the core's streets, never by being livelier than a quieter edge.
The places of other kinds set no reference: a church on a lively square says nothing about the streets
around it. Since the test reads an area of its own, it decides a place that has too few neighbours of
its own density for the other tests to read.

**3. Every place of the kind's classes is counted, whatever its editions.** The quiet streets set no
reference, but they count toward the area. A candidate is a place with the floors, as for the other
tests.

**4. A place the tier holds stays at 0.8 of the share,** as its editions do (ADR-0187).

**5. A layer that does not hold the venues is not read.** Where the build in place was cut before
ADR-0191, its recorded selection names no venue value, and the test is not read (ADR-0175 decision 6).
Nothing enters by it. A place the tier holds keeps its place only when the note its membership
records says it last stood by the venue test (`standsByVenues`), as the guides' test keeps a place by
its guide as last read; a place held by another test is judged by the tests the run read. The run's
line and the place's note say why.

**6. The card says what the test read.** The cut's note names the count, the radius, the reference and
how many places of the kind it was read among. A curator reads them beside the other tests.

## Consequences

- On the measurement, the test lets in 39 places of two editions or more in Berlin, 10 in Istanbul
  and 7 in Kazan. Among them are Bauman Street, Bergmannstraße, Kastanienallee and Simon-Dach-Straße,
  and neither street a curator refused in Berlin. Busy streets a traveller does not walk come too,
  Torstraße and Tarlabaşı Boulevard among them. They arrive for a curator.
- The famous quiet avenues keep their places by their fame: the test only adds.
- A long street whose point stands off its lively stretch read low at its point: Oranienstraße and
  Auguststraße stayed out. Read along its line (decision 1a) it is measured on its whole length.
- The pass counts venues around every place of the kind's classes, one indexed question per place.
  The dry run on the development catalogue measures how long that takes.
- The share rests on three cities. The dry run on the development catalogue lists every place the
  test adds in every surveyed region, for a traveller's reading, and checks the famous streets'
  places on a crowded map. A share that the dry run moves is moved by the register's method.

## Alternatives considered

| Alternative | Why not |
|---|---|
| A third or a quarter of the reference | 106 or 152 places in Berlin, where the neighbourhood streets with a few cafés outnumber the walked ones. |
| The neighbours of the place's own density, as the other tests read them | On a core's edge the reference falls with the density, and an outer high street with a dozen cafés would pass against the quiet streets around it. |
| Every kind's places as the reference | A church or a museum in a lively square sets a street's bar by where it stands, not by what a street is. |
| A fixed count of venues | A city's density of cafés varies by a factor of ten between Kazan and Berlin; the tier measures a place against its surroundings. |
| Buildings on the street (`P669`, `P1435`) | Strong where a country records its buildings with an address (Berlin, Kazan) and absent where it does not (Istanbul): a regional signal, not a world one. |
| Geotagged photographs | Few where tourists are many, and a source the product does not use. |
