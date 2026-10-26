# ADR-0155: A work based on a group of casts is its cast only by the group's creator

**Date:** 2026-10-26
**Status:** Accepted
**Issue:** [#2092](https://github.com/uncovering-world/track-your-regions/issues/2092)
**Narrows:** [ADR-0145](0145-an-edition-is-one-place-with-a-point-at-every-cast.md) decision 2(b), for an item naming the group by "based on" (P144)

---

## Context

ADR-0145 decision 2(b) recognises a cast of a group of casts in three ways, each with a coordinate of its own:

- a part of the group (P527);
- an item naming the group as what it is part of (P361);
- an item naming the group as what it is based on (P144).

The third shape was there for casts that Wikidata links to their group only that way, such as Rodin's *Monument to Balzac* (Q121366871, by Rodin, based on Q2770535).

"Based on" also links works that are not casts. Item Q30251938, "Man on Toilet Reading The Beamo Book", is an architectural sculpture in Greenwich. It names Rodin's *The Thinker* (Q18003128) as what it is based on and names no creator: it is a parody. Since #2036 a group is judged at each cast, and one cast that is not held admits the group with pins only at its open casts. On the development catalogue, after the grouped Wikidata pass of 2026-10-26, *The Thinker* was admitted in Public art and in Monuments & memorials with its only pin in Greenwich.

The local Wikidata subset held five items with a coordinate that name a group of casts by P144 on 2026-10-26:

| Item | Based on | Creator |
|---|---|---|
| Q154571, in Musée Rodin | *The Thinker* | Auguste Rodin |
| Q125973575 | *The Gates of Hell* (Q2003287) | Auguste Rodin |
| Q121366871 | *Monument to Balzac* | Auguste Rodin |
| Q30251938 "Man on Toilet Reading The Beamo Book", in Greenwich | *The Thinker* | none |
| Q124656424 "Denker In Alle Staten", in the Humanist Sculpture Park | *The Thinker* | none |

The three by Rodin are the work. The two with no creator are other works based on it.

## Decision

**An item naming a group of casts by P144 is one of its casts only when one of its creators (P170) is one of the group's.** A part (P527), and an item naming the group by P361, is a cast as decision 2(b) states: Wikidata already says it is part of the work. A cast is still required to have a coordinate of its own and a placement that has not ended.

The live readers state the rule once in `castPattern` (`publicArt/castGroups.ts`), and the subset readers state it once in `NAMES_AS_CAST` (`subset/castGroups.ts`). Both kinds of reader apply it to the casts of a group and to the groups that enter the pool through their casts.

## Alternatives considered

- **Drop P144 and read casts only through P527 and P361.** Rejected: *The Gates of Hell* and *Monument to Balzac* would lose the Rodin items that Wikidata links only by P144.
- **Accept a P144 item only when it is an instance of the group, or of "cast" (Q12042203).** Rejected: only the Balzac item is typed "cast". Q154571 is typed "statue" and Q125973575 "sculpture", as the two works based on *The Thinker* are. The class does not tell a cast from a work based on it, and the creator does.
- **Exclude only a P144 item with no creator.** Rejected: a work by another artist based on the group, such as a homage, is no more a cast than a parody with no named maker.

## Consequences

- A parody, homage or other derivative work never admits a group of casts, never gives it a pin, and does not bring a group into the pool on its own.
- A real cast linked only by P144 whose item names no creator is not read until Wikidata records its creator. None of the five items measured is such a case.
- On the development catalogue, *The Thinker*'s casts become the Kyoto item (P361) and the Musée Rodin items (P144, by Rodin). Each of them is held by a museum, so the group goes back to the museums, with no pin in Greenwich.
