# ADR-0175: A place kind admits by quantiles of its own pool, every bar derived and verified as a traveller

**Date:** 2026-11-02
**Status:** Accepted

---

## Context

Six place kinds admit places by numbers picked one kind at a time:

| Kind | World line today |
|---|---|
| Public art | 22 Wikipedia editions to enter and 18 to stay (`ENTER_SITELINKS`, `STAY_SITELINKS`) |
| Places of worship | 25,000 readers a year to enter and 18,000 to stay (`WORSHIP_READERS_LINE`, ADR-0161) |
| Towers | its own line (`TOWER_LINE`), plus a guide door at 15,000 readers (ADR-0168) |
| Bridges & engineering marvels | its own line (`BRIDGE_LINE`) |
| Squares & streets | its own line (`SQUARE_LINE`) |
| Monuments & memorials | Public art's line, plus a guide door for a curator (ADR-0167) |

Public art also has a door at 20,000 readers for a work a guide uses (ADR-0169). The regional tier
of ADR-0171 is built and switched off (`REGIONAL_CUT.enabled`).

The maintainer stopped tuning bars one kind at a time on 2026-10-31. The review #2177 was asked
for one architecture for every place kind:

- every bar derived by a stated method, not picked;
- robust as readership drifts (views across Wikipedia fell 14 % in a year, #2145);
- verified as a traveller against the city surveys, the canon lists and a control group no tuning
  had read.

The review is
[docs/research/2026-11-02-one-admission-frame-for-the-place-kinds.md](../research/2026-11-02-one-admission-frame-for-the-place-kinds.md).
In short:

- Today's lines sit between the top 1.7 % and the top 5.6 % of each kind's pool, and differ for
  no stated reason.
- Over the sixteen development regions the six kinds show 34 % of what the surveys demand.
- In the three control regions they show 25 % (20 of 79).

## Decision

This narrows ADR-0171 decisions 2 and 6 and ADR-0161 decision 2, and supersedes ADR-0167,
ADR-0168 and ADR-0169, whose doors become the third bar below. The rules that decide what a kind is (its
classes, its kills, its types, ADR-0045, ADR-0132) and the gate on arrival (ADR-0052, ADR-0058) are
unchanged.

**1. The world tier admits by three quantiles of the kind's own pool, recomputed at every run.**
- The pool is every item the kind's rule passes and that has a point, whatever its editions: the
  regional pool's gather (ADR-0171).
- A candidate enters when it reaches any one of three bars:
  - the pool's **97th percentile of Wikipedia editions**;
  - its **98th percentile of readers a year**;
  - its **90th percentile of readers**, when at least one Wikivoyage edition uses the item or the
    item carries an Atlas Obscura place ID (`P7772`).
- The third bar is what the guide doors of ADR-0167, ADR-0168 and ADR-0169 were, read as one rule
  for every kind. Either mark says a traveller goes there, as ADR-0169 found for Public art. With the
  Atlas Obscura mark the point admits 147 more places: among them are Florence's Porcellino, Munich's
  Glockenspiel, Chicago's Crown Fountain and Madrid's Fuente del Ángel Caído. The canon moves from
  0.850 to 0.852, and the judged noise does not move. The control figure is the same with the mark
  and without it (57 of 79): the mark is adopted on the development regions' gain, and leaves the
  control read unchanged.
- On 2026-11-02 the bars come to the following numbers:

  | Kind | Editions | Readers | Readers with a guide |
  |---|---|---|---|
  | Towers | 19 | 64,996 | 12,838 |
  | Bridges & engineering marvels | 17 | 56,955 | 13,757 |
  | Squares & streets | 15 | 44,480 | 10,963 |
  | Places of worship | 16 | 49,634 | 10,577 |
  | Public art | 17 | 93,029 | 20,871 |
  | Monuments & memorials | 18 | 85,409 | 16,719 |

- A bar is a share of the pool, so it moves with the year's readership. The two half-years of a
  readership year admit the same set within 0.1 points whether the bars are read as quantiles or
  frozen as numbers.

**2. A place the last run admitted stays on bars read at 0.8.**
- In the world tier it stays while it reaches 0.8 of any of the three bars.
- In the regional tier it stays while it keeps two Wikipedia editions, reaches 0.8 of the
  readers' floor (2,400 readers a year), and passes one of the three tests. The readers test is
  read at 0.8; the Wikivoyage and editions tests are read whole, since their reference is the
  place's own neighbours. A tunnel, a dam or a lock stays only while a Wikivoyage edition still
  uses it.
- Without that margin, 12.3 % of the set changes between the two half-years of one readership
  year. With it, 8.9 % does.

**3. The regional tier is on for the six kinds, with the parameters the review derived.**
- The neighbourhood is every place of the live kinds within 50 km, as ADR-0171 decision 1 states,
  and the reference is the median of the ten best.
- A candidate under the world bars enters when it has at least two Wikipedia editions and at least
  **3,000 readers a year**, and one of three tests passes:
  - **Wikivoyage:** the editions that use it reach **half** the reference, in an area of at least 5
    places. ADR-0171 said a quarter.
  - **Editions:** its Wikipedia editions reach the reference, in an area of at least 25 places.
  - **Readers**, new: its readers reach the reference, in an area of at least 25 places.
- **A tunnel, a dam or a lock enters the regional tier only when a Wikivoyage edition uses it.**
  A tunnel or a dam is a sight when people go to see it (the Kurobe Dam, the Old Elbe Tunnel), and
  a guide says so. Readership of its article does not.

**4. One quantile level for every kind, each read on the kind's own pool.**
- A bar per type within a kind admitted more and lost canon (0.841 against 0.852).
- A level per kind bought 1.6 points of survey recall for 513 places and 0.3 points of noise.
- A kind that enters later takes the shared levels and is measured on its own canon list before
  its first run.

**5. Every number lives in one register with its derivation, and changes only by the method.**
- The register is one module, read by the runs and by the coverage report. Each parameter carries
  its value, how it was derived, the evidence and the date.
- A parameter changes in four steps:
  1. the frozen metrics on the development regions, read on what the catalogue shows;
  2. the frontier of survey demand, canon, outside Europe, load and judged noise;
  3. a point chosen by a rule the maintainer states;
  4. one read of a control group no tuning has read, where the change is adopted only if it
     improves the control figure.
- The maintainer's rule of 2026-11-02 chose this point: the canon at 85 % or more, the judged
  noise at 7 % or less, and of those the fewest places.

**6. One rule each for what a run cannot read.**
- A run without a readership year keeps the bars and the readers it last read, and says so in its
  line. It never reads a missing year as zero readers.
- A run without the Wikivoyage usage build or the Atlas Obscura marks keeps each place's marks as it
  last read them. It never reads a missing build as no guide, which would drop every place the third
  bar admitted. This restates, for every kind, the rule of the superseded guide doors: their door
  stayed shut and a held row kept its place.
- A tier the run did not read leaves that tier's memberships as they stand, and marks nothing
  missing.
- Arrivals of both tiers are gated as each kind gates them today.

## Alternatives Considered

| Option | Why rejected |
|---|---|
| Keep each kind's line and tune it on its own list | The review's starting point. The six lines sat at different tails of their pools for no stated reason, and a count drifts with readership. |
| Bars as fixed numbers derived once | They agree with quantiles within one year. A quantile needs no re-derivation when readership falls, and it states the rule ("the top 3 % of the pool") rather than its value. |
| A bar per type within the kind | It loses canon (0.841 against 0.852) and raises Europe's share. The kind's bar does not favour churches: they pass at 3.7 %, and cathedrals at 23.5 %. |
| Leave the regional tier off | The point's regional tier holds 5,849 of its 13,014 places. It carries most of the gain outside Europe and in the control regions. |
| Remove the regional noise by a higher readers' floor | 10,000 readers instead of 3,000 costs 1,100 places for 0.2 points of noise. The noise sat in types, not in readership. |
| Ten per type demanded over a whole region | Kyoto's list would rank Nara's temples (Tōdai-ji, Hōryū-ji) against Kyoto's and put them in its tail, though Nara's own map shows them. The survey is read with the display's 10 km instead (#2246). |

## Consequences

**Positive:**

At the point, on what a reader is shown after the display rule (ADR-0172, ADR-0173):

| | Point | Today |
|---|---|---|
| Places held, worldwide | 13,014 | 1,933 |
| Places shown, worldwide | 12,492 | |
| Survey demand shown, development regions | 60 % | 34 % |
| Canon lists held | 85 % | 72 % |
| Judged noise, shown | 6.0 % | |
| Europe's share | 53 % | 64 % |
| Survey demand shown, control regions (Bangkok, Lisbon, Cape Town) | 57 of 79 | 20 of 79 |

**Negative / Trade-offs:**
- **A curator's load grows.** About 11,000 arrivals worldwide (13,014 held against 1,933 today),
  most of them gated, reach the review queue as the two slices land. The slices that switch it on measure the arrivals per kind on dev first.
- **The canon constraint binds.** The next points up the frontier buy 3.5 points of demand recall
  for about a thousand places. A later maintainer's rule can move the point; the method stays.
- **Precision rests on readers' judgement, and two readers differ** (κ 0.39 at the admission line).
  A noise figure is quoted only where both readers' grades enter it.
- **The misses inside the kinds' reach stay** (Cristo Rei, Lisbon's streets, Cape Town's
  St George's Cathedral). They are findings for the kinds' classes, filed by cause.

## References

- Related ADRs:
  - ADR-0171 (decisions 2 and 6 narrowed);
  - ADR-0161 (decision 2 narrowed); ADR-0167, ADR-0168, ADR-0169 (superseded);
  - ADR-0048 and ADR-0126 (the two tiers, unchanged);
  - ADR-0172 and ADR-0173 (what a crowded city shows);
  - ADR-0082 (editions are counted by the runs' counter).
- Research: [2026-11-02 — One admission frame for the place kinds](../research/2026-11-02-one-admission-frame-for-the-place-kinds.md)
- Issues: #2177; #2246 (a survey read the way the map shows it); #2232 (the control group);
  #2230 (the archive year the two-year churn reads); the slices that build it: #2251 (the
  register and the world bars), #2252 (the regional tier on), #2253 (what a run cannot read),
  #2254 (a proposed kind by declaration), #2255 (the control read's misses by cause)
