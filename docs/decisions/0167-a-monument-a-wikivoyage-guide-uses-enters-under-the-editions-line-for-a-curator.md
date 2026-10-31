# ADR-0167: A monument a Wikivoyage guide uses enters under the editions line, for a curator

**Date:** 2026-10-31
**Status:** Accepted

---

## Context

Monuments & memorials fills its world tier by the editions line every Wikidata kind uses
(ADR-0023): a candidate enters at 22 Wikipedia editions and stays at 18, from a pool whose floor
is 15. The kind's calibration list of 64 monuments nobody who knows them would dispute (#1954)
shows ten of its missing tops standing between that floor and that line, more than any other
kind's (#1989): the Voortrekker Monument (20 editions), Cristo de la Concordia and the Monumento a
la Revolución (19), the National World War II Memorial (18), the Berlin Wall Memorial, the Scott
Monument and Mitad del Mundo (17), the Kigali Genocide Memorial and the USS Arizona Memorial (16),
the Shrine of Remembrance (15).

The #1997 report measured five signals on the candidates under each kind's line. For Monuments &
memorials a year of readers at the median of the kind's own places reaches two of its three
measured tops in 92 places, most of them tombs, national historic sites and kofun filed as
monuments. A Wikivoyage guide's use of the item reaches all ten tops and 64 more, nearly all of
them monuments: Buzludzha, the Kyffhäuser Monument, *Fearless Girl*, the Menin Gate, Sardarapat,
Potsdam's Brandenburg Gate. A few are not — Muir Woods and Rainbow Bridge, which the United States
calls national monuments and which are a forest and a natural arch, and Stonehenge's World
Heritage item. Below the pool's floor the guide brings few tops and many misfiled places. The
maintainer decided on 2026-10-30, on #1989: under the editions line, a candidate a Wikivoyage
guide uses enters, for a curator.

Archaeology (ADR-0163), Squares & streets and Bridges (`places/guidedLine.ts`) read a guide's use
as a *lower readers' bar*. Public art reads a year of readers alone (#2033). Monuments & memorials
has read neither.

## Decision

This narrows ADR-0023 for Monuments & memorials. Its editions line stands; one door opens under it.

1. **A candidate of Monuments & memorials under the editions line that passes the kind's rule and
   that a Wikivoyage edition uses enters, for a curator** (`publicArt/guideDoor.ts`,
   `guideDoorCandidates` in `publicArt/pipeline.ts`). The door asks the guide and nothing else: no
   readers' bar, since under this kind's line readers measure fame of the wrong sort, and the
   kind's rule, the pool's floor and the curator's gate keep the rest. The curator's question is
   the row's admission note: the editions, the line, that a guide uses it, and whether it is a
   monument a visitor goes to see.
2. **The door reads the pool from its floor of 15 editions and no further.** Under the floor the
   guide brings few tops and many misfiled places. A place the street-art entrance names in fewer
   editions is not the door's.
3. **A row the door admitted stays while a guide uses it, and falls with the guide named once none
   does.** The door is shut while the source's curator gate is off (ADR-0056 decision 5: every
   arrival through it is for a person to read, as through every door under a line) and while no
   Wikivoyage usage build is in place: nothing enters by it, and a held row under the stay line
   keeps its place with a note saying so, as a place keeps its place while no year of readers can
   be read.
4. **Public art opens no guide door.** The report measured the guide as bringing it few tops.

## Alternatives Considered

| Option | Why rejected |
|--------|-------------|
| A year of readers at the kind's median, as Public art reads (#2033) | Two tops of three in 92 places, most of them tombs, national historic sites and kofun filed as monuments (#1997). |
| The guide as a lower readers' bar, as Archaeology reads it (ADR-0163) | The readers' bar adds nothing the guide does not already answer here, and keeps out a top the guide names that few read. The guide alone reaches every missing top with few false arrivals, and every arrival waits for a curator. |
| Lowering the editions line | Every candidate between 15 and 22 editions enters, 552 of them on the development subset, with no sign that a traveller goes there. |
| The guide door under the pool's floor too, as the finds door reads under it (ADR-0165) | Few tops there (the Vimy Memorial, Maqam Echahid) and many misfiled places. |

## Consequences

**Positive:**

- On the development subset, read-only, the door brings 75 places for a curator and keeps two held
  rows the line alone would have dropped (the Victory Arch and the Warsaw Uprising Monument, 16
  editions each). Among the 75 are all ten tops of the canon under the line, and the Franklin
  Delano Roosevelt Memorial, the Menin Gate, the Brandenburg Gate, the Niederwalddenkmal, the
  Murambi, Nyamata and Srebrenica genocide memorials, the Jan Hus Memorial and *Fearless Girl*.
- The same measurement read the kills a commemorative class now lifts (#1989,
  `MEMORIAL_LIFTED_KILLS`, a rule change beside this decision): Yad Vashem, Anıtkabir, the Walhalla,
  the United States Holocaust Memorial Museum, the Mausoleum of Mao Zedong, the Ho Chi Minh
  Mausoleum and Mazar-e-Quaid enter at the line, and Nagasaki Peace Park and the Australian War
  Memorial reach the door.

**Negative / Trade-offs:**

- **75 arrivals for a curator to read.** Three are no monument — Muir Woods, Rainbow Bridge and the
  World Heritage item of Stonehenge, Avebury and Associated Sites — and a curator refuses them once.
- A top a guide does not use stays out, however many visit it; none of the canon's is such a case.
- The tops no run names — Mount Rushmore, whose item is the mountain, the Monument to the Battle of
  the Nations, Patuxai — are Wikidata's typing, which no door under the line reaches; the entrance
  through English Wikipedia's *Monuments and memorials in …* categories is a decision of its own.

## References

- Narrows: ADR-0023, for Monuments & memorials
- Related ADRs: ADR-0132, ADR-0163
- Related docs: `docs/tech/experiences.md` § Public art and Monuments & memorials;
  `docs/research/2026-10-30-what-other-signals-find-under-a-kinds-editions-line.md`
- Issues: #1989, #1997, #1954
