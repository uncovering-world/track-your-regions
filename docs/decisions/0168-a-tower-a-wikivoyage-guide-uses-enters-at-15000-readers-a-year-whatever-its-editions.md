# ADR-0168: A tower a Wikivoyage guide uses enters at 15,000 readers a year, whatever its editions

**Date:** 2026-10-31
**Status:** Accepted

---

## Context

Towers fills its world tier by a line of two measures (`TOWER_LINE`, `towers/kind.ts`;
`docs/sources/global/wikidata-towers.md` § The line): 15 Wikipedia editions and 25,000 readers a
year to enter, 12 and 18,000 to stay. The kind's calibration list of 68 towers (#1951) shows what
the line misses (#1972): twelve tops are described in fewer than 15 languages — Bologna's Asinelli
and Garisenda towers (9 and 7 editions), the Dom Tower of Utrecht (8), the Martinitoren and the
Torre dei Lamberti (13), the Torrazzo of Cremona and Kalta Minor (14), Reunion Tower, the Three
Pagodas of Chongsheng Temple and the Leaning Tower of Nevyansk — and two, the Iron Pagoda of
Kaifeng and the Songyue Pagoda, stand in the pool at 20 editions and under 25,000 readers. Every one
is climbed or stood under by everyone who comes to its town.

The #1997 report measured the signals under the line. For Towers the guide alone brings both tops
inside the pool with real towers; under the pool's floor the guide with a year of readers brings
the tops with mostly real towers. The maintainer sized the door on that data and decided on
2026-10-30, on #1972: a tower that a Wikivoyage guide uses and that a year of readers puts at
15,000 or more enters, whatever its count of Wikipedia editions, for a curator. At 15,000 the door
reaches 12 of the 16 tops it can reach; at 10,000 no more, with twice the places.

Archaeology (ADR-0163) and Monuments & memorials (ADR-0167) open a guide door under their lines;
Bridges and Squares read a guide as a lower readers' bar inside their pool (`places/guidedLine.ts`).
None reads under the pool's floor by the guide; ADR-0152 and ADR-0165 read under it by readers
alone.

## Decision

This stands beside Towers' line, which is unchanged.

1. **A tower that passes the kind's rule, that a Wikivoyage edition uses and that the latest year of
   readership reads 15,000 times or over enters, whatever its count of editions, for a curator**
   (`TOWER_GUIDE_DOOR`, `towers/kind.ts`). The curator's question is the row's admission note: the
   editions, the readers, the guide and the bar, and whether it is a tower a visitor goes to see.
2. **The door reads under the pool's floor** (`towers/underFloor.ts`): the readership names every
   item read at the bar in fewer than 15 editions, the guide narrows them, and Wikidata is asked
   which of those carry a tower class with a point, then for their rows and classes. They join the
   share as a class question's rows would, and the rule reads them unchanged.
3. **A tower the door admitted stays while a guide uses it and the year reads it over 10,800** — the
   line's own ratio of stay to enter — and falls with the guide named once it does not. The door is
   shut while the source's curator gate is off (ADR-0056 decision 5) and while no Wikivoyage usage
   build is in place: nothing is read under the floor, nothing enters by it, and a held tower under
   the line keeps its place with a note saying so.
4. **The bar is a count, 15,000, stated once.** #2145 restates every readers' bar as a rule that
   follows the year's readership and changes that one line.

## Alternatives Considered

| Option | Why rejected |
|--------|-------------|
| Lowering the editions line, step by step | Each step gains two tops and lets in the pagodas bots wrote (#1972's table); the Asinelli Tower at 9 editions would need a line no bot-written pagoda respects. |
| The guide alone, as Monuments & memorials reads it (ADR-0167) | A tower is a form, and many are towers nobody visits; the readers tell the Asinelli Tower from a water tower a guide mentions in passing. |
| The guide as a lower readers' bar inside the pool only, as Bridges read it | Ten of the twelve missing tops stand under the pool's floor; a door that stops at the floor reaches two. |
| 10,000 readers | No more tops, about twice the places (#1972, the maintainer's measurement). |
| A holder's editions for the pagodas of Hōryū-ji, Daigo-ji and Rurikō-ji and the bell tower of Curon | Each is an item of its own with no article; a year of readers reads nothing of them either. Out of this decision's reach, and noted on #1972. |

## Consequences

**Positive:**

- On the development subset, read-only, the door brings 110 towers for a curator: 17 inside the pool
  (the Iron Pagoda, the Songyue Pagoda, Kiek in de Kök, the Kızıl Kule, the Troitskaya Tower, the
  Leaning Tower of Toruń) and 93 under its floor (the Asinelli and Garisenda towers, the Dom Tower of
  Utrecht, the Torrazzo, the Martinitoren, the Torre dei Lamberti, Kalta Minor, Reunion Tower, the
  Three Pagodas, the Leaning Tower of Nevyansk, the Gros Horloge, the Guinigi Tower, the Watts
  Towers). Twelve of the canon's sixteen reachable tops are among them. Nothing admitted before is
  lost.

**Negative / Trade-offs:**

- **110 arrivals for a curator to read.** A few are no tower a traveller climbs — the Laboe Naval
  Memorial, the Avicenna Mausoleum, the Rottweil elevator test tower, the Emley Moor transmitting
  station, a castle or two Wikidata types a tower — and a curator refuses them once.
- Five items the readership named under the floor are refused by the rule by name (two lighthouses,
  a sculpture, a nuraghe, a gate tower) and appear in the run's report as refusals.
- While no year of readership is read, the door cannot be asked: a held tower a guide uses keeps
  its place with a note saying so, whatever its editions, as the line keeps its own on editions.
- Kuala Lumpur Tower and the Torre Latinoamericana, typed skyscrapers, and Beijing's Drum and Bell
  Towers, a building complex, stay out: the rule's, not the door's (#1972). The Montreal Tower is read
  under the bar.

## References

- Related ADRs: ADR-0131 (Towers), ADR-0152, ADR-0163, ADR-0165, ADR-0167
- Related docs: `docs/tech/experiences.md` § Towers; `docs/sources/global/wikidata-towers.md`;
  `docs/research/2026-10-30-what-other-signals-find-under-a-kinds-editions-line.md`
- Issues: #1972, #1997, #1951, #2145
