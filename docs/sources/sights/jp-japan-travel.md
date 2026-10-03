---
slug: jp-japan-travel
name: "Travel Japan (japan.travel)"
publisher: "Japan National Tourism Organization (JNTO)"
urls:
  home: https://www.japan.travel/en/destinations/kansai/kyoto/
  dataset: none
  api: none
  terms: https://www.japan.travel/en/terms-of-use/
family: tourism-board
kinds: [places-of-worship, parks-and-gardens, festivals-and-events, art-museums, towns-and-villages, neighbourhoods, palaces-and-castles, markets, hiking-trails-and-walks, intangible-heritage, architecture, natural-landmarks, regional-drinks, seasonal-phenomena, day-trips-and-itineraries, notable-works, food-experiences, landmarks, viewpoints, regional-crafts, entertainment-venues, world-heritage, regional-food]
tier: regional
unit: { level: country, code: JP, name: Japan }
row:
  identity: unknown
  wikidata_link: unknown
  coordinates: unknown
  languages: [en, de, es, fr, it, pt, ar, id, ko, th, vi, zh]
  signal: "being named on a prefecture's or an area's page"
terms:
  licence: "none; terms of use: materials may not be reproduced, distributed, displayed, copied or stored without permission"
  database_right: reserved
  attribution: "Japan National Tourism Organization"
  scraping: permitted
access:
  mode: scrape
  format: html
  cadence: "unknown: no date on the page read"
  volume: unknown
  rate: unknown
scorecard:
  date: 2026-10-02
  completeness: 1
  identity: unknown
  coordinates: unknown
  names: 0
  signal: 1
  terms: 1
  access: 1
  cadence: 0
  total: unknown
  verdict: provisional
status: looked-at
issue: 1213
looked_at: 2026-10-02
---

# Travel Japan

The site of the Japan National Tourism Organization for visitors from abroad, in a dozen
languages; its Japanese pages (`/jp/`) and its travel directory are closed by `robots.txt`.
Looked at on 2026-10-02 because the Kyoto survey read it as the national body's.

**What it sorts its places into.** Destinations by region and prefecture. The Kyoto page, which
the server answered in German whatever was asked for, has a "don't miss" list, recommendations,
sights by area, trending attractions, local specialities and seasonal highlights, and area pages
under it. Only that page was read for this record, so what a place's page carries is not known
here.

**Terms ([the access table](../site-access.md), 2026-10-02).** `www.japan.travel`: `allowed`
(terms silent on automated reading; robots close the travel directory). `robots.txt`: some paths
closed (`*`: `Allow: /` with those three closed). Terms: silent on automated reading, at
https://www.japan.travel/en/terms-of-use/. "All materials on www.japan.travel have been licensed
through JNTO, and may not be reproduced, distributed, displayed, copied or stored for public or
private use without permission" (fetch tool's quotation). Nothing on automated access. The
server answered this audit in German whatever was asked for.

**What decides it.** Not decided: identity and coordinates were not looked at, so the verdict is
`provisional`. The terms name storing among the things that need permission ("may not be
reproduced, distributed, displayed, copied or stored for public or private use without
permission", the table's quotation): ask first, and before anything is kept.

**What the survey measured.** Thirteen pages by fetch, all under `/en/destinations/`: the Kyoto
prefecture page, its eight area pages, two Nara pages and two Shiga pages. The Kyoto survey of
2026-10-02 counted it on 119 of the 246 entries of
`db/catalogue-coverage/expectations/kyoto.jsonl` (by type: place 90, activity 9, event 7, route
5, drink 2, work 2, object 2, food 2). On 1 of them nothing else but the surveyor's own list
names the entry. Places among those: Kawai Kanjiro's House. The kinds in the front matter are
those under which the survey filed two or more of the entries it is named on.
