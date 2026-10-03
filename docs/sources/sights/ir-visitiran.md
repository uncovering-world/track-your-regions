---
slug: ir-visitiran
name: "Visit Iran"
publisher: "Ministry of Cultural Heritage, Tourism and Handicrafts (MCTH)"
urls:
  home: https://www.visitiran.ir/en
  dataset: none
  api: none
  terms: none
family: tourism-board
kinds: [regional-food, places-of-worship, regional-crafts, natural-landmarks, towns-and-villages, festivals-and-events, parks-and-gardens, intangible-heritage, world-heritage, squares-and-streets, palaces-and-castles, historic-houses, archaeology, bridges-and-engineering, zoos-and-aquariums, landmarks]
tier: regional
unit: { level: country, code: IR, name: Iran }
row:
  identity: "the site's own page per attraction (/attraction/<slug>); no id exposed"
  wikidata_link: none
  coordinates: unknown
  languages: [en, fa]
  signal: "being listed under a destination's Sightseeing, and under the menu's Attractions headings"
terms:
  licence: "none stated"
  database_right: not-asserted
  attribution: "Visit Iran (MCTH)"
  scraping: permitted
access:
  mode: scrape
  format: html
  cadence: "unknown: the copyright line is dated 2020"
  volume: unknown
  rate: unknown
scorecard:
  date: 2026-10-02
  completeness: 1
  identity: 0
  coordinates: unknown
  names: 2
  signal: 1
  terms: 1
  access: 1
  cadence: 0
  total: unknown
  verdict: curator-list
status: looked-at
issue: 1213
looked_at: 2026-10-02
---

# Visit Iran

The national tourism site of the Ministry of Cultural Heritage, Tourism and Handicrafts, in
English and Persian. Looked at on 2026-10-02 because the Isfahan survey read it as its source
from a public body inside the country.

**What it sorts its places into.** Destinations (Provinces, Cities, Top 10 Cities, Rural);
Attractions (UNESCO Intangible Cultural Heritage In Iran, UNESCO World Heritage Sites In Iran,
Historical Tourism, Ecotourism, Religious Tourism, Recreational Tourism, Sport Tourism);
Cuisine; Handicrafts; World Craft Cities; Art & Culture; Festivals & ceremonies; and a Tourism
Map. A destination page (Isfahan was the one read) gives the city's facts, a long text, a map
with a point for the city, and a "Sightseeing" strip that mixes attractions, crafts and a
desert; an attraction has a page of its own under `/attraction/<slug>`, which was not read.

**Terms ([the access table](../site-access.md), 2026-10-02).** `www.visitiran.ir`: `allowed`
(robots open; no terms linked). `robots.txt`: open (`*`: `Disallow:` (empty)). Terms: no terms
page linked. The footer links a privacy policy only; the fetch tool read it: privacy matters
only. Footer, read for this record: "Copyright 2020 - All rights reserved - Ministry of Cultural
Heritage. Tourism and Handicrafts (MCTH)".

**What decides it.** Identity 0, so the verdict is `curator-list` whatever the total of unknown.
The destination page carries a point for the city, and whether an attraction's page carries one
of its own was not measured, so the coordinates are `unknown`. No licence is stated: ask first.
The site has a contact page (`/en/contact-us`), not read.

**What the survey measured.** It could be read: the Isfahan and Kashan destination pages, the
attractions list, the Isfahan province page and the Natanz page; eight names that stood only in
a search's summary were withdrawn. The Isfahan survey of 2026-10-02 counted it on 71 of the 149
entries of `db/catalogue-coverage/expectations/isfahan.jsonl` (by type: place 42, food 14,
object 6, event 5, activity 4). On none of them is the surveyor's own list the only other
source. The kinds in the front matter are those under which the survey filed two or more of the
entries it is named on.
