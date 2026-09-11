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
  signal: "sitelinks ranked within the unit; for art museums, the local fame of the works a museum holds — their readership in the unit's languages against the world tier's works in the same language (ADR-0057, in draft)"
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
  date: 2026-09-11
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
looked_at: 2026-09-11
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

**What was measured for the signal (September 2025 to August 2026, #807; ADR-0055 to
ADR-0057, in draft).** Readership was read through the works a museum holds, on the museum
import's own placement: 9,967 works at 1,005 venues. A work's *local fame* is its views in an
official language of the country that holds it, over the median views in that language of the
world tier's works — 48,983 in English, 9,074 in Italian, 366 in Georgian. At 1 or more it finds
171 candidate art museums outside the world tier, 168 of them in 47 countries once the
reader-country check has run, each still to pass the curator's gate, and Wikivoyage lists 40 % of
those in
its 40 test cities against 28 % of all candidates. It reaches a museum through a famous work —
the Art Museum of Georgia through the Khakhuli triptych — and not a museum famous as an
institution: the Frida Kahlo Museum, the National Museum of Fine Arts in Buenos Aires, the
Burrell Collection. A country's languages are read from `P37` through `P424` until #809 gives a
region its own list. The readership of a museum's own article, measured per unit on 2026-09-04
(`docs/tech/filling-a-kind.md` § 7.4), is a different signal and was not measured over the pool.

**Terms.** CC0.

**What decides it.** Adopted *per unit* as the fallback, with § 4's three conditions measured
— coverage against the unit's canon, the share of rows with an item (all, here), and a floor
on the group where the cut ranks a unit's museums against each other, as a percentile of sitelinks
does; the local fame of art museums needs no floor, since its bar is set per language (ADR-0057,
in draft) — and replaced when a native source arrives. The place
that shows it: the Georgian Museum of Fine Arts in Tbilisi, 11 sitelinks, a museum no register
lists because Georgia's is unpublished.
