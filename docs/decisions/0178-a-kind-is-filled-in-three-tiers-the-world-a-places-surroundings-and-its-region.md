# ADR-0178: A kind is filled in three tiers: the world, a place's surroundings and its region

**Date:** 2026-11-02
**Status:** Accepted

---

## Context

ADR-0048 fills a kind in two tiers. The world tier comes from a global source with a signal
comparable across the world (decision 2). The regional tier comes from a source native to its
unit, read as an enumeration and cut within the unit (decision 3). Decision 3 also admits a
global source read per unit as a fallback, where no native source exists or can be read.
ADR-0126 sharpened the two definitions: the tiers differ in where their places are found, never
in how much a place matters.

ADR-0171 built that fallback. It reads the same global source the world tier reads, Wikidata,
and measures a place against what lies within 50 km of it. ADR-0175 switched it on for the six
place kinds, with bars derived from each kind's own pool. Both call it the regional tier, and so
do the code and the tickets that followed.

That tier is not what ADR-0048 meant by a regional tier. Its places come from a global source,
and the analysis that admits them is the world tier's own, applied to a smaller territory. A
regional tier proper reads sources native to the region and none of the global analysis. Under
one name the two get confused:

- a kind whose surroundings cut is switched on reads as having its regional tier, while no
  native source has been adopted for it;
- the regional-tier epics (#628, #861, #862, #881, #1855, #1861, #1868) ask for native sources
  and read as overlapping the surroundings cut.

The maintainer set the three-way distinction on 2026-11-02.

## Decision

**1. A kind is filled in three tiers, each named by its source and by how its places are
chosen.**

| Tier | Source | How a place is chosen |
|---|---|---|
| **World tier** | Global sources: Wikidata, Wikipedia, the UNESCO list | Analysed over the whole world: a bar on a signal comparable across the world (ADR-0023, ADR-0175) |
| **Surroundings tier** | The same global sources | The same analysis, applied to the places within 50 km of a place: a place is measured against its surroundings (ADR-0171, ADR-0175 decision 3) |
| **Regional tier** | Sources native to the region only: a ministry's register, a city's list, a guide to the city, a curator who has been there | Each source's own enumeration and judgement, cut within its unit (ADR-0048 decision 3). No global signal and no global analysis |

**2. The tier ADR-0171 built is the surroundings tier.** What ADR-0171 and ADR-0175 call a
global source's regional tier is the surroundings tier. Its rules, units and bars stand as those
ADRs wrote them; only its name changes.

**3. The regional tier reads native sources only.** ADR-0048 decision 3's fallback, a global
source read per unit, is no longer a regional-tier source: a global source read per area is the
surroundings tier. A kind's regional tier exists only where a native source has been adopted for
a unit, and a kind with none has no regional tier, whatever its surroundings tier holds. Its cut is the
native source's own judgement (a label, a listing) or a signal the source carries (the visitors a
register records); a cut by a global source's signal, such as Wikivoyage's use or Wikipedia
editions against an area's best, is the surroundings tier's.

**4. The three tiers weigh the same.** ADR-0126 holds for three. A place any tier brings is
equally a place the kind offers, and the tiers differ only in where their places are found.
"World, surroundings, regional" is the order in which a kind is built, nothing more.

**5. The tiers meet on the place.** ADR-0048 decision 4 holds for three: a place two tiers bring
is one place, kept once per kind.

**6. Every text says which tier it means.** The docs and the tickets name the three tiers by
these names. The code's names (`REGIONAL_CUT`, the regional pool, the `regional` tier recorded
on a membership's facts) are renamed by their own issue (#2287), which carries data on the
development catalogue.

## Alternatives Considered

| Option | Why rejected |
|--------|-------------|
| Keep "regional tier" for both, with a qualifier where it matters | The qualifier is dropped in a hurry, and a ticket asking for a native source reads as done once the surroundings cut is on. |
| "Quasi-regional" or "local" tier for the middle one | "Local" suggests a local source, which is the regional tier's. "Quasi-regional" names what it is not. ADR-0171 already calls its unit the place's surroundings. |
| Fold the surroundings tier into the world tier as a second bar | Its unit and its bars are its own (ADR-0171, ADR-0175 decision 3), and a reader of the catalogue's coverage needs to tell what the world bar admits from what the surroundings bar adds. |

## Consequences

**Positive:**
- A kind's state reads at a glance: which tiers it has, from which sources.
- The regional-tier epics keep their meaning: native sources, still to adopt.

**Negative / Trade-offs:**
- Until the code is renamed, the code says "regional" where the docs say "surroundings".

## References

- ADR-0048 (two tiers; decision 3 narrowed here), ADR-0126 (the tiers weigh the same, extended
  to three), ADR-0171 (the surroundings tier's unit), ADR-0175 (its bars, switched on for the
  six place kinds).
- #2177 (one admission frame for every place kind), #2286 (Archaeology's sites into the frame).
