# What signals other than Wikipedia editions find under a kind's line

Research for #1997, done on 2026-10-30 on the development catalogue of that day. It used the local
Wikidata subset of the dump of 2026-10-19, the Wikivoyage use of 2026-10-01, the year of readership
from October 2025 to September 2026, and #1977's extract of the dump of 2026-10-19.

## The question

Every kind but World Heritage Sites admits a place by its count of Wikipedia editions, and the
calibration lists of #1864 name the tops that count misses. The maintainer decided on 2026-10-26
that no line is moved on Wikipedia editions alone. Other signals are measured first, a year of
readers among them. #1977 read three such signals over each kind's classes. This report reads
them, and a year of readers, on what each kind's own rule passes, and asks two things:

- Which of the obvious world tops that a kind does not offer does a signal bring back?
- How much else does it bring?

The bar is the world tier's. A signal is judged by the obvious world tops it brings back and by
the junk it brings with them. How much of everything that could be offered it reaches does not
count. A place known in one region waits for that region's own sources (the regional tier,
ADR-0048), so a miss that only a regional source would name is not a failure of a signal.

## Method

**The candidates are the kind's own.** Each kind's pool was read the way its run reads it: the
place pass's gather over the subset (`places/gather.ts`, `gatherPlaces`). Each kind's own rule
then decided it: `classifyPublicArt` with each of the Public art and Monuments & memorials rules,
`classifyPlacesByFame`, `classifyTowers`, `classifyBridges` and `classifySquares`, and, for
Archaeology, the source's whole collection (`archaeologySource(...).fetchItems`). The line was
forced open in a throwaway worktree: `lineStanding`, `guidedStanding` and `towerStanding` answered
`in` under an environment flag. So every candidate below came back that the rule passes and only
the line refuses. Editions are the runs' own count, read from the subset. The probes ran with
`default_transaction_read_only` on, so nothing in the catalogue was written.

**What "under the line" means.** A candidate the kind already offers is left out. So is one a
curator refused (a refusal pinned on its membership: 41 such rows across the seven kinds, the
Theatre of Pompey and the Cloaca Maxima among them). For the four kinds whose line is editions
alone, a candidate at 22 editions or more is left out too. What remains sits between the pool's
floor and the line.

**The signals:**

| Signal | What it is | Read from |
|---|---|---|
| guide | some Wikivoyage edition uses the item | `usedByAGuide`, the runs' own reader |
| travel | the item carries a travel platform's identifier: Tripadvisor, Atlas Obscura, Foursquare, Yelp, Michelin, Petit Futé, the Touring Club Italiano, AAA, Routard, Visit Tuscany, Komoot, the Japan Tourism Agency or Google Arts & Culture | #1977's extract |
| atlas | Atlas Obscura's identifier (P7772) alone | #1977's extract |
| grade | a national register's higher grade (heritage designation, P1435): a National Historic Landmark, a National Monument of Portugal, a *monument historique classé*, a Russian site of federal significance, Grade I or a category A listed building | #1977's extract |
| readers | a year of readers at the readership door's bar: the median of what the kind already offers (ADR-0056) | `yearlyReaders`, the runs' own reader |

**The tops** are each kind's calibration list (`db/catalogue-coverage/calibration/`), 732 entries
over eight lists, read with the same readers and Wikivoyage use. The ninth list, the notable works,
names works rather than places and is not read here.

**Under the pool's floor.** The pool stops at a floor: 15 editions for the place pass. A top below
it is never a candidate, so no signal inside the pool can bring it back. For that part, a kind is
#1977's set of its root classes, not its rule. The counts there are upper bounds of what the
kind's rule would let through, and a top its classes do not reach is named apart.

## Where the missing tops are

| Kind | Tops | Offered | Under the line, in the pool | Under the floor | Over the floor, not a candidate |
|---|---|---|---|---|---|
| Public art | 66 | 22 | 2 | 37 | 5 |
| Places of worship | 155 | 138 | 7 | 5 | 5 |
| Archaeology | 113 | 97 | 0 | 8 | 8 |
| Monuments & memorials | 64 | 35 | 10 | 4 | 15 |
| Towers | 68 | 47 | 2 | 16 | 3 |
| Bridges & engineering marvels | 85 | 73 | 1 | 8 | 3 |
| Squares & streets | 85 | 67 | 0 | 11 | 7 |

Three readings:

- **Few missing tops are under the line inside the pool.** Only 22 of the 157 missing tops sit
  between the floor and the line, and ten of those are Monuments & memorials'. A signal that opens
  a door inside the pool helps that kind and few others.
- **Most are under the floor.** There are 89. Public art's 37 are the bulk: Cadillac Ranch and
  Salvation Mountain (10 editions each), the Crown Fountain (13) and the Chicago Picasso (6).
  Towers has 16 (Bologna's Asinelli and Garisenda, the Dom Tower of Utrecht) and Squares & streets
  has 11 (Bourbon Street, the Selarón Steps).
- **The rest are the rule's, not the line's.** These 46 tops have the editions but are no
  candidate:
  - Meteora, the Western Wall and Uluru (#1978);
  - Ayutthaya, the Longmen Grottoes and Rapa Nui (#1982);
  - Mount Rushmore, the Vittoriano and the Arch of Constantine (#1989);
  - the Koutoubia Minaret (#1972);
  - the Delta Works (#1973);
  - Shibuya Crossing and the Hollywood Walk of Fame (#1974);
  - the Vigeland installation (#2037).

  No signal under the line touches them.

Some list entries read nothing because the list names an item the articles are not about: the
Bushwick Collective, Delos, Aksum's stelae field, the Abbey Road crossing and three Japanese
five-storied pagodas, each with 0 editions and 0 readers. They are a question of which item a
place is, as #1977 found for *Maman* and *The Thinker*.

## Inside the pool

Each cell gives the candidates under the line that the signal marks, and in brackets the tops among
them.

| Kind | Under the line | Tops among them | guide | travel | atlas | grade | readers | guide and travel | guide and readers |
|---|---|---|---|---|---|---|---|---|---|
| Public art | 262 | 2 | 31 (1) | 24 (1) | 21 (1) | 1 (0) | 1 (0) | 10 (0) | 1 (0) |
| Places of worship | 1,081 | 7 | 885 (5) | 170 (1) | 105 (1) | 130 (1) | 89 (3) | 154 (1) | 78 (1) |
| Archaeology | 619 | 0 | 362 | 100 | 77 | 30 | 33 | 79 | 7 |
| Monuments & memorials | 113 | 10 | 74 (10) | 40 (6) | 35 (4) | 6 (1) | 14 (3) | 33 (6) | 12 (3) |
| Towers | 35 | 2 | 26 (2) | 4 (0) | 3 (0) | 1 (0) | 0 | 3 (0) | 0 |
| Bridges & engineering marvels | 289 | 1 | 22 (0) | 11 (0) | 10 (0) | 4 (0) | 0 | 3 (0) | 0 |
| Squares & streets | 65 | 0 | 1 | 5 | 4 | 0 | 0 | 0 | 0 |

The readers' bar is the median of what each kind offers: from 54,722 readers a year (Squares &
streets) to 100,736 (Public art). For Towers, Bridges and Squares, a year of readers is already
part of the line (with a lower bar where a guide names the place, `places/guidedLine.ts`). A
candidate under their line has already failed it, so the readers column is empty by construction.

What the signals bring, read as a traveller:

- **Monuments & memorials, guide: all ten tops and 64 more, nearly all of them real monuments.**
  - The tops: the Voortrekker Monument, the Monumento a la Revolución, the World War II Memorial,
    the Ciudad Mitad del Mundo, the Scott Monument, the Berlin Wall Memorial, the Kigali Genocide
    Memorial, the USS Arizona Memorial, the Shrine of Remembrance and Cristo de la Concordia.
  - The rest: the Buzludzha monument, the Kyffhäuser and Niederwald monuments, *Fearless Girl*,
    the Menin Gate, the Cenotaph, Strawberry Fields, Potsdam's Brandenburg Gate, the Porte
    Saint-Martin, the Srebrenica Genocide Memorial, the Sardarapat Memorial and the Chronicle of
    Georgia.
  - What a traveller would not file here: Muir Woods and Rainbow Bridge, which the United States
    calls national monuments but which are a forest and a natural arch; Stonehenge's World
    Heritage item, a duplicate of the site; and a John Lennon statue whose item carries no edition
    at all.

  A travel identifier reaches six of the ten, Atlas Obscura four and readers three.
- **Towers, guide: both tops (the Iron Pagoda and the Songyue Pagoda) and 24 more.** They are
  mostly towers a visitor climbs or looks at: Kiek in de Kök, the Beyazıt Tower, the Kızıl Kule,
  the Oldehove and the TV towers of Tbilisi, Saint Petersburg and Bratislava. A cathedral and a
  castle are filed under it by their classes.
- **Public art, guide: one top in 31 (the Buckingham Fountain).** The rest are real works:
  Bologna's Fountain of Neptune, Brâncuși's ensemble at Târgu Jiu, the Fontana delle Tartarughe
  and the Christ of the Abyss. Atlas Obscura reaches the other top, the Keith Haring mural in
  Collingwood.
- **Places of worship: no signal is selective.**
  - The guide marks 885 of the 1,081 candidates under the line: five of the seven tops (Dilwara,
    the Mont-Saint-Michel Abbey, the Jade Buddha Temple, Wat Xieng Thong and the Salt Cathedral of
    Zipaquirá) and 880 more.
  - Readers reach Fátima, Virupaksha and the Mont-Saint-Michel Abbey with 86 more, mostly
    pilgrimage temples of India read by a domestic public (Mahakaleshwar, Trimbakeshwar,
    Vaishno Devi).
  - No pair keeps the tops and drops the rest.
- **Archaeology: no top under its line in the pool.** It already has a readership door for sites
  (ADR-0127, with two witnesses of a visit, ADR-0128).
- **Bridges: the one top, the Lupu Bridge, carries no signal.** The 22 places the guide marks
  are dams, canals and minor bridges.

## Under the pool's floor

What a door under the floor would bring, by the kind's classes: the places carrying the signal
whose year of readers reaches the level, and, in brackets, the missing tops among them out of
those the kind's classes reach.

| Kind | Tops under the floor (in the classes) | guide or atlas, any readers | …10,000 readers | …25,000 | …50,000 |
|---|---|---|---|---|---|
| Public art | 38 (22) | 2,889 (21) | 452 (15) | 149 (9) | 41 (4) |
| Places of worship | 5 (3) | 25,599 (3) | 2,568 (3) | 624 (1) | 139 (0) |
| Archaeology | 8 (4) | 5,126 (4) | 815 (3) | 186 (2) | 40 (1) |
| Monuments & memorials | 4 (3) | 5,984 (3) | 979 (3) | 313 (2) | 92 (2) |
| Towers | 16 (14) | 2,246 (10) | 193 (10) | 52 (7) | 17 (1) |
| Bridges & engineering marvels | 8 (4) | 2,433 (4) | 508 (4) | 159 (3) | 43 (1) |
| Squares & streets | 11 (5) | 2,207 (5) | 402 (4) | 110 (4) | 22 (1) |

This table counts a top under the floor by its list's editions, so Public art's 38 include the
Keith Haring mural in Collingwood (2 editions). The street-art entrance already brings it into the
pool, where § Where the missing tops are counts it, so it is counted in both places, and the 90
tops here are that section's 89 and the mural. For Towers, Bridges and Squares, Atlas Obscura adds
almost nothing to the guide. For Public art it adds as much as the guide does: Atlas Obscura alone
marks 17 of the 22 tops, the guide 15.

More than a third of the counted tops (35 of 90) lie outside the kind's classes, and no signal at
a floor reaches them:

- Public art: 16 of its 38, most of them street-art places that are districts, lanes or
  buildings (Hosier Lane, Comuna 13, Wynwood, Balmy Alley), and the Chicago Picasso and *LOVE*.
- Bridges & engineering marvels: the canal locks (Neptune's Staircase, the Fonseranes Locks) and
  the living root bridge.
- Squares & streets: Bourbon Street, the Philosopher's Path and Hanamikōji.

What the doors bring, read as a traveller:

- **Towers, guide at 25,000 readers: 47 places, 7 of the 14 tops.** The tops are the Torrazzo of
  Cremona, Reunion Tower, the Three Pagodas of Chongsheng Temple, the Leaning Tower of Nevyansk,
  Bologna's Asinelli and Garisenda towers and the Dom Tower of Utrecht. Most of the rest are towers
  worth a stop: the Watts Towers, the Tower of the Sun, the Torre Branca, the Torre Guinigi, the
  Gros Horloge, the Mouse Tower and the Sutro Tower. A few are towers no traveller goes to: the
  Rottweil elevator test tower and the Emley Moor transmitter. The tops it misses are under the
  readers' level (the Martinitoren, the Torre dei Lamberti) or name the wrong item (the
  five-storied pagodas).
- **Public art, guide or Atlas Obscura at 25,000 readers: 149 places, 9 of the 22 tops.**
  - The tops: Cadillac Ranch, Salvation Mountain, the Crown Fountain, Bethesda Terrace, *Crack Is
    Wack*, *Tuttomondo*, *The Awakening*, *The Spirit of Detroit* and the Floralis Genérica.
  - The rest are mostly sights: Prada Marfa, Spiral Jetty, the Cretto di Burri, the Porcellino,
    Hachikō, Bern's Kindlifresserbrunnen and Rivera's Detroit Industry Murals.
  - Some are curiosities rather than art (the Chicago rat hole, the Hess triangle), some belong
    to another kind (Mount Rushmore, the Black Nazarene), and some are gone (the Nathan Bedford
    Forrest statue).
  - At 10,000 readers it brings 452 and 15 of the tops, *Puppy* and the Sun Voyager among them.
- **Squares & streets, guide at 25,000 readers: 107 places, 4 of the 5 tops.**
  - The tops: the Plaza Mayor of Salamanca, the Selarón Steps, Takeshita Street and Cusco's Plaza
    de Armas.
  - The rest are often real: the Shambles, Hanoi's Train Street, the Begijnhof, the Seven Dials,
    the San Antonio River Walk and Mary King's Close.
  - Some are not a square a traveller looks for: a convention centre (Bharat Mandapam), a bridge
    and a bullring.
- **Bridges & engineering marvels, guide at 25,000 readers: 137 places, 3 tops.** The tops are
  the Seven Mile Bridge, the Verzasca Dam and the Hercílio Luz Bridge. Much of the rest is
  transport infrastructure a traveller crosses rather than visits: the Tokyo Bay Aqua-Line, the
  Cebu–Cordova Link, the Eisenhower and Detroit–Windsor tunnels and Mumbai's Coastal Road.
- **Monuments & memorials and Places of worship: few tops for many places.**
  - Monuments & memorials at 50,000 readers reaches 2 of its 3 tops in 92 places. The most read of
    them are often tombs, national historic sites and kofun filed as monuments.
  - Places of worship reaches none of its 3 tops at 50,000 readers in 139.
- **Archaeology, guide at 25,000 readers: 2 tops in 163, Epidaurus and Meroë.**
  - The rest mixes real sites (Cliff Palace, the Osireion, Aigai, Sannai-Maruyama) with what the
    kind's rule would refuse: a city (Thebes), a flooded town (Mologa), a wreck and an arsenal.
  - The kind's own rule, which reads the map and the witnesses, decides there; this count does not
    run it.

## What the signals are, per kind

These are the readings for the maintainer's decision per kind. This report decides nothing.

| Kind | Inside the pool | Under the floor |
|---|---|---|
| Monuments & memorials | The guide brings every missing top under the line, with real monuments | Few tops; what comes is mostly misfiled |
| Towers | The guide brings both tops, with real towers | The guide with a year of readers brings half the tops, mostly real towers |
| Public art | Nothing to gain: two tops | The guide or Atlas Obscura with a year of readers brings two thirds of the tops the classes reach at 10,000 readers (15 of 22) and 9 at 25,000, with sights and some curiosities. Street-art places are outside the classes and need their own entrance (#2035) |
| Squares & streets | Nothing under the line | The guide with a year of readers brings four of the five tops reachable, with real streets and some misfiled places |
| Bridges & engineering marvels | The one top carries no signal | The guide brings the tops with much infrastructure; the locks and the root bridge are outside the classes (#1973) |
| Places of worship | The 7 tops under the line carry no selective signal; 5 of its 17 misses are the rule's (#1978) | Nothing to gain |
| Archaeology | No top under the line; it has its own readership door | Two tops for many places. Of its 16 misses, 8 are under the floor and 8 are the rule's (#1982) |
| Art Museums | A museum is never admitted for its own fame (#1985): a signal on the museum names the misses, as a check | Of the 8 museums under the floor, the classes reach 7, and the guide at 10,000 readers marks all 7 |

The register's higher grade marks almost nothing under any line (no more than one top per kind).
It is a sign of what one country holds significant, so it belongs to the regional tier, as #1977
found.

## How to rerun it

The probes are in `data/cache/1997-signals/` on the development machine, beside their results:

- `candidates.mts` reads the place pass's kinds.
- `arch.mts` reads Archaeology.
- `canon.mts` reads the calibration lists.
- `join.py` adds the dump's signals.
- `analyse.py` computes the table inside the pool.
- `belowlist.py`, `belowreaders.mts` and `below_sweep.py` compute the table under the floor.

The two `.mts` probes that read the pools need a worktree whose `lineStanding`, `guidedStanding`
and `towerStanding` return `'in'` while `PROBE_ALL_IN` is set. They run as:

```bash
cd <worktree>/backend
set -a; . ../.env; set +a
PGOPTIONS="-c default_transaction_read_only=on" PROBE_ALL_IN=1 \
  node_modules/.bin/tsx data/cache/1997-signals/candidates.mts candidates.jsonl
```

## What this does not show

- **The rule under the floor.** The counts under the floor are by class, so a door there would
  bring fewer places than the table says: the kind's own refusals (a lost work, an indoor one, a
  living town) would still run.
- **A curator's reading of every place.** The judgements above come from reading the most read
  places and a sample of the rest, not every row.
- **A line.** This measures signals beside the line. Each kind's own issue keeps the question of
  moving its line.
- **The tops themselves.** A calibration list naming the wrong item reads as a miss of every
  signal. Those entries are named above and belong to the lists.
