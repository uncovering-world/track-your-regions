# ADR-0185: Archaeology reads a World Heritage listing as a mark and as the map

**Date:** 2026-11-08
**Status:** Accepted

---

## Context

Archaeology misses ruins that the World Heritage List inscribes and every guide lists. #2156
measured the gap on the development subset on 2026-11-04 (the issue's comment of that day):

- 226 whole listings sit under Archaeology's site tree (`P757` with a `P31` under `Q839954`).
- The kind admits 171 of them and misses 55.
- 27 of the 55 are already offered under the dig's own item. Mérida's theatre, circus and Temple of
  Diana are Archaeology's, and so are Knossos, Ephesus, Delphi and Babylon. Those are matching (#2151),
  not admission.
- Of the 28 real misses, a traveller would call 13 ruins one goes to see. Among them are the Moidams
  of Charaideo, the Early Christian Necropolis of Pécs, SGang Gwaay, Sabratha, Red Bay, Qaryat al-Faw,
  Liangzhu, Tyre and Aksum.

Two rules keep them out:

- **The world tier's bars** ([ADR-0175](0175-a-place-kind-admits-by-quantiles-of-its-own-pool.md)).
  A ruin read in few languages reaches the readers' bar of a marked place only when a Wikivoyage guide
  uses it or Atlas Obscura lists it ([ADR-0163](0163-a-site-a-wikivoyage-guide-uses-opens-the-readership-door-at-the-12th-percentile.md)).
  Qaryat al-Faw, Liangzhu and Tyre carry neither mark.
- **The surroundings tier's map condition**
  ([ADR-0179](0179-archaeologys-sites-admit-by-the-frame-and-its-surroundings-tier-asks-the-map-for-a-ruin.md)
  decision 3). A site there needs an OpenStreetMap object that carries its item and maps a ruin or a
  dig. A listing is often drawn as a protected area, or carries no item at all. Its ruins are separate
  objects with their own items.

The measurement read five doors (A–E on #2156). The maintainer chose D and A on 2026-11-08.

## Decision

**1. Archaeology's world tier reads a World Heritage listing as a guide's mark (door A).**
- A candidate the World Heritage List inscribes (`P757`, or `P1435` naming World Heritage, as the
  site rule reads it) is marked as one a guide uses. The readers' bar of a marked place then applies.
- Archaeology passes its listed candidates to the world tier (`openWorldTier`'s `listed`,
  `WorldRead.listed`). No other kind reads the listing, since its World Heritage sites are kind 1's.
- A refusal and the curator's note name the mark ("the World Heritage List inscribes it"), and the
  bars name it among the marks.
- The register states it (`ARCHAEOLOGY_WORLD_REGISTER.listedIsAMark`).

**2. In Archaeology's surroundings tier, a World Heritage listing stands in for the map (door D).**
- A survivor the World Heritage List inscribes passes ADR-0179's map condition whatever OpenStreetMap
  tags carry its item.
- It does not pass where a place Archaeology holds or admits is part of it: a held item is part
  (`P361`) of the listing, or the listing has it as a part (`P527`), read off the subset
  (`heldPartsOf`).
- Mérida's listing beside the theatre the kind holds is the same visit twice, and is refused, with the
  part named.
- The register states it (`ARCHAEOLOGY_SURROUNDINGS_REGISTER.listedStandsForTheMap`).

**3. Three listings open neither door.** The first main-against-branch dry run (2026-11-08) let these
in, and none is a ruin the kind lacks (`listingOpensTheDoors`):
- **An archaeology museum.** The National Archaeological Museum of Paestum is typed an archaeological
  museum and park. Archaeology admits a museum by its finds (ADR-0058), and Paestum is its site.
- **An old town.** The Old City of Hebron and Mazagan are living cities, and so is every World
  Heritage listing typed `old town` (`Q676050`): Vilnius, Florence, Damascus. Ruins typed an ancient
  city, Tyre and Beikthano, are not old towns and keep the doors.
- **A part (`P361`) of a place the kind holds.** The Palace of Knossos is Knossos's visit, and
  Baalbek's Temple of Jupiter is Baalbek's.

**4. Aksum stays a curator's to add.** Its listing sits on an item with no article and on the modern
town. Only door E (a listed site with no floor) reaches it, and E brought nine places that are not
ruins for the thirteen it brought that are.

## Measurement

From #2156's measurement of 2026-11-04 (whole listings + components):

| Door | Admits | Reads |
|---|---|---|
| A. A listing counts as a guide's mark | 5 + 3 | Qaryat al-Faw, Liangzhu, Tyre; 2 duplicates of places held |
| D. A listing stands in for the map, with the held-parts check | 14 listings + 13 components | Mostly ruins: the Moidams, Pécs, SGang Gwaay, Sabratha, Red Bay; Aztec Ruins, Tito Bustillo and Qubbet el-Hawa among the components |
| B. A listing and the kind's rule alone | 45 + 218 | 62 % of the listings not ruins or duplicates |
| C. A listing and a guide or Atlas Obscura mark, no readers' bar | 21 + 61 | about a quarter not Archaeology's |
| E. A listing with no floor or bar | 33 | 13 ruins, 5 unsure, 9 not, about 6 duplicates |

D and A together reach about ten of the thirteen certain misses. B and C bring too much noise.
A main-against-branch dry run on dev is posted on the pull request before the change merges.

## Consequences

- A ruin the World Heritage Committee inscribed enters Archaeology on its listing's evidence where the
  map draws it as a protected area, as Kamphaeng Phet's historical park is drawn. A finds spot with
  nothing to see that the List inscribes, such as a component of the South African Pleistocene sites,
  can now enter. The curator answers it, as every Archaeology arrival waits for one.
- A listing whose parts the kind holds stays out. One whose parts the kind does not hold enters as one
  place, and its parts, if they arrive later, are refused as parts of it (ADR-0179 decision 3).
- The two directions are read differently. A listing's held parts are read both ways, a `P361` to it
  or a `P527` from it, against what the kind holds or admits outside the surroundings step. A part
  coming through the cut beside its listing is refused only by its own `P361`, which ADR-0179
  decision 3 reads. Where only the listing's `P527` names the part, both enter. The dry run on the
  pull request shows how often that happens, and widening ADR-0179's reading to `P527` is a change
  of that rule for every site, not only listed ones.
- The world tier's other kinds are unchanged: `listed` is absent for them.

## Alternatives considered

| Alternative | Why not |
|---|---|
| Doors B, C or E | Measured above: each brings far more places that are not ruins, or duplicates, than misses it reaches. |
| A curator adds each miss | The catalogue would hold rule exceptions nobody tracks; the maintainer asks that a loss be fixed in the rule. |
| Read the listing as a mark for every place kind | The other kinds' World Heritage sites are World Heritage's own kind; only Archaeology was measured. |

## Related

- ADR-0163, ADR-0175, ADR-0179 (decision 3 narrowed here), ADR-0181.
- #2156, #2151, #2146, #2381.
