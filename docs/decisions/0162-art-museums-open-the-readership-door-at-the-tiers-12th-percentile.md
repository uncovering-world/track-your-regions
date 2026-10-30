# ADR-0162: Art Museums open the readership door at the tier's 12th percentile

**Date:** 2026-10-30
**Status:** Accepted

---

## Context

Art Museums admits a museum only through a work it holds (ADR-0023). A museum is never admitted
for its own fame (the maintainer, 2026-10-24, #1985). ADR-0056 opens a second door for works.
A work under the 22-edition line whose year of readers reaches the median of the works at the
line is Iconic and admits its holder. It stays down to the 35th percentile.

The kind's calibration list (#1952) holds 96 art museums nobody would dispute, and on the
development catalogue 49 of them are not offered. #1985 measured why, on the run's own pool
(the pipeline read-only on the subset of the dump of 2026-10-19, every try through the run's own
art test and `selectTier1`). The works these museums are known for carry 10 to 21 editions. The
median door admits 8 more museums and none of the 49:

| Try | New museums | Canon tops among them | Tops per 10 new |
|---|---|---|---|
| Editions line at 16 | 85 | 7 | 0.8 |
| Editions line at 14 | 125 | 12 | 1.0 |
| Readers at the median (ADR-0056, 142,750) | 8 | 0 | 0 |
| Readers ≥ 100,000 | 29 | 4 | 1.4 |
| Readers ≥ 50,000 | 74 | 9 | 1.2 |
| Readers ≥ 25,000 | 143 | 14 | 1.0 |
| Editions ≥ 16 and readers ≥ 25,000 | 68 | 6 | 0.9 |

About one new museum in five is no art museum in every try (Versailles, Windsor Castle, the
Imperial War Museum, two churches). What the tries differ in is how many tops they bring for a
curator's reading. The maintainer asked that curators read as little as a rule can spare them.

## Decision

This narrows ADR-0056 decisions 1 and 2 for Art Museums. Decisions 3 to 5 stand: the bar is a
percentile of the works at the line, never a number.

**Art Museums' work door enters at the 12th percentile of the works at the line and stays at the
8th** (`ART_MUSEUM_DOOR`, passed to `readershipDoorFor`). On the dump of 2026-10-19 that is
48,323 readers a year to enter and 41,248 to stay. Every other source's door keeps ADR-0056's
median and 35th (`DOOR_PERCENTILES`). Every museum the door admits arrives for a curator, as
ADR-0056 decision 5 requires.

## Alternatives Considered

| Option | Why rejected |
|--------|-------------|
| Lower the editions line | At 16 it brings 85 museums for 7 tops, more of them provincial (Accademia Carrara, Gallery Oldham, Watts Gallery). Editions measure languages, and a work famous in one country carries few. |
| A fixed count of readers (50,000) | It drifts with Wikipedia's readership, which fell 14 % in a year (#2145). The percentile follows it, as ADR-0056 decision 3 says. |
| The 25th or 35th percentile | Measured as readers ≥ 100,000 (about the 35th): 29 museums for 4 tops. The Albertina's *Young Hare* (127,000) passes; the Thyssen's *Dream Caused by the Flight of a Bee* (110,000) and SFMOMA's *Woman with a Hat* (116,000) pass; the Guggenheim's *America* (74,000) and Barnes' *Joy of Life* (87,000) do not. |
| The 3rd percentile (25,000) | 14 tops, but 143 museums for a curator, about twice the reading for half again the tops. |
| Combine editions and readers | Editions ≥ 16 and readers ≥ 25,000 bring 68 museums and only 6 tops: the editions term cuts the tops a guide names whose works are read but not translated. |

## Consequences

**Positive:**

- The Thyssen-Bornemisza, the Albertina, the Peggy Guggenheim Collection, SFMOMA, the Solomon R.
  Guggenheim, the Barnes Foundation, the National Gallery of Canada, the Musée Picasso Paris and
  the National Palace Museum arrive.
- With them come the Kunsthaus Zürich, the Kunstmuseum Basel, the Menil Collection, the Bührle
  Collection, the Munch Museum, the Isabella Stewart Gardner Museum, the Cleveland Museum of Art
  and the Boijmans.
- The bar follows the year's readership without a number to move.

**Negative / Trade-offs:**

- **74 museums for a curator to read**, about 15 of them no art museum: palaces, castles, a war
  museum, two churches the worship kind holds.
- **240 works are marked Iconic, against 30 at the median.** That includes works in museums the
  line already admits. They are read by 48,000 a year or more: Cabanel's *Fallen Angel*,
  Matejko's *Stańczyk*, Fabritius' *Goldfinch*.
- **29 canon museums are still not reached**, and no percentile reaches them:
  - the canon names a place where the run admits its institution (the Getty Center, the J. Paul
    Getty Museum);
  - their famous works are of classes outside the artwork classes (bronzes, ceramics, jewels,
    manuscripts: the Shanghai Museum, the Green Vault, Doha);
  - their works are barely on Wikipedia (Bilbao, the Fondation Beyeler, MALBA, MONA).

## References

- Narrows: ADR-0056 decisions 1 and 2, for Art Museums
- Related ADRs: ADR-0023, ADR-0055, ADR-0161 (the worship kind's readers door)
- Related docs: `docs/tech/experiences.md` § Art Museums
- Issues: #1985, #1952, #2145
