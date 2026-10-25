---
slug: wikidata-towers
name: Wikidata, the world's towers
publisher: Wikimedia Foundation and the Wikidata community
urls:
  home: https://www.wikidata.org/
  dataset: https://query.wikidata.org/
  api: https://query.wikidata.org/sparql
  terms: https://www.wikidata.org/wiki/Wikidata:Licensing
family: global
kinds: [towers]
tier: world
unit: { level: any, code: none, name: "the world, cut once by two signals" }
row:
  identity: "the item"
  wikidata_link: itself
  coordinates: all
  languages: [all]
  signal: "Wikipedia editions of the tower and a year of its readers"
terms:
  licence: "CC0 1.0"
  database_right: waived
  attribution: "Wikidata (not required; given)"
  agent: unknown
  agent_rests_on: "no line in site-access.md: not judged for an agent reading pages"
  program: allowed
  program_rests_on: "a documented API under its operator's rules (ADR-0148): the Wikidata query service or the local subset, CC0, under Wikimedia's API rules"
  model: "an item's label and its English description (the line), offered to Jev when a curator asks which source's name or line to keep; CC0"
access:
  mode: api
  format: "SPARQL, or the local subset (ADR-0119); readers from the pageview dumps"
  cadence: continuous
  volume: "33,323 items under the tower roots with a coordinate; 305 with 10 or more editions; 109 at the line (2026-10-22)"
  rate: "the Query Service refuses heavy patterns; the run asks in fame bands and pauses between questions"
scorecard:
  date: 2026-10-22
  completeness: 2
  identity: 2
  coordinates: 2
  names: 2
  signal: 2
  terms: 2
  access: 2
  cadence: 2
  total: 16
  verdict: adoptable
status: adopted
issue: 1854
looked_at: 2026-10-22
---

# Wikidata, read for the world's towers

The kind *Towers* (ADR-0131) holds a tower a traveller climbs or stands under, whatever it was
built for: the Leaning Tower of Pisa, the Giralda, Big Ben, the Kalyan Minaret, the Minaret of
Jam, the Eiffel Tower, the CN Tower. Its world tier is read from Wikidata by the source
*Towers* (`experience_sources` row 7), which decides from the place pass's gather beside Public
art, Monuments & memorials, Places of worship and Archaeology (ADR-0132 decision 5). The rule
is code, and is not restated here: the classes are `backend/src/services/sync/towers/classes.ts`,
the verdict `towerTest.ts` and the line `kind.ts`. This record holds what the search measured
and why the line is where it is.

## The candidates (2026-10-22, the dev subset)

Nine roots name a tower, each checked with `wbgetentities`: tower Q12518, bell tower Q200334,
minaret Q48356, pagoda Q199451, clock tower Q853854, observation tower Q1440300, television
tower Q11166728, campanile Q1864226 and drum tower Q2455293. 33,323 items under them carry a
coordinate, and 305 of them have 10 or more Wikipedia editions.

What came in through a side class and is not a tower, counted among the 305:

- proposed or destroyed: 10, such as Dubai Creek Tower and the Warsaw radio mast;
- a worship building whose only tower class names its part: 9, such as Hagia Sophia and the
  Meenakshi Temple. Places of worship offers them;
- lighthouses: 4, and a bridge: 1. Each is a kind of its own (ADR-0131 decision 2);
- statues: 3, such as the Statue of Liberty, which is a monument;
- office skyscrapers with no observation deck, which wait for Skyscrapers (#1857);
- guyed masts, such as the KVLY-TV mast;
- gate towers and city gates, which go to City gates & walls (ADR-0131).

That leaves 253 towers. Standing fortified towers and tower tombs stay in: Belém Tower, Torre
del Oro, Baku's Maiden Tower, Thessaloniki's White Tower, Gonbad-e Qabus. A TV tower that
Wikidata also calls a skyscraper stays a tower, since its deck is what it is visited for: the
Oriental Pearl Tower.

## Why two signals

Wikipedia editions alone mislead for towers, because bots wrote many editions of some: Hoằng
Phúc pagoda has 37 editions and about 2,700 readers a year, and the Baku TV Tower 39 editions
and 11,000. So the line reads a year's readers too, counted from the pageview dumps with the
automated traffic removed (`readWorks`, the reading Art Museums' works door uses).

## The line

Two reference lists measured the options. That was the reading the line was chosen on; the line
is checked after every run against the canon in `db/catalogue-coverage/calibration/towers.jsonl`
(#1951), compiled independently of what the line measures (`docs/tech/catalogue-coverage.md`).
The two lists:

- the coverage surveys' 23 towers, 11 of which carry a tower class;
- the World Federation of Great Towers' 52 members (`www.great-towers.com/towers`, read
  2026-10-22, allowed by [`site-access.md`](../site-access.md)), 23 of which are clean tower
  candidates.

| line | towers | surveys | WFGT |
|---|---|---|---|
| 20 editions and 20,000 readers a year | 81 | 10/11 | 17/23 |
| 15 and 40,000 | 88 | 9/11 | 16/23 |
| 25 and 20,000 | 56 | 8/11 | 13/23 |
| **15 and 25,000** | **109** | **10/11** | **20/23** |

The maintainer chose **15 editions and 25,000 readers a year** to enter. A tower the source
holds stays while it keeps 12 editions and 18,000 readers, so a tower near the line does not
flicker in and out as the year's reading moves. At the line the weakest admitted towers are the
Almaty Tower, the Liuhe Pagoda, Torre delle Milizie and the Tsim Sha Tsui Clock Tower. Left out
of the federation's list: Reunion Tower (12 editions), the Beijing Central Radio & TV Tower
(22,000 readers) and Zhongyuan Tower. The table was measured on the summed views of the raw
dumps; what the code reads is in § Calibration.

When no year of readership is folded, editions alone would let in the pagodas the readers are
there to see through, so no tower enters, and a tower the source holds keeps its place while it
keeps 12 editions. The run says so in its log.

## Calibration (2026-10-22, the dev subset, read-only in the dev container)

The branch's own code, gathering for Towers alone and counting readers with `readWorks` over
September 2025 to September 2026: the pool named **174** candidates, all with 15 or more editions,
and the source would admit **108** and refuse **31**. 35 more pass the rule and miss the line;
the nearest are Victoria Tower and the Troitskaya Tower, under 25,000 readers. That is the set
the line was chosen on: 10 of the 12 survey towers the pool names (the Beijing Central Radio &
TV Tower below the line, the Spasskaya Tower a gate tower) and 20 of the 21 federation members
it names.

By type: 49 observation towers, 26 towers, 11 bell towers, 7 pagodas, 6 minarets, 5 clock
towers, 4 fortified towers. By refusal: 6 city gates and 2 gate towers (the Powder Tower in
Prague, the Zytglogge, the Spasskaya Tower), 5 skyscrapers and 2 tower blocks (Abraj Al Bait),
4 temples whose tower is a gopuram (the Meenakshi Temple), 3 sculptures (the Statue of
Liberty), 3 lighthouses (the Tower of Hercules), 2 destroyed (the Warsaw radio mast, the
Porcelain Tower of Nanjing), 1 proposed (Dubai Creek Tower), a guyed mast, a bridge and a
nuraghe.

The first reading refused the Qutb Minar, the Minaret of Jam and the Kalyan Minaret as places
of worship, since Wikidata files a minaret under structures of worship. The rule no longer
reads a tower class as a worship building, and those six minarets are admitted.

**What the source cannot reach.** Wikidata types some towers by no tower class: Busan's Diamond
Tower and the Tashkent Tower as a structure, the Kuala Lumpur Tower as a skyscraper, Istanbul's
Maiden's Tower as a lighthouse. And it calls some buildings towers that a traveller would not:
the Ferdowsi and Omar Khayyam mausoleums, the Cœur Défense offices, Antwerp's city hall for its
belfry, and the Svanetian tower, an item about a kind of tower rather than one. Every arrival
waits for a curator, who reads these.
