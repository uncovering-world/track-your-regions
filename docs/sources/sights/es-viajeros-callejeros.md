---
slug: es-viajeros-callejeros
name: "Viajeros Callejeros"
publisher: "Viajeros Callejeros 2021 SL (Spain)"
urls:
  home: https://www.viajeroscallejeros.com/
  dataset: none
  api: none
  terms: https://www.viajeroscallejeros.com/aviso-legal/
family: commercial
kinds: [archaeology, natural-landmarks, places-of-worship, towns-and-villages, viewpoints, markets, regional-food, hiking-trails-and-walks, notable-works, outdoor-activities, world-heritage, cultural-landscapes, neighbourhoods, regional-drinks, art-museums, day-trips-and-itineraries, historic-hotels-and-restaurants]
tier: regional
unit: { level: any, code: none, name: "read per destination" }
row:
  identity: "none: a place is a heading of a list article"
  wikidata_link: unknown
  coordinates: unknown
  languages: [es]
  signal: "being one of the numbered places of a destination's article"
terms:
  licence: "none; legal notice: no reproduction, distribution or public communication for commercial ends without authorisation"
  database_right: reserved
  attribution: "Viajeros Callejeros"
  scraping: permitted
access:
  mode: scrape
  format: html
  cadence: "continuous: the article read was modified 2026-09-28"
  volume: unknown
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
  cadence: 2
  total: unknown
  verdict: curator-list
status: looked-at
issue: 1213
looked_at: 2026-10-02
---

# Viajeros Callejeros

A Spanish-language travel blog "para viajar por libre", owned by a Spanish company. Two surveys
read it as their Spanish-language guide: the Cusco region's and Mexico City's. It is written in
the language of both places and from neither, so it is not a source from inside the country; it
is recorded because the surveys counted it beside those that are. Its file carries the
publisher's country, and its unit is `any`: it is read per destination.

**What it sorts its places into.** Countries by continent, and "Top 10" lists of cities. A
destination has list articles (so many places to see, a day in the city, the best tours) and
diary pages of a trip, day by day. A place is a numbered heading or a name in the day's text.

**Terms ([the access table](../site-access.md), 2026-10-02).** `www.viajeroscallejeros.com`:
`allowed` (legal notice silent on automated reading). `robots.txt`: open (`*`: WordPress service
paths; Googlebot, Facebook's agents, OAI-SearchBot and ChatGPT-User each have `Allow: /`; no
Anthropic agent named). Signal: /llms.txt exists: "# Viajeros Callejeros". Terms: silent on
automated reading, at https://www.viajeroscallejeros.com/aviso-legal/. Reproduction,
distribution and public communication "con fines comerciales" are forbidden without
authorisation; nothing on robots, mining or AI.

**What decides it.** Identity 0, so the verdict is `curator-list`; the total is `unknown`
because the coordinates were not looked at. The legal notice reserves commercial reuse: ask
first.

**What the survey measured.** For the Cusco region, ten pages by fetch, readers' comments cut
before reading; for Mexico City, four. The Cusco region survey of 2026-10-02 counted it on 84 of
the 132 entries of `db/catalogue-coverage/expectations/cusco-region.jsonl` (by type: place 66,
route 5, activity 4, food 4, work 3, drink 2). On 2 of them nothing else but the surveyor's own
list names the entry. The kinds in the front matter are those under which the survey filed two
or more of the entries it is named on. The Mexico City survey of 2026-10-02 counted it on 77 of
the 252 entries of `db/catalogue-coverage/expectations/mexico-city.jsonl` (by type: place 57,
work 8, activity 6, route 3, drink 2, food 1). On 2 of them nothing else but the surveyor's own
list names the entry.
