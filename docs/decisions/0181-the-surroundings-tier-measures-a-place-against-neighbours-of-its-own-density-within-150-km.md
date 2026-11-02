# ADR-0181: The surroundings tier measures a place against neighbours of its own density within 150 km

**Date:** 2026-11-02
**Status:** Accepted

---

## Context

The surroundings tier ([ADR-0178](0178-a-kind-is-filled-in-three-tiers-the-world-a-places-surroundings-and-its-region.md))
measures a place the world bars left out against what lies around it.
[ADR-0171](0171-a-global-sources-regional-tier-measures-a-place-against-what-lies-within-50-km.md)
decision 1 set the neighbourhood at everything within 50 km. It compared 10, 25 and 50 km and
nothing wider. [ADR-0175](0175-a-place-kind-admits-by-quantiles-of-its-own-pool.md) decision 3
then derived two shares with the radius held at 50 km: half the guide reference for the Wikivoyage
test, and the readers reference itself for the readers test.

A circle of fixed size misreads a place on the edge of a dense core. A monastery in Serpukhov is
95 km from the Kremlin. A circle wide enough to give Siberia a neighbourhood reaches Moscow's core
from there, and Moscow's best then set the monastery's references. A circle small enough to keep
Moscow out gives the monastery too few neighbours in emptier regions. The same holds for an abbey in
Lazio against Rome and a cathedral in the Île-de-France against Paris.

A measurement on 2026-11-02 (#2297) read the tier on the frozen metrics of #2177. It crossed four
radii (25 to 100 km) with the two shares. It then read three neighbourhoods that follow the
density gradient, beside the circles:

- **discrete isolation**: everything nearer than the nearest place of higher fame;
- **a density ratio**: within a wide circle, only the neighbours whose own density is close to the
  candidate's;
- **a Gaussian kernel**: neighbours weighted by distance instead of cut at a radius.

Every form was read by name on the edges of four dense cores. The report is
`docs/research/2026-11-02-a-surroundings-neighbourhood-that-follows-density.md`.

## Decision

This narrows ADR-0171 decision 1 and ADR-0175 decision 3. The rest of both stands: the reference
is the median of the ten best, the three tests read in areas of 5, 25 and 25 places, a candidate
needs two editions and 3,000 readers a year, a tunnel, a dam or a lock needs a guide, and a held
place stays at 0.8. ADR-0179's two conditions on Archaeology's sites stand.

**1. A place's neighbours are the places of its own density within 150 km.**
- A place's density is its distance to its 20th-nearest place of the surroundings pool, every place
  of the live kinds and the museums, whatever its editions.
- A neighbour counts toward the candidate's group and references only while its density is within
  a factor of 4 of the candidate's, either way. The candidate always counts.
- This is the local-outlier-factor idea: a place is compared with places of its own density. On a
  core's edge the core's places are far denser than the candidate, and they drop out. In open
  country the circle reaches 150 km, wide enough to give a sparse region a neighbourhood.
- Distances are great-circle distances on a sphere of the Earth's mean radius, as the measurement
  read them.

**2. The Wikivoyage test passes at a quarter of the reference, and the readers test at one and a
half times it.**
- The shares moved demand more than the shape did. On the development regions, a guide share of a
  quarter against a half moves the demanded places shown by 2 to 16 per kind. The neighbourhood
  moves them by 0 to 3.
- A quarter is ADR-0171's own share, which ADR-0175 had doubled at 50 km.

**3. One choice for every kind.**
- Places of worship is the only kind with enough data to decide alone: 324 demanded places and 192
  graded. Its own best cell is this one in all 21 leave-one-region-out folds.
- The other kinds have fewer than 30 demanded or graded places each. Their own picks would trim
  155 places at equal demand, among them Reginald's Tower, Brâncuși's Gate of the Kiss and the San
  Jacinto Monument.
- Archaeology's sites take the same neighbourhood and shares, with ADR-0179's conditions after
  the cut.

**4. The much-read places of a dense hinterland that no guide names are a curator's to put back.**
- Casamari Abbey, the Joseph-Volokolamsk Monastery and the Marudhamalai temple fall under the rule.
- No neighbourhood shape keeps them without about 1,000 more places shown worldwide. A curator
  restores the ones worth a visit, as was done for five of Archaeology's sites.

## Alternatives Considered

| Option | Why rejected |
|---|---|
| Keep 50 km at half and the reference (today) | Every development figure is lower: 276 demanded places shown against 299, 177 outside Europe and Oceania against 197, canon 0.852 against 0.860. The control read 58 of 79 against 61. |
| A plain 100 km circle at a quarter and one and a half | It matches the density ratio within sampling error on the development figures, but it measures a place on a core's edge against the core. In the Moscow region it shows 15 places against 24, and it loses Chernigovsky Skit, the Vladychny Monastery in Serpukhov, Valvisciolo Abbey, and the cathedrals of Montefiascone and Frascati. |
| 50 km at a quarter and one and a half | It shows 13,730 places against 12,653 for 2 fewer demanded places, at 6.6 % judged noise against 5.9 %. |
| Discrete isolation as the neighbourhood (the isolation circle) | It shows 15,974 places, over 3,300 more, for one more demanded place. |
| A rule on isolation alone (fame times a function of the isolation distance) | It shows 33 of 129 demanded places on the held-out regions, where every other form shows 48 to 52. |
| A Gaussian kernel | At σ 50 km it shows 13,715 places for 296 demanded. At σ 25 km it restores Tamil Nadu, at 14,834 places shown worldwide against 12,653. |
| A density ratio of 2, or density at the 50th-nearest place | A factor of 2 shows 779 more places for 2 more demanded. The 50th nearest shows 52 fewer for 2 fewer demanded and canon 0.856. |
| A neighbourhood or shares per kind | Only Places of worship can decide, and its own choice is the shared one. |

## Consequences

**Positive:**

| On the development regions | 50 km, half, the reference (today) | Density ratio, 150 km, a quarter, one and a half |
|---|---|---|
| Places shown, after the display rule | 12,495 | 12,653 |
| Survey demand shown (of 451) | 276 | 299 |
| Outside Europe and Oceania (of 310) | 177 | 197 |
| Held-out regions (of 129) | 50 | 52 |
| Canon | 0.852 | 0.860 |
| Judged noise | 6.1 % (17 of 280) | 5.9 % (16 of 272) |
| Control regions (of 79 demanded) | 58 | 61 |

- A place on the edge of a dense core is measured against the edge. The tier keeps Chernigovsky
  Skit, the Vladychny Monastery in Serpukhov, Valvisciolo Abbey, and the cathedrals of
  Montefiascone and Frascati, which a plain 100 km circle drops.
- The pool read keeps its places in the run's memory, and the neighbourhood is read there through a
  k-d tree. Every one of the pool's places gets its density once, and each candidate's
  neighbourhood is one range question.

**Negative / Trade-offs:**
- **The control read mixes the shape with the shares.** Every configuration at a quarter and one
  and a half reads 61 of 79 on the control regions, 50 km included. The control isolates the
  shares, not the neighbourhood.
- **The figures cannot choose between 100 km and the density ratio.** The case for the density ratio
  rests on the edges named above, not on a development figure.
- **Tamil Nadu falls from 140 places shown to 101.** It is dense everywhere rather than the edge of
  a core, and no shape tied to local density repairs it. Its much-read temples no guide names, such
  as the Marudhamalai temple, are a curator's (decision 4).
- **The noise rests on one reader until a second one has graded the swapped places.** The report
  carries the second reading.
- **A 150 km circle holds about nine times the places of a 50 km one,** so the run reads more
  places per candidate. The pool read's time is in the report.

## References

- Narrows: ADR-0171 decision 1, ADR-0175 decision 3. Applies: ADR-0175 decision 5 (the method),
  ADR-0179 (Archaeology's conditions after the cut).
- Related: ADR-0172 (the crowding circle stays 10 km), ADR-0177 (fame), ADR-0178 (the tiers).
- Research: [2026-11-02 — A surroundings neighbourhood that follows density](../research/2026-11-02-a-surroundings-neighbourhood-that-follows-density.md)
- Issues: #2297, #2177, #2246.
