---
slug: pe-promperu
name: "Perú Travel and Y tú qué planes? (PromPerú)"
publisher: "PromPerú (Comisión de Promoción del Perú para la Exportación y el Turismo)"
urls:
  home: https://www.peru.travel/es
  dataset: none
  api: none
  terms: https://www.peru.travel/en/terms-and-conditions
family: tourism-board
kinds: [archaeology, places-of-worship, towns-and-villages, natural-landmarks, world-heritage, viewpoints, art-museums, hiking-trails-and-walks, notable-works, outdoor-activities, cultural-landscapes, neighbourhoods, markets, festivals-and-events, day-trips-and-itineraries, public-art, regional-food, history-museums, zoos-and-aquariums]
tier: regional
unit: { level: country, code: PE, name: Peru }
row:
  identity: "the site's page per attraction (peru.travel/es/atractivos/<slug>; ytuqueplanes.com/destinos/<region>/<slug>); no id exposed"
  wikidata_link: none
  coordinates: unknown
  languages: [es, en]
  signal: "being given an attraction page under a destination"
terms:
  licence: "none; peru.travel's terms: the user may not copy, distribute, reproduce or publish its information"
  database_right: reserved
  attribution: "PromPerú"
  scraping: permitted
access:
  mode: scrape
  format: "html; peru.travel's attraction index, calendar and restaurant guide are filter forms drawn by script"
  cadence: "unknown: the pages read carry no date"
  volume: "14 attraction pages for Cusco on peru.travel and 21 destination pages on ytuqueplanes.com, by the survey's count"
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

# Perú Travel and Y tú qué planes?

Two sites of PromPerú, the national tourism board: `peru.travel`, in Spanish and English, and
`ytuqueplanes.com`, in Spanish, which the survey records as its site for domestic travellers.
The survey counts them as one source, and this is one record. Looked at on 2026-10-02 because
the Cusco survey read both.

**What it sorts its places into.** On peru.travel, destinations, attractions and experiences: an
attraction has a page of its own (`/es/atractivos/<slug>`), typed `TouristAttraction` in its
structured data, with a text and a map; the one read, the cathedral of Cusco, shows the map
through a query by name, and no point stands in its markup. On ytuqueplanes.com, Destinos,
Experiencias, Ofertas, Rutas Cortas and a blog: the Cusco page lists some twenty destination
pages (a trail, a circuit, the city, its archaeological complexes, a valley, a lagoon), each
with its own list of what to see.

**Terms ([the access table](../site-access.md), 2026-10-02).** `www.peru.travel`: `allowed`
(terms silent on automated reading). `robots.txt`: open (`*`: /*/users/*/ only). Terms: silent
on automated reading, at https://www.peru.travel/en/terms-and-conditions. "the user is not
authorized to modify, copy, distribute, disclose, transmit, use, reproduce, publish, transfer or
sell information" (fetch tool's quotation). Nothing on robots or automated access.
`www.ytuqueplanes.com`: `allowed` (terms are about personal data). `robots.txt`: open (`*`:
search and offer-form paths. 28 old offline copiers are disallowed by name, among them `Fetch`,
`libwww` and `wget`; no AI agent). Terms: silent on automated reading, at
https://www.ytuqueplanes.com/terminos-y-condiciones. About personal data and cookies only.

**What decides it.** Identity 0, so the verdict is `curator-list`; the total is `unknown`
because the coordinates were not measured. The terms of peru.travel reserve copying and
publishing: ask first.

**What the survey measured.** Thirty-three pages of peru.travel by fetch (the Cusco destination
page, 14 attraction pages, 9 experience pages, 6 articles, and the attraction index, events
calendar and restaurant guide, which came back as empty filter forms) and 22 of ytuqueplanes.com
(the Cusco page and its 21 destination pages). The twelve "rutas cortas" of ytuqueplanes.com are
drawn by script and were left unread. The Cusco region survey of 2026-10-02 counted it on 89 of
the 132 entries of `db/catalogue-coverage/expectations/cusco-region.jsonl` (by type: place 71,
route 5, activity 5, work 3, event 2, food 2, drink 1). On 1 of them nothing else but the
surveyor's own list names the entry. Places among those: San Francisco church and convent. The
kinds in the front matter are those under which the survey filed two or more of the entries it
is named on.
