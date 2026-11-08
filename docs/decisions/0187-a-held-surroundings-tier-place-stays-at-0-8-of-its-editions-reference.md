# ADR-0187: A held surroundings-tier place stays at 0.8 of its editions reference

**Date:** 2026-11-08
**Status:** Accepted

---

## Context

[ADR-0175](0175-a-place-kind-admits-by-quantiles-of-its-own-pool.md) decision 2 keeps a place the
surroundings tier admitted while it passes one test at a softer bar. The readers test is read at
0.8. The Wikivoyage and editions tests are read whole, "since their reference is the place's own
neighbours'".

A place's own neighbours change, though, while the place does not. The neighbourhood is every item of
the place kinds' classes within 150 km, of the place's own density
([ADR-0181](0181-the-surroundings-tier-measures-a-place-against-neighbours-of-its-own-density-within-150-km.md)).
A class added to any kind adds its items to that neighbourhood, and the editions reference, the
median of the ten best, moves with them.

#2380 added Thailand's historical parks to Archaeology. In the main-against-branch dry run on dev
(2026-11-08), two shown Places of worship fell by half an edition:

- **Wat Wang Wiwekaram (Q4105234), Sangkhla Buri.** 5 editions. The reference rose from 5 to 5.5 when
  Mueang Sing Historical Park (9 editions) joined its 41 neighbours at 149 km.
- **Wat Phra Si Rattana Mahathat Chaliang (Q16004348).** 4 editions. The reference rose from 4 to
  5.5. Si Satchanalai Historical Park, which the temple stands beside, joined its neighbours.

Neither place's own signals changed. This is the drift the stay exists to absorb, arriving through
the one test the stay does not soften. #2382 first proposed changing the neighbourhood: leaving out
the places a kind refuses, and a place's own whole. Neither variant returns these places. The Chaliang
temple carries no `P361` to the park, and refusing Mueang Sing by ADR-0179's map condition would mean
asking the map about the 2.1 million pool items before any reference is read.

## Decision

**A place the surroundings tier holds stays while its Wikipedia editions reach 0.8 of the editions
reference**, as its readers reach 0.8 of the readers test. This narrows ADR-0175 decision 2.

- The register states it: `SURROUNDINGS_REGISTER.stayEditionsShare`, 0.8, the share the readers
  test already stays at.
- A new place still enters on the whole reference.
- The Wikivoyage test stays whole. A held place's guide is read as last read where no usage build is
  in place (ADR-0175 decision 6), and a tunnel, dam, lock or bridge stays only while a guide uses it.
- The stay note names both shares.

The maintainer's direction of 2026-11-08 was that the loss be fixed in the rule, not by a pin.
The value follows the readers test's share, so this decision moves no number of its own. It closes a
path through which a class added to one kind took places out of another, and the dry run below is
its measurement rather than ADR-0175 decision 5's four steps. A later re-derivation of the frame
reads the two stay shares together.

## Measurement

Main-against-branch places-pass dry run on dev, 2026-11-08: main 1f0156ccd (logs 548–555) against the
branch at f6e5037fb (logs 567–574), compared by kind and external id over all eight kinds.

- **The only difference:** Wat Wang Wiwekaram is kept in Places of worship. Its two `filtered` rows
  become one `updated`.
- **No new `created` row** in any kind.
- The Chaliang temple still falls: 4 editions against 0.8 × 5.5 = 4.4. On the ground, the historical
  park beside it is the visit, and it is in Archaeology since #2380.

## Consequences

- A place the surroundings tier holds no longer falls because a class added to some kind brought
  better-known items into its neighbourhood, as long as the drift stays within a fifth.
- A held place whose editions fall more than a fifth under the reference fails the editions test. It
  still stays by its readers or the guides' test, or where the guides cannot be read (ADR-0175
  decision 6), as long as it keeps the languages and readers' floor every held place needs.
- The churn between two readership years that ADR-0175 decision 2 measured can only fall: the stay
  keeps a superset of what it kept.

## Alternatives considered

| Alternative | Why not |
|---|---|
| Leave the places a kind refuses out of the neighbourhood (#2382) | The refusal Mueang Sing meets is ADR-0179's map condition. Reading it for the 2.1 M pool items before any reference is read costs a map read per item. |
| Leave a place's own whole out of its neighbourhood (#2382) | The Chaliang temple carries no `P361` to its park, so the whole cannot be read off its statements. |
| Pin the two temples back by hand | The maintainer asks that a loss be fixed in the rule. Pins hide the rule's defect. |
| A stay share below 0.8 | It would keep places whose editions truly sit far under their area's, for no measured gain. |

## Related

- ADR-0175 (decision 2 narrowed here), ADR-0181.
- #2380, #2382.
