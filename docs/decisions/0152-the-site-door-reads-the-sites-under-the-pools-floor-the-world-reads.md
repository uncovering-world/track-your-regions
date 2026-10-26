# ADR-0152: The site door reads the sites under the pool's floor the world reads

**Date:** 2026-10-26
**Status:** Accepted

---

## Context

ADR-0127 opened a readership door to Archaeology's world tier for a site below the sitelinks line.
Its decision 3 kept the door to the pool the site door already asks for, every candidate of 15
sitelinks and over (`POOL_MIN_SITELINKS`). A site the world reads with fewer editions than that is
never read. On the readership year of build 21 (October 2025 to September 2026), such sites
include the Temple of Poseidon at Sounion (14 sitelinks, about 103,000 views), the Inca Trail to
Machu Picchu (14, about 77,000), which the Cusco survey lists, the Curia of Pompey (12, about
85,000), the Temple of Jupiter at Baalbek (14, about 76,000) and Watson Brake (10, about 140,000).

The class questions cannot simply ask lower. Of the 24.4 million items the local Wikidata subset
holds, 24.07 million carry fewer than 15 sitelinks. Asked by class, the site tree under that floor
is a list of every mound, cairn and wreck Wikidata records. The readership year is the narrower
list: 2.08 million items over the counted editions, and a sum over it is one local query.

Measured on the development catalogue on 2026-10-26, against the bar and exit read over the 1,073
sites Archaeology admits at the line (about 70,900 and 46,300 views a year):

- 41,449 items under the floor are read at the exit or over;
- 111 of them are under the site tree with a coordinate;
- 36 of those reach the bar.

Many of the 111 are shipwrecks, which the site rule refuses. The 36 include Sounion, the Inca
Trail, the Curia of Pompey, the Temple of Jupiter, Watson Brake, the Daisen Kofun, Cliff Palace,
the Sanctuary of Asclepius at Epidaurus and the Pyramids of Meroe.

## Decision

**1. The readership names the sites under the floor first, and Wikidata is asked only about
those.** The run sums the year over the counted editions for every item read in fewer editions
than the floor (`readAtLeast`, `workReadership.ts`), then asks Wikidata which of them carry a class
under the site tree and a coordinate (`fetchSitesAmong`, with its subset twin `subsetSitesAmong`).
It then fetches those as the pool fetches any row by id (`fetchEntitiesByIds`). An item the pool
already holds is not asked again. The sum is the raw one, before ADR-0055's automated pairs are set
aside, so it never misses an item the door would count; the door reads every row it returns again
with its own measure (`readWorks`).

**2. The read stops at the bar, not the exit.** The exit only keeps a site the source already
holds, and a held site is asked for by id on every run whatever its sitelinks (`collectPool`). A
site under the floor that has not entered can enter only at the bar. Reading at the exit would
fetch three times the rows (111 rather than 36) for none the door could open for.

**3. The rows join the pool unchanged.** Each one arrives as a class question's row would, and the
site rule reads it as it reads any other: the kill classes, the map's town, the branch, ADR-0128's
two witnesses. The read runs only while the place door is open (`openSiteDoor`) and reads the bar
over the sites the source holds at the line, as ADR-0127 decision 2 does (`readUnderFloor`,
`readershipDoor.ts`; `collectUnderFloor`, `archaeology/underFloor.ts`).

**Narrows:** ADR-0127 decision 3. Its pool now holds, beside every candidate of 15 sitelinks and
over, the sites under that floor read at the bar. The rest of ADR-0127 holds.

## Alternatives Considered

| Option | Why rejected |
|--------|-------------|
| Lower the class questions' floor | The site tree under 15 sitelinks is millions of rows, nearly all of them read by nobody. The readership names the few the door could open for |
| Read under the floor at the exit, as the issue first asked | The exit keeps a held site, and every held site is already asked for by id. The 75 extra rows could not enter |
| Ask the site tree of each candidate's classes on the subset alone | The live service must answer the same question (#1439), or a run without the subset reads a different pool |

## Consequences

**Positive:**
- A site the world reads at the kind's median enters whatever its count of editions, so Sounion
  and the Inca Trail are judged like Pompeii.
- The readership does the narrowing: one local query over the year, where a class question
  under the floor would walk the site tree over millions of items.

**Negative / Trade-offs:**
- Wikidata is asked what each item the readership names is, and most of them are not sites: on
  2026-10-26, 20,516 items under the floor were read at the bar. The subset answers that in one
  query; the live service in batches of 400 (`SITES_AMONG_BATCH`).
- The sum over the year takes about 40 seconds on the development database (120 million rows), once
  per run.
- The bar lags one run, as in ADR-0127: on a first run nothing is read under the floor.

## References

- Related ADRs: ADR-0055, ADR-0056, ADR-0127 (decision 3 narrowed), ADR-0128
- Related docs: `docs/tech/experiences.md` § Archaeology
- PR / issue: #1757
