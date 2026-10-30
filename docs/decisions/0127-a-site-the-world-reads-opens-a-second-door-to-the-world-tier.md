# ADR-0127: A site the world reads opens a second door to the world tier

**Date:** 2026-10-20
**Status:** Accepted — decision 1 narrowed by [ADR-0128](0128-a-place-is-one-a-visitor-goes-to-when-two-independent-witnesses-say-so.md); decision 3 narrowed by [ADR-0152](0152-the-site-door-reads-the-sites-under-the-pools-floor-the-world-reads.md); decision 2 narrowed for Archaeology by [ADR-0163](0163-a-site-a-wikivoyage-guide-uses-opens-the-readership-door-at-the-12th-percentile.md)

---

## Context

Archaeology admits a site at the world tier by its sitelinks alone: an item enters at 22 and stays
down to 18 (`enterSitelinks`, `staySitelinks` on the source row; ADR-0058 decision 4). Sitelinks
count how many editions wrote an article, not how many people read one. ADR-0056 found the same
gap for works and opened a second door for a work the world reads. Its amendment of 2026-10-18 made
that door every kind's that admits a place *for a work it holds*. A place admitted for its own sake
has no such door.

A comparison of 131 survey entries on 2026-10-20 (#1160) found that the guides' archaeological
places missing from the catalogue are mostly not a recognition problem. 42 of the 71 in no kind
are already typed as archaeological sites or ruins. Most of those stand under the line while the
world reads them about as much as the sites the kind holds. Each figure below is a year of
readership in every counted edition, with the sitelinks in brackets:

- Largo di Torre Argentina: 129,826 (21);
- the Vatican Necropolis: 100,106 (15);
- the Catacombs of Priscilla: 65,202 (18);
- Moray: 45,610 (18).

The admitted Archaeology sites read a median of 67,155 a year. The maintainer agreed that day that
a site gets the work door's second door.

## Decision

**1. A site below the line whose readership reaches the bar stands in, as one at the line does.**
The measure is the work door's: user views over the twelve kept months in every counted edition,
with ADR-0055's automated pairs set aside (`readWorks`). Every other step of the site rule applies
unchanged: the kill classes, the map's town, the branch. The door changes where the row stands
against the line and nothing else (`siteStanding`, `archaeology/siteTest.ts`). A row the door
opened for and the rule refuses is refused by name, since the world reads it.

**2. The bar is the median over the sites the source holds at the line, and the exit is the 35th
percentile.** Both are percentiles, never numbers (ADR-0056 decisions 2 and 3). The tier is not
every candidate at the line, which the work door reads: the site pool at the line holds Athens,
Istanbul and Damascus, whose readership would set the bar for a dig. The sites the source admits
are what the kind holds at the line. A site the source holds keeps its standing down to the exit,
as a work Iconic now does. On a source that holds no site yet, the tier is empty and the door
opens for nothing.

**3. The door reads the pool the site door already asks for, and nothing wider.** That is every
candidate at the pool's floor of 15 sitelinks and over (`POOL_MIN_SITELINKS`). A site under the
floor is not read: the Inca Trail to Machu Picchu (14) and the Temple of Poseidon at Sounion (14)
wait for a wider pool, which needs a question of its own on both the live service and the subset.

**4. The gate is the work door's.** The door is open only while the source's curator gate is on
(`placeReadershipDoorFor`), and only while the year is folded with the redirects in place. A site
the door alone admits carries the curator's question under Archaeology's own key, `admissionNote`:
its year's reading, the bar, and the burst flag where there is one (ADR-0055 decision 4). It asks
whether a visitor goes to see the place, which the reading cannot say.

**Narrows:** ADR-0058 decision 4, whose line becomes one of two doors for a site. ADR-0056 holds.
This ADR applies its door to a place admitted for its own sake, with the tier read over the places
the source holds.

## Alternatives Considered

| Option | Why rejected |
|--------|-------------|
| Read the bar over every candidate at the line, as the work door does | The site pool at the line holds living cities. Athens and Istanbul are read millions of times a year, and their reading would set a dig's bar |
| Lower the sitelinks line instead | Sitelinks favour the large languages translations flow through (ADR-0056). Every lowered line lets in the tail it was drawn to keep out |
| Leave these sites to the regional tier (#881) | The places are read by the world, not by a region: the Vatican Necropolis is read in every edition. The regional tier is for what a region's own sources name |
| Widen the pool under 15 sitelinks in the same change | It needs a new question against the live service and against the subset, and it is a separate measurement. Decision 3 records it |

## Consequences

**Positive:**
- The kind's world tier reads the signal the work door reads, so a site is not held to a different
  measure of fame than a find.
- A site the door admits arrives held with its reading on the card, so a burst year or a site
  nobody visits is caught by a person.

**Negative / Trade-offs:**
- The bar lags one run: it reads the sites the source held before the run. On a first run it opens
  nothing.
- A site under 15 sitelinks stays out, whatever the world reads.
- The door reads the readership year on every run, about two thousand items. That is one local
  query.

## References

- Related ADRs: ADR-0055, ADR-0056, ADR-0058 (decision 4 narrowed), ADR-0126
- Related docs: `docs/tech/experiences.md` § Archaeology
- PR / issue: #1756, #1160
