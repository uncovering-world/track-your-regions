# ADR-0145: An edition is one place with a point at every cast

**Date:** 2026-10-23
**Status:** Accepted
**Issue:** [#880](https://github.com/uncovering-world/track-your-regions/issues/880)
**Narrows:** [ADR-0085](0085-one-wikidata-item-is-one-reading-whichever-source-reads-it.md), the coordinate fold, for an edition's qualified coordinates

---

## Context

A bronze is cast more than once, and the casts stand in different cities. Louise Bourgeois's *Maman* (Wikidata Q180887) is cast seven times; casts stand permanently in Bilbao, Ottawa, Tokyo, Seoul, Doha and Bentonville, with further casts shown for a season. Wikidata models the edition as **one item with four coordinate statements** (P625), each qualified "applies to part" (P518) with the city it stands in — Bilbao, Ottawa, London and Minato — at equal rank. Rodin's *The Burghers of Calais* (Q978987) is a "group of casts" with one coordinate of its own and casts as parts (P527), each an item with its own coordinate; *The Thinker* (Q18003128) is a group of casts with no coordinate at all, over cast items that name it as what they are part of (P361).

The Public Art & Monuments run read one coordinate per item. Before ADR-0085 the kept one was whichever row the endpoint returned first, and on the development catalogue readers saw *Maman* at Roppongi Hills under the country United Kingdom; after it, the most precisely written point, which an edit on Wikidata moved from Ottawa to London, and run 201 asked a curator to publish or refuse a move of 5,362 km. Neither answer is right: a traveller who stood under *Maman* in Bilbao has seen the work, and the catalogue had no point to record it at; publishing London sends readers away from a cast that is really in Ottawa.

Measured on the 274 admitted rows on 2026-09-13, eleven carried more than one coordinate. Five were the same place written twice (the Cave of Altamira, Koutammakou, the Osun-Osogbo Grove, the Westerbork Transit Camp, the Bronze Horseman), which ADR-0085's fold settles. *Maman* was the one edition. Wikidata also uses "sculpture series" (Q19479037) for works that are not editions — the United Buddy Bears, the Lewis chessmen, the Crystal Palace Dinosaurs — whose pieces are each a different object, and lists among a group's parts items that are not casts of it: two *Heroic Head of Pierre de Wissant* items, a study of one figure of the Burghers, are parts of Q978987 and carry no coordinate.

The product review of 2026-10-22 (#880) decided the shape: the one of a serial World Heritage site, with one difference in what a visit means.

## Decision

1. **An edition is one place with a point at every cast.** A work cast more than once is one experience; each cast is one of its `experience_locations`, named by where it stands (the place the coordinate applies to: "Bilbao", "Ottawa", "London", "Minato"), placed in its own region and counted there. *Maman* is offered in Spain, Canada, the United Kingdom and Japan, and none of its points is a move of another. The place's countries are every cast's.
2. **A cast is recognised from Wikidata in two shapes.** (a) The item's own coordinate statements qualified by "applies to part" (P518), where they name two or more distinct points at its best rank — one cast per point, called by the lowest-numbered of the parts named on it — an order the data carries, so the two readers and two answers of the endpoint name it alike; two statements naming one place are one point, folded as any item's coordinate is (ADR-0085), and one qualified point is a place given precisely, not an edition. (b) A part of a group of casts (P527), or an item naming the group as what it is part of (P361) or based on (P144), that carries a coordinate of its own. A placement with an end date (P276 qualified by P582) is not a cast; a part with no coordinate — the study of one figure — is not a cast. A series whose pieces are different objects is not an edition: its items enter the pool each on its own, as today. Shape (a) is read by the run with this decision; shape (b), and an edition item with no coordinate of its own entering the pool through its casts with the edition's fame, follow in their own slice of #880.
3. **The place is told to be at its most central cast.** Its stored `location` is an anchor as a serial site's is (ADR-0095): the cast nearest the casts' centroid (`medoidOf`, `sync/anchorPoint.ts`, which the World Heritage run's `resolveMainPoint` now shares), written past the gate and never a question for a curator. The one point of a work standing in one place stays the source's own coordinate.
4. **Every cast carries the work's own reference.** A point's identity is its reference together with its coordinate (ADR-0022, ADR-0027), so casts are told apart by where they stand, a cast the run already wrote as the work's one point is the same row — named now — and a cast that leaves Wikidata is withdrawn as any point is, never moved. Under a gated source a new cast arrives `pending`, like any arrival.
5. **A visit to any cast marks the edition visited.** This is the difference from a serial site, whose component is not the site (ADR-0100 decision 5): every cast is the whole work. The rule reaches the visited status on both sides in its own slice of #880; until then an edition reads as a place of several points.

## Alternatives Considered

| Option | Why rejected |
|--------|-------------|
| Keep one point per work and let the fold choose the cast | Readers are sent to one city for a work that stands in four, the kept cast changes with Wikidata's precision, and the gate asks a curator about a move nobody can answer. |
| One experience per cast | A traveller browsing Spain would find *Maman (Bilbao)* beside *Maman (Ottawa)* in search, four rows would carry one fame, and a visit in Bilbao would not count as having seen *Maman*. Wikidata itself keeps one item. |
| A cast's own identifier as its reference (`Q180887/Q8692`) | The casts already written under the work's reference would all read as withdrawn and arrive again as new points, taking a verified pin through the gate for nothing; by position the writer pairs them already. |
| Make the items of a "sculpture series" editions | The United Buddy Bears and the Lewis chessmen are series of different pieces; the class says nothing about casting. Only qualified coordinates and parts with coordinates say it. |

## Consequences

**Positive:**
- *Maman* is drawn at every cast and found in each cast's region; the held London move is retired by the next Public art run, since the anchor is written past the gate and the London cast is a point of its own.
- The anchor rule has one owner for serial sites and editions.

**Negative / Trade-offs:**
- Until decision 5 lands, an edition of four casts reads "1/4 visited" after a visit to one — the serial-site reading, wrong for an edition for one slice.
- A temporary show that Wikidata leaves undated (*Maman*'s London coordinate) counts as a cast until it is dated or removed there; the catalogue reads the data as given.
- The country list of an edition names several countries, the anchor's first; readers that show one country show that one.

## References

- Related ADRs: ADR-0022, ADR-0027 (a point's identity), ADR-0085 (one reading per item — narrowed for an edition's qualified coordinates: distinct qualified places are kept apart as casts, while repeated statements for one place still fold to one point), ADR-0095 (the anchor), ADR-0100 (a serial site's components; decision 5 is what an edition's visit differs from)
- Related docs: `docs/tech/experiences.md` § Public Art & Monuments, § Location model
- Issue: #880 (the product review of 2026-10-22)
