# ADR-0164: A find its readers carry counts as one at the finds' line

**Date:** 2026-10-30
**Status:** Accepted — decision 1 extended under the pool's floor by ADR-0165

---

## Context

ADR-0058 decision 2 admits an archaeological museum under the place line when it holds a find
above the finds' line (Delphi at 15 editions, for the Charioteer). The finds' line is 18
editions to enter and 15 to stay (decision 5). ADR-0056 opened a door for Art Museums' and
Places of worship's works: a work under the line whose year of readers reaches a percentile of
the works at the line counts as one at it. Archaeology's finds had no such door.

The finds' calibration list (#1988) holds 85 finds nobody who knows them would dispute. #1999
measured the misses on the development catalogue and on the subset of the dump of 2026-10-19.
The probe collected Archaeology's own finds pool (`findsCollectorOptions`) and read a year of
readers per find with the code's counter (`readWorks`):

- The pool holds 438 finds, all at 10 editions or more. 111 are placed and reach the line, and
  163 are placed under it.
- Eight canon finds are in the pool under the line. Their readers are real: the Boxer at Rest
  109,326 a year, the Bull-Leaping Fresco 45,745, the Flying Horse of Gansu 44,327, the Kroisos
  Kouros 31,556.
- At the 12th percentile of the finds at the line (26,222 readers), the door admits 57 finds
  under the line and 14 museums new to Archaeology. It reaches 5 of the 8 canon finds.
- At the 25th percentile (40,671), it admits 21 finds and 7 new museums.

Two of the readers' favourites are no finds:

| Item | Readers a year | Class | What it would admit |
|---|---|---|---|
| London Hammer | 152,397 | out-of-place artifact | the Creation Evidence Museum |
| *Chōjū-jinbutsu-giga* | 155,613 | emakimono | — (Tokyo National Museum is admitted already) |
| *Mōko Shūrai Ekotoba* | 47,568 | emakimono | the Museum of the Imperial Collections |

An out-of-place artifact is pseudo-archaeology. An emakimono is a painted handscroll, which
nobody dug up.

The run itself was then read through its own pipeline on the same subset, main against this
decision (read-only, `archaeologySource().fetchItems`):

- The bar is 27,180 readers a year to enter and 20,576 to stay, over every find the pool holds at
  the line. The door opens for 78 finds.
- 44 finds the admitted museums show are badged by their readers. Among them are the Sutton Hoo
  helmet, the Pilate Stone, the Jockey of Artemision, the Boxer at Rest and the Bull-Leaping
  Fresco.
- 10 museums are new to Archaeology, and none leaves it. They include the Salisbury Museum (the
  Amesbury Archer), the Museo Santuarios Andinos (Mummy Juanita), Oslo's Museum of Cultural
  History (the Gjermundbu helmet) and the Gansu Provincial Museum. Each arrives for a curator with
  its find's reading.
- With the two refusals below, neither the Creation Evidence Museum nor the Museum of the Imperial
  Collections arrives.

## Decision

This narrows ADR-0058 decision 2 and extends ADR-0056 decisions 1 to 3 to Archaeology's finds.

**1. A find under the finds' line whose year of readers reaches the 12th percentile of the
finds at the line counts as one at it, and stays down to the 8th** (`ARCHAEOLOGY_FINDS_DOOR`,
`readershipDoorFor`).

- It admits its museum as a find at the line does: for the holders (`findHolders`) and for the
  museum's verdict (`museumVerdict.ts`).
- It is badged by its readers (`readIconic`), and the museum counts it toward its own badge.
- A museum it alone carries in names its readers to the curator who reads the arrival
  (`doorNote`), as ADR-0056 decision 5 requires of every venue a door admits.
- The door is shut while the source's curator gate is off.
- The door reads the finds pool the classes collect. An object the venue-side read (#890) keeps
  at a museum the run admits is judged by the line alone. It is read only at a museum already
  in, so the door would add a badge there and no museum.

**2. An out-of-place artifact and an emakimono are no finds** (`NOT_A_FIND`, matched as a row's
own class, since neither is natural history).

## Alternatives Considered

| Option | Why rejected |
|--------|-------------|
| Lower the finds' line | Editions measure languages. China's bronzes and Tutankhamun's throne are read in a few, and lowering the line brings every hoard named in two. |
| The 25th percentile | 21 finds and 7 museums, but only the Boxer at Rest, the Bull-Leaping Fresco and the Flying Horse among the canon's eight. |
| ADR-0056's median | It reaches none of the canon's eight under the line except the Boxer at Rest. |
| Leave the finds to a curator's hand | A rule can name them, and curators already read thousands of cards. |

## Consequences

**Positive:**

- The Flying Horse of Gansu, the Boxer at Rest, the Bull-Leaping Fresco, the Jockey of
  Artemision and the Kroisos Kouros are badged where they are shown.
- The Sutton Hoo helmet, the Pilate Stone, the Gjermundbu helmet, the Panagyurishte Treasure and
  Mummy Juanita join them.
- The museums new to Archaeology arrive for a curator: the Gansu Provincial Museum, Plovdiv's,
  Navarre's and the Museo Santuarios Andinos among them.
- The bar follows the year's readership without a number to move.

**Negative / Trade-offs:**

- **A find under 10 editions never enters the pool**, so no door on the line reaches it: the
  Houmuwu ding, the four-goat zun, the Marquis Yi bells, Sanxingdui, Tutankhamun's throne and
  chariots, the Muisca raft and the Berlin Gold Hat. That is the pool's floor, a separate
  question (#2159).
- **A find named only by a concept item reaches nothing**: the Code of Hammurabi is a law code
  on Wikidata, Ötzi a human, with no collection or location (#1751).
- Three canon finds in the pool stay under the bar: the Sphinx of Naxos (25,460), the Market
  Gate of Miletus (21,409) and the Ram in a Thicket (19,871).

## References

- Narrows: ADR-0058 decision 2
- Extends: ADR-0056 decisions 1 to 3, to Archaeology's finds
- Related ADRs: ADR-0162 (Art Museums at the 12th percentile), ADR-0163 (the guided site door)
- Related docs: `docs/tech/experiences.md` § Archaeology
- Issues: #1999, #1988, #2145, #1751, #2159
