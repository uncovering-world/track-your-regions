# ADR-0028: A reader is positioned by places they can go to

**Status:** Accepted

**Date:** 2026-08-17

**Context:** [#502](https://github.com/uncovering-world/track-your-regions/issues/502)

## Context

An experience carries a coordinate of its own, `experiences.location`, and its places carry theirs in
`experience_locations`. #502 measured the two disagreeing for **106 objects** — Wet Tropics of
Queensland by 191 km, Gondwana Rainforests of Australia by 171 km, Virgin Komi Forests by 144 km.

**Measured before deciding anything, because the headline number is misleading.** Of the 1604 objects
that have places:

| what the object's own coordinate is | objects |
|---|---|
| **one of its own places**, to within ten metres | **1382 (86%)** |
| 10 m – 1 km from a place | 116 |
| further than 1 km from every place | 106 |
| …of those, inside the extent of its parts (a coarse locator) | 50 |
| …of those, outside the extent of its own parts | 56 |

So the object coordinate is usually not a mystery point: it is one of the places. Of the 1382, it is
the first-listed place in 1178 and **some other place in 204** — the source picks a part, and not
always the first one.

Where it is not a place, the provenance is known: `resolveMainPoint` takes UNESCO's published site
coordinate when the source states one, and UNESCO leaves it empty on serial nominations, where the
sync then picks **the component nearest the centroid**. That code already rejected the two obvious
alternatives with reasons: a centroid of scattered parts "can land in open water" (the Roças of São
Tomé, the D-Day beaches), and the first-listed component is wherever the source happened to list it —
for Getbol, 301 km from the site's former point, far enough to change which region the experience is
assigned to.

Cross-checked outside the catalogue: Gondwana's anchor is 28°15′S 150°03′E in whole minutes, the
degrees-minutes-seconds form ADR-0027 established the World Heritage list publishes; Wikidata carries
a *different* coarse point for the same site (−29.6, 149.6) and marks it precision 0.1° ≈ 11 km.
Two independent publishers both give a locator for the property rather than a place in it.

**And the disagreement turned out to contain data errors, in both directions.** Looking at the ten
objects where one axis matches a part *exactly* while the other is off by a round amount:

| offset | object |
|---|---|
| longitude off exactly **1.0000°** | Ouadi Qadisha (the Holy Valley) and the Forest of the Cedars of God |
| latitude off **0.8000°** | Golden Mountains of Altai |
| **13′**, **10′**, **9′** | Cilento and Vallo di Diano; W-Arly-Pendjari Complex; Maloti-Drakensberg Park |
| **2′**, 54″, 43″ | Parthian Fortresses of Nisa; Ancient Merv; Western Tien-Shan; Dja Faunal Reserve |

Offsets in whole minutes are the signature of a degrees-minutes-seconds transcription slip. Ouadi
Qadisha's anchor puts a Lebanese valley in Syria and its first part carries the right value. And
Rock-Hewn Churches, Lalibela runs the other way: the anchor is the town (12.0294, 39.0404) and **our
component** is 24 km west of it.

## Decision

**1. A surface that can draw more than one point draws the object's places.** The map already does
this; Discover joins it. A serial nomination is shown as its parts, which is what it is — 95% of
offered places carry a name, so the parts are legible rather than anonymous dots. Spread is told by
drawing the parts and by the count, not by moving one pin.

**2. Where exactly one coordinate is unavoidable** — a list row, sorting by distance — **it is the
place nearest the object's own published coordinate, measured in metres.** One rule, no tolerance
constant: for the 86% whose anchor already *is* a place the distance is zero and nothing moves, and
for the rest the reader is taken to the real place closest to what the source published. Metres and
not degrees, on `geography`: 42 multi-place objects sit above 60° — Struve Geodetic Arc's 34 points
reach 70.7°N — where a degree of longitude is a third of a degree of latitude, and planar ordering
was measured sending the reader to a further place for six objects. It is also what makes the answer
dateline-safe, which CLAUDE.md § Antimeridian Handling requires of any distance in this repository.

Measured against the alternative this ADR first proposed — the anchor when it coincides with a place
to within ADR-0027's ten metres, and the medoid otherwise — which turned out to be **discontinuous,
and wrong for a reader in exactly the way #502 reports**:

| | anchor-or-medoid | nearest place |
|---|---|---|
| objects whose position does not move | 1382 | 1382 |
| objects that move | 222 | 222 |
| **worst move** | **2068 km** | **191 km** |
| moved 100 km+ by a near miss of a few hundred metres | **8** | none, by construction |

The failure is the ten-metre tolerance answering a question it was not written for. ADR-0027's ten
metres settles *"did the source rewrite the same point more precisely?"*. Here the question is *"does
this coordinate name one of these places?"*, and a place is a mountain, a railway or a monastery — its
published point and ours can differ by hundreds of metres and still plainly be the same place.
UNESCO's anchor for Mountain Railways of India sits **454 m** from the Nilgiri line, which is the
railway it names; a ten-metre rule calls that a miss and sends the reader to Darjeeling, **2068 km**
away. The Heritage of Mercury does the same across 1734 km, the Roman limes across 834 km.

The nearest place has neither failure mode. It is continuous — a coordinate moved a little moves the
answer a little — and it never invents a third location: the worst moves it makes are Wet Tropics of
Queensland at 191 km, Gondwana at 171 km and Virgin Komi at 144 km, which are the headline
disagreements #502 was opened about. The list arrives where the map already was.

Explicitly **not** the first-listed place, which an earlier draft proposed: the importer already
measured and rejected it (Getbol's first component sits 301 km from the site's point), and it would
move 204 objects whose anchor is a place the source deliberately chose. And explicitly not a rule with
two branches: the medoid keeps its place in `resolveMainPoint`, where it decides what to *publish* as
an anchor when the source states none — and when it does, that anchor is itself a place, so this rule
returns it unchanged.

**3. A disagreement beyond the tolerance is reported to a curator, not resolved silently.** This is
the part the display question was hiding. Two independently published coordinates for one object that
disagree by more than ADR-0027's ten metres are a claim that one of them is wrong, and four cases
looked at by hand produced two real errors. A rule that silently prefers either side would, for
Lalibela, move a reader from the correct point to a wrong one 24 km away. The 106 are a queue of
candidate data errors — the same shape as a withdrawal card: two facts, a distance, a decision — and
the surface for them is tracked separately.

**4. `experiences.location` is kept and stays visible to a curator.** It is what the source published,
and a curator judging a coordinate needs to see both values side by side. Nothing deletes it; it stops
being *the object's position* for a reader.

## Alternatives Considered

| Option | Why rejected |
|--------|-------------|
| Position every object at its first-listed place | The importer already measured this and rejected it: Getbol's first component sits 301 km from the site's point, far enough to change the object's region. It also moves 204 objects whose anchor is a place the source deliberately chose |
| Keep the anchor when it matches a place to within ADR-0027's ten metres, and take the medoid otherwise | Measured and rejected in favour of the nearest place, see decision 2: the tolerance answers a different question, and the rule is discontinuous — eight objects jump over 100 km because their anchor misses a place by a few hundred metres, the worst by 2068 km |
| Derive one point as the centroid of the places | Measured against the six worst cases: 25–143 km from the nearest real component, and for Central Amazon Conservation Complex further off than the anchor. A derived centre is the same lie in a new hat, and the importer's docblock already says so with the open-water cases |
| Treat all 106 disagreements as display bugs and prefer places everywhere | Lalibela disproves it: there the anchor is right and our place is wrong. Preferring places would send a reader 24 km astray, silently |
| Correct the 106 anchors in the catalogue | Most are not errors — 50 sit inside the extent of their own parts, and for a property the size of Serengeti (122 km across) two interior points 55 km apart are both inside the park. Rewriting them would destroy source metadata to paper over a display choice |
| Show the anchor with a caveat in the UI | The caveat cannot travel: Discover clusters, and a cluster of property locators is a map of places nobody can visit |

## Consequences

- **Serial nominations stop being one pin.** Discover shows Gondwana's forty parts where it showed one
  point 171 km from any of them. 1120 single-place objects are unaffected — their one place is their
  position either way.
- Drawing places rather than objects multiplies Discover's point count from 1604 to 6679. Clustered,
  that is ordinary for MapLibre, but it is a layer change rather than a coordinate change and lands as
  its own slice.
- **The catalogue gains a data-quality signal it did not have**: an object whose two coordinates
  disagree. It found ten candidates on its first pass, including one whole-degree error, and it will
  keep finding them as sources re-publish.
- Where one coordinate is still needed the answer is stable for 86% of objects, because their own
  coordinate already is one of their places and the rule returns it unchanged. Of the rest, the average
  move is 9.5 km — the distance between what the source published and the nearest place a reader can
  actually go to.
- A curator correcting a coordinate must be able to write the place and not only the anchor, or the
  correction will not move what a reader sees. That is the editor half of #502 and follows this
  decision.
- Large properties are left as they are, honestly: for Serengeti, neither point is wrong and neither is
  useful — what a traveller wants is an entrance or a visitor centre, which the catalogue does not hold
  in any form. That is a gap this ADR names and does not close.

## References

- Fixes: [#502](https://github.com/uncovering-world/track-your-regions/issues/502)
- Related ADRs: [ADR-0022](0022-locations-are-marked-not-deleted.md) (a visit hangs off a location,
  which is why a place is what a reader can be positioned by);
  [ADR-0027](0027-a-point-rewritten-more-precisely-is-the-same-point.md) (the ten metres, and the
  degrees-minutes-seconds publication that explains the minute-sized offsets above)
- Related docs: `docs/tech/experience-map-ui.md` § markers, `docs/tech/experiences.md` § Location model
