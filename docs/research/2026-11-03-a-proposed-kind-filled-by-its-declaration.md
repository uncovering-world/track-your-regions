# A proposed kind filled by its declaration alone: Parks & gardens as a dry run (2026-11-03)

#2177 asks that the admission frame be extensible: a kind not yet in the catalogue is filled by its
declaration alone, with no admission code of its own (#2254). This report runs that test on one
proposed kind. The kind was declared in the shape the six place kinds use, and run read-only on the
development subset through the code's own gather, world tier, surroundings tier and gone rule. The
admitted places were then read against a canon and the city surveys, and graded blind.

**Short answer.** The frame takes the kind. The declaration needed no bar, line or admission step
of its own, but it did need code that every kind copies.

1. **Load.** The run admits 1,653 places: 679 in the world tier and 974 in the surroundings tier.
   By type they are 1,084 parks, 356 botanical gardens and 213 gardens. Wikidata says none is gone.
2. **The bars are of the six kinds' order.** Read on the kind's own pool of 7,796 places, they are
   16 Wikipedia editions, 54,798 readers a year, and 12,143 readers where a guide marks the place.
   The six kinds' bars range from 15 to 19 editions, 44,480 to 93,029 readers, and 10,577 to 20,871
   guided readers (`MEASURED_BARS`, `places/admissionRegister.ts`).
3. **Noise, read blind by two readers.** 4 of 60 world places (6.7 %) and 3 of 60
   surroundings-tier places (5.0 %). Weighted by tier size this is 5.7 %, under the frame's 7 %.
4. **Canon recall.** 121 of the canon's 145 entries are admitted: 83.4 %, under the frame's 85 %.
   - 13 of the misses carry no park or garden class. For 12 of them, Wikidata holds the garden only
     as its palace's, château's, villa's or house's item, and no class rule of the kind reaches them.
     The 13th, Boboli, is a *historical park museum* (Q112132527), a class a root might reach once
     its 243 items are read (§ The canon).
   - Without those 13, recall is 121 of 132 (91.7 %).
   - **The kind's honest figure is 83.4 %.** A traveller misses the Summer Palace and Vaux-le-Vicomte
     whatever the reason. The 91.7 % says how well the declaration does among the gardens that
     Wikidata types as gardens.
5. **Survey recall.** 107 of the 244 survey entries with a Wikidata item are admitted (43.9 %).
   This is read over every entry, not through the display rule, so it is not comparable with the
   frame report's figures read as the map shows a city.
6. **What the frame did not take as data.** Ten items: the tree fetcher, the verdict loop, the four
   adapters, the type vocabulary, the pass's list of kinds, the register's per-kind evidence, and
   the shared kills. See § What the frame did not take.

---

## Method

The run used no admission code of its own, only a probe that calls the branch's code. The code ran in the backend container on the development
machine against a copy of the branch's `backend/src`, as the #1867 and #2286 probes did. Every
connection was set to the role `pg_read_all_data`. That role can build the surroundings pool's
session table and is refused any write. The run wrote no catalogue row, and the copy was removed
from the machine after it.

### The kind

The coverage report on the development database (2026-11-03) ranks the proposed kinds that hold
places by how many regions ask for them:

| Kind | Entries | Regions |
|---|---|---|
| **Parks & gardens** | 214 | 24 |
| Markets | 181 | 24 |
| History museums | 138 | 24 |
| Neighbourhoods | 224 | 23 |
| Natural landmarks | 197 | 22 |
| Viewpoints | 98 | 22 |

Parks & gardens comes first by regions, then by entries. Wikidata names it by classes: park, urban
park, garden, botanical garden. So the run tests the frame's declaration rather than an entrance.
Neighbourhoods and Viewpoints are named by what a place is used for, not by a class. Castles
(#1665) and Palaces (#1664) have their own issues.

### The declaration

`backend/src/services/sync/parks/` follows `squares/` file for file:

- `classes.ts`: the roots, types, kills and other kinds.
- `parkTest.ts`: the verdict.
- `kind.ts`: a `PlaceKind`, a classifier through `classifyByWorldBars`, and a `SurroundingsKind`.

Every id was checked on the subset on 2026-11-03. The park and garden trees hold 424 classes and
141,803 items. The rule decides in this order:

- **Roots and types.**
  - The roots are park (98,812 items), garden (4,802), urban park (6,685) and botanical garden
    (2,713). The bamboo grove is asked by itself: the definition names "a grove kept for walking
    in", and Arashiyama's Bamboo Forest carries nothing else.
  - The types are read in this order: botanical garden, then garden (a garden class that is no
    park class), then park.
- **Kills.** Destroyed, proposed, under construction: the three kills the other kinds use.
- **Another kind's, whatever else it is.**
  - A national, state or provincial park belongs to National parks & reserves: the national park
    class sits under the park tree.
  - A place of worship belongs to Places of worship (Kinkaku-ji is a Buddhist temple and a
    Japanese garden).
  - A cemetery belongs to Cemeteries.
- **Refused unless a park or garden class outside these trees names it.** This covers a protected
  area, a zoo, an amusement or miniature park, a square, a sports ground, a golf course, a
  business or industrial park, a sitting-out area, an allotment and a community garden.
  - Of the 11,670 protected areas on the park tree, 1,464 carry such a class: Gorky Park, Richmond
    Park, Hampstead Heath, the High Line.
  - A garden square is under both square and garden, and Squares & streets reads it as a square.
    Russell Square is therefore refused, while the Lustgarten, typed a square and a park, stays.
- **The plain classes.**
  - An archaeological site that only the plain park or garden class names belongs to Archaeology
    (Alacahöyük).
  - A palace, house or castle that only the plain garden class names is the house: the Alhambra,
    Blenheim Palace. This is Towers' building-complex rule in another kind.
  - A palace that a garden class names stays, since the kind's definition names a palace garden:
    the Generalife, Hamarikyu, Tsaritsyno.

`parkTest.test.ts` asks each branch on real items.

### Data

The run's files are kept under `docs/local/research/2254-proposed-kind/` (local).

| File | What | SHA-256 |
|---|---|---|
| `parks-dry-run.jsonl` | Every admitted place with its tier, type, editions, readers and guide use; the refusals by reason with samples; each canon and survey entry with its standing; the summary line | `3e1ee7f0…ead6632` |
| `probe.log` | The run's log, the bars line among it | — |
| `sample.jsonl` | The blind sample, 60 places per tier, with no tier, editions or readers shown | `9566ddaf…e06e10` |
| `grades-a.jsonl`, `grades-b.jsonl` | The two readers' grades | `8d21505d…6c6252`, `aa6aaab9…d36287a5` |
| `harness/parks-probe.ts`, `harness/start-probe.sh` | The probe and how it was started | — |

The probe used three inputs:

- the local Wikidata subset;
- the readership year to 2026-09 (`probe.log`: "readers over 2025-10 to 2026-09");
- the branch's `db/catalogue-coverage/` for the canon and the surveys.

### The canon and the city check

**The canon.** `db/catalogue-coverage/calibration/parks-and-gardens.jsonl` holds 145 entries,
compiled by the method of the live kinds' canons (`docs/tech/catalogue-coverage.md` § A calibration
list is a canon).

- **Sources.** The compiler's own list was written before anything was read. The other sources are
  editorial selections read on 2026-11-03: travel publishers' and guides' lists of the world's,
  a country's or a city's parks and gardens, in nine languages. Each entry needed two independent
  sources.
- **Excluded inputs.** No entry was chosen or left out by Wikidata's classes, editions, readers or
  Wikivoyage's use of an item.
- **Spread.** Europe 56, Asia 46, North America 22, Oceania 9, South America 6, Africa 6.
- **Size.** The list passes the soft guide of about a hundred, as Places of worship's does. 62
  entries rest on a country's or a city's selection, most of them Suzhou's, Japan's, Persia's and
  Kashmir's gardens, which the world lists rarely name.

The coverage reader refused a calibration list for a proposed kind, so it now reads one; the report
still reads a live kind's alone.

**The city check.** The 24 survey lists were read for the kind by the `/coverage-survey` method,
as #2030 read them for street art. That meant fresh Wikivoyage articles through
`catalogue-coverage.sh lookup wikivoyage`, the guides' and tourism boards' park pages, and the
earlier surveys' single-source records.

- 28 entries were added and 20 refiled under the kind, among them Kyoto's garden temples, Humayun's
  Tomb and the Pena Palace. One entry, Bang Pu, left the kind.
- The lists now file 261 entries under the kind, 244 of them with a Wikidata item. Two Beijing entries the run read, Baiwangshan Forest Park (not in the pool) and the Garden of World's Flowers (no item), were taken out after it: TravelChinaGuide's attractions index, their second source, is a directory rather than a selection, and the figures below leave them out.
- Identifiers came from the local subset. The lookup's `search` and `facts` read the live Wikidata
  API, which the project does not call (the address is banned there).

### The second reading

**The sample.** 60 admitted places per tier, drawn at random from the run's admitted places and
shown with the label, country, coordinate and type only.

**The readers.** Two readers graded the sample independently under the frame review's
`judging-guideline.md` (local): V worth a visit, L local interest, N noise. **Both readers are model
agents**, as in the density report (`2026-11-02-a-surroundings-neighbourhood-that-follows-density.md`).
Noise by either reader counts as noise.

## Results

### Load and cost

Its steps took 516 seconds, about nine minutes, on the development machine. The figures are from the summary line of
`parks-dry-run.jsonl` and from `probe.log`.

| Step | Seconds | What it read |
|---|---|---|
| Gather | 43 | The kind's share: 16,980 candidates, every one in its admission pool; 7,796 the rule passes |
| World tier | 102 | The bars and each candidate's readers; 679 admitted |
| Surroundings pool | 360 | 2,248,022 items of 4,924 classes (the six kinds', the parks', the museums'), 615,713 of them read for readers |
| Surroundings tier | 10 | 7,809 park-class candidates at 2 editions and 2,400 readers; 4,073 clear the cut within 150 km; 974 pass the rule |
| Gone | 1 | None refused |

**Gathering one kind alone gives its full share.** A pool question names an entity by a class the
entity carries itself (`places/gather.ts`), so the six kinds beside it would change nothing. The
surroundings pool is different, since it measures a park against the churches, towers and digs
around it. The probe therefore built that pool over every live kind's classes, as
`places/placePass.ts` does.

**The tiers by type:**

| Tier | Park | Botanical garden | Garden | All |
|---|---|---|---|---|
| World | 445 | 114 | 120 | 679 |
| Surroundings | 639 | 242 | 93 | 974 |

The surroundings tier admits more parks than any live kind but Places of worship (4,060). The
others range from 256 for Towers to 675 for Bridges & engineering marvels (`docs/tech/experiences.md`
§ the surroundings tier). Every surroundings-tier arrival waits for a curator where the source's
gate is on.

**The rule's refusals, over the share** (`rule-refusal` lines):

| Reason | Count | Example |
|---|---|---|
| National park | 2,918 | Yellowstone |
| State park | 2,069 | Anza-Borrego Desert State Park |
| Zoo | 1,226 | London Zoo |
| Provincial park | 926 | Algonquin |
| Amusement park | 830 | Disneyland |
| Protected area | 466 | Cheonggyecheon |
| Archaeological site | 209 | Hadrian's Villa |
| Square | 123 | Place des Vosges |
| Business park | 98 | Suzhou Industrial Park |
| Cemetery | 88 | Ohlsdorf |
| A palace, house or castle with its garden | 50 | Blenheim Palace |
| Miniature park | 48 | Miniatur Wunderland |
| Sports venue | 43 | — |
| Destroyed | 41 | the Hanging Gardens of Babylon |
| Place of worship | 34 | Kinkaku-ji |
| Allotment, community garden | 13 | — |
| Proposed | 2 | Odori Park, the Garden Bridge |

### Noise

From `sample.jsonl`, `grades-a.jsonl` and `grades-b.jsonl`:

| Tier | Graded | Noise by either | V by both |
|---|---|---|---|
| World | 60 | 4 (6.7 %) | 41 |
| Surroundings | 60 | 3 (5.0 %) | 11 |
| Weighted by tier size | | 5.7 % | |

The readers agreed on the full grade for 104 of the 120 places. On N against the rest they agreed on
118 of 120, κ 0.82.

**The noise has three shapes.** Each shape is a class the item carries, not a bar:

- **The plain `park` alone.** Mutianyu (the Great Wall), the Sanctuary of Truth (a temple) and the
  Lekki Conservation Centre (a reserve) carry no class but `park`. 443 admitted places carry
  nothing else, 309 of them in the surroundings tier, and most of those are city parks.
- **A sculpture garden or a garden on a museum.** The Kröller-Müller Museum (one reader) and the
  Musée Christian Dior (one reader) belong to Art Museums. Dodekalitten is a modern stone circle.
  64 admitted places carry a museum class.
- **An arboretum on a forest.** Rold Skov.

### The misses

**The canon (24 misses).** From the `canon` lines.

- **12: Wikidata holds the garden only as the house's item, with no garden class.** The Summer
  Palace (a palace), Peterhof (a palace complex), Vaux-le-Vicomte, Villandry and Schwetzingen
  (châteaux), Chehel Sotoun, Isola Bella (an island), Dumbarton Oaks (a mansion and a research
  institute), Katsura (a detached palace), Villa Ephrussi (a villa and a museum), Giverny (a house)
  and the Adachi Museum (an art museum).
- **1: a class outside the trees.** Boboli is a *historical park museum* (Q112132527), a class
  under museum alone. Its 243 items may be the Italian state's park museums; read them before
  making the class a root.
- **2: refused on purpose as places of worship.** Ryōan-ji and Saihō-ji.
- **4: under the bars and the cut.** The Desert Botanical Garden, Centennial Park in Sydney,
  Melbourne's Royal Botanic Gardens and the Mirabell Gardens.
- **5: not in the pool, or no point.** Schönbrunn's park (one edition), Monte Palace (one) and Le
  Jardin Secret (none) are not in the pool, which is read at three sitelinks or more. Powerscourt and
  Wendy Whiteley's garden have no coordinate.

**The surveys (137 misses of 244).** From the `survey` lines.

- **50: no park or garden class.**
  - Estates and palaces (Kuskovo, Arkhangelskoye, Villa Torlonia).
  - Glienicke was counted here because its entry named only the palace's item (Q301684). Its park
    has an item of its own, Park Glienicke (Q2052534, a park, four Wikipedia editions), which the
    run did not admit: it is under the bars. The entry now names it in `same_as`.
  - Forests (the Grunewald, Monsanto) and hills.
  - Humayun's Tomb, which another kind holds.
- **19: places of worship.** Kyoto's garden temples.
- **4: other kinds' trees.** 2 national parks, 1 zoo, 1 protected area.
- **2: no point.**
- **46: under the bars and the cut.**
- **16: not in the pool.**

**Odori Park** is refused by the shared *proposed* kill: Wikidata types it "planned road in Japan"
(Q3809453), which is under *proposed building or structure* (Q811683). No live kind's street or
square class is under that root, only abandoned or planned motorways, so the misfire is the parks
kind's alone.

## What the frame did not take

Each of these was copied as code or edited in a shared file, where a declaration would have been
data.

| # | What | Where | Issue |
|---|---|---|---|
| 1 | The tree fetcher: one `fetchClassTree` per root, the same loop over the kills and other kinds | `fetchParkTrees`, as `fetchSquareTrees` and `fetchTowerTrees` | #2318 |
| 2 | The verdict loop: kills, other kinds, "no class of the kind", "no point on Earth", the type order | `parkVerdict`, `parkType`, as the square and tower verdicts | #2318 |
| 3 | A rule's exceptions have no vocabulary: "refused unless a class of its own names it" and "only the plain class names it" are functions in each kind | `notAPark`; Squares' canal, Towers' `towerByTheWay` | #2318 |
| 4 | The four adapters, identical but for names: the `PlaceKind`, the classifier, the `SurroundingsKind`, the pass-shaped classifier | `parks/kind.ts`, as `squares/kind.ts`, `towers/kind.ts`, `bridges/kind.ts` | #2318 |
| 5 | The landmark type is a closed union every kind extends before it compiles | `WikidataLandmark['type']`, `services/sync/types.ts` | #2319 |
| 6 | The type labels a reader sees are a second hand-kept list | `frontend/src/utils/experienceTypes.ts` (not touched) | #2319 |
| 7 | The pass names its kinds three times; a probe of one kind repeats the list to rebuild the surroundings pool | `placeGather`, `surroundingsPoolOf`, `syncPlacePass` in `places/placePass.ts`; `PLACE_PASS` | #2320 |
| 8 | The coverage reader refused a proposed kind's canon | `checkCalibrationList`, `catalogueCoverage/files.ts` | changed on this branch |
| 9 | The register's evidence names kinds, so the coverage report has no editions line for a new kind | `MEASURED_BARS`, `FrameKindSlug`, `places/admissionRegister.ts` | #2321 |
| 10 | The kills are copied into every kind, and the shared *proposed* kill refuses Odori Park | each kind's `KILLS` | #2318, #2317 |

The register itself took the kind with nothing of its own. `WORLD_FRAME` and `SURROUNDINGS_CUT` read
the parks' pool as they read the six kinds', and `refuseGone` read it as is.

## What this does not show

- **The readers are model agents.** No person graded the sample. The frame review's maintainer
  reading disagreed with its first reading at κ 0.39, so the 5.7 % is a model reading's figure
  until a person reads a sample.
- **One kind.** Parks & gardens is named by classes. A kind named by use, such as Viewpoints or
  Neighbourhoods, would test the entrances and is not tested here.
- **No display rule.** The survey recall is read over every entry, not as the map shows a city
  (ADR-0172).
- **No held places.** A first run holds nothing, so the stay share was not read.

## What follows

- **The real kind (#2317)** starts from this declaration and reads three shapes the run found:
  - the gardens Wikidata holds only as the house's item, through an entrance or a curator's list
    (#2317);
  - the museums the kind admits as sculpture gardens;
  - the items whose only class is the plain park.
- **The frame's gaps** go to the issues in the table above.
