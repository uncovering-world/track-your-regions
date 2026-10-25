---
slug: street-art-cities
name: Street Art Cities
publisher: Street Art Cities BV (the Netherlands)
urls:
  home: https://streetartcities.com/
  dataset: https://streetartcities.com/open-data
  api: none
  terms: https://streetartcities.com/legal/terms
family: commercial
kinds: [public-art]
tier: none
unit: { level: any, code: none, name: any }
row:
  identity: "the site's own artwork id, in its URLs"
  wikidata_link: none
  coordinates: all
  languages: [en]
  signal: "none: a directory of the street art its users ('hunters') record, every mural alike"
terms:
  licence: "open data for academic use only: \"It is not allowed to use this data set to redistribute or integrate in any non-academic context\" without the company's consent; images and descriptions CC BY-SA 4.0; the metadata may not be redistributed without written permission"
  database_right: reserved
  attribution: "not reached"
  agent: allowed
  agent_rests_on: "site-access.md, streetartcities.com, read 2026-10-25: robots.txt open, terms silent on robots, scraping and AI"
  program: refused
  program_rests_on: "the open-data page limits the dataset to academic analysis and bars integrating it in any non-academic context; the catalogue is not academic research"
  model: none
access:
  mode: dump
  format: "CSV and JSON, one file per country, monthly"
  cadence: "monthly"
  volume: unknown
  rate: none
scorecard:
  date: 2026-10-25
  completeness: 1
  identity: 1
  coordinates: 2
  names: 1
  signal: 0
  terms: 0
  access: 2
  cadence: 2
  total: 9
  verdict: veto
status: refused
issue: 1992
looked_at: 2026-10-25
---

# Street Art Cities

A platform where users record street art by city. Each artwork has a coordinate, an artist where
known, and photographs. It was looked at by #1992 as a regional or world source for the street
art Public art misses.

**What it holds.** The open-data page offers monthly CSV and JSON exports per country, with
artists, coordinates and links, and no photographs. It does not say how many works or cities the
data covers. Nothing on the page marks a work as removed or painted over. A painted-over mural
is the common fate of street art (Mohamed Mahmoud Street in Cairo, Girl with Balloon on the
South Bank), so a row's present state cannot be known from the source.

**Signal.** None. It records every mural its users find. It does not say which a traveller
crosses a city for, which is the question the kind asks.

**Terms (read 2026-10-25).** The open-data page limits the data to academics, who may analyse it
"in a geographic, demographic or social context". It says: "It is not allowed to use this data set
to redistribute or integrate in any non-academic context". Other uses go through its Partner
Program. The terms of service license images and descriptions under CC BY-SA 4.0. They also say:
"You are not allowed to re-distribute this Metadata without express written permission". A
program of the catalogue would integrate the data, which the terms bar. That is a veto, and the
record is refused.
