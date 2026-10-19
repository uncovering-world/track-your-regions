# ADR-0126: The two tiers of a kind differ by source and weigh the same

**Date:** 2026-10-19
**Status:** Accepted

---

## Context

ADR-0048 decision 1 fills every kind in two tiers, "always both, in this order: the world tier,
then the regional tier". It defines the world tier as what the world knows of the kind and the
regional tier as what a region holds that a traveller standing there would visit. The rest of
that ADR says where each tier's places come from:

- the world tier comes from a global source with a signal comparable across the world
  (decision 2);
- the regional tier comes from a source native to its unit, read as an enumeration and then cut
  within the unit (decision 3).

The texts written around that decision read as a ranking of the two tiers:

- `docs/tech/filling-a-kind.md` § 1 defined the regional tier by the vision's phrase "the
  iconic art museums *and some other art museums worth your time*", which makes the regional
  tier the rest;
- "in this order" was meant as the order in which the tiers are built. It reads as seniority;
- the guide and ADR-0048 decision 5 say that "top" is the world tier.

The maintainer rejected that reading on 2026-10-18, on the places-of-worship question (#1692).
A temple that every Indian knows and the world does not is as much a place the kind offers as
one the whole world knows. It is found through another source. The maintainer asked for the
definition to be sharpened, and agreed to this one on 2026-10-19.

No regional tier is built yet (#628, #862), so no reader has seen the two tiers side by side.
The wording is fixed now, before the first regional source is adopted and calibrated against
it.

## Decision

1. **The two tiers differ in where their places are found, never in how much a place
   matters.**
   - The world tier is found through a global source, whose signal is comparable across the
     world.
   - The regional tier is found through sources native to the region: a ministry's register,
     a city's list, a curator who has been there.

   A place either tier brings is equally a place the kind offers. Neither tier is ranked above
   the other, and each is described and measured by its own source and signal.
2. **"First the world tier, then the regional tier" is the order in which a kind is built,
   nothing more.** The world tier is first because one global source covers every region at
   once.
3. **The Iconic badge is not a mark of the world tier's rank.** A place the regional tier
   brings is not worth less for carrying no badge. What the badge marks is left open (#1737).
   It began as a mark on a work known to the whole world, has spread to the museums, places of
   worship and sites that hold such works, and stays as the runs write it until #1737 decides.
4. **No grade that separates the tiers' places reaches a reader.** A graded scale such as
   "worth a journey" or "worth a detour" may serve an internal mechanism, such as ordering or
   calibration. It never appears on a card, a list or a filter.

This narrows ADR-0048 decision 1 and the phrase "'top' is the world tier" in its decision 5.
The rest of ADR-0048 stands.

## Alternatives Considered

| Option | Why rejected |
|--------|-------------|
| Leave the wording as it is | The first regional source would be cut and calibrated against a definition that makes its places the rest, and the ranking would reach the product through the docs. |
| Supersede ADR-0048 whole | Its decisions 2 to 7, on the sources, the cut within a unit, the meeting on the place and the scorecard, still hold. Superseding it would retire them. |
| Define the Iconic badge here as "known to the whole world" | Its meaning on a museum or another container of works is not settled; it is deferred to #1737, not decided by the definition of the tiers. |

## Consequences

**Positive:**
- A regional source is judged by whether it finds what its region holds, not by how close it
  comes to the world's line.
- The definition of the tiers, the guide and the vision say the same thing.

**Negative / Trade-offs:**
- The badge is written on world-tier places only, and its meaning waits for #1737. No screen
  shows a place's badge today, but a list that mixes both tiers needs care in its design so
  that it does not read as two classes. That care belongs to the regional tier's design
  (#628).

## References

- Related ADRs: ADR-0045 (decision 5, the badge), ADR-0048 (decisions 1 and 5, narrowed here)
- Related docs: `docs/tech/filling-a-kind.md` § 1
- Issues: #1692 (where the reading was rejected), #628 and #862 (the regional tiers), #1737
  (what the Iconic badge marks), #1601
