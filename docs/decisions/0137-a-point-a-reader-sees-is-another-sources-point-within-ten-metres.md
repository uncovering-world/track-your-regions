# ADR-0137: A point a reader sees is another source's point within ten metres

**Date:** 2026-10-23
**Status:** Accepted — decision 1 narrowed by [ADR-0143](0143-a-place-is-found-by-its-identifiers-before-a-run-creates-one.md): on a place of one point, a joining run's one point is that point at any distance
**Issue:** [#1846](https://github.com/uncovering-world/track-your-regions/issues/1846)
**Narrows:** [ADR-0027](0027-a-point-rewritten-more-precisely-is-the-same-point.md) decision 1 (identity is the reference first, and geometry within a tolerance second) and decision 5a (the pairing's order between an unread arrival and the visible row)

---

## Context

ADR-0027 decision 1 makes a point's identity the reference first and the geometry second, inside a
ten-metre tolerance (`LOCATION_UNCHANGED_METERS`). Its options table rejects a tolerance without the
reference: 4172 pairs of points of one place lie within a kilometre of each other, many at 0 m,
because what tells two rock shelters in one cliff apart is the component number. UNESCO gives one
coordinate to seventeen shelters of site 874.

That reasoning is about one source's points. A reference is a source's own name for a point, so
two sources never share one, except when two Wikidata sources name the same item. Since ADR-0084 a
place can hold the points of several sources. Under decision 1, a second source's point for a place
the first already shows can only be written as a new row:
- **The Genbaku Dome.** Monuments & memorials' first run (run 200, 2026-10-22) wrote Wikidata's
  `Q231140` as an unread point 5 cm from UNESCO's `775`. The review card then asked a curator about
  a "Moved 0 m south".
- **Tel Be'er Sheva.** Archaeology's point lies 0 m from UNESCO's component `1108-003`.

## Decision

**1. A point a reader sees takes a source's point within ten metres, under another source's
reference.** The location writer first decides the pairing by ADR-0027 and ADR-0117. Then a point
it paired with nothing, or only with an unread row, takes another point:
- first, the run's folded point of the same reference (#1662);
- otherwise, the nearest point a reader sees within `LOCATION_UNCHANGED_METERS` that no other point
  of the run holds, preferring one the run already places. The step is repeated while it takes a
  point, so two of the run's points nearest one point take the next nearest rather than one of them
  becoming a second pin.

Under its own reference it asks what the pairing asks, so a point with no reference matches only
exactly. Under another reference it takes only a point the source names by a reference, which
**another membership also places, and which the run does not place as its own**: one it wrote, or one it took under another of its references. A
source's own references stay its components, as decision 1 has them. A component a source dropped
never lends its point to the one it added at the same coordinate, even after a second source has
taken that point.

**2. Such a point is adopted, not written.** The run places its membership on the point and records
on the placement the reference it offers the point under (`experience_location_placements.adopted_ref`).
It writes nothing else on the point: not the reference, not the name, not the coordinate. Nothing is
held and nothing is reported, so no source's point is rewritten by another's. The next run takes the
point again by that reference, and the fast path matches it.

**3. What the run read stays its own.** A pairing with a point a reader sees or saw is kept, so a
point that went missing comes back with its visits. A pairing with the run's folded point is kept
too. A folded point of a reference the run offers is the run's own when the run places the point it
was folded into: a kind split from the source whose point was folded took that placement with it
(Monuments & memorials from Public Art, #1807). Under the run's own reference the step makes an
ordinary pair. In ADR-0027's held shape (decision 5a), an unread arrival a centimetre from the
visible row of its reference, the visible row is now kept and the arrival withdrawn.

**4. The review card never words a proposed point within ten metres as a move.** It reads "Not a
move: the source writes the same place again, within 10 m." (`describeProposedMove`). A curator's
own correction keeps its distance, since a pin they drag five metres did move.

## Alternatives Considered

| Option | Why rejected |
|--------|-------------|
| Pair across references within ten metres for every point (`ST_DWithin` alone) | ADR-0027's identity swap: a source's dropped component would lend its row, name and visits to a new one at the same coordinate. |
| Inherit the folded points of the source a kind was split from, and nothing else (#1846's second request) | It fixes the Genbaku Dome alone, which decision 3 does too. Tel Be'er Sheva's two points were never merged, and every later source of a place would write the same duplicate. |
| Take another reference's point whenever another membership places it | Once a second source has taken a point, its owner's dropped component would lend its point to the one added at the same spot. The owner's placement has to be told from an adoption, which is why the placement records the reference. |
| Rewrite the adopted point with the run's values | Two sources would overwrite each other's name and coordinate on every run, and a gated source would hold another source's point. |
| Only hide a sub-ten-metre move on the card | The duplicate row, its placement and its held withdrawal stay, and the place keeps two points for one spot. |

## Consequences

**Positive:**
- A second source of a place joins the point readers already see, with no new row and no question
  for a curator.
- The unread duplicates on dev settle on the next run of each source: the duplicate is withdrawn,
  and the wait it held is cleared.

**Negative / Trade-offs:**
- An adopted point keeps the first source's reference and name. The second source's own name for
  the spot is not stored on it.
- A point within ten metres of another source's point that was really a different place, such as
  two monuments on one plinth, is joined to it. The tolerance is below the width of the thing
  pointed at (ADR-0027), so this is accepted.

## References

- Related ADRs: ADR-0027 (decisions 1 and 5a narrowed), ADR-0084 (a place belongs to no source; placements),
  ADR-0117 (the pairing completed), ADR-0025 (what a reader sees)
- Related docs: `docs/tech/experiences.md` (the point identity rules)
- Code: `backend/src/services/sync/locationWriter.ts` (the adopting statement),
  `frontend/src/utils/moveDescription.ts` (`describeProposedMove`)
- Issue: #1846
