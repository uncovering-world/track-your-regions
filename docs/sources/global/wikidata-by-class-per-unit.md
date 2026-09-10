---
slug: wikidata-by-class-per-unit
name: Wikidata, a kind's classes read within a unit
publisher: Wikimedia Foundation and the Wikidata community
urls:
  home: https://www.wikidata.org/
  dataset: https://query.wikidata.org/
  api: https://qlever.dev/api/wikidata
  terms: https://www.wikidata.org/wiki/Wikidata:Licensing
family: global
kinds: [any]
tier: regional
unit: { level: any, code: none, name: "any unit, read by country (P17) or by coordinates inside its boundary" }
row:
  identity: "the item"
  wikidata_link: itself
  coordinates: most
  languages: [all]
  signal: "readership in the unit's official languages, cut within the unit — of the museum's own article (measured per unit 2026-09-04), or through the works it holds, the museum scoring as its best (ADR-0054); sitelinks ranked within the unit as the control"
terms:
  licence: "CC0 1.0"
  database_right: waived
  attribution: "Wikidata (not required; given)"
  scraping: not-needed
access:
  mode: api
  format: "SPARQL (the Query Service, 60 s; QLever for a full scan)"
  cadence: continuous
  volume: "per unit: Paris 236 museums, Florence 162, Berlin 233, Kraków 116, Lima 30, Tbilisi 32, Estonia 346 by country"
  rate: "the Query Service refuses heavy patterns; keep queries flat, one band at a time"
scorecard:
  date: 2026-09-10
  completeness: 1
  identity: 2
  coordinates: 1
  names: 2
  signal: 2
  terms: 2
  access: 2
  cadence: 2
  total: 14
  verdict: adoptable
status: looked-at
issue: 807
looked_at: 2026-09-10
---

# Wikidata, read per unit

The world tier's source for two kinds already (ADR-0023; the public-art line reuses it, #754),
and the **fallback** of
the regional tier where no native source exists or can be read
(`docs/tech/filling-a-kind.md` § 4, § 7.4): any museum class (`P31/P279*` under Q33506)
located in the unit, ranked by a within-unit signal. Also the yardstick every native source is
measured against.

**What was measured (2026-09-06, through QLever's endpoint; the Query Service timed out on the
same pattern).** Museums located in the unit, with coordinates, in the art-museum subtree, and
at 22 / 10 sitelinks: Paris 236 (220) 63, 30/71; Florence 162 (137) 50, 17/35; Berlin 233
(214) 39, 25/58; Kraków 116 (116) 31, 3/13; Lima 30 (28) 3, 0/4; Tbilisi 32 (30) 3, 2/9;
Estonia by country 346 (43) 1, 5/22; Georgia by country 124 (82) 9, 5/16; Peru by country
187 (157) 18, 0/4; Poland by country 1,792 (1,769) 185, 14/64. Tbilisi's museums by
sitelinks: the Museum of Soviet Occupation 27, the Art Museum of Georgia 23, the Simon
Janashia Museum 20, the National Centre of Manuscripts 18, the Open Air Museum of Ethnography
15, the National Gallery 14 — the order a resident would give.

**Two cautions the measurement left.** The location chain (`P131*`) to a unit is not
guaranteed: Tallinn counts one museum through it because Kumu (Q919611) points at a second
item labelled "Tallinn" (Q4450503) rather than the city's (Q1770); a country is read by P17
and a city by coordinates inside its boundary. And completeness is 1 at best — Wikidata knows
what somebody wrote an item for: 30 museums in Lima against 109 on OpenStreetMap.

**Terms.** CC0.

**What was measured for the signal (2026-09-10, #807, ADR-0054).** A work's share of readers in
the official languages of the country it is held in, over twelve months of Wikimedia's pageview
dumps, and a museum scored as its best work. Below 22 sitelinks it correlates with the sitelink
count at +0.19 — the sum over every edition at +0.36, raw views at +0.58 — so it orders a unit's
museums differently from the world line rather than lower on it. Cut within the country at a
view floor of 2,000, it keeps 378 to 509 museums outside the catalogue as the cut widens from one
decade to two. It ranks and does not find: of the eight canon places `filling-a-kind.md` § 7.6
names, it reaches two, each through a famous local work — the Art Museum of Georgia through the
Khakhuli triptych, the Niguliste Museum through Notke's *Danse Macabre* — and Wikidata places no
artwork at all at the Georgian Museum of Fine Arts or at Manggha. That is the reading through a
museum's works; the reading of the museum's own article, measured per unit on 2026-09-04 (Kumu,
the Niguliste Museum), is a second signal this record keeps and #807 did not re-measure. A
country's languages are read from `P37` through `P424` until #809 gives a region its own list;
Filipino has no `P424`, so the Philippines reads as English.

**What decides it.** Adopted *per unit* as the fallback, with § 4's three conditions measured
— coverage against the unit's canon, the share of rows with an item (all, here), and a floor
on the group for the within-unit cut — and replaced when a native source arrives. The place
that shows it: the Georgian Museum of Fine Arts in Tbilisi, 11 sitelinks, a museum no register
lists because Georgia's is unpublished.
