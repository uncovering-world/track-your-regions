# A place measured against its surroundings: the unit and the bar of a global source's regional tier (2026-10-31)

The measurement #2154 asked for. The world line on Wikipedia editions admits most of what guides
send a traveller to in Rome and Berlin, and little of it in Dakar or Addis Ababa. Inside one area,
the signals rank places about as well everywhere (#2154's own table). The rule for the whole world
therefore needs a unit that exists everywhere, and a bar that is a ratio to the unit, not a count.

**Short answer.** Measure a place against what lies **within 50 km of it**. It enters when it has
a Wikipedia article in at least two languages and either of two conditions holds:
- **Wikivoyage:** the Wikivoyage editions that use it reach **a quarter of the median of the 10
  best within 50 km**, in an area of at least 5 places;
- **Editions:** its Wikipedia editions reach the **median of the 10 best within 50 km**, in an
  area of at least 25 places.

Over the 14 surveyed regions outside Europe and Oceania, this admits 209 of the 264 places that
three sources other than Wikivoyage name (79 %). The world line admits 93 of them (35 %). Of the
places missing from the catalogue today, it finds 145 of 204 (71 %). A percentile within the
country found 10–11 %. It adds 446 places inside those 14 circles, and some guide names 267 of
them (60 %).

Three findings:
- The unit hardly matters: a radius, an H3 cell with its ring and a Wikivoyage region give the same results.
- The signal matters most: Wikivoyage editions are the most precise of the four. Readers in the
  country's languages are never the best signal, although `docs/tech/filling-a-kind.md` names
  them as the within-unit signal.
- The floor must count places, not places that carry the signal. Otherwise it closes Dakar,
  Zanzibar and Havana, where Wikivoyage uses only the tops.

---

## Method

**Data.** All from the development machine, under `data/cache/`.

| File | What | SHA-256 |
|---|---|---|
| `bias-signals/pool21.tsv` | Every item with a coordinate whose `P31` falls under one of the eight live kinds' classes, in the 21 surveyed countries: kind, item, Wikipedia editions, country, coordinate, label (2026-10-30, from the local Wikidata subset) | `805235185f7693bd1f483af7d97e265cacd33e45670b294ad0bb02a2ff5b12af` |
| `bias-signals/readers21.tsv` | Those items' readers over a year, per Wikipedia edition (the pageview dumps) | `534981e3c39750d79c2f0a6c25ab654da4579e0f62fd8fdd621aef9e8d5d3146` |
| `bias-signals/wv21.tsv` | How many Wikivoyage editions use each item in a guide article, heritage-register lists left out (`wikivoyage_usage`, `docs/tech/dumps.md` § The items Wikivoyage uses) | `9cf80b7229c11ff4b16dfa78386863abd0ff376417248f8d7d03cb2607b993c7` |
| `bias-signals/cov.json` | The coverage report of 2026-10-30: each survey entry's verdict and source count | `39afb1b2d38772c94d5391e263a9c9243f7d5465e0d1b13ff7aebb6a5c76b832` |
| `2154-regional-unit/wvdest.tsv` | English Wikivoyage's city, district and park articles with their `{{geo}}` coordinate and `{{IsPartOf}}` parent, from `wikivoyage_pages` (dump of 2026-10-01; `wvdest.sql`) | `3f4c8a057406d77a30ae6b1169a71eb008a71e21545add6fc5e644a6d8c8087a` |
| `2154-regional-unit/wvnamed.tsv` | Whether Wikivoyage was one of the sources that named each survey entry, from each survey's per-source record (`wvnamed.py`) | `8800cdc1787b8ce1fe6bf0cc466f191a01c66c9f579c940912c1aafb40d0efdd` |

The survey circles and entries are `db/catalogue-coverage/regions.jsonl` and
`expectations/*.jsonl`.

**Tops.** A region's tops are its survey entries of type place that at least three sources name.
Each top has a live kind and an item in the pool, which leaves 604 tops.

Wikivoyage is one of the sources a survey reads (`/coverage-survey` step 3), and it named 3,450
of the 4,466 entries. A top Wikivoyage helped to name scores well on the Wikivoyage signal for
that very reason, so a test on such tops is partly its own judge. Every result is therefore also
given on the **tops without Wikivoyage**: entries that three sources other than Wikivoyage name.
There are 430 of them, 264 outside Europe and Oceania. They lead the comparison below. The
per-source records live in each survey's local working directory and cover 4,458 of the 4,466
entries.

**Groups.** Europe means the Rome, Berlin, Moscow, Istanbul and Yerevan surveys, and AU/NZ means
Sydney and Auckland. The 14 others are reported together as the "regions outside Europe and
Oceania".

**Units** (`units.py`). A place's group is built in nine ways:
- **A radius around the place:** 10, 25 or 50 km.
- **An H3 cell and its ring:** the place's cell at resolution 6, 5 or 4 (average edge 3.7, 9.9
  and 26 km), with the six cells around it.
- **A Wikivoyage destination:** the nearest city, district or park article within 50 km, then
  the city a district belongs to, then that city's `IsPartOf` parent (a region).

A group either takes all live kinds together or only the place's own kind; a place with several
kinds passes if any one of them does.

**Bar.** The **reference** of a group is the median of its 5 or 10 best values of the signal, or
of all its positive values where fewer places than that carry the signal.
A place passes when its own value is positive and at least *c* times the reference, with *c* 1,
0.5 or 0.25. The **floor** is a minimum group size of 5, 10 or 25, counting either the places
that carry the signal or every place of the group. Places on the world line (22 editions or
more) are admitted as they are, and the variant adds the rest.

**Signals.** Wikipedia editions; readers over a year; readers in the country's languages (as
`signals.py` of 2026-10-30 defines them); and the Wikivoyage editions that use the item.

**What is reported, per region:**
- **Recall:** the share of tops the variant admits.
- **The places it adds inside the survey circle.**
- **How many of those any guide of the survey names.** This is a lower bound on precision: a
  survey lists 100–400 entries, so a temple a traveller would visit and no guide happened to
  list counts against the variant.

## Results

### The unit matters little; the signal and the floor matter

Recall on the tops without Wikivoyage outside Europe and Oceania (all tops in brackets), and the
share of the added places some guide names. Each cell is the variant with the best recall that
adds at most 500 places in the 14 regions. The floor counts every place of the group. The world
line alone: 35 % (27 %).

| Unit | Editions | Readers | Wikivoyage | Local readers | Wikivoyage or editions |
|---|---|---|---|---|---|
| H3 r4 + ring | 72 (64) 43 % | 67 (60) 43 % | 75 (75) 54 % | 69 (61) 42 % | 70 (67) 53 % |
| H3 r5 + ring | 60 (52) 24 % | 66 (58) 35 % | 70 (68) 58 % | 66 (59) 35 % | 66 (63) 39 % |
| H3 r6 + ring | 48 (40) 15 % | 59 (51) 30 % | 69 (66) 55 % | 58 (50) 24 % | 53 (45) 21 % |
| WV city | 52 (42) 13 % | 61 (52) 26 % | 72 (69) 55 % | 61 (53) 25 % | 56 (46) 20 % |
| WV destination | 46 (40) 15 % | 59 (49) 33 % | 64 (58) 49 % | 57 (51) 28 % | 55 (46) 26 % |
| WV region | 64 (54) 37 % | 69 (60) 39 % | 71 (68) 61 % | 69 (60) 45 % | 73 (70) 53 % |
| radius 10 km | 48 (40) 15 % | 62 (53) 26 % | 69 (66) 56 % | 62 (53) 26 % | 52 (44) 21 % |
| radius 25 km | 60 (52) 26 % | 65 (56) 37 % | 75 (74) 53 % | 66 (59) 37 % | 66 (62) 40 % |
| radius 50 km | 68 (59) 40 % | 67 (58) 38 % | 76 (76) 54 % | 67 (60) 40 % | 72 (69) 48 % |

Read across a row, Wikivoyage editions give the best recall and the most precise set. Read down a
column, the larger units do better, and three of them come out level: a radius of 50 km, an H3
cell of resolution 4 with its ring, and a Wikivoyage region. Readers in the country's languages
are level with all readers, within two points either way, and never the best signal.

Wikivoyage stays ahead on the tops it did not help to name, so its lead is not its own vote. At
800 places the picture is the same, with most cells a few points higher and less precise.

### The floor counts places, not places with the signal

With the floor counting the places that carry the signal (at least 10 of them), Wikivoyage on a
50 km radius admits nothing in Dakar, Zanzibar or Havana. Wikivoyage uses 8, 5 and 8 places
there, and they are the tops:
- **Dakar:** the African Renaissance Monument (5 editions of Wikivoyage), the Musée Théodore
  Monod (4), the Grande Mosquée and the Cathedral of the African Remembrance (3 each).
- **Zanzibar:** Christ Church and the Old Fort (4 each).

A floor on every place of the group (5 or more) admits them. A floor exists so that the fifth
church of a group of five is not a top. It does that by group size, and a sparse signal is not a
small group.

### A single listing clears a reference of one

Where the 10 best places within 50 km are each used by one Wikivoyage edition, the reference is
1, and every place a town's article lists passes. Russian Wikivoyage's town articles list most
of their churches. Wikivoyage alone, at its best 500-place variant, admits 71 places in the
circle around Tula (below). Among them are dozens of village churches with no Wikipedia article or with one only,
Metallistov Street, Lenin Square, and items with no label at all.

Requiring a Wikipedia article in at least two languages cuts that circle to 22, and loses nothing
outside Europe and Oceania: 202 of 264 tops without Wikivoyage, against 200. Precision rises from
53 % to 61 % on 419 places added instead of 497. Requiring two Wikivoyage editions instead loses
recall: 185 of 264.

### The rule

The best variant of each family, on the tops without Wikivoyage outside Europe and Oceania:
- **Wikivoyage alone** (rule A): a quarter of the median of the 10 best within 50 km, an area of
  at least 5 places, 2+ editions. It admits 202 of 264 and adds 419 places, 61 % named.
- **A or editions:** adds an editions test at the median of the 10 best within 50 km, among 25
  places or more. It reaches 209 of 264 for 446 places, 60 % named.

The editions test catches places Wikivoyage does not use: two more tops each in Havana and
Salvador, and one each in Dakar, Addis Ababa and Samarkand. A or editions at half the median
instead of the whole median reaches 214 of 264, but adds 583 places, 48 % named. The rule below is A or editions
at the median, with the 2-language requirement on both tests (`final.py`):

| Region | Tops without Wikivoyage: world line | the rule | All tops: world line | the rule | Places added | named by a guide |
|---|---|---|---|---|---|---|
| Cusco region | 3/18 | 16/18 | 3/25 | 20/25 | 39 | 26 |
| Rome | 49/59 | 56/59 | 68/91 | 84/91 | 84 | 33 |
| Kyoto | 22/56 | 49/56 | 22/73 | 63/73 | 88 | 52 |
| Cairo | 25/43 | 34/43 | 26/49 | 37/49 | 32 | 16 |
| Mexico City | 11/22 | 19/22 | 11/27 | 22/27 | 40 | 16 |
| Sydney | 4/6 | 6/6 | 4/10 | 10/10 | 29 | 7 |
| Auckland | 1/4 | 4/4 | 1/7 | 4/7 | 6 | 5 |
| Delhi | 9/16 | 15/16 | 10/28 | 27/28 | 73 | 40 |
| Beijing | 5/10 | 6/10 | 7/17 | 13/17 | 47 | 25 |
| Samarkand | 4/10 | 10/10 | 4/14 | 13/14 | 26 | 15 |
| Yerevan | 14/21 | 21/21 | 17/35 | 32/35 | 55 | 25 |
| Bali | 4/13 | 12/13 | 4/25 | 19/25 | 25 | 19 |
| Istanbul | 21/25 | 23/25 | 28/41 | 38/41 | 20 | 16 |
| Isfahan | 8/13 | 10/13 | 8/24 | 19/24 | 23 | 13 |
| Dakar | 1/7 | 6/7 | 1/9 | 6/9 | 5 | 5 |
| Zanzibar | 0/3 | 3/3 | 0/4 | 4/4 | 5 | 5 |
| Addis Ababa | 0/10 | 7/10 | 0/13 | 9/13 | 12 | 10 |
| Havana | 1/15 | 9/15 | 1/15 | 9/15 | 9 | 9 |
| Salvador da Bahia | 0/28 | 13/28 | 0/31 | 14/31 | 22 | 16 |
| Berlin | 24/26 | 26/26 | 30/36 | 35/36 | 51 | 16 |
| Moscow | 15/25 | 21/25 | 16/30 | 26/30 | 52 | 16 |
| **Europe** | 123/156 | 147/156 | 159/233 | 215/233 | 262 | 106 |
| **AU/NZ** | 5/10 | 10/10 | 5/17 | 14/17 | 35 | 12 |
| **Outside Europe and Oceania** | 93/264 | 209/264 | 97/354 | 275/354 | 446 | 267 |
| **All 21** | 221/430 | 366/430 | 261/604 | 504/604 | 743 | 385 |

Of the places missing from the catalogue today, the rule finds:
- 145 of 204 outside Europe and Oceania (92 of 131 counted without Wikivoyage);
- 38 of 48 in Europe;
- 8 of 11 in Australia and New Zealand.

The places it adds that no guide of the survey names are places a traveller would visit. In Rome
there are Santa Maria dell'Anima, Tre Fontane Abbey and Portus. In Kyoto there are Gangō-ji (a
component of the Historic Monuments of Ancient Nara), Hiyoshi Taisha and the Kasugayama Primeval
Forest.

### What it misses

Outside Europe and Oceania 55 tops without Wikivoyage stay out:
- **24: no Wikivoyage edition uses the place, and its editions are under the area's median.**
  Most are in Havana and Salvador, where few Wikivoyage listings carry an item: Paseo del Prado,
  Plaza de la Catedral, El Templete, the Church of the Third Order of Mount Carmel. Kyoto has
  Pontochō.
- **18: a Wikipedia article in fewer than two languages.** Examples are Salvador's *largos*
  (squares), the Temple of the Sun at Machu Picchu (no article, four Wikivoyage editions) and
  Dakar's Place du Souvenir Africain.
- **13: under both references, in dense areas.** Old Cairo is the case. In the Islamic quarter
  the Aqsunqur Mosque and al-Muizz Street, and in the Coptic quarter the Church of Saints Sergius
  and Bacchus, are each used by one Wikivoyage edition, against a reference of 6.5 set by Giza
  and Saqqara within 50 km.

These are what a native source (#1337) or a curator's list adds. The rule is the fallback,
and it does not replace them.

## Read as a traveller, where no survey is

The rule applied to three regions outside the surveys (`final.py`, its last section).

**Around Tula** (Russia; 110 km around 54.0° N 37.6° E, 1,515 places of the live kinds). The
circle holds most of Tula Oblast and runs into Kaluga, Moscow and Lipetsk oblasts: Kaluga and
Tarusa, Serpukhov, and Polibino are in it.
- **The world line admits** only Yasnaya Polyana.
- **The rule adds 31.** Among them are the Kulikovo Field, the Dormition and Epiphany churches of
  the Tula Kremlin and the Vysotsky and Vladychny monasteries of Serpukhov. Kaluga gives its
  stone bridge, the Tsiolkovsky house and its art museum. Further on are the Tula regional art
  museum, the Shukhov tower at Polibino, Marina Tsvetaeva's cenotaph at Tarusa and the church of
  Saint Sergius on the Kulikovo Field.
- **A traveller would skip** three monuments with no English label (Q87746182, Q108130657,
  Q97344466), a church with none (Q48954896), and the monument to Kaluga's 600th anniversary.
- **Missing:** the Tula Kremlin itself (only its towers are in the pool), the Polenovo estate and
  museum, and the Bogoroditsk palace. None of the live kinds' classes reaches them (#2146), so no
  unit could have found them.

**Saint-Louis** (Senegal; 70 km around the island, 9 places of the live kinds).
- **The rule adds** the Faidherbe Bridge and the cathedral.
- **Missing:** the Great Mosque of Saint-Louis is in the pool, but no Wikivoyage edition uses it
  and it has 3 editions. The island itself is the World Heritage site, a kind of its own. Wikidata
  holds too little here for any unit, which is #2154's thin case (#1337).

**Lalibela and North Wollo** (Ethiopia; 90 km, 18 places of the live kinds).
- **The world line admits** Bete Giyorgis.
- **The rule adds 13 churches** a visitor comes for: the rest of the rock-hewn group, which
  Wikidata holds as 11 more items (Bete Medhane Alem, Bete Maryam, Bete Abba Libanos, Bete
  Gebriel-Rufael, Bete Amanuel and the rest), and Yemrehana Krestos and Na'akueto La'ab nearby.
- **Nothing is admitted that a traveller would skip.**

## What this does not show

- **Precision is a lower bound.** The share named by a guide counts against the rule every
  place a survey happened not to list.
- **The surveys are city circles.** The circle around Tula is the only rural region read, and it
  was read by eye, not against a list.
- **Wikivoyage's own judgement is part of the rule.** The tops without Wikivoyage remove its
  vote from the test, but not the agreement between guides that list the same places.
- **The pool is the live kinds' classes.** A top no class reaches (the Tula Kremlin, the
  National Museum of Ethiopia) is outside every variant. Another 24 survey entries have no item.
- **No admission was changed.** The rule is a measurement until a kind adopts it.

## How to rerun

On the development machine, from `data/cache/2154-regional-unit/` with its venv
(numpy 2.5.4, scipy 1.18.1, h3 4.5.0):

```bash
python wvnamed.py ../../../docs/local/research/catalogue-coverage ../../../db/catalogue-coverage/expectations > wvnamed.tsv
docker exec -i tyr-ng-db psql -U postgres -d track_regions -At -F $'\t' < wvdest.sql > wvdest.tsv
venv/bin/python units.py ../bias-signals ../../../db/catalogue-coverage wvdest.tsv wvnamed.tsv .   # every unit, signal, reference and floor: units.tsv
UNITS_ONLY='radius 25 km,radius 50 km,H3 r4 + ring' venv/bin/python units-min.py ../bias-signals ../../../db/catalogue-coverage wvdest.tsv wvnamed.tsv .   # the minimum-editions variants
UNITS_ONLY='radius 50 km,H3 r4 + ring' venv/bin/python units-comb.py ../bias-signals ../../../db/catalogue-coverage wvdest.tsv wvnamed.tsv .   # A and A or editions
venv/bin/python final.py ../bias-signals ../../../db/catalogue-coverage wvnamed.tsv final.md   # the rule, per region and in the three regions
```

`units.py` takes about seven minutes on 24 cores.
