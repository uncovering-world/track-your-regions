# ADR-0161: A holy place is a place of worship, and a year of readers opens a door under the line

**Date:** 2026-10-30
**Status:** Accepted

---

## Context

ADR-0052 fills *Places of worship* through two doors on one editions line: the place's own fame
and the fame of a work it holds. Door one reads the tree under *structure of worship*
(Q1370598). The ADR rejected two alternatives:
- the `sacred place` tree (Q4588528), whose rows at the line were mostly landscape;
- a lower line on the world signal.

It accepted as a consequence that the Western Wall and the Kaaba are not in the kind.

Three things have moved since then.

**The kind's definition names holy places that are no building.** The coverage register
(`db/catalogue-coverage/kinds.jsonl`, 2026-10-02) defines the kind as "a place people go to
worship, pray or make a pilgrimage … a holy spring, grove, lake or mountain where the place
itself is what is venerated". The maintainer confirmed on 2026-10-30 that the kind is holy places
in general, and that the Western Wall plainly belongs to it.

**The kind's calibration list (#1955) names tops the editions line misses.** Seven sit under the
line inside the pool: Mont-Saint-Michel Abbey (19 editions), the Sanctuary of Fátima (16), the
Virupaksha Temple at Hampi (16), the Dilwara Temples, the Jade Buddha Temple, Wat Xieng Thong
and the Salt Cathedral of Zipaquirá. Lowering the line to 16 would bring them with about 850
ordinary cathedrals and churches (#1978).

**#1997 measured other signals on the kind's own pool.**
- A year of readers at 25,000 reaches all seven tops in 484 places, mostly places a traveller
  seeks out: the Jyotirlinga temples, Zenkō-ji, Florence's Baptistry.
- A Wikivoyage guide misses Fátima and Hampi, whose own items no guide uses.

Read again on the subset, the `sacred place` tree brings 37 places not in the kind:
- holy places a traveller goes to: the Western Wall, Kailash, Fuji, Mount Arafat;
- mountains no one worships at: Kanchenjunga, Rainier;
- objects kept inside a building or a museum: the Black Stone, the Pergamon Altar;
- cities, rivers and relics.

The maintainer asked that a rule rather than a curator remove what is plainly no place to go,
since curators already have thousands of cards to read.

## Decision

This narrows ADR-0052 decisions 1 and 2. Decisions 3 to 6 stand.

**1. A holy place is a place of worship.** Door one reads the `sacred place` tree beside the
building tree (`worship/holyPlaces.ts`). A holy place lifts the hill and mountain kills. A holy
place that carries no class of the building tree is refused in three cases:
- it is a city or a city's walls (Anuradhapura, the Walls of Jerusalem);
- its location (`P276`) is a building of worship or a museum, so the object is that place's (the
  Black Stone and the Kaaba are Al-Masjid Al-Haram's, the Pergamon Altar the museum's);
- it is a landform no faith (`P140`) and no pilgrimage class (pilgrimage site, shintaisan,
  sangō, religious complex) is named for (Kanchenjunga, Rainier, Shiprock).

Rivers, terms, places of myth and relics are refused whatever else they carry. Two types file
what remains: *sacred mountain* and *holy site*.

**2. A year of readers opens a door under the editions line.** A place the rule passes and the
editions line leaves out enters when a year of readers puts it at 25,000, and stays while it
reads 18,000 (`WORSHIP_READERS_LINE`). Its arrival carries the reading for the curator, since the
source gates every arrival (ADR-0052 decision 5). With no year read, the editions line alone
decides. The counts follow the year's readership once #2145 decides how.

## Alternatives Considered

| Option | Why rejected |
|--------|-------------|
| Keep the Western Wall a curator's hand, as ADR-0052 did | The kind's definition and the maintainer name holy places as the kind's own. A class rule that reaches them, with refusals read off the rows it brings, leaves a curator 13 holy places to read instead of the whole tree. |
| Admit every holy mountain and let the curator refuse the peaks | The maintainer asked for curators to be spared what a rule can decide. Wikidata's `P140` and the pilgrimage classes tell Kailash and Kōya from Kanchenjunga and Rainier. |
| Lower the editions line to 16 | It brings the seven tops with about 850 ordinary cathedrals and churches (#1978), which is the cost ADR-0052 rejected a lower line for. |
| A Wikivoyage guide with readers, as Towers and Public art decided | The guide misses Fátima and Hampi, whose own items no guide uses (#1997). |

## Consequences

**Positive:**

- The Western Wall, Kailash, Fuji, Mount Arafat and Mount Kōya are offered. Every top of the
  calibration list under the line arrives for a curator.
- What `sacred place` brings that a traveller does not go to is refused by a named rule, so the
  review queue holds 13 holy places rather than 37.

**Negative / Trade-offs:**

- **485 arrivals by readers on the development data**, each read by a curator. Most are real
  places of the second rank: Le Thoronet, Silos, Torcello, provincial cathedrals.
- **Holy mountains that name no faith on Wikidata are refused** with the peaks: Ontake, the Three
  Mountains of Dewa, Ōmine. They are the regional tier's.
- **The location test applies to a holy place only.** A building of worship inside another stays
  admitted on its own fame (the Sistine Chapel, ADR-0052).
- Meteora, Shah-i-Zinda and the Batu Caves carry no holy class and are still not reached (#2146).
- The gather reads the containers of the kind's pool on every run (`readsContainers`).

## References

- Narrows: ADR-0052 decisions 1 and 2
- Related ADRs: ADR-0056 (the works door's readership), ADR-0127 (Archaeology's readers door),
  ADR-0048 (the world tier)
- Related docs: `docs/tech/experiences.md` § Places of worship,
  `docs/sources/global/wikidata-places-of-worship.md`
- Issues: #1978, #1997, #2145, #2146
