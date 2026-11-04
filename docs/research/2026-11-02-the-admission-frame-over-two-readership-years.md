# The admission frame over two readership years (2026-11-02)

The question #2177 left open: does the frame of
[ADR-0175](../decisions/0175-a-place-kind-admits-by-quantiles-of-its-own-pool.md) hold as Wikipedia's
readership drifts from one year to the next? The review that derived the frame,
[2026-11-02 — One admission frame for the place kinds](2026-11-02-one-admission-frame-for-the-place-kinds.md),
had one readership year. It read the drift on that year's two half-years and left the two-year reading
waiting on an archive year (#2230). This report is that reading, measured on 2026-11-02. It replaces
the half-year figure as the evidence for ADR-0175 decisions 1 and 2. The rest of that report stands.

**Short answer.** Yes, both decisions hold.

- **Quantile bars hold the set better than fixed numbers.** The year ending 2025-09 and the year
  ending 2026-09 admit sets that differ by 10.6 % when the bars are quantiles of each year's pool,
  as the runs read them. They differ by 11.3 % when the bars are frozen as numbers. Readership was
  higher a year earlier, so fixed numbers admit 331 more places on the earlier year: the set shrinks
  as views fall.
- **The stay pair halves the churn.** When a place the earlier year admitted stays at 0.8 of the
  bars, 5.6 % of the set changes in a year.
- **Survey recall and canon hold on both years.** Survey recall is 0.684 on the earlier year and
  0.670 on the current one. Canon is 0.850 and 0.852.

## Method

**The two years.** #2230 let a readership build keep a second year beside the current one, ending
on a month the admin names (PR #2237). On the development machine, build 35 (`pageviews-202509-user`,
finished 2026-11-02) completed the year 2024-10 to 2025-09. The readership tables then held 24
months, 2024-10 to 2026-09.

**The earlier year's readers.** `prevyear.mts` read every candidate's readers in the year
2024-10 to 2025-09 with the runs' own counter (`readWorks` in
`backend/src/services/dumps/readership/workReadership.ts`, ADR-0055's rules, the automated pairs set
aside). It ran once, read-only, inside the backend container, and its output is `readers-prev.tsv`.
Of the 100,120 candidates of the six kinds, 98,453 had readers in the earlier year. The rest count
as zero readers there.

**The replay.** `churn2.py` is the review's harness (its § Method), with two readership years in
place of two half-years. It admits ADR-0175's point on each year and compares the two sets. The
point is the review's chosen parameters with the Atlas Obscura mark (`point-final.json`). Both tiers
count. The churn is the share of places admitted on one year only, out of the union of the two sets.
The bars are read in three forms:

- **Quantiles** (ADR-0175 decision 1): each year's bars are quantiles of that year's own pool, as a
  run recomputes them.
- **Frozen as numbers:** the bars are read once on the current year and kept as constants for both
  years, as a line written in code would be.
- **The stay pair** (ADR-0175 decision 2): the earlier year admits by quantiles. On the current year
  a place enters by its quantiles, and a place the earlier year admitted stays while it reaches 0.8
  of the current year's bars. In the surroundings tier it stays at 0.8 of the readers' floor and of
  the readers test. The harness also read the stay at 0.9 and 0.7.

Survey recall and canon are the frozen metrics of the review (§ The frozen metrics). Survey recall is
the expected entries of the development regions' surveys the held set admits; canon is the kinds'
calibration lists. Both are read on what the catalogue holds, not on what the display rule shows, so
they are not the review's shown figures.

### Data

The files are on the development machine under `data/cache/2177-admission/`. A copy of the harness
lives in `docs/local/research/2177-admission-review/harness/`.

| File | What | SHA-256 |
|---|---|---|
| `readers-prev.tsv` | Each candidate's readers in the year 2024-10 to 2025-09 | `a82ee8b75856458a4a64e5527d9242e57b27531c007af373d08066828e3f0cde` |
| `point-final.json` | The decided point with the Atlas Obscura mark (`atlas_marks`) | `7ba2a2f4fc5bb04a6cf0bf7b462cb8dae08ac0ee76881f2a44bcca240680bfb6` |
| `churn2.py` | The replay over two years | `0e80d9778873fecf7ea8c418689145023d5e172b2e41c47298d32ad085c1ff8e` |
| `churn-twoyears-2026-11-02.txt` | Its output | `30d3b201aa2c11165ded1fcdcb60cd689b0af02f3057c9de1f31e218c2873baa` |

The review's other inputs (`signals/`, `verdicts/`, `regional-export/`, `regions-split.json`, the
judgements) are those its § Data lists. The review's own `point-final.json` has no Atlas Obscura
mark; the mark was added to the point after the review chose it.

## Results

### Churn by form

| Form | Earlier year | Current year | Union | On both | Churn |
|---|---:|---:|---:|---:|---:|
| Quantiles of the pool | 13,454 | 13,014 | 13,973 | 12,495 | 10.6 % |
| Frozen as numbers | 13,785 | 13,014 | 14,200 | 12,599 | 11.3 % |
| Quantiles, stay at 0.9 | 13,454 | 13,441 | 13,973 | 12,922 | 7.5 % |
| Quantiles, stay at 0.8 | 13,454 | 13,713 | 13,973 | 13,194 | 5.6 % |
| Quantiles, stay at 0.7 | 13,454 | 13,850 | 13,973 | 13,331 | 4.6 % |

The current year admits 13,014 places, the review's point, in every form without a stay: the frozen
numbers are the current year's own. From the earlier year to the current one the set shrinks by 440
places with quantile bars and by 771 with frozen numbers. Quantile bars do not hold the set's size
exactly: the world tier's bars are quantiles, but the surroundings tier's floors are numbers in both
forms, and this reading does not split the churn by tier. The stay at 0.8 keeps 699 places of the
earlier year that the current year's bars alone would drop.

### Churn by kind

| Kind | Quantiles | Frozen as numbers | Stay at 0.8 |
|---|---:|---:|---:|
| Places of worship | 10.2 % | 10.7 % | 5.2 % |
| Bridges & engineering marvels | 11.4 % | 12.2 % | 6.1 % |
| Squares & streets | 9.7 % | 11.8 % | 4.9 % |
| Monuments & memorials | 13.7 % | 14.4 % | 8.1 % |
| Towers | 11.1 % | 11.5 % | 5.0 % |
| Public art | 10.8 % | 11.1 % | 7.0 % |

Frozen numbers churn more than quantiles in every kind. The stay at 0.8 cuts every kind's churn,
by a little over a third in Public art and a little over a half in Towers. Monuments & memorials
churns most in every form.

### Survey and canon on each year

| Form | Survey recall, earlier / current | Canon, earlier / current |
|---|---|---|
| Quantiles of the pool | 0.684 / 0.670 | 0.850 / 0.852 |
| Frozen as numbers | 0.695 / 0.670 | 0.850 / 0.852 |
| Quantiles, stay at 0.8 | 0.684 / 0.684 | 0.850 / 0.852 |

Frozen numbers gain survey recall on the earlier year (0.695) with the 331 more places they admit
there. With the stay at 0.8, survey recall is the same on both years.

### Against the half-year reading

The review compared the two half-years of the year ending 2026-09, each annualised. Their sets
differed by 12.3 % in both forms, and by 8.9 % with the stay pair. Decision 1 of ADR-0175 quotes the
two forms as agreeing within 0.1 points. Over two whole years the forms come apart: 10.6 % against
11.3 %. The drift a year apart is in the level of readership, which fixed numbers do not follow. The
review called the half-year reading a lower bound on drift. The two whole years churn less than the
two half-years did, 10.6 % against 12.3 % with quantiles, so the half-year figure was not a lower
bound on a year's churn.

## How to rerun

On the development machine, with an archive readership year kept beside the current one (#2230).
`prevyear.mts` names its twelve months in its source. It was removed from the container after its
run, and its copy is in `docs/local/research/2177-admission-review/harness/`:

```bash
docker cp prevyear.mts tyr-ng-backend:/tmp/prevyear.mts
docker exec -w /app tyr-ng-backend npx tsx /tmp/prevyear.mts /app/data/cache/2177-admission   # writes readers-prev.tsv
P=~/projects/track-your-regions/cv-python/.venv/bin/python
cd ~/projects/track-your-regions/data/cache/2177-admission
flock ~/.cache/tyr-heavy.lock $P churn2.py point-final.json > churn-twoyears-2026-11-02.txt
```

`prevyear.mts` sets a ten-minute statement timeout on every connection it opens and writes nothing
to the database. `churn2.py` reads the development regions (`--split dev`) by default.

## What this does not show

- **It was read at ADR-0175's point.** The point predates three later changes:
  - Archaeology's sites in the frame (ADR-0179), so the reading covers the six kinds only;
  - the density neighbourhood of ADR-0181, within 150 km at a guide share of 0.25 and a readers
    share of 1.5, where the reading has the 50 km neighbourhood and shares of 0.5 and 1.0;
  - the guide a surroundings-tier bridge needs (#2324).

  None of them changes the world bars, and the world bars are where readership drift acts. The
  surroundings tier is different. Its tests read a place against its neighbours, but its floors are
  absolute numbers: 3,000 readers a year to enter, 2,400 to stay. Those floors do not follow a drift
  of readership in either form. The churn of the live surroundings tier over two years is not
  measured here.
- **Two years are one step of drift.** The reading compares one pair of years.
- **Survey recall and canon are read on what the catalogue holds**, not on what the display rule
  shows, and on the development regions only.
- **The earlier year's pool is the current one.** The candidates, their classes and their Wikipedia
  editions are those of the current extract. Only the readers are the earlier year's.
