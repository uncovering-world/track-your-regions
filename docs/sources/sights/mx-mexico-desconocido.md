---
slug: mx-mexico-desconocido
name: "México Desconocido"
publisher: "g21 Comunicación (Mexico)"
urls:
  home: https://www.mexicodesconocido.com.mx/
  dataset: none
  api: none
  terms: none
family: commercial
kinds: [notable-works, places-of-worship, art-museums, parks-and-gardens, archaeology]
tier: regional
unit: { level: country, code: MX, name: Mexico }
row:
  identity: "none: a place is a numbered item or a heading of an article"
  wikidata_link: unknown
  coordinates: unknown
  languages: [es]
  signal: "being one of the numbered things to do of a city's or a site's article"
terms:
  licence: "none; no terms page linked, only a privacy notice"
  database_right: unknown
  attribution: "México Desconocido"
  scraping: permitted
access:
  mode: scrape
  format: html
  cadence: "continuous: the Mexico City list read was published 2017-07-22 and modified 2026-02-23"
  volume: unknown
  rate: unknown
scorecard:
  date: 2026-10-25
  completeness: unknown
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
issue: 1962
looked_at: 2026-10-25
---

# México Desconocido

A Mexican travel magazine, published by g21 Comunicación and written from inside the country,
in Spanish. The Mexico City survey had left it unread on 2026-10-02; it was read on 2026-10-25
to re-judge the entries that the withdrawal of Viajeros Callejeros left with one source (#1962).

**What it sorts its places into.** Cities, Pueblos Mágicos, beaches, archaeological zones,
museums and gastronomy, and under them articles: lists of things to do in a city (the Mexico
City one has a hundred, numbered), a site's guide with a numbered heading per thing to see, and
lists of day trips. A place is a numbered item or a heading.

**Terms ([the access table](../site-access.md), 2026-10-02).** `www.mexicodesconocido.com.mx`:
`allowed`. `robots.txt` (read again on 2026-10-25): `OAI-SearchBot`, `ChatGPT-User`, `CCBot`,
`PerplexityBot` and `Applebot` stand under `Disallow: /`; no Anthropic agent is named, and for
every agent only query strings and WordPress paths are closed. No terms page is linked: the
footer links a privacy notice ("Aviso de privacidad"), which redirects to a PDF and was not
opened. Footer: "©2026 México Desconocido | g21 Comunicación".

**What decides it.** Identity 0, so the verdict is `curator-list`; the total is `unknown`
because completeness and coordinates were not looked at. A curator reads it.

**What the survey measured.** Seven pages by fetch, one at a time: the hundred things to do in
Mexico City, the Mexico City destination page, the Teotihuacan guide, the ten things to do in San
Juan Teotihuacán, the fifty destinations near the city, the city's typical food and the ten
Barrios Mágicos. It was read for fourteen entries only, those Viajeros Callejeros had left with
one source, so its figure is not a measure of the whole list. The Mexico City survey counts it
on 5 of the 245 entries of `db/catalogue-coverage/expectations/mexico-city.jsonl` (by type:
place 4, work 1). On 1 of them nothing else but the surveyor's own list names the entry. Which
entries those are is kept under `docs/local/`, a guide's selection being its publisher's. No kind
holds two of the entries it is named on; the kinds in the front matter are those of the five.
