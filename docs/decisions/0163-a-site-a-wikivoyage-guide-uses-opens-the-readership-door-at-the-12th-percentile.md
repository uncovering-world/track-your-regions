# ADR-0163: A site a Wikivoyage guide uses opens the readership door at the 12th percentile

**Date:** 2026-10-30
**Status:** Accepted

---

## Context

Archaeology admits a site below its editions line when a year of readers reaches the median of
the sites at the line (ADR-0127) and two independent witnesses say a visitor goes there
(ADR-0128). ADR-0152 reads the sites under the pool's floor at the same bar.

Some digs a traveller visits carry few articles, because an item that is not the dig takes their
fame: an island, a town, a neighbouring monument (#1982). Examples:
- The Roman Agora of Athens is one of the seven sites of the city's combined ticket. It has 19
  editions and 47,207 readers a year, while the Tower of the Winds inside it has 35 editions.
  Four Wikivoyage editions use its item, as many as the Ancient Agora's.
- The Sanctuary of Asclepius at Epidaurus has 14 editions and 56,769 readers.
- The Pyramids of Meroë have 7 editions and 46,028 readers.

All three are on Archaeology's calibration list and under the median of 75,419. A Wikivoyage
guide uses every one of them. Squares & streets and Bridges already read a guide's use as a
lower readers' bar (`places/guidedLine.ts`). Places of worship (ADR-0161) and Art Museums
(ADR-0162) now read their bars as percentiles.

## Decision

This narrows ADR-0127's bar and ADR-0152's read for Archaeology. ADR-0128's two witnesses stand.

**A site a Wikivoyage guide uses enters by its readers at the 12th percentile of the sites at the
line, and stays at the 8th** (`ARCHAEOLOGY_GUIDED_DOOR`, the place door's `GuidedDoor`). On the
dump of 2026-10-19 that is 24,756 readers a year. Every other site still enters at the median.
The read under the pool's floor uses the same lower bar for a site a guide uses. The curator's
note names the bar the site cleared: "over the bar of … for a place a Wikivoyage guide uses".

## Alternatives Considered

| Option | Why rejected |
|--------|-------------|
| Keep the median | The Roman Agora, Epidaurus and Meroë stay out. Each is a visit of its own that an item which is not the dig overshadows. |
| A lower bar for every site, with or without a guide | Readers alone bring what nobody visits as a site: a battle, a vanished city, a bunker. A guide's use is what says the dig is a visit (#1997). |
| A fixed count of readers | It drifts as Wikipedia's readership falls, 14 % in a year (#2145). The percentile follows the year. |
| A door that reads the fame of the overshadowing item (the island, the town) | The town's fame is not the dig's: Jerash's town and Baalbek's are read for the city of today. |

## Consequences

**Positive:**

- On the development data, read-only on the subset, the door brings 220 sites for a curator.
  Among them are the Roman Agora, Epidaurus and Meroë, and with them the Amphitheatre of Pompeii,
  Moray, Ingapirca, Housesteads, the Greek Theatre of Syracuse, the Ness of Brodgar and the
  Catacomb of Priscilla.

**Negative / Trade-offs:**

- **220 arrivals for a curator to read.** A few of them are no dig: Manchester Piccadilly
  station, Hillsborough Castle and Independence National Historical Park.
- Jerash (24,033 readers) stays just under this year's bar. The Archaeological Ensemble of
  Mérida and Baalbek's temples, which no guide's item names, stay out.
- The sites whose classes the pool does not ask for (Polonnaruwa, Ayutthaya, Sukhothai, the Ming
  tombs, Longmen and Yungang, Ollantaytambo, Rapa Nui) are #2146's.

## References

- Narrows: ADR-0127 (the bar), ADR-0152 (the read under the floor), for Archaeology
- Related ADRs: ADR-0128, ADR-0161, ADR-0162
- Related docs: `docs/tech/experiences.md` § Archaeology
- Issues: #1982, #1997, #2145, #2146
