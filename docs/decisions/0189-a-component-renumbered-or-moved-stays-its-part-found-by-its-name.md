# ADR-0189: A component renumbered or moved stays its part, found by its name

**Date:** 2026-11-08
**Status:** Accepted

---

## Context

A serial World Heritage site's components are places, part of the site, and the run finds a
part by the component's reference (ADR-0100 decision 3). A component's point pairs with a stored
point by the reference together with the point (ADR-0027). The reference can be read past the
inscription's variant: `829bis-001` and `829ter-001` are one reference within ten metres (ADR-0090).
Beyond that, a changed reference or a changed point is a withdrawal plus an arrival (ADR-0090
decision 2).

Two shapes of UNESCO's list break that, measured on the development catalogue on 2026-11-08 (#2182):

- **A list renumbered within one inscription.** Western Tien-Shan (1490) went from 13 components
  to 11. The Chatkal reserve's Maidantal area went from `1490-012` to `1490-010` at the same point,
  and the Bashkizilsay area went from `1490-013` to `1490-011`, 3.5 km on. The Boraldaitau area
  went from `1490-005` to `1490-003`, 85 km on. The run read each new number as the component the
  old number had named. `1490-003`'s arrival held the Karabastau area, which the list had dropped,
  and every arrival was parted as a new place. That left ten references, each holding two different
  reserves, and two "lost" questions about reserves the list still names.
- **A component that moved under its own number.** Its arrival was parted as a place of its own
  beside the part whose point it replaced (`part_site_components`). Fourteen such pairs stood on
  Champagne, Getbol, Mangystau, the Mijikenda Kaya Forests and the Ahwar of Southern Iraq, two of
  them made by runs on 2026-11-05.

The variant rule cannot serve the first shape: `1490-012` and `1490-010` are different
components in the bare reading too, and the reference is exactly what changed. What stayed is the
name. The list names every Tien-Shan reserve exactly as it did, so the name is what carries the
component across the renumbering. The point is what keeps a name from reaching a namesake
elsewhere in the site.

## Decision

1. **A component renumbered at its point is its one row.** The World Heritage run pairs a stored
   point with an incoming point of another bare reference when the two names are the same, folded
   (`name_match_key`), and the points are within ten metres (`renumberedSql`). The row is kept
   and takes the new number, as a variant match does (ADR-0090 decision 1). It ranks after every
   pairing by reference, so a component whose number stayed keeps its row first. A name that names
   nothing (`names_nothing`) pairs nothing. No other source's run reads it, since only the World
   Heritage run's references are component numbers.
2. **A moved component is held by its own arrival.** Under a gate, a withdrawal the run holds is
   paired with an arrival of the same name first (`heldByNameSql`), then by reference, then by
   position (ADR-0027 decision 5). This holds even when the component was renumbered as well as
   moved.
3. **A moved component's arrival goes on its part.** `part_site_components` puts an arrival on the
   part whose point it replaces, instead of parting it, when that point has the same name. That is
   the point the arrival holds, or else a point the list dropped, on a part with no other point
   standing. The part then holds the point it moved from beside the one it moved to. It follows the
   one a reader sees: a standing point before a withdrawn one, a published one before an arrival
   waiting for a curator (`partFollowsSql`). Its relation takes that point's reference.
4. **The lost-point card measures a moved component on its part.** What replaced a part's
   withdrawn point is a point on the same part, or a point of the same reference and the same name.
   A point that only shares the reference does not count: a renumbered list gives a dropped
   component's number to another, and the Karabastau area, dropped as `1490-003`, did not move
   35 km to become the Boraldaitau area. The card names the number the source lists the part under
   now where it differs (`replacedRef`).

This extends ADR-0090 decision 1 from a variant of the reference to a renumbering within one
inscription, by the name at the same point. It narrows ADR-0100 decision 3: the run finds a part by
the component's reference, and by its name where the reference changed or the point moved.

## Alternatives Considered

| Option | Why rejected |
|--------|-------------|
| Pair by the point alone across references | The list repeats one coordinate across distinct components: site 874 gives seventeen separately named rock shelters one point (ADR-0027). |
| Pair by the name alone, at any distance, as a kept row | Under a gate, a kept row's coordinate is written at once, so a move of 85 km would pass no curator. A move stays a withdrawal plus an arrival, as ADR-0027 has it. Only the part it lands on changes. |
| Merge the rows the development catalogue already holds | A fresh database never forms them. The duplicates migration 094 parted are #2119's, and the per-country listings under one reference (Maloti-Drakensberg, iSimangaliso) are real and stay. |
| Wait for the source records of #2124 | #2124 pairs components over source records and plans the same name pass. Until it lands, the run makes a second part on every move, and a renumbering raises false "lost" questions. |

## Consequences

**Positive:**
- A renumbered list leaves one part per component, and only a component the list dropped is asked
  about as gone.
- A move keeps the place, its visits and its record. The card says where it went, under which
  number.

**Negative / Trade-offs:**
- A component renamed and moved at once, under its old number or a new one, is not recognised.
  Its arrival is a new part, and the old part is asked about as gone. The name does not carry it,
  a number can pass to another component, and a point alone is no identity.
- A part holds two points while a move waits for a curator, as a place of one point did before
  parts.
- A dropped component keeps the number it was last listed under. A new component may take that
  number, so the two parts share it: one standing and one withdrawn.

## References

- Related ADRs: ADR-0027 (a point is its reference within ten metres), ADR-0090 (a component
  renumbered by an extension), ADR-0100 (a serial site's components are places), ADR-0156 (a
  part's record)
- Related docs: `docs/tech/experiences.md` § A serial site's components are places, part of the
  site
- PR / issue: #2182, #2119, #2124
