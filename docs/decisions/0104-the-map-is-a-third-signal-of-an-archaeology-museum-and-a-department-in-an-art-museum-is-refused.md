# ADR-0104: The map is a third signal of an archaeology museum, and a department in an art museum is refused

**Date:** 2026-10-14
**Status:** Accepted

---

## Context

ADR-0058 decision 2 reads a museum's nature off two signals: the English Wikipedia category `Archaeological museums in …` and a Wikidata class under `archaeological museum`. A museum whose categories name only an antiquities department (`Museums of ancient Greece in …`, `Egyptological collections in …`) arrives held for a curator. The department categories are read only of museums something else already named. #889 found two museums that no door names at all:

- **The Altes Museum in Berlin** (44 Wikipedia editions). It houses the Antikensammlung, the Greek, Etruscan and Roman antiquities a traveller goes to Museum Island for. Wikidata types it `history museum` and `art museum`. English Wikipedia files it under `Museums of ancient Greece in Germany` and nowhere archaeological. No find above the finds' line stands there.
- **The History Museum of Armenia in Yerevan** (27 editions), the country's archaeology museum in practice. Its article is under `History museums in Armenia`. Its own category, `Category:History Museum of Armenia`, is filed under the bare `Archaeological museums`.

Measured on 2026-10-14:

- **The bare root.** `Category:Archaeological museums`, the parent of the country shelves, holds 60 articles filed there directly that the walk never read. Among them are the Erebuni Museum, the National Museum of Sudan, the Rockefeller Archeological Museum, and the national museums of Finland, Slovakia and Singapore.
- **The department shelves.** Walked to their country level, they name 400 articles. 43 of them are at or above the place line with no nature category, and about 27 of those are in no kind. All but a handful are art museums with an Egyptian or classical gallery: Cleveland, Denver, Houston, Toledo, Baltimore. As a door that lands every arrival held, the shelves would ask a curator about 27 times to reach two or three museums.
- **Wikidata's class does not separate the two.** The Altes Museum is `art museum` like Cleveland.
- **OpenStreetMap's `museum=*` tag does.** The Altes Museum and Dumbarton Oaks are mapped `museum=archaeological`. Cleveland, Denver, Houston, Toledo, the Metropolitan Museum and the Ny Carlsberg Glyptotek are mapped `museum=art`. The tag is precise and sparse:
  - It is on 23 of the 84 archaeology museums the source admits, and on 1 of the 100 art museums Art Museums admits.
  - `museum=art` is also on the Louvre, the Pushkin Museum, the Kunsthistorisches Museum and the Tokyo National Museum. These are museums of both natures, so the art tag cannot refuse a museum that carries an archaeological signal.

## Decision

1. **The map is the third signal of the nature.** A museum whose mapped objects carry `museum=archaeological` is archaeological by nature, with the reason `map: museum=archaeological`. The run reads the `museum` tag of every museum candidate once per pass, through the same map door the site door reads. The tag is a traveller's view: whoever tagged it stood at the door. Its absence says nothing, because most museums carry no `museum` value at all. A natural-history class is no mark against a museum the map calls archaeological, just as it is none against one the category or the class calls so (ADR-0103 decision 3).
2. **The bare category counts, and so does a museum's own category.** `Archaeological museums` is a nature category like `Archaeological museums in …`. The walk starts there and follows the country shelf and the country shelves. A subcategory the walk does not follow, named exactly after an article with a Wikidata item, is read as that article: the museum is named, and the shelf its category sits on counts as one of its own categories. This is how the History Museum of Armenia is reached.
3. **The department shelves are a door.** `Museums of ancient …`, `Museums of the ancient Near East`, `Egyptological collections`, `Pre-Columbian art museums` and `Mesoamerican art museums` are walked to their country level, and their articles join the candidates. Which museums a door names is not what they are: each one is judged by its own categories, classes and map.
4. **A department in an art museum is refused by name.** A museum whose only signal is a department category, and which the map (`museum=art`) or Wikidata (`art museum`) calls an art museum, is refused with the reason `an antiquities department in an art museum (…)`. Two exceptions keep the museum held with the department question, as ADR-0058 decision 2 holds it:
   - it holds a find above the finds' line;
   - the source already admits it.
   The second covers the Hermitage, the Vatican Museums and the Pushkin Museum, which the source admits after a curator answered the department question. The first keeps a museum a famous find carries over the line a question rather than a refusal. A department museum nothing calls an art museum is held as before. "Calls it an art museum" means the map's `museum=art`, or a class the Art Museums kind reads as an art museum's (`ART_CLASSES`: both of Wikidata's `art museum` items, `glyptotheque`, `pinacotheca` and the rest), so the two kinds mean one thing by the word.

## Alternatives Considered

| Option | Why rejected |
|--------|-------------|
| Department shelves as a door, every arrival held (#889's second option) | About 27 questions per run to reach two or three museums, and the number grows as the art kinds do. |
| A department only in a museum that is not an art museum by Wikidata's class (#889's third option) | The Altes Museum is typed `art museum`, so the one museum the issue is about would stay out. |
| A curator's own door (a museum added to a kind by hand) | It still has a place, for a museum no source and no map names. Here, though, the map already says what a traveller would say, and a run can read it. |
| The map's `museum=art` as a refusal of any museum | The Louvre, the Pushkin Museum and the Kunsthistorisches Museum carry it. A museum of both natures is a museum of both (ADR-0058 decision 2). |
| The Wikidata description ("antiquities museum in Berlin") | It is free text with no controlled vocabulary. It is useful to a curator, but no rule can read it. |

## Consequences

**Positive:**
- The Altes Museum and Dumbarton Oaks enter on the map's word. The History Museum of Armenia and the national museums of Finland, Slovakia and Singapore enter on Wikipedia's.
- About twenty art museums the department shelves name are refused with a reason a curator can read, rather than asked about one by one.

**Negative / Trade-offs:**
- The run asks the map about every museum candidate, a few hundred more items per pass on the same door.
- A department museum the map has not tagged and Wikidata does not type as an art museum still reaches a curator, for example the Sir John Soane's Museum and the Freud Museum. Whether a model such as Jev answers that question for the curator is #930's to measure.
- The map can be wrong or change. A museum it later calls archaeological enters on the next run, and one it stops calling so falls back to its other signals.

## References

- Narrows: ADR-0058 decision 2
- Related ADRs: ADR-0059 (OpenStreetMap as the site door's second signal), ADR-0103 (a museum held for a find)
- Related docs: `docs/tech/experiences.md` § Archaeology, `docs/sources/global/wikipedia-archaeological-museum-categories.md`
- Issues: #889, #930
