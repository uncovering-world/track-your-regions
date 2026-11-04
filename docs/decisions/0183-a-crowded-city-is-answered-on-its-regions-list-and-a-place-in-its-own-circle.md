# ADR-0183: A crowded city is answered on its region's list, and a place in its own circle

**Date:** 2026-11-04
**Status:** Accepted

---

## Context

ADR-0180 decision 3 has a curator answer a crowded city in a window over the whole type around
one place: every place of the kind and type within the radius of the card's place, best known
first. The tab of shadowed arrivals opened that window on a group's best-known arrival and
stepped through the rest. The maintainer's review of 2026-11-04 (#2358) found two faults in it.

- **The answers mean something other than what the window shows.** An answer is a pin on the
  place itself (ADR-0180 decision 1), and it holds wherever the place is seen. The window showed
  a place only from the centre's point of view. A curator answering for street B in street A's
  window could not see how B stood from anywhere else. B could come up again in street C's
  window and get the opposite answer, and the last answer won.
- **The window does not show what a reader sees.** What a curator decides is what the region's
  page shows. For England's streets the window drew one circle around a street in central
  London, and the region's other streets were reached only by stepping.

The window also listed what a place is compared with by a second spelling of the rule's
predicate (`outranksCentre`): `crowding_better()` counted those places and named none of them.

The maintainer approved a redesign from a mockup on 2026-11-04. The shadowing rule itself does not
change (ADR-0172, ADR-0180 decisions 1 and 2).

## Decision

This narrows ADR-0180 decision 3. Its decisions 1, 2 and 4 stand.

**1. The window is the region's list as a reader sees it.**
- It covers one region, one kind and one type: "Lazio · Places of worship · church". It reads
  every place of that kind and type placed in the region or under it, less what a curator
  rejected from the region. For each place it reads the standing (shown, shadowed by the rule,
  or new), the fame order, the point, the picture with its credit, and the article.
- The map draws every place of the group in the colour of its standing. The list runs as the
  region page has it: the shown places best known first, then the shadowed tail with each
  place's count of better-known places within the radius. A new arrival sits where the rule
  would put it once passed.
- A hover says why a place stands where it stands, naming the best known above it.
- The tab's groups and its Region search choose the group. A review card and a place's
  curation dialog open the region's list of the place's group, with that place open.

**2. A click opens a place in its own circle.**
- The map zooms to the kind's radius around the place. The better-known places inside it are
  marked as what it is compared with, and the others are faded.
- The place's card shows its picture, article, credit and the rule's reading with its exact
  count, and its own answers.
- A list of the places it is compared with follows, best known first, each with its distance
  and each opening its own circle. A link leads back to the region's list.

**3. Each answer pins the place itself, and the answers offered follow its standing.**
- A shown place: *Shadow*.
- A shadowed place: *Show anyway* or *Keep shadowed*.
- A new arrival the rule would show: *Publish*, *Shadow* or *Don't take*. One the rule would
  shadow: *Show anyway*, *Keep shadowed* or *Don't take*.
- *Show anyway* is the `list` pin and *Shadow* and *Keep shadowed* are the `shadow` pin
  (ADR-0180 decision 1). A held pin can be handed back to the rule. The Apply bar names the
  staged answers and how many places the region page will then show.

**4. `publish` is an answer of its own.** It publishes a new arrival with no pin, so the rule
places it, as the arrival's own card publishes it. It is refused on a place already published.
*Publish* on an arrival the rule would show is therefore no `list` pin. Such a pin would take
one of the ten for good, and push a later, better-known arrival out of a place the curator only
meant to take.

**5. What a place is compared with is the rule's own set.** `crowding_above()` lists the
candidates that count above a membership: the better known and those a curator keeps in the
list, never one kept in the shadow nor one holding a work a reader is shown, the membership's own
pin unread. `crowding_better()` counts what `crowding_above()` lists (migration 217). Both stay
set-returning SQL functions, so the planner inlines them, the inner through the outer, into the
recount's lateral join.

## Alternatives Considered

| Option | Why rejected |
|---|---|
| Keep the window around one arrival and add the region's list beside it | The circle would still frame every answer from one centre, which is the view that misled the answers about other places. |
| Open a circle for every place of the region at once | The circles overlap across a city's core, so the map could no longer say which places one place is compared with. |
| *Publish* as a `list` pin | The pin would take one of the ten for good and outlive the neighbourhood it answered (ADR-0180's own trade-off), for a place the rule already shows. |
| List what a place is compared with by a predicate spelled in the read | That is a second statement of the rule beside `crowding_better()`. A change to one would make the list and the count disagree. |
| Make `crowding_better()` a scalar over `crowding_above()` | A scalar called per candidate took the full recount from 2.1 s to 5.7 s (ADR-0180); a set-returning count keeps the inlining. |

## Consequences

**Positive:**
- **A curator answers a place where a reader meets it:** in its region's list, beside the places
  that list shows. On the development catalogue of 2026-11-04 Lazio's churches are 127 places:
  18 shown, 28 shadowed and 81 new, 70 of which the rule would shadow.
- **The list of what a place is compared with and its count are one rule,** so a circle names
  the places its count counts, less the new arrivals the curator's scope leaves out or whose
  source no longer lists them, which it counts without naming (`comparedUnlisted`).
- **A group stays open after its last arrival is answered,** since a region's list exists
  whether or not arrivals wait in it. A link opens any group.

**Negative / Trade-offs:**
- **The region's list costs more than the circle did.** It reads `crowding_above()` once for
  each place in the tail or pinned. Lazio's churches took 317 ms warm on dev; the circle around
  the Pantheon took 4 ms.
- **The count the Apply bar gives is the places the staged answers move, before the recount.** A
  pin also moves the neighbours it counts against, which only the recount says.
- **The first statement of the rule now spans two functions,** `crowding_above()` for the set
  and `crowding_better()` for the count. The recount was planned with the pair (an EXPLAIN shows
  no function scan), but its full time was not measured again.

**Amended while Draft (2026-11-07, #2365's review), before the pull request that accepts it:**
- *What a circle names.* The first draft said a circle names exactly the places its count counts.
  It lists them through the circle's own predicate (`aroundSql`), which leaves out a new arrival
  outside the curator's scope and one whose source no longer lists it, as the review queue does,
  while `crowding_above()` counts both. Widening the list would break the scope rule, so the
  circle names what the curator may see and counts the rest (`comparedUnlisted`).

## References

- Related ADRs: ADR-0180 (decision 3 narrowed), ADR-0172, ADR-0173, ADR-0179
- Related docs: `docs/tech/experiences.md` § What a crowded city shows, `docs/tech/addresses.md`
  § The review page
- Issues: #2358; #2282, #2345, #2349
