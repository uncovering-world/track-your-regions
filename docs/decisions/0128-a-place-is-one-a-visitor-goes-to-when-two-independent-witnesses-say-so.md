# ADR-0128: A place is one a visitor goes to when two independent witnesses say so

**Date:** 2026-10-20
**Status:** Accepted

---

## Context

ADR-0127 opened Archaeology's world tier to a site below the sitelinks line that the world reads
at the median of the kind's held sites at the line. Dry run 178 on 2026-10-20 measured it: the
door would have created 41 places, every one held for a curator. Read as a traveller, the 41 were:

- 20 sites a visitor goes to: the Ancient theatre of Taormina, the Roman Baths, Karahan Tepe,
  Largo di Torre Argentina;
- 6 parts of a site the catalogue holds: the Lupanar, the Propylaea, Saint Peter's tomb, Hisarlik
  Hill;
- 9 places with nothing to see: Stapleton International Airport, the Darien scheme, Rungholt, the
  circus of Nero, Nyenschantz;
- 2 Roman predecessors of a living city: Camulodunum and Augusta Treverorum;
- 4 places of another kind: Jantar Mantar, the London Stone, Po Nagar, Fotheringhay Castle.

A year of reading says people read about a place, not that they go there. Rungholt is read
because it drowned in 1362. The maintainer judged 16 non-places among 41 arrivals too much for a
curator and asked for a rule before the door's first real run, researched across sources (#1756).

The measurement compared the sources that might tell the groups apart, on the 41 and on #1718's
109 places judged by a person, mostly in Rome (the comments of 2026-10-20 on #1756 and #1718):

| Signal | Door sites (20) | Door, nothing to see (9) | #1718, worth a visit (92) | #1718, nothing to see (12) |
|---|---:|---:|---:|---:|
| A Wikivoyage article uses the item, in any of 27 editions | 19 | 0 | 80 | 7 |
| 10 or more Commons files of its category taken within 1 km | 14 | 0 | 47 | 0 |
| Wikidata: heritage, opening hours, visitors or website | 14 | 2 | 52 | 0 |
| OpenStreetMap: something standing or visited | 12 | 2 | 65 | 1 |
| **Two of the four** | **18** | **0** | **76** | **1** |

The guide alone separates the door's 41 best, but not Rome: Italian Wikivoyage lists Rome so
closely that it names the Regia, the Cloaca Maxima and the Gardens of Sallust, where nothing
stands. Wikidata's "demolished" and "dissolved" statements also mark ruins that stand, the
Basilica Julia among them, and mappers tag Rungholt as a dig. The maintainer chose one general
rule over a door tied to one source.

## Decision

**1. A place is one a visitor goes to when two of four independent witnesses say so.**
- **The guide:** an article of any Wikivoyage edition uses the item (`wikivoyage-usage`, users'
  drafts and heritage registers left out).
- **The photographs:** at least 10 files of the item's Commons category (P373) were taken within
  1 km of the place.
- **Wikidata's formal statements:** a heritage designation (P1435), opening hours (P3025), a
  visitor count (P1174) or an official website (P856).
- **The map:** an OpenStreetMap object carrying the item that stands or that visitors are sent
  to: a typed building, a temple, church, monument, gate, fountain, bridge, aqueduct, tomb, castle
  or memorial, a place of worship, a column or obelisk, opening hours, or a museum, attraction or
  viewpoint. A dig or ruins tag alone is not one.

The rule is kind-agnostic (`services/sync/visit/`); a kind decides where it asks.

**2. Archaeology's readership door asks it of every place the door alone admits.** A place the
door opens for that has fewer than two witnesses stays out. It is named among the run's refusals
(`few-witnesses`), with its reading, where it stands against the bar or the exit, and the
witnesses it has. This holds for a held place the exit would keep as much as for a new one, since
the door alone keeps it. A place it keeps carries its witnesses on the curator's card. On the 41,
a curator reads 24 arrivals instead of 41, 6 of them not a site instead of 16.

**3. The line is not asked.** A place the sitelinks line admits is not held to the witnesses
here. Of #1718's 92 places worth a visit, 16 have fewer than two: the Aqua Claudia and the Castra
Praetoria among them. Asking a curator about such a place, never refusing it, is #1770.

**4. Without the guide built, the place door is shut,** as it is without a year folded with the
redirects (ADR-0127 decision 4), and the run says so: a place would otherwise be held to three
witnesses.

**Narrows:** ADR-0127 decision 1. A site below the line whose readership reaches the bar stands in
only with two witnesses. ADR-0127's other decisions hold.

## Alternatives Considered

| Option | Why rejected |
|--------|-------------|
| Keep the curator's gate as the only guard (ADR-0127 decision 4) | 16 of 41 arrivals were not places: two non-places for every three sites |
| A Wikivoyage listing as the door's only condition | One source with gaps: Italian Wikivoyage names places in Rome where nothing stands, and the guide alone let in 7 of #1718's 12 |
| Refuse what Wikidata says is gone | It refuses the Basilica Julia and the Basilica Aemilia, whose ruins stand |
| Require OpenStreetMap's dig or ruin tag | Measured on dry run 178: it drops seven real sites (Karahan Tepe, Epang Palace) and keeps Stapleton, the Darien scheme and Rungholt |
| Let Jev refuse what it reads as nothing to see | ADR-0087 keeps Jev's answer a suggestion a curator applies; on the 41 it read Fadak and Ye as sites |
| Three witnesses of three, without the photographs | Two of the door's 20 sites fall short |

## Consequences

**Positive:**
- No single source decides, so a guide that lists too much or a map that tags too loosely is
  outvoted.
- The witnesses are read only for the door's rows, about a hundred places a run, so the Commons
  questions stay few.

**Negative / Trade-offs:**
- A real site with fewer than two witnesses stays out of the world tier: on the 41, Kalambo and
  the Giants of Mont'e Prama. The regional tier (#881) is where they can enter.
- Parts of a held place and places of another kind pass the witnesses: the Lupanar, Jantar Mantar.
  They stay a curator's question, with Jev's reading beside them (#1768).
- One more build to keep current, the Wikivoyage usage, and one more cached question per door row.

## References

- Related ADRs: ADR-0127 (decision 1 narrowed), ADR-0056, ADR-0087, ADR-0101, ADR-0106
- Related docs: `docs/tech/experiences.md` § Archaeology, `docs/tech/dumps.md` § The items
  Wikivoyage uses, `docs/sources/global/wikivoyage-see-listings.md`,
  `docs/sources/global/wikimedia-commons-category-photos.md`
- PR / issue: #1768, #1718, #1756, #1770
