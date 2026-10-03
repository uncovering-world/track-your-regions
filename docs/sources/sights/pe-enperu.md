---
slug: pe-enperu
name: Enperu
publisher: "Enperu; the site names no author, and its footer credits a web studio in Cusco"
urls:
  home: https://www.enperu.org/es/
  dataset: none
  api: none
  terms: none
family: commercial
kinds: [archaeology, natural-landmarks, towns-and-villages, hiking-trails-and-walks, viewpoints, world-heritage, cultural-landscapes, markets, iconic-transport, regional-food, historic-hotels-and-restaurants]
tier: regional
unit: { level: country, code: PE, name: Peru }
row:
  identity: "none: a place is the subject of a guide article"
  wikidata_link: unknown
  coordinates: unknown
  languages: [es, en, pt, de, fr, it, ja, zh]
  signal: "being given a guide"
terms:
  licence: "none; the footer: no reproducing, distributing or using the content without prior written authorisation"
  database_right: reserved
  attribution: Enperu
  scraping: permitted
access:
  mode: scrape
  format: html
  cadence: "unknown: titles carry the year 2026; no date on the pages read"
  volume: "two sections, Machu Picchu and the Sacred Valley"
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

# Enperu

Practical travel guides to Peru in eight languages: tickets, circuits, timetables and entry
rules. Looked at on 2026-10-02 because the Cusco survey read its Spanish edition as a guide
written inside the country.

**What it sorts its places into.** Two sections, Machu Picchu and Valle Sagrado, and under them
guide articles: which circuit, how to get there, a town of the valley. It has no page on the
city of Cusco. A place is the subject of an article.

**Terms ([the access table](../site-access.md), 2026-10-02).** `www.enperu.org`: `allowed`
(robots open; no terms linked). `robots.txt`: open (`*`: `Allow: /`). Terms: no terms page
linked. No terms page; the footer's copyright line says the content "may not be reproduced".

**What decides it.** Identity 0, so the verdict is `curator-list`; the total is `unknown`
because the coordinates were not looked at. It is narrow by design, and useful for the two
things it covers. The footer reserves every use to "prior written authorization from Enperu":
ask first.

**What the survey measured.** Fifteen pages by fetch: the two indexes, six Sacred Valley guides
and six Machu Picchu guides. The Cusco region survey of 2026-10-02 counted it on 46 of the 132
entries of `db/catalogue-coverage/expectations/cusco-region.jsonl` (by type: place 36, route 4,
activity 4, food 2). On 2 of them nothing else but the surveyor's own list names the entry. The
kinds in the front matter are those under which the survey filed two or more of the entries it
is named on.
