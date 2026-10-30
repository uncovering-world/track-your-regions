# ADR-0165: The finds door reads the finds under the pool's floor the world reads

**Date:** 2026-10-30
**Status:** Accepted

---

## Context

ADR-0164 opened a readership door for Archaeology's finds. A find under the finds' line whose
year of readers reaches the 12th percentile of the finds at the line counts as one at it. The
door chooses only among the finds the works pool holds. The pool is collected from 10 Wikipedia
editions up (`POOL_MIN_SITELINKS`, `museum/queries.ts`), so a find in fewer is never seen.

The finds' calibration list (#1988) opens with such finds, read widely in few languages:

| Find | Editions | Readers a year |
|---|---|---|
| Houmuwu ding | 9 | 48,585 |
| Berlin Gold Hat | 9 | 33,358 |
| Omphalos of Delphi | 5 | 40,238 |

ADR-0152 answered the same gap for the site door: the year's readership names the items under
the pool's floor read at the door's bar (`readUnderFloor`), and each is asked about by id.

#2159 measured the finds' side on the subset of 2026-10-19:

- At the finds door's bar (27,180), the year reads 57,849 items under 10 counted editions.
- 77 of them pass the find rule, and 49 of those carry a collection or a location.
- **Real finds:** the King of Na gold seal, the Padmanabhaswamy Temple treasure, the Saddle Ridge
  Hoard, the Houmuwu ding, the Gypsy Girl mosaic, the Warrior of Capestrano, the Berlin Gold Hat.
- **What the rule's loosest road, a discovery place, also lets through:** Belgian endive, a
  blobfish, a bird's egg, a geode.

A stricter rule for these alone was considered. Keeping only the artefact tree and the find
classes, without the discovery-place road, would refuse the Houmuwu ding, which Wikidata knows
only as found at Anyang.

## Decision

This extends ADR-0164 the way ADR-0152 extends ADR-0127.

**1. The finds the year reads at the finds door's bar in fewer editions than the works pool's
floor join the pool** (`underFloorFinds`, `readUnderFloor` with `ARCHAEOLOGY_FINDS_DOOR`). The
year names tens of thousands of items at the bar (57,849 on the subset), so only the ones that
carry a class of the kind's finds as their own are read in full (`fetchFindsAmong`: the artefact
tree, `FIND_CLASSES`, the ancient art roots), as `fetchSitesAmong` narrows the sites. Each is
read by id (`fetchWorksByIds`) once the pool's own find rule has run, goes through that same
rule, and joins the pool to be judged, placed and counted as any pool find is.

**2. `ding` and `fangding` are find classes.** The Houmuwu ding is typed `fangding` and nothing
else; without the class it is reached only by its discovery place, which the narrowing above
does not read.

**3. The read happens only while the finds door is open.** The bar is read over the kept pool,
the finds the rule kept of what the classes collected, which is the tier the door reads, so the
two cannot disagree about a find. The read asks no travel guide: `readUnderFloor` wants a
Wikivoyage usage only for a door with a guide's bar.

## Alternatives Considered

| Option | Why rejected |
|--------|-------------|
| Lower the works pool's floor | The fame bands are what keep the pool's questions affordable (`POOL_BANDS`), and below 10 editions each band holds every object Wikidata knows. |
| Read every item the year names in full, and let the find rule sort them | 54,412 items by id on every run. On the subset it admitted the Australian Museum for a blobfish found at Norfolk Ridge: the discovery-place road keeps what no class names. |
| The discovery-place road under the floor too | The Houmuwu ding, the find #1999 opened with, was reached by it alone; naming its class (`fangding`) reaches it without reading the 54,412. |
| Read the holdings of every admitted museum below the floor | The venue-side read (#890) stops at the floor for the same reason the pool does: the British Museum alone holds tens of thousands of items. |

## Consequences

Read through the run's own pipeline on the subset, main against this decision:

- The year names 57,849 items under the floor at the bar; 176 carry a find class and are read in
  full, and the find rule keeps 43 of them.
- 11 museums are new to Archaeology, and none leaves it: the National Museum of China (the
  Houmuwu ding), the National Palace Museum (the Mao Gong ding), the Bangkok National Museum
  (the Ram Khamhaeng inscription), Gaziantep (the Gypsy Girl mosaic), the Royal Armouries (the
  Pioneer Helmet), Berlin's Museum für Vor- und Frühgeschichte (the Berlin Gold Hat), the
  Sakitama museum (the Inariyama Sword), among them. Each arrives for a curator.
- 26 finds the admitted museums show are badged by their readers, the Battersea Shield, the
  Lachish relief, the Omphalos of Delphi, the Manunggul Jar and Khafre Enthroned among them.

**Positive:**

- The Houmuwu ding, the Berlin Gold Hat and the Omphalos of Delphi reach the run, with the finds
  like them a traveller expects in their museums.
- No number is added: the bar is the finds door's.
- The read costs a few hundred items by id on every run, not tens of thousands.

**Negative / Trade-offs:**

- **A find read just under the bar on a later year falls out**, since the read asks the enter bar
  and not the stay bar, as ADR-0152 accepted for sites.
- The read counts Wikipedia editions in the readership dump, while the pool counts sitelinks. A
  find the pool already holds is skipped. A find with 9 sitelinks but 10 counted editions is
  missed by both.
- **A find Wikidata types only by a broad class is still refused by the find rule.** The Muisca
  raft is typed `sculpture`, with no discovery place and no date.
- **A find under the floor that no find class names is not read**, whatever its readers: the
  King of Na gold seal (148,009 a year) and the Cup of Nestor are reached by their discovery
  place alone, which the narrowing does not ask. A class for them is a question of its own.

## References

- Extends: ADR-0164 (as ADR-0152 extends ADR-0127)
- Related ADRs: ADR-0058, ADR-0082 (Wikipedia editions)
- Related docs: `docs/tech/experiences.md` § Archaeology
- Issues: #2159, #1999, #1988
