# A surroundings neighbourhood that follows density

**Date:** 2026-11-02
**Issue:** #2297 (part of #2177)
**Decision:** [ADR-0181](../decisions/0181-the-surroundings-tier-measures-a-place-against-neighbours-of-its-own-density-within-150-km.md)

## Question

The surroundings tier measures a place the world bars left out against its neighbours. ADR-0171
set the neighbourhood at everything within 50 km, from a comparison of 10, 25 and 50 km only.
ADR-0175 then derived the guide share (half the reference) and the readers share (the reference
itself) with the radius held at 50 km.

The question has two parts:

- Does a wider circle, crossed with the two shares, do better?
- Does a neighbourhood that follows the density gradient do better again? Here a place on the edge
  of a dense core is not measured against the core. The edges named are the Moscow region outside
  Moscow, Lazio outside Rome, the Île-de-France outside Paris, and Tamil Nadu.

## Method

The measurement follows ADR-0175 decision 5 and reuses #2177's frozen metrics.

- **The frame.** `frame.admit` over `point-final.json`, the adopted point. Only the surroundings
  tier's neighbourhood and its two shares move. The group floors (5, 25 and 25), the ten best, the
  two editions and the 3,000 readers a year are held, and so is the guide a tunnel, a dam or a
  lock needs.
- **The pool.** Every item of the live kinds' classes and of the museum tree with a point, whatever
  its editions: 2,117,643 items. It is the pool `readSurroundingsPool` builds, exported from the
  development database on 2026-10-31 (the subset of 2026-10-19, the readership year to 2026-09).
- **The candidates.** The 29,051 places that pass their kind's rule, with two editions and 3,000
  readers a year.
- **The figures.** All are read on what the catalogue shows after the display rule (ADR-0172,
  ADR-0177's fame):
  - places shown;
  - survey demand on the 16 development regions (451 demanded places, as the map shows them,
    #2246), and the part of it outside Europe and Oceania (310);
  - survey demand on the held-out regions (129);
  - canon recall;
  - judged noise, among the places a person graded.
- **The edges.** Places shown in Moscow Oblast, the Central Federal District beyond 30 km of
  Moscow, Lazio outside Rome, the Île-de-France outside Paris, England outside Greater London and
  Tamil Nadu, read by name.

Distances are great-circle distances on a sphere of the Earth's mean radius (6,371.0088 km). The
scripts and outputs are on the development machine under `data/cache/2177-admission/`: `radius-*`
for the sweep, `gradient-*` for the gradient forms, `perkind-*` for the kinds, `blind2297-*` for the
second reading.

## The radius sweep

Four radii crossed with the guide share {0.25, 0.5, 1} and the readers share {0.5, 1, 1.5}. The
rows below are the two shares the result turned on.

| Radius, guide, readers | Shown | Demand (of 451) | Outside Europe (of 310) | Held-out (of 129) | Canon | Judged noise |
|---|---|---|---|---|---|---|
| 25 km, 0.25, 1.5 | 14,880 | 293 | 192 | 51 | 0.862 | 6.3 % |
| 50 km, 0.5, 1.0 (adopted) | 12,495 | 276 | 177 | 50 | 0.852 | 6.1 % |
| 50 km, 0.25, 1.5 | 13,730 | 297 | 196 | 51 | 0.860 | 6.6 % |
| 75 km, 0.25, 1.5 | 12,968 | 296 | 195 | 50 | 0.856 | 5.9 % |
| 100 km, 0.25, 1.5 | 12,418 | 295 | 194 | 50 | 0.858 | 5.5 % |
| 100 km, 0.5, 1.0 | 10,597 | 272 | 173 | 49 | 0.852 | 4.7 % |

- **100 km at a quarter and one and a half dominates the adopted point on every development
  figure.** It shows fewer places, more demand, more outside Europe, a higher canon and less noise.
- **About 1,500 places swap in each direction** between those two points.
  - Added: 1,312 of 1,549 are used by a guide, for example Adhai Din Ka Jhonpra, Kataragama, Wat
    Phra That Phanom, Hellfire Pass and Christ the Redeemer of the Andes.
  - Dropped: 1,323 of 1,510 are used by none, for example the Batu Caves Murugan statue, Tancarville
    Bridge and Kaal Bhairav in Varanasi.
- **The cost falls where no survey looks.** Tamil Nadu falls from 140 places shown to 101, and the
  Central Federal District outside Moscow from 122 to 101.
- **Neighbourhoods of the k nearest places** (k 50 to 400) moved admissions into the dense cores. They
  lost the places ADR-0171 exists for: the Dakar mosques, Kizimkazi, and the Friday mosques of Natanz
  and Nain.
- **No radius per type** gained beyond noise.

## Neighbourhoods that follow density

Three forms were read beside the circles, each at the same shares:

- **discrete isolation**: a place's distance to the nearest place of higher fame, as cartographic
  settlement selection uses it (Gröbe and Burghardt; van Kreveld, van Oostrum and Snoeyink's circle
  growth). The *isolation circle* measures a place against everything nearer than that distance.
  The *isolation rule* admits a place when its fame, times a function of that distance, reaches a
  bar.
- **a density ratio**: within a wide circle, only the neighbours whose own density is within a
  factor of the candidate's. This is the local-outlier-factor idea, a place compared with its own
  density. A place's density is its distance to its k-th nearest place of the pool. The candidate
  always counts.
- **a Gaussian kernel**: the ten best by signal weighted by `exp(−d²/2σ²)`, out to 3σ, in place of
  the hard circle.

| Neighbourhood (guide / readers share) | Shown | Demand /451 | Outside Europe /310 | Held-out /129 | Canon | Judged noise | Moscow Oblast / Lazio outside Rome / Île-de-France outside Paris / Tamil Nadu |
|---|---|---|---|---|---|---|---|
| 50 km, 0.5 / 1.0 (adopted) | 12,495 | 276 | 177 | 50 | 0.852 | 6.1 % | 22 / 27 / 11 / 140 |
| 100 km, 0.25 / 1.5 | 12,418 | 295 | 194 | 50 | 0.858 | 5.5 % | 15 / 23 / 16 / 101 |
| density ratio 150 km, k 20, ×4, 0.25 / 1.5 | 12,653 | 299 | 197 | 52 | 0.860 | 5.9 % | 24 / 32 / 19 / 101 |
| isolation circle, 0.25 / 1.5 | 15,974 | 300 | 198 | 53 | 0.864 | 6.3 % | 33 / 53 / 45 / 120 |
| isolation rule alone | 9,615 | 257 | 159 | 33 | 0.850 | 5.6 % | 17 / 26 / 15 / 92 |

The density ratio was read at 100 and 150 km, k 20 and 50, and a factor of 2 and 4. At 150 km,
a quarter and one and a half:

| Density ratio | Shown | Demand /451 | Held-out /129 | Canon | Judged noise |
|---|---|---|---|---|---|
| 100 km, k 20, ×4 | 13,432 | 300 | 52 | 0.862 | 6.3 % |
| 150 km, k 20, ×2 | 13,432 | 301 | 56 | 0.858 | 6.1 % |
| **150 km, k 20, ×4** | **12,653** | **299** | **52** | **0.860** | **5.9 %** |
| 150 km, k 50, ×4 | 12,601 | 297 | 51 | 0.856 | 5.5 % |

- **The density ratio is the only gradient form worth carrying forward.** On the development
  figures it matches 100 km within sampling error.
- **On the edges it keeps most of what 100 km cuts**: Chernigovsky Skit, the Vladychny Monastery in
  Serpukhov, Valvisciolo Abbey and the cathedrals of Montefiascone and Frascati.
- **Tamil Nadu is repaired by no shape tied to local density.** It is dense everywhere, not the edge
  of a core. Only the Gaussian kernel at σ 25 km restores it, showing 14,834 places worldwide.
- **The isolation rule alone fails the held-out regions.** It shows 33 of 129 there, against 48 to
  52 for every other form.
- **The isolation circle shows 3,300 more places** for one more demanded place.
- **The figures cannot choose between 100 km and the density ratio.** The case for leaving 50 km
  rests mostly on the guide share of a quarter.

## Per kind

The grid was then read per kind, with each kind's own best cell and leave-one-region-out folds.

- **Places of worship is the only kind with enough data to decide**: 324 demanded places and 192
  graded. Its own best cell is the shared one, the density ratio at 150 km with guide share 0.25
  and readers share 1.5. That holds in all 21 folds.
- **The other five kinds are undecidable**, with fewer than 30 demanded or graded places each.
  Their own picks would trim 155 places at equal demand, and those include named sights:
  Reginald's Tower, Brâncuși's Gate of the Kiss, the San Jacinto Monument.
- **The shares matter and the shape barely does.** A guide share of a quarter against a half moves
  demand by 2 to 16 places per kind. The shape moves it by 0 to 3.
- **Squares & streets and Bridges carry their own noise at every cell.** Squares & streets reads
  13 to 17 % and Bridges about 33 %. That is a matter of those kinds' rules, not of the
  neighbourhood.

Archaeology's sites were read over the radii alone, on their own frame (ADR-0179, `radius-arch-*`):
from 25 km to 100 km their canon held at 0.876, and 75 and 100 km cost one and two of the 143
demanded sites against 50 km. They were not read at the
density ratio. The maintainer's decision takes them in with the other kinds, and ADR-0179's two
conditions after the cut.

## The point

The maintainer's decision (2026-11-02):

- the density-ratio neighbourhood: within 150 km, a neighbour counts only while its own density,
  its distance to its 20th-nearest place, is within a factor of 4 of the candidate's;
- the guide share 0.25 and the readers share 1.5;
- one choice for every kind, Archaeology's sites included.

The much-read temples and monasteries of dense hinterlands that no guide names are not held by
the rule. A curator puts back the ones worth keeping, as was done for five of Archaeology's sites.

## The edges by name

Against the adopted point (50 km, a half, the reference):

- **Moscow Oblast: 22 → 24.** In: the Church of the Theotokos of Vladimir, the
  Svyato-Ekaterininsky Monastery in Vidnoye, the Trinity Church in Troitse-Lykovo, the
  Transfiguration Church in Ostrov. Out: the Joseph-Volokolamsk Monastery, the Peremilovo monument,
  the Nicolo-Peshnoshsky Monastery, the Cathedral of the Dormition in Kolomna.
- **The Central Federal District beyond 30 km of Moscow: 122 → 111.** Out among others: the
  Shamordino Convent, the Troitsky Makariev Monastery and the Otroch Uspensky Monastery, none of
  which a guide uses.
- **Lazio outside Rome: 27 → 32.** In: Valvisciolo Abbey, Montefiascone Cathedral, Frascati
  Cathedral, the Collegiata di San Tommaso, Lucus Feroniae, San Giusto Abbey. Out: Casamari Abbey,
  read 27,655 times a year and used by no guide, and the cathedrals of Gaeta and Terracina.
- **The Île-de-France outside Paris: 11 → 19.** In, and none out: Notre-Dame de Versailles,
  Pontoise Cathedral, the basilica of Argenteuil, Créteil Cathedral, the Louveciennes aqueduct and
  the church of Auvers-sur-Oise.
- **England outside London: 245 → 277.** In: Evesham Abbey, Bolton Priory, Netley Abbey and the
  Bennerley Viaduct among 45. Out: 13, among them St Chad's in Shrewsbury and St Laurence's in
  Ludlow.
- **Tamil Nadu: 140 → 101.** Out: 49, most of them much-read temples no guide uses, such as the
  Marudhamalai temple (43,707 readers a year) and the Pancha Rathas of Mamallapuram's group.

Against a plain 100 km circle at the same shares, the density ratio adds 10 places in Moscow Oblast
and loses one, adds 9 in Lazio outside Rome and loses none, and shows six more demanded places
(Meskel Square, the Yunju Temple, the Keur Moussa abbey, Monar Jonban, the Collegiata di San
Tommaso, Ilê Axé Iyá Omin Iyamassê).

## The control read

The control regions (Bangkok, Lisbon, Cape Town), which no tuning has read, show 61 of their 79
demanded places at the new point against 58 at the adopted one. Every configuration at a quarter
and one and a half reads 61 there, 50 km included: the read isolates the shares, not the shape.

## The second reading

The first figures' noise rests on one reader. A blind double reading of the swap graded 180
shuffled places: 100 the new point adds, 60 it drops and 20 decoys shown under both. Two
independent readers graded them against the review's guideline without the key, which was joined
only afterwards.

| Side | Places | Noise by either reader | Worth a visit by both |
|---|---|---|---|
| Added | 100 | 9 (9.0 %, ±5.6) | 19 |
| Dropped | 60 | 10 (16.7 %) | 9 |
| Decoys, unchanged | 20 | 1 (5 %) | 7 |

- **The readers agree** on 167 of 180 places, κ 0.85. Both readers are model agents, so that
  agreement says less than a human second reader would.
- **The swap takes noise out.** The new point adds places with half the noise of those it drops,
  and more places both readers call worth a visit.
- **The noise of the shown set,** with the unchanged 10,898 places at the review's 6.1 %, is about
  **6.5 %** at the new point against about **7.4 %** at the adopted one. With the unchanged places at
  the decoys' 5 % it is 5.6 % against 6.5 %. Either way it is under the 7 % limit.
- **The noise the new point adds** is road bridges people drive across, a mast, a never-built
  bridge, places moved away or demolished, and ordinary modern mosques. That is noise in the kinds'
  rules, not in the neighbourhood (#2255).

## The code's run

The code reads the same rule (`places/surroundingsNeighbourhood.ts`): the same pool, built by the
same statement; a place's density at its 20th-nearest place over the whole pool; neighbours within
150 km whose density is within a factor of 4 of the candidate's, the candidate always among them;
distances on the same sphere. It was run read-only on the development database on 2026-11-02, as
the role `pg_read_all_data`, which can build the session's temporary table and is refused a write
to the catalogue. It used the code's own gather and kind rules, the world tier as the database holds
it, and no held places, since the measurement modelled no stay.

**Where the code's run differs from the measurement:**

- **The pool** is the same statement two days later: 2,117,620 items against 2,117,643, over 4,295
  classes against 4,296.
- **The candidates.** The code reads the surroundings of every pool item with two editions and the
  2,400 readers a held place stays at, 50,948 items. The measurement read the 29,051 that pass their
  kind's rule with 3,000 readers. A candidate's neighbourhood is the same either way: of the 29,050
  measured candidates the code read, 92.5 % have the same three lists of the best and 97.6 % a group
  size within 1 % or 2 places. The rest moved with the data.
- **The kind's rule** runs after the cut on today's data, where the measurement read the verdicts
  exported on 2026-10-31.
- **A coordinate the pool picked at random.** An item with two coordinates of one rank took either
  one, in the measurement's export and in the code until this change. A neighbour that moves moves
  the densities around it: two reads of the same pool an hour apart differed by more than 1 % of the
  group, or two places, for 1,078 of the 50,948 candidates. The code now takes the coordinate with the
  lowest statement id, so every run reads the same pool.

**The arrivals by kind**, the code's surroundings tier against the measurement's:

| Kind | Measured, 50 km, a half, the reference | Code, same | Measured, the new point | Code, the new point | In both, the new point |
|---|---|---|---|---|---|
| Places of worship | 4,000 | 3,995 | 4,061 | 4,060 | 4,059 |
| Bridges & engineering marvels | 653 | 650 | 680 | 675 | 672 |
| Monuments & memorials | 445 | 439 | 486 | 480 | 480 |
| Squares & streets | 243 | 246 | 369 | 372 | 368 |
| Public art | 253 | 252 | 285 | 285 | 281 |
| Towers | 255 | 255 | 255 | 256 | 254 |
| **Total** | **5,849** | **5,837** | **6,136** | **6,128** | |

The code's arrivals, put through the measurement's own display rule and metrics with the
measurement's world tier, read:

| | Held | Shown | Demand /451 | Held-out /129 | Canon | Judged noise |
|---|---|---|---|---|---|---|
| Measured, the new point | 13,301 | 12,653 | 299 | 52 | 0.860 | 16/272 |
| The code, the new point | 13,289 | 12,641 | 298 | 52 | 0.858 | 16/272 |
| Measured, 50 km (adopted) | 13,014 | 12,495 | 276 | 50 | 0.852 | 17/280 |
| The code, 50 km | 12,999 | 12,480 | 276 | 50 | 0.850 | 17/280 |

At the new point every kind's count is within 1.2 % of the measurement's, and at 50 km within 1.4 %. Archaeology's sites were read only to the
cut: 2,074 survivors at the new point against 2,157 at 50 km, before the site rule and ADR-0179's two
conditions.

**The run's cost.** The pool read, its readers and every candidate's neighbourhood took 300 s, against
2,248 s (37 minutes) for main's indexed queries at 50 km over the same pool, run just after it on the
same machine. Main read the surroundings of the 143,382 items with two editions, one query each over
a GiST index, and those queries alone took 2,078 s. Of the 300 s, building the
pool took 137 s, its readers 101 s, the densities of its 2.1 million places 6 s and the 50,948
neighbourhoods 56 s. The same code at 50 km and no density ratio reads the neighbourhoods in 17 s.
A second read with the final code took 303 s, 61 s of it the neighbourhoods. The run's heap held
1.4 GB after the read.
