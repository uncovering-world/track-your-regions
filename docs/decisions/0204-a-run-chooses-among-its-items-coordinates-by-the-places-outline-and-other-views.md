# ADR-0204: A run chooses among its item's coordinates by the place's outline and other views

**Date:** 2026-11-13
**Status:** Accepted
**Issue:** [#2119](https://github.com/uncovering-world/track-your-regions/issues/2119), Epic #2115
**Narrows:** [ADR-0085](0085-one-wikidata-item-is-one-reading-whichever-source-reads-it.md) decision 1, the coordinate rule

---

## Context

ADR-0085 made every Wikidata reader keep one coordinate of an item: the most precisely written,
then the smaller latitude and longitude. That rule is deterministic. Its claim that the finer
coordinate is the better one does not hold on the catalogue. On the development catalogue on
2026-11-13, 674 places carried a kind's item with two or more best-rank coordinates. In 283 of
them the coordinates stood more than 100 m apart.

- **Messene** (Q1022117) holds the excavation at Mavromati, written to three decimals, and a bot's
  point 15.6 km off, written to two. The place showed the bot's point, and the run's move to
  Mavromati waited for a curator.
- **Myra** shows modern Demre, while the theatre is 1.2 km away. **Pergamon** shows a rounded point
  1.4 km from the acropolis. In both, the item carries both points. Pergamon's rounded point is a
  whole arc-minute written out to six decimals (39.116667, 27.183333), so the rule keeps it over the
  acropolis (39.12947, 27.18412) for its digits.
- **Waiting moves:** 36 of the 47 coordinate moves held for a curator were of this shape. The run had
  proposed one statement where the place showed the other.

Most such places say which point is right. 80 of them have an OpenStreetMap outline holding one
of the coordinates, and 4 have another source's view within a short move of one: Tyre, the
Shrines and Temples of Nikko and the Cave of Altamira 0 to 21 m from it. Three more views stand
between the coordinates, 255 to 471 m from both: Poverty Point, the Moidams and Kato Paphos. The rest
say nothing. Asking a
curator about every one of them would be a question per run for places a short move apart.

## Decision

1. **A run chooses its coordinate among its item's for the place it writes.** It does not take one
   fixed in advance. The choice sits in the run's record write (`withChosenCoordinate`, called by
   `upsertExperienceRecord` under the place's lock and by its preview). It reads the item's
   best-rank coordinates on this planet from the local Wikidata copy, beside the one the run
   sends. The record reports the chosen coordinate, and the run writes the place's point there
   (`upsertSingleLocation`, which every kind that reads an item calls with `location`).
2. **The order** (`chooseItemCoordinate`, `itemCoordinate.ts`):
   1. Coordinates within a short move of each other (250 m, `SHORT_MOVE_METERS`) are one place
      written twice. The one the place shows stands, else the first.
   2. Else the one nearest the place's outline, where only one is nearest. Inside counts as zero.
      An outline more than a kilometre from a coordinate says nothing about it.
   3. Else the one nearest another source's view of the place, under another id than the item,
      counting a view only within a short move of a coordinate: the two sources then read one spot.
      A view farther from every coordinate says nothing about them.
   4. Else the one the run reported last, then the one the place shows, then the first. This choice
      is undecided.
3. **How finely a coordinate is written decides only between writings of one spot.**
   `preferredCoordinate`, "the first" above and the gather's coordinate before the run knows the
   place, is a function of the item's set of coordinates, never of the order its rows arrive in.
   It keeps the points on this planet over those on another globe, takes the first of them by
   latitude, then longitude, and of the points within a short move of that one keeps the most
   finely written, as for *Maman* in Minato written once rounded, 120 m off. Farther apart, the
   digits say nothing. A fold of pairs could not hold this: two points each within a short move of
   a third may stand farther apart, and the kept one would change with the order.
4. **No coordinate is written outside a run, and the gate is unchanged.** A move the choice makes is
   proposed and held like any other (ADR-0140). A move the run already proposed stays the curator's
   question while nothing decides.
5. **What nothing decides is a curator's question.** The catalogue check `item-coordinates-disagree`
   lists the undecided places a reader is shown. It reads the run's own choice, so the rule has one
   owner. A place whose coordinate a curator set is settled, and so is one whose move waits on the
   review page. The check `pin-away-from-its-place` lists a place whose pin stands more than a short
   move from the coordinate its row and card use.

This narrows ADR-0085 decision 1 for the coordinate. Two sources reading one item still read one
place. Which coordinate that is now depends on what the place holds, not on how the number is
written.

## Alternatives Considered

| Option | Why rejected |
|--------|-------------|
| Keep the more precisely written coordinate | It keeps Pergamon in the town, 1.4 km from the acropolis, for an arc-minute written to six decimals. Its choice says nothing about the ground. |
| Ask a curator about every item with two coordinates | 674 places, 445 of them within a short move: a question per run that nothing on the ground needs. |
| Prefer the preferred-rank statement only | It is what `bestStatements` already does. The cases here are two statements at the same rank. |
| Repair the coordinates in a migration from the outlines | A repair writes coordinates outside the run and outside the gate. The run makes the same choice and proposes it, and a curator passes it. |

## Consequences

**Positive:**
- On the development catalogue, the run keeps proposing 31 waiting moves: those the outline backs
  (Messene, Hierapolis, Stobi, Viminacium), and those nothing decides, which stay the curator's
  question (Myra, Olynthus). It stops proposing 5: Metapontum and Gortyn, whose
  outlines hold the point the place shows, and three moves of under 250 m. It proposes 8 new moves
  onto the outline (Pergamon, Apollonia, Sicyon, Amorium).
- Undecided places are listed once, for a person, instead of flipping with the order of a reader's
  rows.

**Negative / Trade-offs:**
- A run reads the item's coordinates and the place's evidence once per record of an item with
  several coordinates: two indexed statements.
- Where nothing decides, the place keeps what it showed even when that is wrong (Olynthus,
  Pattadakal), until a curator answers the check or the waiting move.

*Amended in place on 2026-11-13, in review of the pull request that accepts it: decision 2.3 gains
the short-move reach of another source's view, measured on the development catalogue, since a view
at any distance from both coordinates could decide between them; decision 3 states the fallback as a
function of the set, since a pairwise fold over three points kept a different point in a different
order. With the reach, the views that decide number 4 rather than 7.*

## References

- Related ADRs: ADR-0085 (one item, one reading), ADR-0140 (a short move passes the gate), ADR-0105
  (the local Wikidata copy), ADR-0059 (OpenStreetMap outlines)
- Related docs: `docs/tech/experiences.md`, `docs/tech/data-assertions.md`
- Issue: #2119
