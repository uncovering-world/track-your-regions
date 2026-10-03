---
slug: es-guias-viajar
name: "Guías Viajar"
publisher: "Guías Viajar S.L. (Spain)"
urls:
  home: https://guias-viajar.com/
  dataset: none
  api: none
  terms: https://guias-viajar.com/aviso-legal-politica-cookies/
family: commercial
kinds: [neighbourhoods, archaeology, art-museums, squares-and-streets, world-heritage, places-of-worship, architecture, parks-and-gardens, notable-works]
tier: regional
unit: { level: any, code: none, name: "read per destination" }
row:
  identity: "none: a place is a heading of an article"
  wikidata_link: unknown
  coordinates: unknown
  languages: [es]
  signal: "being one of the numbered essentials of a city's article"
terms:
  licence: "none; legal notice: photographs and videos may be reused on a non-commercial site with the source named; article text may not be copied"
  database_right: reserved
  attribution: "Guías Viajar"
  scraping: permitted
access:
  mode: scrape
  format: html
  cadence: "irregular: the article read is dated 2022-12-16 and was modified 2025-08-27"
  volume: "one article for Mexico City"
  rate: unknown
scorecard:
  date: 2026-10-02
  completeness: 1
  identity: 0
  coordinates: unknown
  names: 1
  signal: 1
  terms: 1
  access: 1
  cadence: 1
  total: unknown
  verdict: curator-list
status: looked-at
issue: 1213
looked_at: 2026-10-02
---

# Guías Viajar

A Spanish travel guide site, owned by a Spanish company, whose menu begins with the regions of
Spain. The Mexico City survey read one article of it as a second Spanish-language guide. Like
`es-viajeros-callejeros` it is written in the city's language and not from the city; it is
recorded because the survey counted it. Its unit is `any`.

**What it sorts its places into.** Countries and regions, and under them articles. The one read
is a list of fifteen essentials of the city for two or three days, a heading each.

**Terms ([the access table](../site-access.md), 2026-10-02).** `guias-viajar.com`: `allowed`
(legal notice silent on automated reading). `robots.txt`: open (`*`: /wp-admin/ only). Terms:
silent on automated reading, at https://guias-viajar.com/aviso-legal-politica-cookies/.
Photographs and videos may be reused on a non-commercial site with the source named; article
text may not be copied. Nothing on automated access.

**What decides it.** Identity 0, so the verdict is `curator-list`; the total is `unknown`
because the coordinates were not looked at. The legal notice forbids copying the text: a curator
reads it.

**What the survey measured.** One page by fetch. The Mexico City survey of 2026-10-02 counted it
on 36 of the 252 entries of `db/catalogue-coverage/expectations/mexico-city.jsonl` (by type:
place 31, activity 2, work 2, route 1). On none of them is the surveyor's own list the only
other source. The kinds in the front matter are those under which the survey filed two or more
of the entries it is named on.
