---
slug: wikimedia-commons-geosearch
name: Wikimedia Commons, the geotagged files near a point (list=geosearch in the File namespace)
publisher: Wikimedia Foundation (the service); the files' uploaders (the pictures, each under its own licence)
urls:
  home: https://commons.wikimedia.org/
  dataset: https://commons.wikimedia.org/wiki/Commons:Geocoding
  api: https://commons.wikimedia.org/w/api.php?action=query&list=geosearch&gsnamespace=6
  terms: https://foundation.wikimedia.org/wiki/Policy:Terms_of_Use
family: global
kinds: [any]
tier: world
unit: { level: any, code: none, name: "the world, asked one point at a time" }
row:
  identity: "a file title; a structured-data item (M-id) and often a depicts (P180) statement; no id of the place"
  wikidata_link: none
  coordinates: all
  languages: [the uploader's — a file title in any language]
  signal: "none of the place's — being photographed near the point; a file's extmetadata carries its licence and author"
terms:
  licence: "per file: CC BY, CC BY-SA, CC0 or public domain, read from extmetadata (the picture-credit rule, ADR-0043)"
  database_right: not-asserted
  attribution: "the file's author and licence, from extmetadata, on every display (ImageCreditLine)"
  scraping: not-needed
access:
  mode: api
  format: "MediaWiki API, list=geosearch with gsnamespace=6, gsradius up to 10 km, gslimit up to 500 (50 used)"
  cadence: continuous
  volume: "per point: 0–50 files within 300 m on the sample (the cap was hit at Finlandia Hall and the Aalto Centre)"
  rate: "Wikimedia's API etiquette: one request at a time, a descriptive User-Agent (userAgent() with the bot marker), back off on 429 and 5xx with Retry-After"
scorecard:
  date: 2026-10-10
  completeness: 1
  identity: 1
  coordinates: 2
  names: 2
  signal: 0
  terms: 2
  access: 2
  cadence: 2
  total: 12
  verdict: adoptable
status: looked-at
issue: 1306
looked_at: 2026-10-10
---

# Wikimedia Commons, by place

Every picture the product shows is a Commons file (ADR-0043), so Commons is not a candidate
source so much as the one host; the question #1306 asked is whether a *geotagged* file near a
component's point is a way to its picture when the component has no Wikidata item to carry P18.

**What was measured (2026-10-10).** `data/tmp-1306/wiki.mts` asked `list=geosearch` in the
File namespace within 300 m of each of 401 component points, one request a second, and compared
the file titles with the component's name:

| Site | Points | Points with a geotagged file within 300 m | …a file title resembling the name (≥ 0.5) |
|---|---|---|---|
| Frontiers of the Roman Empire – Dacia (721) | 277 | 14 | 0 |
| Aalto Works (1755) | 13 | 11 | 4 |
| Prehistoric Pile Dwellings around the Alps (418) | 111 | 68 | 4 |

Dacia's forts are photographed by almost nobody with a geotag: 14 of 277 points have any file
within 300 m, none named for the fort. Aalto's buildings have plenty (Finlandia Hall and the
Aalto Centre hit the 50-file cap; Villa Mairea 17, Paimio 18) but the files are of the place and
of everything else at that spot — a geotag says where the camera stood, not what it looked at.
Around the Alps 68 of 111 points have files within 300 m, which at a lakeshore is the lake. A
Commons *category* of the component's English name exists for none of the 401.

**What decides it.** The scorecard says `adoptable` (12 of 16, no veto), and what it adopts is
the *read*: the files near a point, offered. A geotagged file is a proposal for a curator at
best — the signal is 0 —
and the right road to a picture is still the item: P18 and the Commons category (P373) of the
item that Wikipedia geosearch or a register code finds (`wikipedia-geosearch`, `ro-lmi`,
`ch-kgs-inventar`). Where no item exists, the nearby files are what a curator is shown to pick
from, each with its extmetadata credit, never written unasked. The terms are the product's own
already.
