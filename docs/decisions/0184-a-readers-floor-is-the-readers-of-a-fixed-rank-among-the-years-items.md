# ADR-0184: A readers' floor is the readers of a fixed rank among the year's items

**Date:** 2026-11-08
**Status:** Accepted

---

## Context

Wikipedia is read less every year. The items the readership build keeps
([ADR-0055](0055-readership-is-read-from-monthly-dumps-and-an-unseen-country-is-unobserved.md)) were read 60.56 billion
times in the year to September 2025 and 47.26 billion times in the year to September 2026, 22 % fewer
(`readership_months`, measured on 2026-11-08).

[ADR-0175](0175-a-place-kind-admits-by-quantiles-of-its-own-pool.md) restated every world-tier bar of
the place kinds as a quantile of the kind's own pool, so those bars move with the year. Two counts were
left as numbers:

- **The surroundings tier's readers' floor:** 3,000 readers a year to enter and 2,400 to stay (ADR-0175
  decision 3, `SURROUNDINGS_REGISTER.minReaders`). The two-year reading of #2177
  ([2026-11-02](../research/2026-11-02-the-admission-frame-over-two-readership-years.md)) named this
  gap: "Those floors do not follow a drift of readership in either form."
- **Public art's street-art mark:** 10,000 readers a year counts as one of the three marks of fame of a
  street-art place (#2035, `READERS_MARK`).

A floor stated as a count asks a little more of every place each year that Wikipedia is read less. No
place's own standing has to change for it to fall under the floor (#2145).

## Decision

**1. A readers' floor is the readers of the item at a fixed rank among every item the year keeps.**
- The year is the one the runs read. Its items are summed over the editions a door counts, as
  `readWorks` sums a place's.
- The rank is derived once, so that the year it is derived on yields the count it replaces.
- A run reads the year's count at that rank once (`readersAtRank`, `workReadership.ts`) and measures
  against it.

**2. The two counts are restated on the year to September 2026.**

| Count | Rank | Yields on the year to September 2026 |
|---|---|---|
| Surroundings tier's readers' floor (`SURROUNDINGS_REGISTER.minReaders`) | 889,568 | 3,000 |
| Street-art mark (`READERS_MARK_RANK`) | 424,028 | 10,000 |

- The surroundings tier's stay is still 0.8 of the floor, so it moves with the floor.
- The surroundings pool reads the floor with its year's readers (`SurroundingsPool.minReaders`). Every
  test the tier reads uses that floor (`yearCut`), and so does its line in the run's log.
- The street-art reading reads the mark with the candidates' readers (`StreetArtReading.readersMark`).

**3. A floor that cannot be read is no year read.**
- If the year keeps fewer items than the rank, the floor is not read.
- The surroundings tier is then not read, and its places keep their standing, as when no year of
  readers is read (ADR-0175 decision 6).
- The street-art test reads no readers, so readers admit no newcomer, and a held place keeps its place
  on its other marks.

## Measurement

The three anchors #2145 names were derived on the year to September 2025 so that each yields 3,000, then
read on the year to September 2026. The population is the 4.86 million items the build keeps, with raw
sums:

| Anchor | Floor in the later year | Items over it, earlier → later year | Lost | Gained |
|---|---|---|---|---|
| Fixed count | 3,000 | 941,954 → 891,917 (−5.3 %) | 94,259 | 44,222 |
| Share of the year's total views | 2,341 | 941,954 → 1,027,329 (+9.1 %) | 40,811 | 126,186 |
| Quantile of the year's items | 2,617 | 941,954 → 964,592 (+2.4 %) | 57,650 | 80,288 |
| Rank among the year's items | 2,728 | 941,954 → 942,070 (0.0 %) | 66,708 | 66,824 |

- **The rank holds the set's size, and it churns less than the fixed count:** 133,532 items change side
  against 138,481.
- **Its 9 % fall matches the places'.** The 7,019 places the surroundings tier held on 2026-11-08 were
  read 9.5 % less at the median over the same two years.
- **The share of total views overcorrects.** The views the sum lost are concentrated in the most-read
  pages, so the total falls faster than a typical item's readership.
- **A quantile drifts with the build's own floor.** The build keeps a (month, item, edition) only from
  10 views (`MONTH_FLOOR`), so the bottom of the distribution is cut. Fewer items cross that cut in a
  quieter year, which moves every quantile. A rank counts from the top and does not see the cut.
- **No class moves a rank.** Its population is every item the build keeps, not a pool a kind's classes
  draw. #2380 showed a surroundings pool that grew by one class moving the references inside it.

On the year it is derived on, a rank yields the count it replaces, so a run on that year admits and
refuses what it did before.

## Consequences

- The surroundings tier and the street-art test ask a place for the readers a fixed number of items
  reach that year, not for a count. When Wikipedia is read less, the floor falls with it.
- Reading a rank sums the year over every kept item, about half a minute on the development machine.
  Each run reads each rank once per year (`readersAtRank` keeps it per process).
- The sum behind a rank is raw: decision 3 of ADR-0055 sets no pair aside in it, while a place's own
  readers are read with it. Decision 3 judges no pair under 5,000 views a year, so a floor of 3,000
  reads the same either way. At the street-art mark of 10,000 the rank sits slightly higher than a
  filtered sum would put it.
- The counts in docs and in the run's log are the counts the rank yields, named with the year they
  were read on.

## Alternatives considered

| Alternative | Why not |
|---|---|
| Keep the counts | They admit 5.3 % fewer items a year later for no change in any place. |
| A share of the year's total views | It falls 22 % where a typical place fell 9.5 %, and admits 9.1 % more items a year later. |
| A quantile of the year's items | The build's floor of 10 views a month cuts the bottom of the distribution, so the population and every quantile move with the level of readership. |
| A quantile of the surroundings pool | A class added to a kind moves it (#2380), and so would any change of what the pool draws. |
| A percentile of the kind's calibration list (#1864) | A floor is one number for every kind, and a calibration list holds a few dozen famous tops, far from the floor. |

## Related

- [ADR-0055](0055-readership-is-read-from-monthly-dumps-and-an-unseen-country-is-unobserved.md): the year of readers.
- [ADR-0175](0175-a-place-kind-admits-by-quantiles-of-its-own-pool.md): decision 3's readers' floor,
  narrowed here.
- [ADR-0181](0181-the-surroundings-tier-measures-a-place-against-neighbours-of-its-own-density-within-150-km.md):
  the surroundings tier as it stands.
- #2145, #2035, #2177.
