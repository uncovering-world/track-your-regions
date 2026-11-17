# ADR-0210: A dispersed whole holds no point, and every line of a serial site is a part

**Date:** 2026-11-15
**Status:** Accepted — decisions 1, 2 and 5 narrowed by [ADR-0218](0218-a-record-states-its-shape-and-its-pin-is-derived-from-what-it-holds.md): "whole" is read as a record with parts; `whole_shape` gives way to the record's own shape, a row constraint holds that shape to the point, and a reader asks the shape and the pin, never a missing coordinate
**Issue:** [#2122](https://github.com/uncovering-world/track-your-regions/issues/2122), Epic #2115
**Supersedes:** [ADR-0095](0095-a-place-of-several-points-has-no-coordinate-of-its-own.md) decision 1
**Narrows:** [ADR-0095](0095-a-place-of-several-points-has-no-coordinate-of-its-own.md) decision 2,
[ADR-0205](0205-a-whole-has-no-coordinate-in-a-readers-answer-and-is-framed-by-its-places.md) decisions 1 and 3

---

## Context

ADR-0205 stopped every reader's answer from standing a whole at a point. The column underneath
stayed: `experiences.location` was `NOT NULL`, and each of the 482 wholes on the development
catalogue (2026-11-15, all of them serial World Heritage sites) still held ADR-0095's anchor, the
component nearest its components' centroid. The anchor was a coordinate nobody was shown and every
writer still had to keep: the World Heritage run wrote it past the gate, a curator's correction of
a whole's one shown point moved it, and the readers that read the column itself (the review map,
crowding, the catalogue checks, the tick's answer) read it as if it were where the site is.

Eighteen wholes also held points of their own beside their parts:

- **16 sites kept the line named like them as their own point** (#1899): Prague's `616bis-001`,
  Kakadu's `147quater-001`, Angkor's `668-001`, Mount Kenya's `800ter-001`, W-Arly-Pendjari's
  `749quater-001` twice, 53 km apart. A part named like the site was thought to show the site
  twice. But the Historic Centre of Prague is a part of the Historic Centre of Prague site, beside
  Průhonice Park, as Fountains Abbey is beside St Mary's Church. And Graz's `931ter-002`, which the
  list names "City of Graz – Historic Centre and Schloss Eggenberg", stands at Schloss Eggenberg:
  the site counted one place (its historic centre) where it has two.
- **4 sites whose lines all carry the site's name**, one line per country, were one place of two
  points and no whole: Białowieża Forest (`33ter-001` in Belarus, `33ter-002` in Poland), the Ohrid
  region (North Macedonia and Albania), Koutammakou (Togo and Benin) and Waterton Glacier
  International Peace Park (Alberta and Montana).
- **2 sites held the export's site coordinate under the site's own reference**: Wudang's `705` and
  Baalbek's `294`, beside parts all still waiting for a curator. Each was the only thing a reader
  saw of its site. ADR-0207 decision 2 now places such a site by its record's point.

The maintainer decided on 2026-10-27/28 that a dispersed whole has no coordinate at all: not
stored, not computed on read, not chosen by a curator (#2122).

## Decision

1. **A whole has a shape** (`experiences.whole_shape`): `dispersed`, a place a traveller visits one
   part at a time, or `container`, one a traveller stands inside; NULL on a place that is not a
   whole. A place takes its shape when it gains its first part (`whole_shape_follows_parts()`, a
   statement trigger on `experience_parts`, through `whole_shape_of()`): dispersed when it holds a
   World Heritage record, whatever the walk between its parts (Würzburg's two, 159 m apart), or
   when its parts' standing points lie more than 1 km apart; container otherwise. A container is
   not shaped again as parts come. A whole that loses its last part is a place again.
2. **A dispersed whole holds no point** (supersedes ADR-0095 decision 1). `location` is NULL
   exactly on it, which a row constraint holds (`experiences_location_iff_not_dispersed`). A
   whole that loses its last part takes back the point its kind record reports, else a standing
   point of its own; with neither it keeps its shape, and a check names it.
3. **The anchor is the record's view only** (narrows ADR-0095 decision 2). The World Heritage run
   still derives it (`resolveMainPoint`, `locationIsAnchor`) as its record's `reported_location`,
   which places a site none of whose parts is read (ADR-0207 decision 2). The run writes no
   coordinate to a dispersed whole and files no move of one (`noCoordinate`, `changeSet.ts`); a new
   site stands at the anchor until the same write parts it. Past the gate, the anchor is written
   only to a place that holds a coordinate: an edition's casts (ADR-0145).
4. **Every line of a serial site is a part**, the one named like the site too
   (`part_site_components()`), and a site whose lines all carry its name is a whole of them:
   Białowieża Forest is its Polish and its Belarusian line. A point under the site's own reference
   is the export's site coordinate, no line, and stays the site's; an arrival the list withdrew
   before anyone read it makes no part. A part whose list name folds equal to its site's is named
   apart (`component_part_name_apart()`): the site's spelling and the most general GADM division
   that holds it, no other line so named and not every other part of the site, so "Białowieża
   Forest (Poland)", "Historic Centre of Prague (Praha 1)"; with none such, its most local one
   ("Kakadu National Park (West Arnhem)"), else the site's name. No reference or other id is ever
   a name; a curator renames one whose name says less than the place (Graz's Schloss Eggenberg
   reads "(Algersdorf)").
5. **Every reader asks the column.** A reader's coordinate and frame read `location IS NULL`, not
   whether the place has parts (narrows ADR-0205 decision 1): a dispersed whole answers no
   coordinate and its frame, a container whole its point. The review map draws a dispersed whole
   at the centre of the frame of its standing points; a tick on it answers its record's point; a
   curator's correction of its one shown point moves no coordinate of the whole; no source's view
   of its point is asked (`openViewFieldsSql`). Two checks follow it: `whole-shape-drift` and
   `whole-own-point`.

ADR-0095 decision 3 (no anchor on the review card) stands. This narrows ADR-0205 decision 3,
which kept the column `NOT NULL` and the anchor on every whole.

## Alternatives Considered

| Option | Why rejected |
|--------|-------------|
| Keep the anchor stored, unread | Every writer of the column would keep writing a coordinate no reader is shown, and every reader of the column (crowding, the review map, the checks) would go on reading it as the site's. A dispersed whole would have a point after all. |
| Infer the shape on read from the parts | Container wholes keep a point and dispersed ones do not; the row constraint needs a column to hold. A shape inferred from the parts' spread would also flip a container's point away when a curator adds a distant outlier. |
| Keep the line named like the site on the site | Graz's Schloss Eggenberg and both halves of W-Arly-Pendjari would stay points no part stands for: pins of the site itself, counted as no leaf, which a dispersed whole cannot hold. |
| Make the bare site reference a part too | Baalbek's `294` stands on the sanctuary, where its part `294-001` already stands: a second place of the same spot. |
| Ask a curator for the shape of each whole | Every whole today holds the World Heritage record and is dispersed by that alone. The curator's pin, for the wholes no record decides, comes with containers (#2125). |

## Consequences

**Positive:**
- No coordinate of a serial site is stored, written, moved or asked about. A run that reorders
  the export moves nothing.
- On a copy of the development catalogue (2026-11-15), 25 lines of 20 sites became parts, each a
  part migration 161 had folded into its site, revived: 17 lines of the 16 sites that kept them,
  and 8 of the 4 transboundary sites, which became wholes. Each site counts its leaves again: Graz
  2 (its historic centre and Schloss Eggenberg), Prague 2, W-Arly-Pendjari 3, Białowieża Forest 2.
  No row a reader is offered in a region went; the 25 parts gained 75. Wudang lost the point that
  stood for it, and stays listed in Hubei by its record. 486 wholes hold no point.

**Negative / Trade-offs:**
- A part named like its site reads as the site's name and the division it stands in ("Historic
  Centre of Prague (Praha 1)"), as GADM spells it ("Old City of Dubrovnik (Dubrovacko-Neretvanska)");
  Graz's reads "(Algersdorf)" and stands at Schloss Eggenberg until a curator renames it. Siblings
  that share a name with each other, not with their site, are left as they are (#2548).
- A dispersed whole's own outline no longer reaches a point of its own, so it places nothing
  (`outline_reaches_place`); its parts' rows place it. The Mausoleum of the First Qin Emperor, the
  one whole holding an outline, stays in the leaf its parts give it.
- The archaeology-twin watch now measures to a World Heritage row's points, its parts' included,
  so it counts a site standing on any component of a serial site.
- Wudang shows no place to a reader until a curator reads one of its 45 parts; its card says so.
- Baalbek keeps its `294` point while Archaeology's Baalbek is folded into it (#2119's merge
  undo), and `whole-own-point` lists it until then.
- A traveller who stood in Białowieża on the Polish side reads its whole as 1 of 2: "Białowieża
  Forest (Poland)" visited, "Białowieża Forest (Belarus)" not.

**Amended in its accepting pull request (#2546):** decision 4 and its trade-off name a part
named like its site apart by its GADM division, as the review round settled; the Draft said it
kept the site's name.

## References

- Related ADRs: ADR-0028, ADR-0095, ADR-0100, ADR-0145, ADR-0198, ADR-0200, ADR-0203, ADR-0205,
  ADR-0207
- Related docs: `docs/tech/experiences.md` § Location model and § Serial nominations,
  `docs/tech/data-assertions.md`
- Issues: #2122, #2125 (containers and the curator's pin), Epic #2115
