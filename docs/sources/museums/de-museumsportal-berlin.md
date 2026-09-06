---
slug: de-museumsportal-berlin
name: Museumsportal Berlin
publisher: Kulturprojekte Berlin GmbH (with the museums of the city)
urls:
  home: https://www.museumsportal-berlin.de/en/museums/
  dataset: none
  api: none
  terms: https://www.museumsportal-berlin.de/robots.txt
family: tourism-board
kinds: [art-museums, archaeology-museums, history-museums]
tier: regional
unit: { level: city, code: DE-BE, name: Berlin }
row:
  identity: "the portal's own page per museum; no id exposed"
  wikidata_link: none
  coordinates: address-only
  languages: [de, en]
  signal: "being listed — an editorial selection of the city's museums, memorials and collections, with a description each"
terms:
  licence: none stated
  database_right: reserved
  attribution: "Museumsportal Berlin"
  scraping: reserved
access:
  mode: scrape
  format: html
  cadence: continuous
  volume: "205 results, 24 to a page"
  rate: unknown
scorecard:
  date: 2026-09-06
  completeness: 2
  identity: 0
  coordinates: 1
  names: 2
  signal: 1
  terms: 1
  access: 1
  cadence: 2
  total: 10
  verdict: curator-list
status: looked-at
issue: 799
looked_at: 2026-09-06
---

# Museumsportal Berlin

The city's museum portal — 205 museums, memorials and collections with addresses, opening
hours and an editorial description each, 24 to a page. Looked at on 2026-09-06 as the worked
example of a tourism board's list (`docs/tech/filling-a-kind.md` § 7.3).

**What decides it.** The shape is exactly the regional tier's — an enumeration of what the city
holds with "worth seeing" built in — and the terms are why it is not a source yet: no licence
on the page, a `robots.txt` content signal reserving the content for search and reference and
disallowing crawlers by name, and under the EU database right reading all 205 is extraction of
a substantial part. The mode is therefore *ask first*: the record keeps the address to write
to, and until permission is given the portal is a list a curator reads. Identity 0 (no id, no
Wikidata) is the second reason, and by § 6.2 it is what sets the verdict: `curator-list`,
whatever the total of 10 — a list a curator reads, never a source a sync writes from.

**Beside it.** Wikidata holds 233 museums in Berlin (214 with coordinates, 39 art museums,
25 at 22 sitelinks); OpenStreetMap 247 (144 with a Wikidata tag); Wikivoyage's *Berlin/Mitte*
71 See listings with 63 items. The world tier holds the Alte Nationalgalerie and the
Gemäldegalerie and nothing else in the city. The place that shows the gap: the Berlinische
Galerie, 21 sitelinks, one short of the line. The Institut für Museumsforschung's database of
some 6,300 German museums is the register to look for; no open dataset of it was found.
