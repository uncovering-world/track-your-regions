# ADR-0170: A collection with a museum class is the museum, and a network stands for the house at its coordinate

**Date:** 2026-10-31
**Status:** Accepted

---

## Context

Art Museums places a work at the venue its collection (`P195`) and location (`P276`) statements
name, once that venue passes the venue test (`museum/venueTest.ts`): a museum class, a
coordinate, not dissolved, and none of the kill-list's classes — a curatorial department, an art or
private collection, a museum network, a never-built structure. The kill-list was written for the
Louvre's Department of Paintings and for the Bavarian State Painting Collections, which a visitor
cannot go to; Wikidata gives the same classes to places a visitor goes to every day.

Measured on the development subset against run 387 (2026-10-31), the kill-list refused 20 entities
that a work over the editions line names. Six are museums Wikidata also types `art collection`:
the Frick Collection, named by *Officer and Laughing Girl* (24 editions) and eight more works; the
Carnegie Museum of Art; Palazzo Vecchio, named by Donatello's *Judith and Holofernes*; Buckingham
Palace and the Royal Collection. Four are museum networks (`museum network`, Q88667167): the Tate,
whose item carries the coordinate of its Millbank house, the Museo Soumaya, whose item sits on its
Plaza Carso house, National Galleries Scotland and Museum Wales. A work that names a refused entity
and nothing else is placed nowhere, and the museum never arrives; a work that names the Tate beside
the National Gallery that owned it until 1897 (*The Lady of Shalott*, *The Girlhood of Mary Virgin*,
*Symphony in White, No. 2*) was placed on Trafalgar Square, where it does not hang. Wikidata's
`part of` statements for a network's houses are read by `fetchMuseumParts`, which took a house the
network had closed as a house still (Frick Madison, dissolved 2024) and so counted the Frick as
several houses.

## Decision

The kill-list stays; two of its kills are read with a second look.

1. **A holding — an art or private collection (`HOLDING_CLASSES`) — is the museum when the entity
   also carries a museum class, has a coordinate of its own and is one house rather than an umbrella
   of several** (`museumDespiteHolding` in `venueTest.ts`; `VenueFacts.housesApart` is the graph's
   `isOrganisation` read over the entity's standing parts). The Frick Collection and the Carnegie
   Museum of Art are museums Wikidata also calls collections; the Bavarian State Painting
   Collections, twenty houses, stay a holding, as does a collection with no coordinate or no museum
   class.
2. **A museum network (`UMBRELLA_CLASSES`) is never a visit and stays refused, but a work that
   names one is placed at the house the network's own coordinate sits on** (`VenueGraph.houseOf`:
   the nearest of its museum parts within `CONTAINER_RADIUS_M`, walked by `walkHouses` so it has
   facts; `resolveVenue` stands the network for that house when it passes the venue test). The Tate
   stands for Tate Britain, the Museo Soumaya for its Plaza Carso house. A network with no house at
   its coordinate resolves to nothing, as before.
3. **A network that stands above a branch the same work names resolves to nothing**
   (`placeArtwork`: a named value strictly above another named value that resolves is that value's
   umbrella, read on the raw statements). *Ophelia*, which names the Tate and Tate Britain, hangs at
   Tate Britain alone, not at Tate Britain twice.
4. **A network's parts are its standing parts**: `fetchMuseumParts` and the subset's `museumAt`
   read `has part` and the reverse `part of` at standing rank, without an end date, and skip a part
   that is dissolved (`P576`). Frick Madison, ended in 2024, is no longer a house of the Frick.

## Alternatives Considered

| Option | Why rejected |
|--------|-------------|
| Take `art collection` and `museum network` off the kill-list | The Bavarian State Painting Collections, the Royal Collection Trust's holdings in twenty rooms, and every network would arrive as a museum at the coordinate of their offices; the kill-list was written for them. |
| Forgive a holding on a museum class alone | The Bavarian State Painting Collections carry one; what tells the Frick from them is one house against twenty, which only the parts say. |
| A network stands for the house a work's other statement names, never for one on its own | *The Lady of Shalott* names the Tate and the National Gallery: the other statement is the stale owner. The network's own coordinate is the one fact on the item that points at a house. |
| Move the works to the branch by hand | Twenty entities today, and every Wikidata edition adds a collection class to a museum; a curator's hand on each is the load the rule exists to carry (#1617). |

## Consequences

**Positive:**

- On the development subset, read-only, main against the branch by item: 176 museums against 173.
  The Frick Collection arrives with nine works (*Officer and Laughing Girl*, *The Polish Rider*,
  *Saint Francis in the Desert*, *Comtesse d'Haussonville*), Palazzo Vecchio with two (*Judith and
  Holofernes*, *The Genius of Victory*), Buckingham Palace with three (*The Music Lesson*, *The
  Tribuna of the Uffizi*, which hangs in the King's Gallery there); seven works move from the
  National Gallery to Tate Britain, where they hang (*The Lady of Shalott*, *The Girlhood of Mary
  Virgin*, *Symphony in White, No. 2*, *The Age of Innocence*); 1,316 works are placed against
  1,302, and none is lost.
- A network's houses are read as they stand: a closed house no longer makes a one-house museum an
  umbrella.

**Negative / Trade-offs:**

- **A network's house is a guess by coordinate.** A work whose only sound statement names the
  network lands at the house its item sits on: *Marilyn Diptych*, whose location statement names a
  French village, is placed at Tate Britain though it hangs at Tate Modern. One work of the eight the
  Tate's name moves; a curator moves it by hand.
- **The Royal Collection stays a holding, and its works go where their location says.** Its item
  carries `museum` and Buckingham Palace's coordinate, but the palaces and galleries that say they
  are part of it make it an umbrella of several houses, so it is refused as before; *The Music
  Lesson* and *The Tribuna of the Uffizi* land at Buckingham Palace, which their location
  statements name, and *Boy Peeling Fruit*, whose location names no venue, is placed nowhere.
- **The Museo Soumaya still does not arrive.** Its item resolves to its Plaza Carso house, but the
  works that name it — casts of *The Kiss* and *The Gates of Hell* — carry a preferred or
  corroborated statement for the Musée Rodin and the Orsay, where the placement rule leaves them.
  The Soumaya enters when a work it holds alone crosses the line.

## References

- Related ADRs: ADR-0040, ADR-0084, ADR-0166
- Related docs: `docs/tech/experiences.md` § Venue resolution
- Issues: #1617
