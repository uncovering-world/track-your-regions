# One admission frame for the place kinds: every bar derived, verified as a traveller (2026-11-02)

The review #2177 asked for, rescoped by the maintainer on 2026-11-01. It covers six kinds: Places of
worship, Squares & streets, Monuments & memorials, Public art, Towers, and Bridges & engineering
marvels. Each had admitted places by numbers picked one kind at a time: 22 Wikipedia editions to
enter Public art, 25,000 readers for Places of worship, a line per kind for Towers, Bridges and
Squares. The question was whether one frame, with every bar derived by a stated method, admits a
catalogue a traveller would want, and holds as Wikipedia's readership drifts.

**Short answer.** Yes, and it is adopted on a control group no tuning had read.

1. **The world tier.** A candidate of a kind enters when it reaches any of three bars, each a
   quantile of the kind's own pool, recomputed from that pool at every run:
   - the pool's **97th percentile of Wikipedia editions**;
   - its **98th percentile of readers a year**;
   - when at least one Wikivoyage edition uses the item or it carries an Atlas Obscura place ID,
     its **90th percentile of readers**.
2. **The regional tier.** It is the 50 km cut of ADR-0171, with these parameters:
   - against all its neighbours' places;
   - the Wikivoyage test at **half** the median of the ten best (not a quarter);
   - a **readers test at the median of the ten best**, beside the editions test;
   - at least **3,000 readers a year** and two Wikipedia editions;
   - a **tunnel, a dam or a lock enters only with a Wikivoyage guide**.
3. **The bar's grain.** One quantile level holds for every kind, and each kind's bar is read on its
   own pool, not on each type's.
4. **The point.** The maintainer's rule chose it from the frontier: canon at least 85 %, judged
   noise at most 7 %, and of those the fewest places. Worldwide it holds 13,014 places and shows
   12,492 after the display rule (ADR-0172, ADR-0173). In the sixteen development regions it shows
   60 % of what the surveys demand, against 34 % today. It holds 85 % of the kinds' canon lists, and
   its judged noise is 6.0 %.
5. **The control read.** In Bangkok, Lisbon and Cape Town, read once at the end, today's catalogue
   shows 20 of the 79 places the surveys demand (25 %). The frame shows 57 (72 %).

Four findings changed the method on the way:

- **What a reader sees is not what the catalogue holds.** The display rule hides the middle of a
  dozen cities (Kyoto, Rome, Istanbul). The comparison must read the shown set.
- **A survey's long list of one type is the union of its guides, not a plan.** Rome's 39 places of
  worship come from eight sources naming ten to fifteen each. The survey is read the way the map
  shows a city: an entry is demanded unless ten entries of its kind and type within 10 km of it are
  named by more sources (#2246).
- **The noise of the regional tier is a shape of the rule, not a value of it.** Tunnels, utility
  dams and ordinary streets entered on their neighbourhood's readership. No parameter removed them,
  and a type-level guide requirement did.
- **One reader is not enough.** The maintainer's blind reading of forty places agreed with the
  first reading on 29 of 40 at the line admission uses (κ 0.39). The grades of every reader now
  enter the noise figure, and noise by either reader counts as noise.

---

## Method

The harness is a set of Python scripts under `data/cache/2177-admission/` on the development
machine. A copy lives in `docs/local/research/2177-admission-review/harness/`. The scripts replay a
kind's rule over an extract of its candidate pool and admit places under any parameter set. They
score the result with metrics frozen before any parameter moved.

### Data

| File | What | SHA-256 |
|---|---|---|
| `signals/*.jsonl` | Every candidate of the six kinds: item, label, classes, coordinate, Wikipedia editions, readers a year, the kind's rule verdict and type, its memberships today, the survey entries and canon lists naming it (2026-10-31, from the local Wikidata subset and the readership year ending 2026-09) | `3112b905d2d6ec5e8c36a3b61a5ced35ef56a92eccefbf513a00ab7b4c6d399b` (concatenated) |
| `verdicts/*.jsonl` | The kinds' rule verdicts for the regional pool | `5dd9f922072d1c0ed7b5bb5ccd16adb83090121ed4458ca41c2cc9cfbb8b2b07` (concatenated) |
| `regional-export/{pool,readers,candidates,nbr-50}.tsv` | The regional tier's pool, its readers, its candidates, and every candidate's places within 50 km | `81b18c1e…963`, `2e8f9488…b6e9`, `aa8353f2…ae4`, `62ee5d04…fb84` |
| `editions.tsv`, `guide-editions.tsv` | Wikipedia editions by the runs' own counter; Wikivoyage editions using each item | `eb635b52…833b8ae`, `f8fdb915…453ec58` |
| `readers-halves.tsv` | Each candidate's readers in the two half-years of the readership year | `2d396a0c…d19d49` |
| `regions-split.json` | The sixteen development regions and the five held out; the control regions in neither | `8191366b…b6d` |
| `judgements.jsonl`, `judgements-maintainer-2026-11-02.jsonl`, `judgements-sample2-2026-11-02.jsonl` | The golden set: the first reading (420), the maintainer's blind forty, and the fresh sample of the candidate (109) | `0f2cf36e…18ba`, `cb7c65dc…d8`, `9a860e43…5bb` |
| `control/*.jsonl` | The control regions' lists, copied from `db/catalogue-coverage/expectations/` at a267069bd | — |
| `point-final.json` | The chosen parameters | `af4945c5ba371c57e310a202c17037d2c010d55bebc83c450904e4eb66fd9cb5` |

### The frozen metrics

`metrics.py` reports each figure per kind and per region, never as one score:

- **Survey recall.** First read as every expected place of the 24 city surveys
  (`db/catalogue-coverage/expectations/`). From § 30 of the log it is read the way the map shows a
  city, with the display rule's own geometry and the survey's own ranking. An entry is demanded
  unless ten entries of the same region, kind and type within 10 km of it are named by more sources.
  A tie is broken by the entry's Wikipedia editions as its survey file records them, then by its
  slug. An entry with no coordinate is ranked against its whole region. The rest are the list's
  tail.
- **Canon recall.** Read on each kind's calibration list of tops (`db/catalogue-coverage/calibration/`).
- **Judged noise.** The share of judged places among the admitted that a reader graded N.
- **Load.** Places admitted, and arrivals for a curator.
- **Spread.** The share outside Europe and Oceania, and the spread over regions.

Every figure is read on what the catalogue holds and on what it shows after the display rule.
`shadow.py` ranks fame exactly as `refresh_crowding()` does: the mean of the percentile ranks of
readers, Wikivoyage editions and Wikipedia editions among the kind and type's candidates.

### The golden set

`judging-guideline.md` (local) defines three grades, with examples from real places:

- **V**, worth a visit;
- **L**, local interest;
- **N**, noise: gone, nothing to see, or a misfiled type.

A first reading graded 420 places. The maintainer re-graded forty of them blind: full agreement 20
of 40, κ 0.25. On N against the rest the two agreed on 29 of 40, κ 0.39; the maintainer gave V to 3
places where the first reading gave it to 14. A fresh stratified sample of 109 places the candidate
shows was graded under the guideline. Where two readers graded a place, noise by either counts.

### The search

- **Split.** Sixteen development regions; five held out, never tuned on (Delhi, Salvador, Havana,
  Addis Ababa, Auckland). Three control regions surveyed for the purpose (#2232).
- **Screening.** A Morris screening (130 evaluations) over every parameter of the frame.
  - Recall moved with the Wikivoyage share, the neighbourhood, and the editions and guided
    quantiles.
  - Load and noise moved with the readers' floor, the Wikivoyage share, the neighbourhood and the
    readers' share.
  - The readers quantile, the editions reference and the Wikivoyage minimum moved nothing and are
    fixed.
- **The frontier.** A grid of 972 points over the factors that mattered; 118 are non-dominated.
- **The point.** The maintainer's rule chose it on the shown figures: canon ≥ 85 %, judged noise
  ≤ 7 %, and of those the fewest places.
- **Checks at the point.** Churn, the grain, the held-out regions, and the control regions once.

## Results

### Today's numbers sat at the far tail of each pool

Today's lines admit between the top 1.7 % and the top 5.6 % of each kind's pool. They keep 24–49 %
of what the surveys expect and 69–98 % of the canon lists, and the two differ by kind for no stated
reason. Worldwide the six kinds hold 1,933 places. Over the development regions they hold 37.7 %
of every expected place of the surveys (34 % shown of the demanded, read as below) and 72 % of the
canon. Europe's share is 64 %.

### What the display rule hides

At the first candidate point, 67 of the 374 expected-and-admitted places of the development
regions were shadowed (ten better-known of their type within 10 km):

| Region | Shadowed | Examples |
|---|---|---|
| Kyoto | 23 | Daitoku-ji, Nanzen-ji, Chion-in, Ninna-ji, Daigo-ji |
| Rome | 20 | San Luigi dei Francesi, Santa Maria della Vittoria, Santa Sabina, Sant'Agnese in Agone |
| Istanbul | 13 | Little Hagia Sophia, Rüstem Pasha, Bayezid II, the Mihrimah mosques |

Cairo had 4, Beijing 3, Berlin 3 and Moscow 1; every other region had none.

Five of Rome's shadowed churches hold works a reader is shown. Since ADR-0173 a place holding such
a work is never shadowed. The maintainer kept ten per type (2026-11-02): ten is enough to choose
from, and thirty mosques in Istanbul serve nobody.

### A survey read as the map reads a city

Read at the decided point (13,014 held, 12,492 shown):

| Reading | Demanded | Point held | Point shown | Today held | Today shown |
|---|---|---|---|---|---|
| every entry | 514 | 0.675 | 0.556 | 0.377 | 0.315 |
| ten per kind and type within 10 km | 451 | 0.647 | 0.603 | 0.364 | 0.344 |
| ten per kind within 10 km | 382 | 0.639 | 0.620 | 0.366 | 0.361 |

Read per type within 10 km, the gap between held and shown falls from 12 points to 4. It is the
display's own grain and geometry. Ranked over a whole region instead, Kyoto's list puts Nara's
temples (Tōdai-ji, Hōryū-ji, Kōfuku-ji) in its tail, though Nara's own map shows them. Ranked per
region with a tie taken whole, it demands more of Kyoto's temples than any map of ten shows.

### The noise is in the regional tier of two kinds

The fresh sample of 109 shown places, graded under the guideline:

| | n | V | L | N | Noise |
|---|---|---|---|---|---|
| World tier | 61 | 23 | 35 | 3 | 5 % |
| Regional tier | 48 | 0 | 37 | 11 | 23 % |
| Places of worship | 65 | 16 | 46 | 3 | 5 % |
| Bridges & engineering | 15 | 1 | 7 | 7 | 47 % |
| Squares & streets | 9 | 2 | 4 | 3 | 33 % |
| Towers | 6 | 2 | 3 | 1 | 17 % |
| Monuments, Public art | 14 | 2 | 12 | 0 | 0 % |

The noise, by name:

- Bridges: the Finse, Héðinsfjörður and Warnow tunnels; the Wivenhoe, Rock Island and Eschbach
  dams; the Audubon highway bridge.
- Squares: Seventh Avenue, Warsaw's Aleja Niepodległości, Vienna's Mexikoplatz.
- Towers: the Obninsk meteorological mast.
- Places of worship: Gounsa, burned in the 2025 fires, and two parish churches.

With every reader's grades in the figure, no point of the frontier reached 7 % noise; the lowest
was 8.1 %. No parameter value removes a tunnel: a tunnel's neighbourhood is read like a church's.
Requiring a Wikivoyage guide for a regional place of the types tunnel, dam or lock removed 370
places, all of them in Bridges. Noise fell from 9.1 % to 6.5 %, and demand recall and canon did not
move. Extending the requirement to streets and squares changed nothing measurable. A tunnel or a dam
is a sight when people go to see it, and a guide says so: the Kurobe Dam and the Old Elbe Tunnel
stay in.

### The point

Rule ① on the shown figures, with the guided types, among 78 passing points:

| | Parameters |
|---|---|
| World tier | editions q 0.97 · readers q 0.98 · guided readers q 0.90 (≥ 1 Wikivoyage edition, or an Atlas Obscura ID) |
| Regional tier | neighbours all · best 10 · Wikivoyage share 0.5 (≥ 5 places) · editions share 1.0 (≥ 25 places) · readers share 1.0 (≥ 25 places) · at least 3,000 readers and 2 editions · tunnel, dam, lock need a guide |

| Held | Shown | Demand recall shown (held) | Canon | Judged noise | Europe share |
|---|---|---|---|---|---|
| 13,014 | 12,492 | 0.603 (0.647) | 0.852 | 6.0 % | 0.528 |

The point was chosen without the Atlas Obscura mark (12,867 held, canon 0.850, noise 6.1 %). With
it, as ADR-0169 read it for Public art and now for every kind, the point holds 147 more places:
23 of them works of public art such as Florence's Porcellino, Munich's Glockenspiel, Chicago's Crown
Fountain and Madrid's Fuente del Ángel Caído. Demand recall is unchanged and noise does not move.
The canon constraint binds: the next points up the list buy a few points of demand recall for
about a thousand places.

### Checks at the point

Every check below, and the control read, is taken at the decided point, with the Atlas Obscura
mark.

- **Churn within the year.** The two half-years of the readership year, annualised, admit sets
  that differ by 12.3 % whether the bars are read as quantiles or frozen as the year's numbers. An
  enter/stay pair keeps an admitted place while it reaches 0.8 of any world bar, or, in the
  regional tier, while it keeps two editions, reaches 0.8 of the readers' floor and passes one test
  with the readers test read at 0.8; it brings the churn
  to 8.9 %. The two-year reading waits on the archive year (#2230).
- **Per kind or per type.** A bar per type admits 13,246 places, for canon 0.841 (−1.1 points), survey
  recall 0.9 points lower and a higher Europe share. The kind's bar does not favour churches: they pass
  at 3.7 % and cathedrals at 23.5 %.
- **One level or one per kind.** Loosening each kind's level while its canon holds buys 1.6 points
  of survey recall for 513 places and 0.3 points of noise.

### The control read

Bangkok, Lisbon and Cape Town were surveyed by agents that read no catalogue (#2232) and were read
once, at the end:

| | Demanded | Today shown | Candidate held | Candidate shown |
|---|---|---|---|---|
| Bangkok | 39 | 8 | 35 | 31 |
| Lisbon | 30 | 11 | 20 | 20 |
| Cape Town | 10 | 1 | 6 | 6 |
| **All** | **79** | **20 (0.25)** | **61 (0.77)** | **57 (0.72)** |

What the candidate misses there:

- **Shadowed:** four of the Bangkok circle's places of worship, among them Wat Traimit with the
  Golden Buddha. Wat Niwet Thammaprawat and Wat Phu Khao Thong are not admitted.
- **Out of a kind's reach or under its line:**
  - in Lisbon, Cristo Rei, the Vasco da Gama Tower, the church of Nossa Senhora da Conceição Velha
    and seven squares and streets;
  - in Cape Town, the Moederkerk, St George's Cathedral, Greenmarket Square and the Grand Parade;
  - in Bangkok, the Giant Swing and the Royal Plaza.

What it shows that no list names: 24 places, most of them worth it, such as Wat Paknam's great
Buddha, Lisbon's São Domingos and Cape Town's Auwal Mosque. Three are noise: the Burapha Withi
Expressway, Ratchadaphisek Road, and the Necessidades Palace read as a church.

## What this does not show

- **Precision rests on readers' judgement, and they differ** (κ 0.39 at the admission line). Two
  readers graded the samples, each of 40 to 109 places a kind or a tier; Towers, Public art and
  Monuments carry few judged places each.
- **The six kinds only.** Art Museums, Archaeology and World Heritage Sites keep their own rules,
  measured elsewhere.
- **One readership year.** Churn over two years waits on the archive year; the half-year reading is
  a lower bound on drift.
- **The misses inside the kinds' reach** (Cristo Rei, Lisbon's streets) are findings for the kinds'
  classes, not for the bars. They are filed by cause, not answered here.
- **Kyoto and Bangkok hold more temples worth a visit than ten.** The display rule hides some of
  them; the maintainer kept ten.

## How to rerun

On the development machine, in `data/cache/2177-admission/`, with
`JUDGEMENTS=judgements.jsonl,judgements-maintainer-2026-11-02.jsonl,judgements-sample2-2026-11-02.jsonl`:

```bash
P=~/projects/track-your-regions/cv-python/.venv/bin/python
E=~/projects/track-your-regions/db/catalogue-coverage/expectations
$P frame.py point-final.json --split dev --out admitted-final.json   # the point's held set and figures
$P shadow.py admitted-final.json                                      # what the display rule hides
$P demand.py admitted-final.json $E --split dev                       # the three readings of a survey
$P frontier3.py frontier2-front.json $E --extra '{"guide_for_types": ["tunnel", "dam", "lock"]}'
$P churn.py point-final.json --split dev; $P bytype.py point-final.json; $P bylevel.py point-final.json
$P control2.py point-final.json                                       # once, at the end
```
